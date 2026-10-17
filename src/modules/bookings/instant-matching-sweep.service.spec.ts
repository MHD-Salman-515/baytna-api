import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { CountriesService } from '../countries/countries.service';
import { InstantMatchingSweepService } from './instant-matching-sweep.service';
import { InstantMatchingService } from './instant-matching.service';
import { Booking } from './schemas/booking.schema';

describe('InstantMatchingSweepService', () => {
  let service: InstantMatchingSweepService;
  let bookingModel: { find: jest.Mock; findOneAndUpdate: jest.Mock };
  let instantMatchingService: { markOutstandingOffersStale: jest.Mock; broadcastWave: jest.Mock };
  let countriesService: { findActiveById: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };

  const country = {
    instantMatchingPolicy: {
      radiusStepsMeters: [3000, 6000, 10000],
      waveTimeoutSeconds: 20,
      totalRequestTimeoutSeconds: 90,
      heartbeatStalenessSeconds: 120,
    },
  };

  function searchingBooking(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'booking-1',
      id: 'booking-1',
      countryId: { toString: () => 'country-1' },
      instantMatching: {
        searchStartedAt: new Date(),
        currentWaveIndex: 0,
        currentWaveStartedAt: new Date(),
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    bookingModel = { find: jest.fn(), findOneAndUpdate: jest.fn() };
    instantMatchingService = {
      markOutstandingOffersStale: jest.fn().mockResolvedValue(undefined),
      broadcastWave: jest.fn().mockResolvedValue(undefined),
    };
    countriesService = { findActiveById: jest.fn().mockResolvedValue(country) };
    configService = { get: jest.fn() };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstantMatchingSweepService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: InstantMatchingService, useValue: instantMatchingService },
        { provide: CountriesService, useValue: countriesService },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(InstantMatchingSweepService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    it('does nothing when neither the wave timeout nor the total timeout has elapsed', async () => {
      const booking = searchingBooking(); // just started
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });

      const result = await service.sweep();

      expect(result).toEqual({ expanded: 0, noWorkerFound: 0 });
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('expands to the next wave once the wave timeout elapses, via a claim-then-update guarded by the old wave index', async () => {
      const booking = searchingBooking({
        instantMatching: {
          searchStartedAt: new Date(Date.now() - 25_000), // 25s ago, under the 90s total timeout
          currentWaveIndex: 0,
          currentWaveStartedAt: new Date(Date.now() - 25_000), // over the 20s wave timeout
        },
      });
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });
      bookingModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...booking, instantMatching: { currentWaveIndex: 1 } }),
      });

      const result = await service.sweep();

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: 'booking-1',
          status: BookingStatus.SEARCHING,
          'instantMatching.currentWaveIndex': 0,
        },
        {
          $set: {
            'instantMatching.currentWaveIndex': 1,
            'instantMatching.currentWaveStartedAt': expect.any(Date),
          },
        },
        { new: true },
      );
      expect(instantMatchingService.broadcastWave).toHaveBeenCalledWith(expect.anything(), 1);
      expect(result).toEqual({ expanded: 1, noWorkerFound: 0 });
    });

    it('clamps the wave index at the last radius step once exhausted, but still re-broadcasts', async () => {
      const booking = searchingBooking({
        instantMatching: {
          searchStartedAt: new Date(Date.now() - 50_000),
          currentWaveIndex: 2, // already at the last step (index 2 of 3)
          currentWaveStartedAt: new Date(Date.now() - 25_000),
        },
      });
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });
      bookingModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(booking) });

      await service.sweep();

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ 'instantMatching.currentWaveIndex': 2 }),
        { $set: expect.objectContaining({ 'instantMatching.currentWaveIndex': 2 }) },
        { new: true },
      );
    });

    it('moves to NO_WORKER_FOUND once the total timeout elapses, taking precedence over wave expansion', async () => {
      const booking = searchingBooking({
        instantMatching: {
          searchStartedAt: new Date(Date.now() - 95_000), // over the 90s total timeout
          currentWaveIndex: 1,
          currentWaveStartedAt: new Date(Date.now() - 95_000), // also over the wave timeout
        },
      });
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });
      bookingModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...booking, status: BookingStatus.NO_WORKER_FOUND }),
      });

      const result = await service.sweep();

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'booking-1', status: BookingStatus.SEARCHING },
        { status: BookingStatus.NO_WORKER_FOUND },
        { new: true },
      );
      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1); // never also tries to expand the wave
      expect(instantMatchingService.markOutstandingOffersStale).toHaveBeenCalledWith('booking-1');
      expect(result).toEqual({ expanded: 0, noWorkerFound: 1 });
    });

    it('is safe under a concurrent claim: a losing findOneAndUpdate (null) is not double-counted', async () => {
      const booking = searchingBooking({
        instantMatching: {
          searchStartedAt: new Date(Date.now() - 95_000),
          currentWaveIndex: 0,
          currentWaveStartedAt: new Date(Date.now() - 95_000),
        },
      });
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });
      // Simulates another instance having already claimed this booking.
      bookingModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const result = await service.sweep();

      expect(result).toEqual({ expanded: 0, noWorkerFound: 0 });
      expect(instantMatchingService.markOutstandingOffersStale).not.toHaveBeenCalled();
    });

    it('skips a SEARCHING booking with no instantMatching state (defensive)', async () => {
      const booking = searchingBooking({ instantMatching: null });
      bookingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([booking]) });

      await expect(service.sweep()).resolves.toEqual({ expanded: 0, noWorkerFound: 0 });
      expect(countriesService.findActiveById).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled by env var', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'booking.instantMatchingSweepEnabled' ? false : 5,
      );
      service.onModuleInit();
      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string) =>
        key === 'booking.instantMatchingSweepEnabled' ? true : 5,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'instant-matching-sweep',
        expect.anything(),
      );
      service.onModuleDestroy();
    });
  });
});
