import { Inject, Injectable, Logger } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { APP_CONFIG } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';
import { tmpPaths } from '../uploads/upload-policy';
import { UploadStorage } from '../uploads/upload-storage';
import { FileEntity } from '../entities/file.entity';
import { UploadsRepository } from '../uploads/uploads.repository';

/** ack: borrar el mensaje. retry: reintentar. dead: último intento, va a la DLQ. */
export type Outcome = 'ack' | 'retry' | 'dead';

export interface JobContext {
  fileId: string;
  /** Veces que SQS entregó el mensaje. */
  receiveCount: number;
  /** Extiende el visibility timeout del mensaje. */
  keepAlive: () => Promise<void>;
}

@Injectable()
export class UploadProcessor {
  private readonly logger = new Logger(UploadProcessor.name);

  constructor(
    private readonly repo: UploadsRepository,
    private readonly storage: UploadStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async process(ctx: JobContext): Promise<Outcome> {
    const { fileId } = ctx;
    const tmp = tmpPaths(this.config.uploads.tmpDir, fileId).complete;

    // Pasa a uploading solo si está en queued o uploading.
    const row = await this.repo.transition(
      fileId,
      ['queued', 'uploading'],
      'uploading',
    );
    if (!row) return this.handleNotClaimable(fileId, tmp);

    // Sube al bucket; se aborta si la carga se cancela.
    const cancel = new AbortController();
    const stopWatching = this.watch(ctx, cancel);
    try {
      await this.storage.putFile(
        row.s3Key,
        tmp,
        row.contentType ?? 'application/octet-stream',
        cancel.signal,
      );
    } catch (err) {
      if (cancel.signal.aborted || (await this.isCancelled(fileId))) {
        await this.cleanupCancelled(row, tmp);
        return 'ack';
      }
      return this.handleFailure(ctx, row, tmp, err);
    } finally {
      stopWatching();
    }

    // Si se canceló durante la subida, se borra lo subido.
    if (!(await this.repo.transition(fileId, ['uploading'], 'ready'))) {
      await this.cleanupCancelled(row, tmp);
      return 'ack';
    }
    await rm(tmp, { force: true });
    this.logger.log(`Archivo ${fileId} listo (${row.sizeBytes} bytes)`);
    return 'ack';
  }

  private async handleNotClaimable(
    fileId: string,
    tmp: string,
  ): Promise<Outcome> {
    const current = await this.repo.findById(fileId);
    if (!current) {
      // La fila ya no existe: se canceló en cola.
      await rm(tmp, { force: true });
      return 'ack';
    }
    if (current.status === 'cancelled') {
      await this.cleanupCancelled(current, tmp);
    }
    // ready o error: mensaje duplicado.
    return 'ack';
  }

  private async handleFailure(
    ctx: JobContext,
    row: FileEntity,
    tmp: string,
    err: unknown,
  ): Promise<Outcome> {
    const reason = err instanceof Error ? err.message : String(err);
    const missingTmp = (err as { code?: string } | null)?.code === 'ENOENT';
    const lastAttempt =
      missingTmp || ctx.receiveCount >= this.config.worker.maxReceiveCount;

    if (lastAttempt) {
      this.logger.error(
        `Archivo ${row.id} falló en el intento ${ctx.receiveCount}: ${reason}. Se marca como error.`,
      );
      await this.repo.transition(row.id, ['uploading'], 'error');
      await rm(tmp, { force: true });
      // Sin temporal no se puede reintentar.
      return missingTmp ? 'ack' : 'dead';
    }

    this.logger.warn(
      `Archivo ${row.id} falló en el intento ${ctx.receiveCount}: ${reason}. Se reintentará.`,
    );
    await this.repo.transition(row.id, ['uploading'], 'queued');
    return 'retry';
  }

  /** Borra el objeto, el temporal y la fila de una carga cancelada. */
  private async cleanupCancelled(row: FileEntity, tmp: string): Promise<void> {
    await this.storage.deleteObject(row.s3Key);
    await rm(tmp, { force: true });
    await this.repo.deleteIfStatus(row.id, ['cancelled']);
    this.logger.log(`Carga ${row.id} cancelada y limpiada`);
  }

  private async isCancelled(fileId: string): Promise<boolean> {
    const current = await this.repo.findById(fileId);
    return !current || current.status === 'cancelled';
  }

  /** Cada heartbeatMs extiende la visibilidad del mensaje y revisa si la carga se canceló. */
  private watch(ctx: JobContext, cancel: AbortController): () => void {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      Promise.all([ctx.keepAlive(), this.isCancelled(ctx.fileId)])
        .then(([, cancelled]) => {
          if (cancelled) cancel.abort();
        })
        .catch((err: Error) =>
          this.logger.warn(`Heartbeat de ${ctx.fileId}: ${err.message}`),
        )
        .finally(() => {
          busy = false;
        });
    }, this.config.worker.heartbeatMs);
    return () => clearInterval(timer);
  }
}
