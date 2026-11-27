import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Pool } from 'pg';
import { AppConfig, loadConfig } from './config';

/**
 * Conexión a PostgreSQL y clientes de S3 y SQS.
 * TODO: reemplazar por los del esqueleto del backend.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const PG_POOL = Symbol('PG_POOL');
export const S3_CLIENT = Symbol('S3_CLIENT');
export const SQS_CLIENT = Symbol('SQS_CLIENT');

@Injectable()
class InfraShutdown implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.s3.destroy();
    this.sqs.destroy();
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: 10 }),
    },
    {
      provide: S3_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3Client({
          region: config.aws.region,
          endpoint: config.aws.endpoint,
          // URLs con el bucket en la ruta: http://localstack:4566/<bucket>
          forcePathStyle: true,
        }),
    },
    {
      provide: SQS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SQSClient({
          region: config.aws.region,
          endpoint: config.aws.endpoint,
          // Usa AWS_ENDPOINT_URL en vez del host de la QueueUrl.
          useQueueUrlAsEndpoint: !config.aws.endpoint,
        }),
    },
    InfraShutdown,
  ],
  exports: [APP_CONFIG, PG_POOL, S3_CLIENT, SQS_CLIENT],
})
export class InfraModule {}
