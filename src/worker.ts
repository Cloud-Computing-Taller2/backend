import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';
import { UploadWorker } from './worker/upload-worker';

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

  const shutdown = async (signal: string) => {
    Logger.log(`${signal} recibido: terminando cargas en curso…`, 'Worker');
    await worker.stop();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
