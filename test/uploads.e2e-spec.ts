/**
 * Pruebas e2e de la carga. Necesitan PostgreSQL y LocalStack:
 *   docker compose -f dev/docker-compose.dev.yml up -d --wait
 *   UPLOADS_E2E=1 pnpm test:e2e -- uploads
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { InfraModule, S3_CLIENT, SQS_CLIENT } from '../src/infra/infra.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import type { UploadView } from '../src/uploads/uploads.service';
import { UploadStorage } from '../src/uploads/upload-storage';
import { UploadWorker } from '../src/worker/upload-worker';
import { WorkerModule } from '../src/worker/worker.module';

// Usuario alice y su carpeta Fotos de db/migrations/002_seed.sql.
const ALICE = '1';
const FOLDER = '2';
const enabled = process.env.UPLOADS_E2E === '1';

/** Permite modificar la subida a S3 en cada prueba. */
type Hook = (
  next: () => Promise<void>,
  key: string,
  signal?: AbortSignal,
) => Promise<void>;
let storageHook: Hook | undefined;

class HookableStorage extends UploadStorage {
  override putFile(
    key: string,
    path: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const next = () => super.putFile(key, path, contentType, signal);
    return storageHook ? storageHook(next, key, signal) : next();
  }
}

async function waitFor<T>(
  check: () => Promise<T | undefined | false>,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`Tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

(enabled ? describe : describe.skip)('Carga, cola y worker (e2e)', () => {
  let app: INestApplication<App>;
  let workerModule: TestingModule;
  let worker: UploadWorker;
  let db: DataSource;
  let s3: S3Client;
  let sqs: SQSClient;
  let tmpDir: string;
  let queueUrl: string;
  let dlqUrl: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // Lee .env sin sobrescribir variables ya definidas.
    const dotenv = await readFile('.env', 'utf8').catch(() => '');
    for (const [k, v] of Object.entries(parseEnv(dotenv))) {
      process.env[k] ??= v;
    }
    tmpDir = await mkdtemp(join(tmpdir(), 'drive-e2e-'));
    Object.assign(process.env, {
      UPLOAD_TMP_DIR: tmpDir,
      ALLOW_DEV_AUTH: 'true',
      WORKER_POLL_WAIT_SECONDS: '1',
      WORKER_HEARTBEAT_MS: '200',
      SQS_MAX_RECEIVE_COUNT: '3',
    });

    const apiModule = await Test.createTestingModule({
      // Sin AppModule porque Jest no puede cargar @nestjs/config 12 (ESM).
      imports: [InfraModule, UploadsModule],
    }).compile();
    app = apiModule.createNestApplication();
    await app.listen(0);

    workerModule = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(UploadStorage)
      .useClass(HookableStorage)
      .compile();
    await workerModule.init();
    worker = workerModule.get(UploadWorker);

    db = apiModule.get(DataSource);
    s3 = apiModule.get(S3_CLIENT);
    sqs = apiModule.get(SQS_CLIENT);
    queueUrl = process.env.SQS_QUEUE_URL!;
    dlqUrl = process.env.SQS_DLQ_URL ?? `${queueUrl}-dlq`;
    await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    await sqs.send(new PurgeQueueCommand({ QueueUrl: dlqUrl }));
  });

  afterEach(async () => {
    storageHook = undefined;
    await worker.stop();
  });

  afterAll(async () => {
    await workerModule?.close();
    await app?.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  const upload = async (name: string, bytes = 256 * 1024) => {
    const res = await http()
      .post(`/files?folderId=${FOLDER}`)
      .set('x-user-id', ALICE)
      .attach('file', randomBytes(bytes), name)
      .expect(202);
    return res.body as UploadView;
  };

  const status = async (id: string) => {
    const res = await http().get(`/files/${id}/status`).set('x-user-id', ALICE);
    return { code: res.status, body: res.body as UploadView };
  };

  const objectExists = async (key: string) => {
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  };

  const rowCount = async (where: string, value: string) => {
    const rows: { n: number }[] = await db.query(
      `SELECT count(*)::int AS n FROM files WHERE ${where}`,
      [value],
    );
    return rows[0].n;
  };

  const keyOf = async (id: string) => {
    const rows: { s3_key: string }[] = await db.query(
      'SELECT s3_key FROM files WHERE id = $1',
      [id],
    );
    return rows[0].s3_key;
  };

  const idOfKey = async (key: string) => {
    const rows: { id: string }[] = await db.query(
      'SELECT id FROM files WHERE s3_key = $1',
      [key],
    );
    return rows[0].id;
  };

  const queueDepth = async (url: string) => {
    const res = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
        ],
      }),
    );
    return (
      Number(res.Attributes?.ApproximateNumberOfMessages ?? 0) +
      Number(res.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
    );
  };

  const tmpFiles = () => readdir(tmpDir);

  /** Verifica que no quede fila, objeto, temporal ni mensaje. */
  async function expectNoTrace(id: string, key: string) {
    await waitFor(async () => (await status(id)).code === 404, 'fila borrada');
    expect(await rowCount('id = $1', id)).toBe(0);
    expect(await objectExists(key)).toBe(false);
    expect(await tmpFiles()).toEqual([]);
    await waitFor(async () => (await queueDepth(queueUrl)) === 0, 'cola vacía');
  }

  it('sube un archivo: 202 queued y luego ready, objeto en el bucket y sin temporal', async () => {
    worker.start();
    const file = await upload(`ok-${randomUUID()}.png`);
    expect(file).toMatchObject({
      status: 'queued',
      contentType: 'image/png',
      folderId: FOLDER,
    });
    const key = await keyOf(file.id);
    expect(key).toMatch(
      new RegExp(`^users/${ALICE}/folders/${FOLDER}/[0-9a-f-]{36}-ok-`),
    );

    await waitFor(
      async () => (await status(file.id)).body.status === 'ready',
      'estado listo',
    );
    expect(await objectExists(key)).toBe(true);
    expect(await tmpFiles()).toEqual([]);
  });

  it('cancelar mientras el archivo todavía se envía (sin id) no deja rastro', async () => {
    const name = `abortado-${randomUUID()}.png`;
    const server = app.getHttpServer() as unknown as import('node:net').Server;
    const { port } = server.address() as AddressInfo;
    const boundary = 'x' + randomUUID();
    const req = httpRequest({
      port,
      method: 'POST',
      path: `/files?folderId=${FOLDER}`,
      headers: {
        'x-user-id': ALICE,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'transfer-encoding': 'chunked',
      },
    });
    req.on('error', () => undefined);
    req.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        `Content-Type: image/png\r\n\r\n`,
    );
    req.write(randomBytes(512 * 1024));

    await waitFor(
      async () => (await tmpFiles()).some((f) => f.endsWith('.part')),
      'temporal .part creado',
    );
    req.destroy(); // corta la conexión

    await waitFor(
      async () => (await tmpFiles()).length === 0,
      'temporal borrado',
    );
    expect(await rowCount('name = $1', name)).toBe(0);
  });

  it('cancelar mientras está en cola no deja rastro', async () => {
    const file = await upload(`en-cola-${randomUUID()}.pdf`);
    const key = await keyOf(file.id);
    await http()
      .delete(`/files/${file.id}/upload`)
      .set('x-user-id', ALICE)
      .expect(200, { id: file.id, status: 'cancelled' });

    worker.start();
    await expectNoTrace(file.id, key);
  });

  it('cancelar mientras el worker sube aborta la subida y no deja rastro', async () => {
    let attempts = 0;
    let uploadedKey = '';
    storageHook = async (_next, key, signal) => {
      attempts++;
      uploadedKey = key;
      const id = await idOfKey(key);
      await http()
        .delete(`/files/${id}/upload`)
        .set('x-user-id', ALICE)
        .expect(200);
      // Espera a que el worker aborte la subida.
      await waitFor(
        () => Promise.resolve(signal?.aborted),
        'abort de la subida',
        5_000,
      );
      throw new Error('Upload aborted');
    };
    worker.start();
    const file = await upload(`subiendo-${randomUUID()}.mp4`);
    await expectNoTrace(
      file.id,
      await waitFor(() => Promise.resolve(uploadedKey), 'clave'),
    );
    expect(attempts).toBe(1);
  });

  it('cancelar justo cuando terminó de subir borra el objeto del bucket', async () => {
    let uploadedKey = '';
    storageHook = async (next, key) => {
      uploadedKey = key;
      const id = await idOfKey(key);
      await next();
      await http()
        .delete(`/files/${id}/upload`)
        .set('x-user-id', ALICE)
        .expect(200);
    };
    worker.start();
    const file = await upload(`justo-${randomUUID()}.docx`);
    await expectNoTrace(
      file.id,
      await waitFor(() => Promise.resolve(uploadedKey), 'clave'),
    );
  });

  it('si S3 falla siempre: 3 intentos, estado error y el mensaje termina en la DLQ', async () => {
    let attempts = 0;
    storageHook = () => {
      attempts++;
      return Promise.reject(new Error('S3 no disponible'));
    };
    worker.start();
    const file = await upload(`falla-${randomUUID()}.jpg`);

    await waitFor(
      async () => (await status(file.id)).body.status === 'error',
      'estado error',
      30_000,
    );
    expect(attempts).toBe(3);
    await waitFor(
      async () => (await queueDepth(dlqUrl)) === 1,
      'mensaje en la DLQ',
    );
    expect(await queueDepth(queueUrl)).toBe(0);
    expect(await tmpFiles()).toEqual([]);

    // Una carga con error también se puede cancelar.
    await http()
      .delete(`/files/${file.id}/upload`)
      .set('x-user-id', ALICE)
      .expect(200);
    expect(await rowCount('id = $1', file.id)).toBe(0);
  }, 45_000);
});
