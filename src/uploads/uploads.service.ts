import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { APP_CONFIG } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';
import {
  ClientAbortedError,
  ReceivedFile,
  receiveSingleFile,
} from './receive-upload';
import {
  ALLOWED_EXTENSIONS,
  apiError,
  buildObjectKey,
  FileStatus,
  fileTooLarge,
  mimeTypeFor,
  sanitizeFileName,
  tmpPaths,
} from './upload-policy';
import { UploadQueue } from './upload-queue';
import { FileEntity } from '../entities/file.entity';
import { isUniqueViolation, UploadsRepository } from './uploads.repository';

export interface UploadView {
  id: string;
  name: string;
  folderId: string;
  contentType: string | null;
  sizeBytes: number;
  status: FileStatus;
  createdAt: string;
}

function toView(row: FileEntity): UploadView {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly repo: UploadsRepository,
    private readonly queue: UploadQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Recibe el archivo, crea la fila en estado queued y publica el mensaje en SQS. */
  async upload(
    userId: string,
    folderId: string,
    req: IncomingMessage,
  ): Promise<UploadView> {
    const { maxBytes, tmpDir } = this.config.uploads;

    const declared = Number(req.headers['content-length']);
    // Margen para las cabeceras multipart.
    if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) {
      req.resume();
      throw fileTooLarge(maxBytes);
    }

    if (!(await this.repo.canUploadTo(userId, folderId))) {
      req.resume();
      // 404 también cuando no hay permiso.
      throw apiError(404, 'FOLDER_NOT_FOUND', 'La carpeta no existe');
    }

    await mkdir(tmpDir, { recursive: true });
    const uploadId = randomUUID();

    let received: ReceivedFile;
    try {
      received = await receiveSingleFile(req, {
        uploadId,
        tmpDir,
        maxBytes,
        accept: async (rawName) => {
          const name = sanitizeFileName(rawName);
          if (!name) {
            throw apiError(
              400,
              'INVALID_NAME',
              'El nombre del archivo no es válido',
            );
          }
          const mimeType = mimeTypeFor(name);
          if (!mimeType) {
            throw apiError(
              415,
              'UNSUPPORTED_TYPE',
              `Tipo de archivo no permitido. Se aceptan: ${ALLOWED_EXTENSIONS.join(', ')}`,
            );
          }
          if (await this.repo.nameTaken(folderId, name)) {
            throw duplicateName(name);
          }
          return { name, mimeType };
        },
      });
    } catch (err) {
      if (err instanceof ClientAbortedError) {
        this.logger.log(
          `Carga ${uploadId} cancelada por el cliente durante el envío`,
        );
        throw apiError(499, 'CLIENT_CLOSED_REQUEST', err.message);
      }
      throw err;
    }

    let row: FileEntity;
    try {
      row = await this.repo.insertQueued({
        ownerId: userId,
        folderId,
        name: received.name,
        contentType: received.mimeType,
        sizeBytes: received.sizeBytes,
        s3Key: buildObjectKey(userId, folderId, uploadId, received.name),
      });
    } catch (err) {
      await rm(received.path, { force: true });
      if (isUniqueViolation(err)) throw duplicateName(received.name);
      throw err;
    }

    // El worker busca el temporal por el id de la fila.
    const tmpPath = tmpPaths(tmpDir, row.id).complete;
    try {
      await rename(received.path, tmpPath);
      await this.queue.publish({ fileId: row.id });
    } catch (err) {
      this.logger.error(`No se pudo encolar ${row.id}`, err as Error);
      await this.repo.deleteIfStatus(row.id, ['queued']);
      await rm(received.path, { force: true });
      await rm(tmpPath, { force: true });
      throw apiError(
        503,
        'QUEUE_UNAVAILABLE',
        'No se pudo encolar el archivo, intenta de nuevo',
      );
    }

    return toView(row);
  }

  /** Estado de una carga del usuario. */
  async status(userId: string, fileId: string): Promise<UploadView> {
    const row = await this.repo.findOwned(fileId, userId);
    if (!row) throw notFound();
    return toView(row);
  }

  /**
   * Cancela una carga. En queued o error borra la fila y el temporal; en uploading
   * la marca como cancelled y el worker limpia. Reintenta si el estado cambia
   * entre la lectura y la escritura.
   */
  async cancel(
    userId: string,
    fileId: string,
  ): Promise<{ id: string; status: 'cancelled' }> {
    const done = { id: fileId, status: 'cancelled' as const };

    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.repo.findOwned(fileId, userId);
      if (!row) throw notFound();

      switch (row.status) {
        case 'queued':
        case 'error':
          if (await this.repo.deleteIfStatus(fileId, [row.status])) {
            await rm(tmpPaths(this.config.uploads.tmpDir, fileId).complete, {
              force: true,
            });
            return done;
          }
          break;
        case 'uploading':
          if (await this.repo.transition(fileId, ['uploading'], 'cancelled')) {
            return done;
          }
          break;
        case 'cancelled':
          return done;
        case 'ready':
          throw apiError(
            409,
            'UPLOAD_ALREADY_FINISHED',
            'La carga ya terminó; para quitar el archivo usa DELETE /files/{id}',
          );
      }
    }
    throw apiError(
      409,
      'UPLOAD_STATE_CHANGED',
      'La carga cambió de estado, reintenta',
    );
  }
}

function duplicateName(name: string) {
  return apiError(
    409,
    'DUPLICATE_NAME',
    `Ya existe un archivo llamado "${name}" en esta carpeta`,
  );
}

function notFound() {
  return apiError(404, 'FILE_NOT_FOUND', 'El archivo no existe');
}
