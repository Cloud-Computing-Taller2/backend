import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module';
import { UploadsRepository } from '../uploads/uploads.repository';
import { UploadQueue } from '../uploads/upload-queue';
import { UploadStorage } from '../uploads/upload-storage';
import { UploadProcessor } from './upload-processor';
import { UploadWorker } from './upload-worker';

/** Módulo del worker, sin controladores HTTP. */
@Module({
  imports: [InfraModule],
  providers: [
    UploadsRepository,
    UploadQueue,
    UploadStorage,
    UploadProcessor,
    UploadWorker,
  ],
})
export class WorkerModule {}
