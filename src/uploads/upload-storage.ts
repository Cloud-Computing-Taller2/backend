import { Inject, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';
import { APP_CONFIG, S3_CLIENT } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';

@Injectable()
export class UploadStorage {
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.bucket = config.s3BucketName;
  }

  /** Sube el archivo temporal al bucket. Si se activa signal, se aborta la subida. */
  async putFile(
    key: string,
    path: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    const onAbort = () => void upload.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await upload.done();
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Borra un objeto del bucket. */
  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
