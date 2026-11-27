import { createWriteStream, WriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { apiError, fileTooLarge, tmpPaths } from './upload-policy';

export interface AcceptedFile {
  name: string;
  mimeType: string;
}

export interface ReceiveOptions {
  fileId: string;
  tmpDir: string;
  maxBytes: number;
  /** Valida nombre y tipo antes de escribir el archivo. */
  accept: (fileName: string, clientMimeType: string) => Promise<AcceptedFile>;
}

export interface ReceivedFile extends AcceptedFile {
  path: string;
  sizeBytes: number;
}

/** El cliente cortó la conexión antes de terminar de enviar el archivo. */
export class ClientAbortedError extends Error {
  constructor() {
    super('El cliente canceló la carga antes de terminar de enviarla');
  }
}

/**
 * Guarda el archivo de una petición multipart en la carpeta temporal. Si el
 * cliente corta la conexión, borra el temporal y rechaza con ClientAbortedError.
 */
export function receiveSingleFile(
  req: IncomingMessage,
  opts: ReceiveOptions,
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    const paths = tmpPaths(opts.tmpDir, opts.fileId);
    let settled = false;
    let parser: busboy.Busboy;
    let output: WriteStream | undefined;
    let accepted: AcceptedFile | undefined;
    let sawFile = false;
    let parserDone = false;
    let fileWritten = false;

    const cleanup = () => {
      req.off('close', onRequestClose);
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.unpipe(parser);
      output?.destroy();
      void rm(paths.partial, { force: true });
      // Consume el resto del cuerpo para poder responder con el error.
      if (!req.destroyed) req.resume();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const maybeFinish = () => {
      if (settled || !parserDone) return;
      if (!sawFile) {
        fail(apiError(400, 'NO_FILE', 'La petición no trae ningún archivo'));
        return;
      }
      if (!fileWritten || !accepted || !output) return;
      settled = true;
      cleanup();
      const sizeBytes = output.bytesWritten;
      const file = accepted;
      rename(paths.partial, paths.complete).then(
        () => resolve({ ...file, path: paths.complete, sizeBytes }),
        (err) => {
          void rm(paths.partial, { force: true });
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    };

    function onRequestClose() {
      if (!req.complete) fail(new ClientAbortedError());
    }

    try {
      parser = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          files: 1,
          fileSize: opts.maxBytes,
          fields: 10,
          fieldSize: 1024,
        },
      });
    } catch {
      reject(
        apiError(
          400,
          'INVALID_MULTIPART',
          'Se esperaba un cuerpo multipart/form-data con un campo "file"',
        ),
      );
      return;
    }

    req.on('close', onRequestClose);

    parser.on('file', (_field, stream, info) => {
      if (settled) {
        stream.resume();
        return;
      }
      sawFile = true;
      opts.accept(info.filename ?? '', info.mimeType).then(
        (file) => {
          if (settled) {
            stream.resume();
            return;
          }
          accepted = file;
          output = createWriteStream(paths.partial, { flags: 'wx' });
          stream.once('limit', () => fail(fileTooLarge(opts.maxBytes)));
          pipeline(stream, output).then(() => {
            fileWritten = true;
            maybeFinish();
          }, fail);
        },
        (err) => {
          stream.resume();
          fail(err);
        },
      );
    });

    parser.on('filesLimit', () =>
      fail(
        apiError(
          400,
          'ONE_FILE_PER_REQUEST',
          'Envía un archivo por petición; para varios archivos, una petición por cada uno',
        ),
      ),
    );

    parser.on('error', () =>
      fail(
        apiError(
          400,
          'INVALID_MULTIPART',
          'El cuerpo multipart está mal formado',
        ),
      ),
    );

    parser.on('close', () => {
      parserDone = true;
      maybeFinish();
    });

    req.pipe(parser);
  });
}
