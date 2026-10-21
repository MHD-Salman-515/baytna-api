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
  // Worker-facing, wallet (Phase 8) — none of these are tied to a specific
  // booking, see BookingNotificationEvent.bookingId's own comment.
  WALLET_LOW_BALANCE = 'WALLET_LOW_BALANCE',
  WALLET_SUSPENDED = 'WALLET_SUSPENDED',
  WALLET_REINSTATED = 'WALLET_REINSTATED',
  // Admin-facing (Phase 9) — fired at every admin individually, never at a
  // booking party. See PanicAlertsService.trigger.
  PANIC_ALERT_TRIGGERED = 'PANIC_ALERT_TRIGGERED',
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
  // She needs to know the moment either of these happens — it changes
  // whether she can work right now, same urgency class as everything above.
  NotificationEventType.WALLET_SUSPENDED,
  NotificationEventType.WALLET_REINSTATED,
  // WALLET_LOW_BALANCE stays non-urgent, alongside SCHEDULED_REMINDER — it's
  // a heads-up, not something that just changed her ability to work.
  // A panic alert is the single most time-sensitive event in the system.
  NotificationEventType.PANIC_ALERT_TRIGGERED,
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
  // null for the three WALLET_* types (Phase 8) — a balance/suspension event
  // isn't about any one booking. Every other type always sets it.
  bookingId: string | null;
  context: {
    workerDisplayName?: string;
    etaMinutes?: number;
    serviceName?: { ar: string; en: string };
    reason?: string;
    scheduledForIso?: string;
    // WALLET_* only. Never commissionAmount/workerEarnings — a push/socket
    // payload must never carry what the business actually earned off her.
    balance?: number;
    currency?: string;
    // PANIC_ALERT_TRIGGERED only. Never an exact address or phone — see
    // PanicAlertsService.trigger's own comment on what an admin notification
    // may and may not carry.
    triggeredByRole?: string;
  };
}
