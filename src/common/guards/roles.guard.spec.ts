import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  function contextWithUser(user?: AuthenticatedUser): ExecutionContext {
    const request = { user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request through when the route has no @Roles() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = contextWithUser(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    const context = contextWithUser({ userId: 'user-1', roles: [Role.CUSTOMER, Role.ADMIN] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws when the user lacks every required role', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    const context = contextWithUser({ userId: 'user-1', roles: [Role.CUSTOMER] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws when roles are required but no user is attached to the request', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    const context = contextWithUser(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
