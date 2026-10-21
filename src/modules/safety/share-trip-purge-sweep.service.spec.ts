import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingsService } from '../bookings/bookings.service';
import { ShareTripPurgeSweepService } from './share-trip-purge-sweep.service';

function chainExec(resolvedValue: unknown) {
  return { exec: jest.fn().mockResolvedValue(resolvedValue) };
}

describe('ShareTripPurgeSweepService', () => {
  let service: ShareTripPurgeSweepService;
  let tokenModel: { find: jest.Mock };
  let bookingsService: { getForAdmin: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };

  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'token-1',
      bookingId: { toString: () => 'booking-1' },
      isDeleted: false,
      deletedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  beforeEach(() => {
    tokenModel = { find: jest.fn() };
    bookingsService = { getForAdmin: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(60) };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };

    tokenModel.find.mockReturnValue(chainExec([]));

    service = new ShareTripPurgeSweepService(
      tokenModel as never,
      bookingsService as unknown as BookingsService,
      configService as unknown as ConfigService,
      schedulerRegistry as unknown as SchedulerRegistry,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    it('purges a token whose booking has been terminal for longer than the grace period', async () => {
      const token = tokenRow();
      tokenModel.find.mockReturnValue(chainExec([token]));
      bookingsService.getForAdmin.mockResolvedValue({
        status: BookingStatus.COMPLETED,
        completedAt: new Date(Date.now() - 2 * 3_600_000),
        cancelledAt: null,
        updatedAt: new Date(Date.now() - 2 * 3_600_000),
      });

      const purged = await service.sweep();

      expect(token.isDeleted).toBe(true);
      expect(token.save).toHaveBeenCalled();
      expect(purged).toBe(1);
    });

    it('leaves a token alone while its booking is still active', async () => {
      const token = tokenRow();
      tokenModel.find.mockReturnValue(chainExec([token]));
      bookingsService.getForAdmin.mockResolvedValue({
        status: BookingStatus.IN_PROGRESS,
        completedAt: null,
        cancelledAt: null,
        updatedAt: new Date(),
      });

      const purged = await service.sweep();

      expect(token.isDeleted).toBe(false);
      expect(purged).toBe(0);
    });

    it('leaves a token alone while still within the grace period after termination', async () => {
      const token = tokenRow();
      tokenModel.find.mockReturnValue(chainExec([token]));
      bookingsService.getForAdmin.mockResolvedValue({
        status: BookingStatus.COMPLETED,
        completedAt: new Date(),
        cancelledAt: null,
        updatedAt: new Date(),
      });

      const purged = await service.sweep();

      expect(purged).toBe(0);
    });

    it('purges a token whose booking no longer exists at all', async () => {
      const token = tokenRow();
      tokenModel.find.mockReturnValue(chainExec([token]));
      bookingsService.getForAdmin.mockRejectedValue(new Error('gone'));

      const purged = await service.sweep();

      expect(token.isDeleted).toBe(true);
      expect(purged).toBe(1);
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled', () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'safety.shareTripTokenPurgeSweepEnabled' ? false : fallback,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'safety.shareTripTokenPurgeSweepEnabled') return true;
        if (key === 'safety.shareTripTokenPurgeSweepIntervalSeconds') return 300;
        return fallback;
      });

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'share-trip-purge-sweep',
        expect.anything(),
      );
    });
  });
});
