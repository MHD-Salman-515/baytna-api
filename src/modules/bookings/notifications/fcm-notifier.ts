import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { AppConfig } from '../../../config/configuration';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import { NotificationCopy } from '../../notifications/notification-localization';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { BaseNotifier } from './base-notifier';
import { PushSendOutcome } from './push-send-outcome';

// FCM's two ways of telling us a token is dead — either one means "stop retrying it forever".
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

/** Only ever constructed when NOTIFICATION_PUSH_PROVIDER=fcm (see booking-notifier.factory.ts) — the admin app itself is lazy-initialized on first send, never at boot. */
@Injectable()
export class FcmNotifier extends BaseNotifier {
  private readonly logger = new Logger(FcmNotifier.name);
  private app: admin.app.App | undefined;

  constructor(
    preferencesService: NotificationPreferencesService,
    logService: NotificationLogService,
    deviceTokensService: DeviceTokensService,
    usersService: UsersService,
    countriesService: CountriesService,
    workerProfilesService: WorkerProfilesService,
    gateway: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {
    super(
      preferencesService,
      logService,
      deviceTokensService,
      usersService,
      countriesService,
      workerProfilesService,
      gateway,
    );
  }

  protected async sendPush(tokens: string[], copy: NotificationCopy): Promise<PushSendOutcome[]> {
    if (tokens.length === 0) {
      return [];
    }

    const response = await this.getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: copy.title, body: copy.body },
      data: copy.data,
    });

    return response.responses.map((result, index) => ({
      token: tokens[index],
      success: result.success,
      providerMessageId: result.messageId ?? null,
      shouldDeactivate: !result.success && INVALID_TOKEN_ERROR_CODES.has(result.error?.code ?? ''),
      errorMessage: result.success ? null : (result.error?.message ?? 'unknown FCM error'),
    }));
  }

  private getMessaging(): admin.messaging.Messaging {
    if (!this.app) {
      const fcm = this.configService.get<AppConfig['notifications']['fcm']>('notifications.fcm');
      this.app = admin.initializeApp(
        {
          credential: admin.credential.cert({
            projectId: fcm?.projectId,
            clientEmail: fcm?.clientEmail,
            privateKey: fcm?.privateKey,
          }),
        },
        `fcm-notifier-${Date.now()}`,
      );
      this.logger.log('Firebase Admin app initialized for push delivery');
    }
    return admin.messaging(this.app);
  }
}
