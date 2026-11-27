import { HttpException } from '@nestjs/common';

/** Valores de files.status. */
export type FileStatus =
  'queued' | 'uploading' | 'ready' | 'cancelled' | 'error';

/** Error HTTP con formato { code, message }. */
export function apiError(
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ code, message }, status);
}

export function fileTooLarge(maxBytes: number): HttpException {
  const mb = maxBytes / (1024 * 1024);
  const shown = mb >= 10 ? Math.floor(mb).toString() : mb.toFixed(1);
  return apiError(
    413,
    'FILE_TOO_LARGE',
    `El archivo supera el máximo de ${shown} MB`,
  );
}

/** Clave del objeto en el bucket: users/{userId}/folders/{folderId}/{uuid}-{nombre}. */
export function buildObjectKey(
  ownerId: string,
  folderId: string,
  uploadId: string,
  name: string,
): string {
  return `users/${ownerId}/folders/${folderId}/${uploadId}-${safeKeyName(name)}`;
}

/** Nombre sin tildes ni caracteres especiales para usarlo en la clave. */
export function safeKeyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(-100);
}

/** Extensiones permitidas y su tipo MIME. */
const MIME_BY_EXTENSION: Record<string, string> = {
  // Imágenes
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  raw: 'image/x-raw',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // Documentos
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
};

export const ALLOWED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

/** Devuelve el MIME según la extensión, o null si no está permitida. */
export function mimeTypeFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? null;
}

const MAX_NAME_LENGTH = 255;

/** Quita rutas, caracteres de control y espacios del nombre. Devuelve null si no es válido. */
export function sanitizeFileName(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean === '.' || clean === '..') return null;
  if (clean.length > MAX_NAME_LENGTH) return null;
  return clean.normalize('NFC');
}

// Ids BIGSERIAL de PostgreSQL.
const ID_RE = /^[1-9][0-9]{0,17}$/;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function parseIdOrThrow(value: unknown, what = 'id'): string {
  if (!isId(value)) {
    throw apiError(
      400,
      'INVALID_ID',
      `El ${what} no es un identificador válido`,
    );
  }
  return value;
}

/** Rutas del temporal: .part mientras se recibe y sin extensión cuando está completo. */
export function tmpPaths(
  tmpDir: string,
  name: string,
): { partial: string; complete: string } {
  return {
    partial: `${tmpDir}/${name}.part`,
    complete: `${tmpDir}/${name}`,
  };
}
