/**
 * Every notification this app sends, across both customer- and
 * worker-facing events. One flat catalogue (not split by recipient role)
 * keeps NotificationDispatchService, the localization templates, and
 * NotificationLog all working from the same vocabulary.
 */
export enum NotificationEventType {
  // Customer-facing
  BOOKING_ACCEPTED = 'BOOKING_ACCEPTED',
  WORKER_ON_THE_WAY = 'WORKER_ON_THE_WAY',
  WORKER_ARRIVED = 'WORKER_ARRIVED',
  JOB_STARTED = 'JOB_STARTED',
  JOB_COMPLETED = 'JOB_COMPLETED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  NO_WORKER_FOUND = 'NO_WORKER_FOUND',
  // Worker-facing
  NEW_OFFER = 'NEW_OFFER',
  OFFER_TAKEN = 'OFFER_TAKEN',
  SCHEDULED_REMINDER = 'SCHEDULED_REMINDER',
}

/**
 * Transactional events about a booking that's actively in flight — quiet
 * hours must never suppress these (see quiet-hours.ts). Only
 * SCHEDULED_REMINDER is a true "can wait until morning" notification.
 * `BOOKING_CANCELLED`/`NO_WORKER_FOUND` are urgent too: the other party
 * needs to know right away that whatever she was expecting isn't happening.
 */
export const URGENT_NOTIFICATION_TYPES: ReadonlySet<NotificationEventType> = new Set([
  NotificationEventType.BOOKING_ACCEPTED,
  NotificationEventType.WORKER_ON_THE_WAY,
  NotificationEventType.WORKER_ARRIVED,
  NotificationEventType.JOB_STARTED,
  NotificationEventType.JOB_COMPLETED,
  NotificationEventType.BOOKING_CANCELLED,
  NotificationEventType.NO_WORKER_FOUND,
  NotificationEventType.NEW_OFFER,
  NotificationEventType.OFFER_TAKEN,
]);

export function isUrgentNotificationType(type: NotificationEventType): boolean {
  return URGENT_NOTIFICATION_TYPES.has(type);
}

/**
 * What a notification is actually about — deliberately minimal and never
 * containing an exact address, phone number, document data, or commission
 * figures (see toNotificationCopy in notification-localization.ts, the one
 * place these fields turn into the text a user actually sees).
 */
export interface BookingNotificationEvent {
  type: NotificationEventType;
  recipientUserId: string;
  bookingId: string;
  context: {
    workerDisplayName?: string;
    etaMinutes?: number;
    serviceName?: { ar: string; en: string };
    reason?: string;
    scheduledForIso?: string;
  };
}
