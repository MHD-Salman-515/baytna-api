import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { AppConfig } from '../../../config/configuration';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationCopy } from '../../notifications/notification-localization';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { BaseNotifier } from './base-notifier';
import { PushSendOutcome } from './push-send-outcome';

const ONESIGNAL_NOTIFICATIONS_URL = 'https://onesignal.com/api/v1/notifications';

interface OneSignalErrorBody {
  // A fully-rejected batch (every id invalid/unsubscribed) comes back as a
  // flat array of human-readable strings — no per-id detail at all.
  errors?: string[] | { invalid_player_ids?: string[] };
}

interface OneSignalSuccessBody {
  id?: string;
  errors?: { invalid_player_ids?: string[] };
}

/**
 * Only ever constructed when NOTIFICATION_PUSH_PROVIDER=onesignal (see
 * booking-notifier.factory.ts) — FCM isn't reliably reachable in every
 * market this app serves, OneSignal has been separately verified to work.
 * `DeviceToken.token` is reused as-is to hold a OneSignal player/
 * subscription id for a OneSignal-registered device — the schema has no
 * provider-specific concept of "token", only this notifier does.
 */
@Injectable()
export class OneSignalNotifier extends BaseNotifier {
  private readonly logger = new Logger(OneSignalNotifier.name);

  constructor(
    preferencesService: NotificationPreferencesService,
    logService: NotificationLogService,
    deviceTokensService: DeviceTokensService,
    usersService: UsersService,
    countriesService: CountriesService,
    workerProfilesService: WorkerProfilesService,
    moduleRef: ModuleRef,
    private readonly configService: ConfigService,
  ) {
    super(
      preferencesService,
      logService,
      deviceTokensService,
      usersService,
      countriesService,
      workerProfilesService,
      moduleRef,
    );
  }

  protected async sendPush(tokens: string[], copy: NotificationCopy): Promise<PushSendOutcome[]> {
    if (tokens.length === 0) {
      return [];
    }

    const oneSignal =
      this.configService.get<AppConfig['notifications']['oneSignal']>('notifications.oneSignal');

    const response = await fetch(ONESIGNAL_NOTIFICATIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Basic ${oneSignal?.restApiKey}`,
      },
      body: JSON.stringify({
        app_id: oneSignal?.appId,
        include_player_ids: tokens,
        headings: { en: copy.title, ar: copy.title },
        contents: { en: copy.body, ar: copy.body },
        data: copy.data,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as OneSignalErrorBody &
      OneSignalSuccessBody;

    if (!response.ok) {
      // OneSignal only reports "every id in this batch is dead" this way —
      // anything else (bad app id, rate limit, ...) is an ordinary failure
      // that says nothing about any individual token's validity.
      const allUnsubscribed =
        Array.isArray(body.errors) &&
        body.errors.some((e) => typeof e === 'string' && /not subscribed/i.test(e));
      const message = Array.isArray(body.errors)
        ? body.errors.join('; ')
        : `OneSignal HTTP ${response.status}`;
      this.logger.warn(`OneSignal send failed: ${message}`);
      return tokens.map((token) => ({
        token,
        success: false,
        providerMessageId: null,
        shouldDeactivate: allUnsubscribed,
        errorMessage: message,
      }));
    }

    const invalidIds = new Set(
      !Array.isArray(body.errors) ? (body.errors?.invalid_player_ids ?? []) : [],
    );
    return tokens.map((token) => ({
      token,
      success: !invalidIds.has(token),
      providerMessageId: invalidIds.has(token) ? null : (body.id ?? null),
      shouldDeactivate: invalidIds.has(token),
      errorMessage: invalidIds.has(token) ? 'invalid or unsubscribed player id' : null,
    }));
  }
}
