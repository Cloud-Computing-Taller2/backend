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
import { parseUuidOrThrow } from './upload-policy';
import { UploadsService } from './uploads.service';

/**
 * POST /files?folderId=<uuid|root>  multipart con un campo "file", responde 202.
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
    const target =
      !folderId || folderId === 'root'
        ? null
        : parseUuidOrThrow(folderId, 'folderId');
    return this.uploads.upload(userId, target, req);
  }

  @Get(':id/status')
  status(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.uploads.status(userId, parseUuidOrThrow(id));
  }

  @Delete(':id/upload')
  cancel(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.uploads.cancel(userId, parseUuidOrThrow(id));
  }
}
