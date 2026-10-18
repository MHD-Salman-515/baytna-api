import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CountriesService } from '../../countries/countries.service';
import { DeviceTokensService } from '../../notifications/device-tokens.service';
import { NotificationLogService } from '../../notifications/notification-log.service';
import {
  BookingNotificationEvent,
  isUrgentNotificationType,
  NotificationEventType,
} from '../../notifications/notification-event';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import {
  buildNotificationCopy,
  NotificationCopy,
} from '../../notifications/notification-localization';
import { isWithinQuietHours } from '../../notifications/quiet-hours';
import {
  NotificationChannel,
  NotificationOutcome,
} from '../../notifications/schemas/notification-log.schema';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { UsersService } from '../../users/users.service';
import { WorkerProfilesService } from '../../workers/worker-profiles.service';
import { BookingNotifier, BookingOfferNotification } from './booking-notifier.interface';
import { PushSendOutcome } from './push-send-outcome';
import { SOCKET_EVENT_BY_TYPE } from './socket-event-names';

interface QuietHours {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

/**
 * Shared orchestration for every BookingNotifier implementation: muted-type
 * suppression, quiet-hours suppression (bypassed for every urgent/
 * active-booking event type — see isUrgentNotificationType), socket
 * emission, push delivery, and an append-only NotificationLog entry for
 * every channel attempted on every event. Concrete subclasses
 * (LogNotifier, FcmNotifier) differ only in how `sendPush` actually
 * transmits — everything else here is identical regardless of provider.
 */
@Injectable()
export abstract class BaseNotifier implements BookingNotifier {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
    private readonly logService: NotificationLogService,
    private readonly deviceTokensService: DeviceTokensService,
    private readonly usersService: UsersService,
    private readonly countriesService: CountriesService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolved lazily, at request time, never at construction — RealtimeGateway
   * lives in RealtimeModule, which imports BookingsModule (for
   * isPartyToBooking/LocationTrackingService), so looking it up eagerly
   * through a constructor-injected forwardRef here created a circular
   * factory-provider dependency that resolved to null at runtime (caught
   * live: InstantMatchingService's own `this.notifier` came back null).
   * ModuleRef.get with strict:false searches the whole app container and
   * carries no such cycle, and by the time any notify() call happens the
   * module graph is always fully initialized.
   */
  private get gateway(): RealtimeGateway {
    return this.moduleRef.get(RealtimeGateway, { strict: false });
  }

  protected abstract sendPush(tokens: string[], copy: NotificationCopy): Promise<PushSendOutcome[]>;

  /** Unchanged call site (InstantMatchingService) — resolves workerProfileId to a userId, then just a NEW_OFFER event. */
  async notifyOffer(notification: BookingOfferNotification): Promise<void> {
    const profile = await this.workerProfilesService.getForAdmin(notification.workerProfileId);
    await this.notify({
      type: NotificationEventType.NEW_OFFER,
      recipientUserId: profile.userId.toString(),
      bookingId: notification.bookingId,
      context: {},
    });
  }

  async notify(event: BookingNotificationEvent): Promise<void> {
    const preferences = await this.preferencesService.getOwn(event.recipientUserId);

    if (preferences.mutedTypes.includes(event.type)) {
      await this.recordSuppressed(event, NotificationChannel.SOCKET);
      await this.recordSuppressed(event, NotificationChannel.PUSH);
      return;
    }

    const quietHoursSuppressed = await this.isQuietHoursSuppressed(event, preferences.quietHours);

    if (preferences.channels.socket && !quietHoursSuppressed) {
      await this.deliverSocket(event);
    } else {
      await this.recordSuppressed(event, NotificationChannel.SOCKET);
    }

    if (preferences.channels.push && !quietHoursSuppressed) {
      await this.deliverPush(event);
    } else {
      await this.recordSuppressed(event, NotificationChannel.PUSH);
    }
  }

  private async deliverSocket(event: BookingNotificationEvent): Promise<void> {
    const user = await this.usersService.findById(event.recipientUserId);
    const copy = buildNotificationCopy(event, user.locale);
    this.gateway.emitToUser(event.recipientUserId, SOCKET_EVENT_BY_TYPE[event.type], {
      bookingId: event.bookingId,
      title: copy.title,
      body: copy.body,
      data: copy.data,
    });
    await this.logService.record({
      userId: event.recipientUserId,
      type: event.type,
      channel: NotificationChannel.SOCKET,
      outcome: NotificationOutcome.SENT,
    });
  }

  private async deliverPush(event: BookingNotificationEvent): Promise<void> {
    const tokens = await this.deviceTokensService.listActiveForUser(event.recipientUserId);
    if (tokens.length === 0) {
      await this.logService.record({
        userId: event.recipientUserId,
        type: event.type,
        channel: NotificationChannel.PUSH,
        outcome: NotificationOutcome.FAILED,
        errorMessage: 'no active device tokens',
      });
      return;
    }

    const user = await this.usersService.findById(event.recipientUserId);
    const copy = buildNotificationCopy(event, user.locale);
    const outcomes = await this.sendPush(
      tokens.map((t) => t.token),
      copy,
    );

    for (const outcome of outcomes) {
      await this.logService.record({
        userId: event.recipientUserId,
        type: event.type,
        channel: NotificationChannel.PUSH,
        outcome: outcome.success ? NotificationOutcome.SENT : NotificationOutcome.FAILED,
        providerMessageId: outcome.providerMessageId,
        errorMessage: outcome.errorMessage,
      });
      if (outcome.shouldDeactivate) {
        await this.deviceTokensService.deactivateToken(outcome.token);
      }
    }
  }

  private async recordSuppressed(
    event: BookingNotificationEvent,
    channel: NotificationChannel,
  ): Promise<void> {
    await this.logService.record({
      userId: event.recipientUserId,
      type: event.type,
      channel,
      outcome: NotificationOutcome.SUPPRESSED,
    });
  }

  private async isQuietHoursSuppressed(
    event: BookingNotificationEvent,
    quietHours: QuietHours,
  ): Promise<boolean> {
    if (isUrgentNotificationType(event.type) || !quietHours.enabled) {
      return false;
    }
    const user = await this.usersService.findById(event.recipientUserId);
    const country = await this.countriesService.findOne(user.countryId.toString());
    return isWithinQuietHours(quietHours.startTime, quietHours.endTime, country.timezone);
  }
}
