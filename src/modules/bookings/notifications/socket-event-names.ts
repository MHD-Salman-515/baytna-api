import { NotificationEventType } from '../../notifications/notification-event';

/**
 * The socket event catalogue from the Phase 7 spec, keyed by
 * NotificationEventType so BaseNotifier's single dispatch path can emit the
 * right named event instead of one generic "notification" event.
 */
export const SOCKET_EVENT_BY_TYPE: Record<NotificationEventType, string> = {
  [NotificationEventType.BOOKING_ACCEPTED]: 'booking:statusChanged',
  [NotificationEventType.WORKER_ON_THE_WAY]: 'booking:statusChanged',
  [NotificationEventType.WORKER_ARRIVED]: 'booking:statusChanged',
  [NotificationEventType.JOB_STARTED]: 'booking:statusChanged',
  [NotificationEventType.JOB_COMPLETED]: 'booking:completed',
  [NotificationEventType.BOOKING_CANCELLED]: 'booking:cancelled',
  [NotificationEventType.NO_WORKER_FOUND]: 'booking:statusChanged',
  [NotificationEventType.NEW_OFFER]: 'offer:new',
  [NotificationEventType.OFFER_TAKEN]: 'offer:taken',
  [NotificationEventType.SCHEDULED_REMINDER]: 'booking:reminder',
};
