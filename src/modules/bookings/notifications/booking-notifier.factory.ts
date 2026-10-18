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

/**
 * Only this one call site ever decides Log vs Fcm — both are constructed
 * by hand here (never registered as their own eagerly-instantiated
 * providers), so FcmNotifier's constructor only ever runs when
 * notifications.pushProvider === 'fcm'. No Firebase credentials are
 * touched otherwise, in dev or in the test suite.
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
