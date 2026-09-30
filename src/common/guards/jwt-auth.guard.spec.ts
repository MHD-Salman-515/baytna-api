import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { get: jest.Mock };

  function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
    const request: { headers: Record<string, string>; user?: unknown } = { headers };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    jwtService = { verifyAsync: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('access-secret') };

    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  it('allows the request through without checking a token when the route is @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = contextWithHeaders({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws when no Authorization header is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = contextWithHeaders({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when the Authorization header is not a Bearer token', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = contextWithHeaders({ authorization: 'Basic abc123' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when the token fails verification', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const context = contextWithHeaders({ authorization: 'Bearer bad.token.here' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches request.user and allows the request through on a valid token', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', roles: [Role.CUSTOMER] });
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: 'Bearer good.token.here' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user-1', roles: [Role.CUSTOMER] });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('good.token.here', {
      secret: 'access-secret',
    });
  });
});
