import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { BookingNotifier } from './booking-notifier.interface';
import { FcmNotifier } from './fcm-notifier';
import { LogNotifier } from './log-notifier';
import { OneSignalNotifier } from './onesignal-notifier';

/**
 * Only this one call site ever decides Log vs Fcm vs OneSignal — all three
 * are constructed by hand here (never registered as their own
 * eagerly-instantiated providers), so FcmNotifier/OneSignalNotifier's
 * constructors only ever run when notifications.pushProvider actually
 * selects them. No Firebase/OneSignal credentials are touched otherwise,
 * in dev or in the test suite.
 */
export function createBookingNotifier(
  preferencesService: NotificationPreferencesService,
  logService: NotificationLogService,
  deviceTokensService: DeviceTokensService,
  usersService: UsersService,
  countriesService: CountriesService,
  workerProfilesService: WorkerProfilesService,
  moduleRef: ModuleRef,
  configService: ConfigService,
): BookingNotifier {
  const provider = configService.get<string>('notifications.pushProvider');
  if (provider === 'fcm') {
    return new FcmNotifier(
      preferencesService,
      logService,
      deviceTokensService,
      usersService,
      countriesService,
      workerProfilesService,
      moduleRef,
      configService,
    );
  }
  if (provider === 'onesignal') {
    return new OneSignalNotifier(
      preferencesService,
      logService,
      deviceTokensService,
      usersService,
      countriesService,
      workerProfilesService,
      moduleRef,
      configService,
    );
  }
  return new LogNotifier(
    preferencesService,
    logService,
    deviceTokensService,
    usersService,
    countriesService,
    workerProfilesService,
    moduleRef,
  );
}
