import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreference } from './schemas/notification-preference.schema';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let preferenceModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };

  const userId = 'user-1';

  beforeEach(async () => {
    preferenceModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: getModelToken(NotificationPreference.name), useValue: preferenceModel },
      ],
    }).compile();

    service = module.get(NotificationPreferencesService);
  });

  describe('getOwn', () => {
    it('returns the all-enabled defaults when she has never customized anything (no row written)', async () => {
      preferenceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.getOwn(userId);

      expect(result).toEqual({
        mutedTypes: [],
        channels: { push: true, socket: true },
        quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
      });
    });

    it('returns her saved preferences when a row exists', async () => {
      const saved = {
        mutedTypes: ['SCHEDULED_REMINDER'],
        channels: { push: true, socket: false },
        quietHours: { enabled: true, startTime: '23:00', endTime: '06:00' },
      };
      preferenceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(saved) });

      await expect(service.getOwn(userId)).resolves.toEqual(saved);
    });
  });

  describe('upsertOwn', () => {
    it('merges the given partial update onto her current preferences (defaults, if none saved yet)', async () => {
      preferenceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      preferenceModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.upsertOwn(userId, { quietHours: { enabled: true, startTime: '23:00' } });

      expect(preferenceModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId, isDeleted: false },
        expect.objectContaining({
          userId,
          mutedTypes: [],
          channels: { push: true, socket: true },
          quietHours: { enabled: true, startTime: '23:00', endTime: '07:00' },
        }),
        { upsert: true, new: true },
      );
    });

    it('a partial channels update only overrides the given keys, keeping the rest', async () => {
      preferenceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          mutedTypes: [],
          channels: { push: true, socket: true },
          quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
        }),
      });
      preferenceModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.upsertOwn(userId, { channels: { push: false } });

      expect(preferenceModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ channels: { push: false, socket: true } }),
        expect.anything(),
      );
    });
  });
});
