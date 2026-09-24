import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Placeholder admin gate for Phase 1 only. Checks a static `x-admin-key`
 * header against ADMIN_API_KEY. Replace with real role-based auth
 * (JWT + ADMIN role) in the auth phase.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.headers['x-admin-key'];
    const expectedKey = this.configService.get<string>('adminApiKey');

    if (!providedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid or missing admin credentials');
    }

    return true;
  }
}
