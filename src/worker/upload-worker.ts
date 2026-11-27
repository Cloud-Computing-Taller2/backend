import { Inject, Injectable, Logger } from '@nestjs/common';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';
import { ReceivedJob, UploadQueue } from '../uploads/upload-queue';
import { UploadProcessor } from './upload-processor';

const ORPHAN_PART_MAX_AGE_MS = 60 * 60 * 1000;

/** Lee mensajes de SQS y los procesa en paralelo. */
@Injectable()
export class UploadWorker {
  private readonly logger = new Logger(UploadWorker.name);
  private running = false;
  private loop?: Promise<void>;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly queue: UploadQueue,
    private readonly processor: UploadProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.sweeper = setInterval(() => void this.sweepOrphans(), 10 * 60 * 1000);
    void this.sweepOrphans();
    this.logger.log(
      `Worker escuchando la cola (concurrencia ${this.config.worker.concurrency})`,
    );
  }

  /** Deja de leer la cola y espera los mensajes en curso. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.sweeper) clearInterval(this.sweeper);
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let batch: ReceivedJob[];
      try {
        batch = await this.queue.receive(
          this.config.worker.concurrency,
          this.config.worker.pollWaitSeconds,
        );
      } catch (err) {
        this.logger.error(`No se pudo leer la cola: ${(err as Error).message}`);
        await delay(2000);
        continue;
      }
      await Promise.all(batch.map((msg) => this.handle(msg)));
    }
  }

  private async handle(msg: ReceivedJob): Promise<void> {
    if (!msg.job) {
      this.logger.warn(
        `Mensaje ${msg.messageId} con formato inválido; se descarta`,
      );
      await this.queue.ack(msg.receiptHandle).catch(() => undefined);
      return;
    }
    const { fileId } = msg.job;
    const { visibilityTimeoutSeconds } = this.config.worker;

    try {
      const outcome = await this.processor.process({
        fileId,
        receiveCount: msg.receiveCount,
        keepAlive: () =>
          this.queue.setVisibility(msg.receiptHandle, visibilityTimeoutSeconds),
      });

      if (outcome === 'ack') {
        await this.queue.ack(msg.receiptHandle);
      } else if (outcome === 'retry') {
        // Reintento con espera exponencial.
        const backoff = Math.min(
          2 ** msg.receiveCount,
          visibilityTimeoutSeconds,
        );
        await this.queue.setVisibility(msg.receiptHandle, backoff);
      } else {
        // Visible de nuevo para que SQS lo mueva a la DLQ.
        await this.queue.setVisibility(msg.receiptHandle, 0);
      }
    } catch (err) {
      // El mensaje queda en la cola y se reintenta.
      this.logger.error(
        `Error procesando ${fileId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /** Borra archivos .part con más de una hora. */
  private async sweepOrphans(): Promise<void> {
    const dir = this.config.uploads.tmpDir;
    try {
      const now = Date.now();
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.part')) continue;
        const full = join(dir, name);
        const info = await stat(full).catch(() => null);
        if (info && now - info.mtimeMs > ORPHAN_PART_MAX_AGE_MS) {
          await rm(full, { force: true });
          this.logger.log(`Temporal huérfano eliminado: ${name}`);
        }
      }
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(
          `No se pudo revisar ${dir}: ${(err as Error).message}`,
        );
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
