import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { DevicePlatform } from './schemas/device-token.schema';
import { DeviceToken } from './schemas/device-token.schema';
import { DeviceTokensService } from './device-tokens.service';

describe('DeviceTokensService', () => {
  let service: DeviceTokensService;
  let tokenModel: { findOneAndUpdate: jest.Mock; updateOne: jest.Mock; find: jest.Mock };

  const userId = 'user-1';
  const dto = { token: 'fcm-token-abc123', platform: DevicePlatform.ANDROID, locale: 'ar' };

  beforeEach(async () => {
    tokenModel = { findOneAndUpdate: jest.fn(), updateOne: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceTokensService,
        { provide: getModelToken(DeviceToken.name), useValue: tokenModel },
      ],
    }).compile();

    service = module.get(DeviceTokensService);
  });

  describe('register', () => {
    it('upserts by token alone (not scoped by user), setting isActive true and a fresh lastSeenAt', async () => {
      tokenModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ token: dto.token }),
      });

      await service.register(userId, dto);

      expect(tokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { token: dto.token, isDeleted: false },
        expect.objectContaining({
          userId,
          token: dto.token,
          platform: DevicePlatform.ANDROID,
          locale: 'ar',
          isActive: true,
          lastSeenAt: expect.any(Date),
        }),
        { upsert: true, new: true },
      );
    });

    it('is idempotent: registering the same token twice is just two upserts, not an error', async () => {
      tokenModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ token: dto.token }),
      });
      await expect(service.register(userId, dto)).resolves.toBeDefined();
      await expect(service.register(userId, dto)).resolves.toBeDefined();
      expect(tokenModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('transfers ownership when the same token re-registers under a different user', async () => {
      tokenModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ token: dto.token }),
      });
      await service.register('a-different-user', dto);
      expect(tokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { token: dto.token, isDeleted: false },
        expect.objectContaining({ userId: 'a-different-user' }),
        { upsert: true, new: true },
      );
    });
  });

  describe('unregister', () => {
    it('scopes the deactivation to her own userId + token', async () => {
      tokenModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });
      await service.unregister(userId, dto.token);
      expect(tokenModel.updateOne).toHaveBeenCalledWith(
        { token: dto.token, userId, isDeleted: false },
        { isActive: false },
      );
    });
  });

  describe('deactivateToken', () => {
    it('deactivates by token value alone, with no userId scoping (system-triggered by FCM)', async () => {
      tokenModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });
      await service.deactivateToken(dto.token);
      expect(tokenModel.updateOne).toHaveBeenCalledWith(
        { token: dto.token, isDeleted: false },
        { isActive: false },
      );
    });

    it('a stale token that keeps getting reported invalid is a no-op the second time, not a repeated failure', async () => {
      tokenModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });
      await expect(service.deactivateToken(dto.token)).resolves.toBeUndefined();
    });
  });

  describe('listActiveForUser', () => {
    it('filters by userId, isActive, and isDeleted', async () => {
      tokenModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      await service.listActiveForUser(userId);
      expect(tokenModel.find).toHaveBeenCalledWith({ userId, isActive: true, isDeleted: false });
    });
  });
});
