import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../infra/infra.module';
import { FileStatus } from './upload-policy';

export interface FileRow {
  id: string;
  ownerId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  status: FileStatus;
  updatedAt: Date;
}

export interface NewFile {
  id: string;
  ownerId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
}

const COLUMNS = `
  id, owner_id AS "ownerId", folder_id AS "folderId", name,
  mime_type AS "mimeType", size_bytes::float8 AS "sizeBytes",
  s3_key AS "s3Key", status, updated_at AS "updatedAt"`;

/** Indica si el error es una violación de UNIQUE (código 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/**
 * Consultas a la tabla files. Los cambios de estado usan WHERE status para que
 * la API y el worker no se pisen.
 */
@Injectable()
export class UploadsRepository {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async insertQueued(file: NewFile): Promise<FileRow> {
    const { rows } = await this.db.query<FileRow>(
      `INSERT INTO files (id, owner_id, folder_id, name, mime_type, size_bytes, s3_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
       RETURNING ${COLUMNS}`,
      [
        file.id,
        file.ownerId,
        file.folderId,
        file.name,
        file.mimeType,
        file.sizeBytes,
        file.s3Key,
      ],
    );
    return rows[0];
  }

  async nameTaken(
    ownerId: string,
    folderId: string | null,
    name: string,
  ): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM files
        WHERE owner_id = $1 AND folder_id IS NOT DISTINCT FROM $2 AND name = $3
        LIMIT 1`,
      [ownerId, folderId, name],
    );
    return (rowCount ?? 0) > 0;
  }

  async findById(id: string): Promise<FileRow | null> {
    const { rows } = await this.db.query<FileRow>(
      `SELECT ${COLUMNS} FROM files WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Busca el archivo solo si pertenece al usuario. */
  async findOwned(id: string, ownerId: string): Promise<FileRow | null> {
    const { rows } = await this.db.query<FileRow>(
      `SELECT ${COLUMNS} FROM files WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ?? null;
  }

  /** Cambia el estado solo si el actual está en from. */
  async transition(
    id: string,
    from: FileStatus[],
    to: FileStatus,
  ): Promise<FileRow | null> {
    const { rows } = await this.db.query<FileRow>(
      `UPDATE files SET status = $3, updated_at = now()
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING ${COLUMNS}`,
      [id, from, to],
    );
    return rows[0] ?? null;
  }

  /** Borra la fila solo si el estado está en statuses. */
  async deleteIfStatus(id: string, statuses: FileStatus[]): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `DELETE FROM files WHERE id = $1 AND status = ANY($2::text[])`,
      [id, statuses],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Por ahora solo el dueño de la carpeta puede subir a ella.
   * TODO: usar el permiso efectivo de edición.
   */
  async canUploadTo(userId: string, folderId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM folders WHERE id = $1 AND owner_id = $2`,
      [folderId, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}
