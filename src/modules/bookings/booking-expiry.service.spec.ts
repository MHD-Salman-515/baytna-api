import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingExpiryService } from './booking-expiry.service';
import { Booking } from './schemas/booking.schema';

describe('BookingExpiryService', () => {
  let service: BookingExpiryService;
  let bookingModel: { find: jest.Mock; updateOne: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };

  beforeEach(async () => {
    bookingModel = { find: jest.fn(), updateOne: jest.fn() };
    configService = { get: jest.fn() };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingExpiryService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(BookingExpiryService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    function select(resolvedValue: unknown) {
      return {
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) }),
      };
    }

    it('expires every overdue PENDING_WORKER booking, using claim-then-update (status re-checked in the update filter)', async () => {
      bookingModel.find.mockReturnValue(select([{ _id: 'b1' }, { _id: 'b2' }]));
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });

      const count = await service.sweep();

      expect(count).toBe(2);
      expect(bookingModel.find).toHaveBeenCalledWith({
        status: BookingStatus.PENDING_WORKER,
        responseDeadline: { $lte: expect.any(Date) },
      });
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b1', status: BookingStatus.PENDING_WORKER },
        { status: BookingStatus.EXPIRED },
      );
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'b2', status: BookingStatus.PENDING_WORKER },
        { status: BookingStatus.EXPIRED },
      );
    });

    it('is idempotent: running twice with nothing newly overdue expires nothing the second time', async () => {
      bookingModel.find
        .mockReturnValueOnce(select([{ _id: 'b1' }]))
        .mockReturnValueOnce(select([]));
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });

      const first = await service.sweep();
      const second = await service.sweep();

      expect(first).toBe(1);
      expect(second).toBe(0);
    });

    it('is safe under a concurrent claim: a losing updateOne (modifiedCount 0) is not double-counted and does not throw', async () => {
      bookingModel.find.mockReturnValue(select([{ _id: 'b1' }]));
      // Simulates another instance having already flipped this booking's
      // status between the find() and this instance's updateOne() call.
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });

      const count = await service.sweep();

      expect(count).toBe(0);
    });

    it('returns 0 when nothing is overdue', async () => {
      bookingModel.find.mockReturnValue(select([]));
      await expect(service.sweep()).resolves.toBe(0);
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled by env var', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'booking.expirySweepEnabled' ? false : 300,
      );
      service.onModuleInit();
      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string) =>
        key === 'booking.expirySweepEnabled' ? true : 120,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'booking-expiry-sweep',
        expect.anything(),
      );
      service.onModuleDestroy();
    });
  });
});
