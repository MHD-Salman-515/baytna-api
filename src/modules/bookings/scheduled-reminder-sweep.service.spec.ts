import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEventType } from '../notifications/notification-event';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { ScheduledReminderSweepService } from './scheduled-reminder-sweep.service';
import { Booking } from './schemas/booking.schema';

function chainable(resolvedValue: unknown) {
  return {
    select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(resolvedValue) }),
  };
}

describe('ScheduledReminderSweepService', () => {
  let service: ScheduledReminderSweepService;
  let bookingModel: { find: jest.Mock; updateOne: jest.Mock };
  let workerProfilesService: { getForAdmin: jest.Mock };
  let configService: { get: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    doesExist: jest.Mock;
    deleteInterval: jest.Mock;
  };
  let notifier: { notify: jest.Mock; notifyOffer: jest.Mock };

  function dueBooking(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'booking-1',
      id: 'booking-1',
      workerProfileId: { toString: () => 'worker-profile-1' },
      scheduledFor: new Date(Date.now() + 30 * 60_000),
      ...overrides,
    };
  }

  beforeEach(async () => {
    bookingModel = { find: jest.fn(), updateOne: jest.fn() };
    workerProfilesService = {
      getForAdmin: jest.fn().mockResolvedValue({ userId: { toString: () => 'worker-user-1' } }),
    };
    configService = { get: jest.fn().mockReturnValue(60) };
    schedulerRegistry = {
      addInterval: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      deleteInterval: jest.fn(),
    };
    notifier = { notify: jest.fn().mockResolvedValue(undefined), notifyOffer: jest.fn() };

    bookingModel.find.mockReturnValue(chainable([]));
    bookingModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledReminderSweepService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: WorkerProfilesService, useValue: workerProfilesService },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: BOOKING_NOTIFIER, useValue: notifier },
      ],
    }).compile();

    service = module.get(ScheduledReminderSweepService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sweep', () => {
    it('sends a SCHEDULED_REMINDER to the assigned worker and claims reminderSentAt atomically', async () => {
      const booking = dueBooking();
      bookingModel.find.mockReturnValue(chainable([booking]));

      const sent = await service.sweep();

      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: 'booking-1', reminderSentAt: null },
        { reminderSentAt: expect.any(Date) },
      );
      expect(workerProfilesService.getForAdmin).toHaveBeenCalledWith('worker-profile-1');
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEventType.SCHEDULED_REMINDER,
          recipientUserId: 'worker-user-1',
          bookingId: 'booking-1',
          context: { scheduledForIso: booking.scheduledFor.toISOString() },
        }),
      );
      expect(sent).toBe(1);
    });

    it('is safe under a concurrent claim: a losing updateOne (modifiedCount 0) sends no notification', async () => {
      bookingModel.find.mockReturnValue(chainable([dueBooking()]));
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });

      const sent = await service.sweep();

      expect(notifier.notify).not.toHaveBeenCalled();
      expect(sent).toBe(0);
    });

    it('never throws when the worker profile lookup fails for one booking', async () => {
      bookingModel.find.mockReturnValue(chainable([dueBooking()]));
      workerProfilesService.getForAdmin.mockRejectedValue(new Error('gone'));

      await expect(service.sweep()).resolves.toBe(0);
    });

    it('filters on type SCHEDULED, status ACCEPTED, the reminder lead window, and an unset reminderSentAt', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'booking.reminderLeadMinutes' ? 60 : fallback,
      );

      await service.sweep();

      expect(bookingModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCHEDULED',
          status: 'ACCEPTED',
          reminderSentAt: null,
          scheduledFor: { $lte: expect.any(Date) },
        }),
      );
    });
  });

  describe('onModuleInit', () => {
    it('does not register the interval when disabled', () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'booking.reminderSweepEnabled' ? false : fallback,
      );

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval at the configured cadence when enabled', () => {
      jest.useFakeTimers();
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'booking.reminderSweepEnabled') return true;
        if (key === 'booking.reminderSweepIntervalSeconds') return 120;
        return fallback;
      });

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'scheduled-reminder-sweep',
        expect.anything(),
      );
    });
  });
});
