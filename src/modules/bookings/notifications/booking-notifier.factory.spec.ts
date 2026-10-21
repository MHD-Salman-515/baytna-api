import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { createBookingNotifier } from './booking-notifier.factory';
import { FcmNotifier } from './fcm-notifier';
import { LogNotifier } from './log-notifier';
import { OneSignalNotifier } from './onesignal-notifier';

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(),
}));

describe('createBookingNotifier', () => {
  function build(configService: { get: jest.Mock }) {
    return createBookingNotifier(
      {} as NotificationPreferencesService,
      {} as NotificationLogService,
      {} as DeviceTokensService,
      {} as UsersService,
      {} as CountriesService,
      {} as WorkerProfilesService,
      {} as ModuleRef,
      configService as unknown as ConfigService,
    );
  }

  it('selects LogNotifier by default (no NOTIFICATION_PUSH_PROVIDER configured)', () => {
    const notifier = build({ get: jest.fn().mockReturnValue(undefined) });

    expect(notifier).toBeInstanceOf(LogNotifier);
    expect(notifier).not.toBeInstanceOf(FcmNotifier);
  });

  it('selects LogNotifier when pushProvider is explicitly "log"', () => {
    const notifier = build({ get: jest.fn().mockReturnValue('log') });

    expect(notifier).toBeInstanceOf(LogNotifier);
  });

  it('selects FcmNotifier only when pushProvider is "fcm"', () => {
    const notifier = build({ get: jest.fn().mockReturnValue('fcm') });

    expect(notifier).toBeInstanceOf(FcmNotifier);
    expect(notifier).not.toBeInstanceOf(OneSignalNotifier);
  });

  it('selects OneSignalNotifier only when pushProvider is "onesignal"', () => {
    const notifier = build({ get: jest.fn().mockReturnValue('onesignal') });

    expect(notifier).toBeInstanceOf(OneSignalNotifier);
    expect(notifier).not.toBeInstanceOf(FcmNotifier);
    expect(notifier).not.toBeInstanceOf(LogNotifier);
  });
});
