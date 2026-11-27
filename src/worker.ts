import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';
import { UploadWorker } from './worker/upload-worker';
import { APP_CONFIG } from './infra/infra.module';
import type { AppConfig } from './infra/config';

// Punto de entrada del worker (node dist/worker.js).
function loadDotEnv() {
  // Carga .env si existe (desarrollo local).
  try {
    process.loadEnvFile();
  } catch {
    /* sin .env */
  }
}

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const worker = app.get(UploadWorker);
  worker.start();

  // GET /health para el healthcheck del contenedor.
  const { healthPort } = app.get<AppConfig>(APP_CONFIG).worker;
  const health = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const ok = worker.isRunning;
    res
      .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: ok ? 'ok' : 'stopping' }));
  }).listen(healthPort);

  const shutdown = async (signal: string) => {
    Logger.log(`${signal} recibido: terminando cargas en curso…`, 'Worker');
    await worker.stop();
    health.close();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
