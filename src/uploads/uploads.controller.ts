import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUserId, TemporaryAuthGuard } from './auth.placeholder';
import { apiError, parseIdOrThrow } from './upload-policy';
import { UploadsService } from './uploads.service';

/**
 * POST /files?folderId=<id>         multipart con un campo "file", responde 202.
 * GET /files/:id/status             estado de la carga.
 * DELETE /files/:id/upload          cancela la carga.
 */
@Controller('files')
@UseGuards(TemporaryAuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @HttpCode(202)
  upload(
    @CurrentUserId() userId: string,
    @Query('folderId') folderId: string | undefined,
    @Req() req: Request,
  ) {
    // files.folder_id es NOT NULL: todo archivo va dentro de una carpeta.
    if (!folderId) {
      req.resume();
      throw apiError(
        400,
        'FOLDER_REQUIRED',
        'Falta la carpeta destino (folderId)',
      );
    }
    return this.uploads.upload(
      userId,
      parseIdOrThrow(folderId, 'folderId'),
      req,
    );
  }

  @Get(':id/status')
  status(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.uploads.status(userId, parseIdOrThrow(id));
  }

  @Delete(':id/upload')
  cancel(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.uploads.cancel(userId, parseIdOrThrow(id));
  }
}
