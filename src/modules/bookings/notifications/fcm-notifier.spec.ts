import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationEventType } from '../../notifications/notification-event';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { NotificationOutcome } from '../../notifications/schemas/notification-log.schema';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { FcmNotifier } from './fcm-notifier';

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn().mockReturnValue({ name: 'fake-app' }),
  credential: { cert: jest.fn().mockReturnValue({}) },
  messaging: jest.fn().mockReturnValue({ sendEachForMulticast: jest.fn() }),
}));

const sendEachForMulticast = (
  jest.requireMock('firebase-admin') as { messaging: jest.Mock }
).messaging().sendEachForMulticast as jest.Mock;

describe('FcmNotifier', () => {
  let notifier: FcmNotifier;
  let deviceTokensService: { listActiveForUser: jest.Mock; deactivateToken: jest.Mock };
  let logService: { record: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    sendEachForMulticast.mockReset();
    (jest.requireMock('firebase-admin') as { initializeApp: jest.Mock }).initializeApp.mockClear();

    const preferencesService = {
      getOwn: jest.fn().mockResolvedValue({
        mutedTypes: [],
        channels: { push: true, socket: true },
        quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
      }),
    };
    logService = { record: jest.fn().mockResolvedValue(undefined) };
    deviceTokensService = {
      listActiveForUser: jest
        .fn()
        .mockResolvedValue([{ token: 'good-token' }, { token: 'dead-token' }]),
      deactivateToken: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue({ locale: 'ar', countryId: 'country-1' }),
    };
    const countriesService = { findOne: jest.fn() };
    const workerProfilesService = { getForAdmin: jest.fn() };
    const gateway = { emitToUser: jest.fn() };
    const moduleRef = { get: jest.fn().mockReturnValue(gateway) };
    configService = {
      get: jest.fn().mockReturnValue({
        projectId: 'p',
        clientEmail: 'e@x.com',
        privateKey: 'key',
      }),
    };

    notifier = new FcmNotifier(
      preferencesService as unknown as NotificationPreferencesService,
      logService as unknown as NotificationLogService,
      deviceTokensService as unknown as DeviceTokensService,
      usersService as unknown as UsersService,
      countriesService as unknown as CountriesService,
      workerProfilesService as unknown as WorkerProfilesService,
      moduleRef as unknown as ModuleRef,
      configService as unknown as ConfigService,
    );
  });

  it('sends a multicast message with the rendered copy and both tokens', async () => {
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-1' },
        { success: true, messageId: 'msg-2' },
      ],
    });

    await notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: 'user-1',
      bookingId: 'booking-1',
      context: {},
    });

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['good-token', 'dead-token'],
        notification: expect.objectContaining({ title: expect.any(String) }),
        data: { type: 'BOOKING_ACCEPTED', bookingId: 'booking-1' },
      }),
    );
  });

  it('deactivates a token FCM reports as unregistered, but keeps a successful one active', async () => {
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-1' },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered', message: 'gone' },
        },
      ],
    });

    await notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: 'user-1',
      bookingId: 'booking-1',
      context: {},
    });

    expect(deviceTokensService.deactivateToken).toHaveBeenCalledWith('dead-token');
    expect(deviceTokensService.deactivateToken).not.toHaveBeenCalledWith('good-token');
    expect(logService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: NotificationOutcome.FAILED, errorMessage: 'gone' }),
    );
  });

  it('does not deactivate a token for an ordinary transient failure', async () => {
    sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-1' },
        { success: false, error: { code: 'messaging/internal-error', message: 'try again' } },
      ],
    });

    await notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: 'user-1',
      bookingId: 'booking-1',
      context: {},
    });

    expect(deviceTokensService.deactivateToken).not.toHaveBeenCalled();
  });

  it('initializes the Firebase app lazily — not before the first send', async () => {
    const admin = jest.requireMock('firebase-admin') as { initializeApp: jest.Mock };
    expect(admin.initializeApp).not.toHaveBeenCalled();

    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true, messageId: 'm' }] });
    await notifier.notify({
      type: NotificationEventType.BOOKING_ACCEPTED,
      recipientUserId: 'user-1',
      bookingId: 'booking-1',
      context: {},
    });

    expect(admin.initializeApp).toHaveBeenCalledTimes(1);
  });
});
