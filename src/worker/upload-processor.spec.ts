import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../infra/config';
import type { FileStatus } from '../uploads/upload-policy';
import type { UploadStorage } from '../uploads/upload-storage';
import type { FileRow, UploadsRepository } from '../uploads/uploads.repository';
import { UploadProcessor } from './upload-processor';

const FILE_ID = '0b9f8a54-3c2e-4d1a-9e6f-7a8b9c0d1e2f';

/** Repositorio en memoria para las pruebas. */
class FakeRepo {
  row: FileRow | null;

  constructor(status: FileStatus | null) {
    this.row = status
      ? {
          id: FILE_ID,
          ownerId: 'owner',
          folderId: null,
          name: 'a.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          s3Key: `users/owner/${FILE_ID}`,
          status,
          updatedAt: new Date(),
        }
      : null;
  }

  transition(id: string, from: FileStatus[], to: FileStatus) {
    if (!this.row || !from.includes(this.row.status)) {
      return Promise.resolve(null);
    }
    this.row = { ...this.row, status: to };
    return Promise.resolve(this.row);
  }

  findById() {
    return Promise.resolve(this.row);
  }

  deleteIfStatus(id: string, statuses: FileStatus[]) {
    if (this.row && statuses.includes(this.row.status)) {
      this.row = null;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

class FakeStorage {
  objects = new Set<string>();
  deleted: string[] = [];
  putImpl: (key: string, signal?: AbortSignal) => Promise<void> = (key) => {
    this.objects.add(key);
    return Promise.resolve();
  };

  putFile(key: string, _path: string, _type: string, signal?: AbortSignal) {
    return this.putImpl(key, signal);
  }

  deleteObject(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
}

describe('UploadProcessor', () => {
  let dir: string;
  let tmpFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'upload-proc-'));
    tmpFile = join(dir, FILE_ID);
    await writeFile(tmpFile, 'abc');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setup(status: FileStatus | null, maxReceiveCount = 3) {
    const repo = new FakeRepo(status);
    const storage = new FakeStorage();
    const config = {
      uploads: { tmpDir: dir, maxBytes: 1000 },
      worker: { maxReceiveCount, heartbeatMs: 5 },
    } as AppConfig;
    const processor = new UploadProcessor(
      repo as unknown as UploadsRepository,
      storage as unknown as UploadStorage,
      config,
    );
    const run = (receiveCount = 1) =>
      processor.process({
        fileId: FILE_ID,
        receiveCount,
        keepAlive: () => Promise.resolve(),
      });
    return { repo, storage, run };
  }

  const tmpExists = async () => (await readdir(dir)).includes(FILE_ID);

  it('sube, marca listo y borra el temporal', async () => {
    const { repo, storage, run } = setup('queued');
    await expect(run()).resolves.toBe('ack');
    expect(repo.row?.status).toBe('ready');
    expect(storage.objects.has(`users/owner/${FILE_ID}`)).toBe(true);
    expect(await tmpExists()).toBe(false);
  });

  it('retoma una carga que quedó subiendo por un intento anterior caído', async () => {
    const { repo, run } = setup('uploading');
    await expect(run(2)).resolves.toBe('ack');
    expect(repo.row?.status).toBe('ready');
  });

  it('cancelada en cola (la API ya borró la fila): descarta el mensaje y el temporal', async () => {
    const { storage, run } = setup(null);
    await expect(run()).resolves.toBe('ack');
    expect(storage.objects.size).toBe(0);
    expect(await tmpExists()).toBe(false);
  });

  it('cancelada antes de que el worker la tome: limpia todo sin subir', async () => {
    const { repo, storage, run } = setup('cancelled');
    await expect(run()).resolves.toBe('ack');
    expect(repo.row).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(await tmpExists()).toBe(false);
  });

  it('cancelada mientras sube: aborta la subida y no deja rastro', async () => {
    const { repo, storage, run } = setup('queued');
    storage.putImpl = (_key, signal) =>
      new Promise((_resolve, reject) => {
        // Cancela durante la subida.
        void repo.transition(FILE_ID, ['uploading'], 'cancelled');
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(run()).resolves.toBe('ack');
    expect(repo.row).toBeNull();
    expect(storage.deleted).toEqual([`users/owner/${FILE_ID}`]);
    expect(await tmpExists()).toBe(false);
  });

  it('cancelada justo al terminar de subir: borra el objeto ya subido', async () => {
    const { repo, storage, run } = setup('queued');
    storage.putImpl = async (key) => {
      storage.objects.add(key);
      await repo.transition(FILE_ID, ['uploading'], 'cancelled');
    };
    await expect(run()).resolves.toBe('ack');
    expect(repo.row).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(await tmpExists()).toBe(false);
  });

  it('mensaje duplicado de una carga ya lista: no hace nada', async () => {
    const { repo, storage, run } = setup('ready');
    await expect(run()).resolves.toBe('ack');
    expect(repo.row?.status).toBe('ready');
    expect(storage.deleted).toEqual([]);
  });

  it('falla con intentos restantes: vuelve a en cola y pide reintento', async () => {
    const { repo, storage, run } = setup('queued');
    storage.putImpl = () => Promise.reject(new Error('S3 caído'));
    await expect(run(1)).resolves.toBe('retry');
    expect(repo.row?.status).toBe('queued');
    expect(await tmpExists()).toBe(true);
  });

  it('falla en el último intento: marca error y el mensaje va a la DLQ', async () => {
    const { repo, storage, run } = setup('queued', 3);
    storage.putImpl = () => Promise.reject(new Error('S3 caído'));
    await expect(run(3)).resolves.toBe('dead');
    expect(repo.row?.status).toBe('error');
    expect(await tmpExists()).toBe(false);
  });

  it('sin temporal no reintenta: marca error de inmediato', async () => {
    const { repo, storage, run } = setup('queued');
    await rm(tmpFile);
    storage.putImpl = () =>
      Promise.reject(Object.assign(new Error('no existe'), { code: 'ENOENT' }));
    await expect(run(1)).resolves.toBe('ack');
    expect(repo.row?.status).toBe('error');
  });
});
