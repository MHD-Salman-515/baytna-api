import { BookingNotificationEvent } from '../../notifications/notification-event';

export const BOOKING_NOTIFIER = Symbol('BOOKING_NOTIFIER');

export interface BookingOfferNotification {
  workerProfileId: string;
  bookingId: string;
  wave: number;
  radiusMeters: number;
}

/**
 * How a worker learns an INSTANT offer exists, and (Phase 7) how every other
 * booking lifecycle event reaches a customer or worker. `notifyOffer`'s
 * signature and every one of its call sites (InstantMatchingService) are
 * untouched by Phase 7 — only the DI binding behind BOOKING_NOTIFIER changed,
 * from the dev-only LogNotifier to a config-selected LogNotifier/FcmNotifier
 * that both run the same preferences/quiet-hours/localization/delivery-log
 * pipeline (see BaseNotifier). `notify` is the generic seam every other
 * event type (BOOKING_ACCEPTED, WORKER_ON_THE_WAY, NEW_OFFER, ...) goes
 * through.
 */
export interface BookingNotifier {
  notifyOffer(notification: BookingOfferNotification): Promise<void>;
  notify(event: BookingNotificationEvent): Promise<void>;
}
