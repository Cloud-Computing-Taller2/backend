import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsRepository } from './uploads.repository';
import { UploadQueue } from './upload-queue';
import { UploadStorage } from './upload-storage';
import { TemporaryAuthGuard } from './auth.placeholder';

@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    UploadsRepository,
    UploadQueue,
    UploadStorage,
    TemporaryAuthGuard,
  ],
  exports: [UploadsRepository, UploadQueue, UploadStorage],
})
export class UploadsModule {}
