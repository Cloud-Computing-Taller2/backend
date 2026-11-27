import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG } from '../infra/infra.module';
import type { AppConfig } from '../infra/config';
import { apiError, isUuid } from './upload-policy';

type AuthedRequest = Request & { user?: { id?: string } };

/**
 * Guard temporal de autenticación. Usa req.user si existe; con ALLOW_DEV_AUTH=true
 * acepta la cabecera x-user-id.
 * TODO: reemplazar por requireAuth.
 */
@Injectable()
export class TemporaryAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (isUuid(req.user?.id)) return true;

    const header = req.headers['x-user-id'];
    if (this.config.allowDevAuth && isUuid(header)) {
      req.user = { id: header.toLowerCase() };
      return true;
    }
    throw apiError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión');
  }
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const id = req.user?.id;
    if (!id) throw apiError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión');
    return id;
  },
);
