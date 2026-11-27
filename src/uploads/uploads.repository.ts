import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FileEntity } from '../entities/file.entity';
import { FileStatus } from './upload-policy';

export interface NewFile {
  ownerId: string;
  folderId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
}

/** Indica si el error es una violación de UNIQUE (código 23505). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/**
 * Consultas a la tabla files. Los cambios de estado usan WHERE status para que
 * la API y el worker no se pisen.
 */
@Injectable()
export class UploadsRepository {
  constructor(
    @InjectRepository(FileEntity)
    private readonly files: Repository<FileEntity>,
  ) {}

  insertQueued(file: NewFile): Promise<FileEntity> {
    return this.files.save(this.files.create({ ...file, status: 'queued' }));
  }

  nameTaken(folderId: string, name: string): Promise<boolean> {
    return this.files.exists({ where: { folderId, name } });
  }

  findById(id: string): Promise<FileEntity | null> {
    return this.files.findOneBy({ id });
  }

  /** Busca el archivo solo si pertenece al usuario. */
  findOwned(id: string, ownerId: string): Promise<FileEntity | null> {
    return this.files.findOneBy({ id, ownerId });
  }

  /** Cambia el estado solo si el actual está en from. */
  async transition(
    id: string,
    from: FileStatus[],
    to: FileStatus,
  ): Promise<FileEntity | null> {
    const result = await this.files
      .createQueryBuilder()
      .update()
      .set({ status: to })
      .where('id = :id', { id })
      .andWhere('status IN (:...from)', { from })
      .execute();
    if (!result.affected) return null;
    return this.findById(id);
  }

  /** Borra la fila solo si el estado está en statuses. */
  async deleteIfStatus(id: string, statuses: FileStatus[]): Promise<boolean> {
    const result = await this.files.delete({ id, status: In(statuses) });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Por ahora solo el dueño de la carpeta puede subir a ella.
   * TODO: usar el permiso efectivo de edición.
   */
  async canUploadTo(userId: string, folderId: string): Promise<boolean> {
    const rows: unknown[] = await this.files.manager.query(
      'SELECT 1 FROM folders WHERE id = $1 AND owner_id = $2',
      [folderId, userId],
    );
    return rows.length > 0;
  }
}
