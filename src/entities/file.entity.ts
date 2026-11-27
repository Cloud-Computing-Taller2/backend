import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import type { FileStatus } from '../uploads/upload-policy';

// pg devuelve BIGINT como string; el tamaño cabe sin problema en un number.
const bigintToNumber: ValueTransformer = {
  to: (value: number | undefined) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

/** Tabla files de db/migrations/001_init.sql. */
@Entity('files')
export class FileEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId!: string;

  @Column({ name: 'folder_id', type: 'bigint' })
  folderId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 's3_key', type: 'text', nullable: true, unique: true })
  s3Key!: string;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    default: 0,
    transformer: bigintToNumber,
  })
  sizeBytes!: number;

  @Column({ name: 'content_type', type: 'text', nullable: true })
  contentType!: string | null;

  @Column({ type: 'text', default: 'queued' })
  status!: FileStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
