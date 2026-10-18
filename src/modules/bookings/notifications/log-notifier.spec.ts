import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationEventType } from '../../notifications/notification-event';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import {
  NotificationChannel,
  NotificationOutcome,
} from '../../notifications/schemas/notification-log.schema';
import { ModuleRef } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { BookingNotificationEvent } from '../../notifications/notification-event';
import { LogNotifier } from './log-notifier';

describe('LogNotifier (BaseNotifier orchestration)', () => {
  let notifier: LogNotifier;
  let preferencesService: { getOwn: jest.Mock };
  let logService: { record: jest.Mock };
  let deviceTokensService: { listActiveForUser: jest.Mock; deactivateToken: jest.Mock };
  let usersService: { findById: jest.Mock };
  let countriesService: { findOne: jest.Mock };
  let workerProfilesService: { getForAdmin: jest.Mock };
  let gateway: { emitToUser: jest.Mock };

  const userId = 'user-1';
  const DEFAULT_PREFS = {
    mutedTypes: [] as string[],
    channels: { push: true, socket: true },
    quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
  };

  function event(overrides: Partial<BookingNotificationEvent> = {}): BookingNotificationEvent {
    return {
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: userId,
      bookingId: 'booking-1',
      context: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    preferencesService = { getOwn: jest.fn().mockResolvedValue(DEFAULT_PREFS) };
    logService = { record: jest.fn().mockResolvedValue(undefined) };
    deviceTokensService = {
      listActiveForUser: jest.fn().mockResolvedValue([{ token: 'tok-1', locale: 'ar' }]),
      deactivateToken: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ locale: 'ar', countryId: 'country-1' }),
    };
    countriesService = { findOne: jest.fn().mockResolvedValue({ timezone: 'Asia/Damascus' }) };
    workerProfilesService = { getForAdmin: jest.fn() };
    gateway = { emitToUser: jest.fn() };
    const moduleRef = { get: jest.fn().mockReturnValue(gateway) };

    notifier = new LogNotifier(
      preferencesService as unknown as NotificationPreferencesService,
      logService as unknown as NotificationLogService,
      deviceTokensService as unknown as DeviceTokensService,
      usersService as unknown as UsersService,
      countriesService as unknown as CountriesService,
      workerProfilesService as unknown as WorkerProfilesService,
      moduleRef as unknown as ModuleRef,
    );
  });

  describe('notify', () => {
    it('emits a socket event and a push, logging SENT for both', async () => {
      await notifier.notify(event());

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'booking:statusChanged',
        expect.objectContaining({ bookingId: 'booking-1' }),
      );
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.SOCKET,
          outcome: NotificationOutcome.SENT,
        }),
      );
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.PUSH,
          outcome: NotificationOutcome.SENT,
        }),
      );
    });

    it('suppresses both channels and skips delivery entirely when the type is muted', async () => {
      preferencesService.getOwn.mockResolvedValue({
        ...DEFAULT_PREFS,
        mutedTypes: ['BOOKING_ACCEPTED'],
      });

      await notifier.notify(event());

      expect(gateway.emitToUser).not.toHaveBeenCalled();
      expect(deviceTokensService.listActiveForUser).not.toHaveBeenCalled();
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.SOCKET,
          outcome: NotificationOutcome.SUPPRESSED,
        }),
      );
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.PUSH,
          outcome: NotificationOutcome.SUPPRESSED,
        }),
      );
    });

    it('suppresses a channel the user disabled in preferences, without touching the other', async () => {
      preferencesService.getOwn.mockResolvedValue({
        ...DEFAULT_PREFS,
        channels: { push: false, socket: true },
      });

      await notifier.notify(event());

      expect(gateway.emitToUser).toHaveBeenCalled();
      expect(deviceTokensService.listActiveForUser).not.toHaveBeenCalled();
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.PUSH,
          outcome: NotificationOutcome.SUPPRESSED,
        }),
      );
    });

    it('suppresses a non-urgent reminder during quiet hours', async () => {
      preferencesService.getOwn.mockResolvedValue({
        ...DEFAULT_PREFS,
        quietHours: { enabled: true, startTime: '00:00', endTime: '23:59' },
      });

      await notifier.notify(event({ type: NotificationEventType.SCHEDULED_REMINDER }));

      expect(gateway.emitToUser).not.toHaveBeenCalled();
      expect(deviceTokensService.listActiveForUser).not.toHaveBeenCalled();
      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.SOCKET,
          outcome: NotificationOutcome.SUPPRESSED,
        }),
      );
    });

    it('never suppresses an urgent/active-booking event for quiet hours, even when inside the window', async () => {
      preferencesService.getOwn.mockResolvedValue({
        ...DEFAULT_PREFS,
        quietHours: { enabled: true, startTime: '00:00', endTime: '23:59' },
      });

      await notifier.notify(event({ type: NotificationEventType.WORKER_ON_THE_WAY }));

      expect(gateway.emitToUser).toHaveBeenCalled();
      expect(deviceTokensService.listActiveForUser).toHaveBeenCalled();
    });

    it('logs a FAILED push attempt (not SUPPRESSED) when the user has no active device tokens', async () => {
      deviceTokensService.listActiveForUser.mockResolvedValue([]);

      await notifier.notify(event());

      expect(logService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.PUSH,
          outcome: NotificationOutcome.FAILED,
          errorMessage: 'no active device tokens',
        }),
      );
    });

    it('builds the copy from the localization templates in the recipient locale', async () => {
      usersService.findById.mockResolvedValue({ locale: 'en', countryId: 'country-1' });

      await notifier.notify(event());

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        expect.anything(),
        expect.objectContaining({ title: 'Your booking was accepted' }),
      );
    });
  });

  describe('notifyOffer', () => {
    it("resolves the worker's userId via WorkerProfilesService and dispatches a NEW_OFFER event", async () => {
      workerProfilesService.getForAdmin.mockResolvedValue({
        userId: { toString: () => 'worker-user-1' },
      });
      usersService.findById.mockResolvedValue({ locale: 'ar', countryId: 'country-1' });

      await notifier.notifyOffer({
        workerProfileId: 'profile-1',
        bookingId: 'booking-9',
        wave: 0,
        radiusMeters: 3000,
      });

      expect(workerProfilesService.getForAdmin).toHaveBeenCalledWith('profile-1');
      expect(usersService.findById).toHaveBeenCalledWith('worker-user-1');
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'worker-user-1',
        'offer:new',
        expect.objectContaining({ bookingId: 'booking-9' }),
      );
    });
  });
});
