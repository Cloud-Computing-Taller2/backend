import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { FileEntity } from '../entities/file.entity';
import { AppConfig, loadConfig } from './config';

/**
 * Conexión a PostgreSQL (TypeORM) y clientes de S3 y SQS.
 * TODO: reemplazar por los del esqueleto del backend.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const S3_CLIENT = Symbol('S3_CLIENT');
export const SQS_CLIENT = Symbol('SQS_CLIENT');

@Injectable()
class AwsShutdown implements OnModuleDestroy {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onModuleDestroy(): void {
    this.s3.destroy();
    this.sqs.destroy();
  }
}

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: loadConfig().databaseUrl,
        entities: [FileEntity],
        // El esquema lo crean las migraciones SQL, no TypeORM.
        synchronize: false,
      }),
    }),
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
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
    AwsShutdown,
  ],
  exports: [APP_CONFIG, S3_CLIENT, SQS_CLIENT],
})
export class InfraModule {}
