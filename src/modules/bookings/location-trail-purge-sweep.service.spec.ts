import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationTrailPurgeSweepService } from './location-trail-purge-sweep.service';
import { BookingLocationTrail } from './schemas/booking-location-trail.schema';

describe('LocationTrailPurgeSweepService', () => {
  let service: LocationTrailPurgeSweepService;
  let trailModel: { deleteMany: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };

  beforeEach(async () => {
    trailModel = { deleteMany: jest.fn() };
    configService = {
      get: jest.fn().mockImplementation((_key: string, fallback?: unknown) => fallback),
    };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };
    trailModel.deleteMany.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationTrailPurgeSweepService,
        { provide: getModelToken(BookingLocationTrail.name), useValue: trailModel },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(LocationTrailPurgeSweepService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    it('deletes only trails terminated at least retentionHours ago', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.trailRetentionHours' ? 24 : fallback,
      );
      trailModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 3 }),
      });

      const deleted = await service.sweep();

      expect(trailModel.deleteMany).toHaveBeenCalledWith({
        terminatedAt: { $ne: null, $lte: expect.any(Date) },
      });
      expect(deleted).toBe(3);
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled', () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'location.trailPurgeSweepEnabled' ? false : fallback,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'location.trailPurgeSweepEnabled') return true;
        if (key === 'location.trailPurgeSweepIntervalSeconds') return 300;
        return fallback;
      });

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'location-trail-purge-sweep',
        expect.anything(),
      );
    });
  });
});
