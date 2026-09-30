import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '../../../common/enums/role.enum';
import { UserStatus } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { RefreshToken, RefreshTokenStatus } from './refresh-token.schema';
import { TokenService } from './token.service';

type MockModel = {
  findOne: jest.Mock;
  updateMany: jest.Mock;
  updateOne: jest.Mock;
  create: jest.Mock;
};

describe('TokenService', () => {
  let service: TokenService;
  let model: MockModel;
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let usersService: { findById: jest.Mock };

  const userId = 'user-1';
  const familyId = 'family-1';
  const jti = 'jti-1';

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      create: jest.fn().mockResolvedValue({}),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt'),
      verifyAsync: jest.fn(),
    };
    usersService = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: getModelToken(RefreshToken.name), useValue: model },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: (key: string) => `secret-${key}` } },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  describe('issueTokenPair', () => {
    it('signs both tokens and persists a new ACTIVE refresh token record', async () => {
      const result = await service.issueTokenPair({ id: userId, roles: [Role.CUSTOMER] });

      expect(result).toEqual({ accessToken: 'signed-jwt', refreshToken: 'signed-jwt' });
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId, status: RefreshTokenStatus.ACTIVE }),
      );
    });

    it('reuses the given familyId instead of minting a new one', async () => {
      await service.issueTokenPair({ id: userId, roles: [Role.CUSTOMER] }, familyId);

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ familyId }));
    });
  });

  describe('rotateRefreshToken', () => {
    it('throws when the refresh token fails signature/expiry verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));

      await expect(service.rotateRefreshToken('bad-token')).rejects.toThrow(UnauthorizedException);
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('throws when the token verifies but no matching record exists', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);
    });

    it('detects reuse of an already-rotated token, revokes the whole family, and throws', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ familyId, status: RefreshTokenStatus.ROTATED, userId }),
      });

      await expect(service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);

      expect(model.updateMany).toHaveBeenCalledWith(
        { familyId, status: { $ne: RefreshTokenStatus.REVOKED } },
        expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      );
    });

    it('rejects an already-REVOKED token (e.g. post-logout) without escalating to a family-wide revoke', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ familyId, status: RefreshTokenStatus.REVOKED, userId }),
      });

      await expect(service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);

      expect(model.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when the owning user is not ACTIVE', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });
      model.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          familyId,
          status: RefreshTokenStatus.ACTIVE,
          userId,
          save: jest.fn(),
        }),
      });
      usersService.findById.mockResolvedValue({
        id: userId,
        roles: [Role.CUSTOMER],
        status: UserStatus.SUSPENDED,
      });

      await expect(service.rotateRefreshToken('token')).rejects.toThrow(UnauthorizedException);
    });

    it('rotates a valid ACTIVE token: marks it ROTATED and issues a new pair in the same family', async () => {
      const record = {
        familyId,
        status: RefreshTokenStatus.ACTIVE,
        userId,
        save: jest.fn().mockResolvedValue(undefined),
      };
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      usersService.findById.mockResolvedValue({
        id: userId,
        roles: [Role.CUSTOMER],
        status: UserStatus.ACTIVE,
      });

      const result = await service.rotateRefreshToken('token');

      expect(record.status).toBe(RefreshTokenStatus.ROTATED);
      expect(record.save).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'signed-jwt', refreshToken: 'signed-jwt' });
      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ familyId }));
    });
  });

  describe('revokeByToken', () => {
    it('silently no-ops when the token does not verify', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad'));

      await expect(service.revokeByToken('bad-token')).resolves.toBeUndefined();
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('revokes the matching record by jti', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: userId, familyId, jti });

      await service.revokeByToken('token');

      expect(model.updateOne).toHaveBeenCalledWith(
        { jti },
        expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every non-revoked token for the user', async () => {
      await service.revokeAllForUser(userId);

      expect(model.updateMany).toHaveBeenCalledWith(
        { userId, status: { $ne: RefreshTokenStatus.REVOKED } },
        expect.objectContaining({ status: RefreshTokenStatus.REVOKED }),
      );
    });
  });
});
