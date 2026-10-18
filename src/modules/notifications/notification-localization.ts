import { BookingNotificationEvent, NotificationEventType } from './notification-event';

export interface NotificationCopy {
  title: string;
  body: string;
  // Always exactly { type, bookingId } — what the client routes on. Never
  // an exact address, phone number, document reference, or commission
  // figure; `context` on BookingNotificationEvent is deliberately shaped so
  // there's nothing sensitive to leak here even by accident.
  data: { type: string; bookingId: string };
}

type Templates = Record<
  NotificationEventType,
  (locale: 'ar' | 'en', event: BookingNotificationEvent) => NotificationCopy
>;

function copy(title: string, body: string, event: BookingNotificationEvent): NotificationCopy {
  return { title, body, data: { type: event.type, bookingId: event.bookingId } };
}

const TEMPLATES: Templates = {
  [NotificationEventType.BOOKING_ACCEPTED]: (locale, event) => {
    const name = event.context.workerDisplayName ?? (locale === 'ar' ? 'العاملة' : 'the worker');
    return locale === 'ar'
      ? copy('تم قبول طلبك', `${name} ستتولى طلبك وستصل قريبًا`, event)
      : copy(
          'Your booking was accepted',
          `${name} will handle your booking and arrive soon`,
          event,
        );
  },
  [NotificationEventType.WORKER_ON_THE_WAY]: (locale, event) => {
    const eta = event.context.etaMinutes;
    if (locale === 'ar') {
      return copy(
        'في الطريق إليك',
        eta ? `الوصول المتوقع خلال ${eta} دقيقة` : 'العاملة في الطريق إليك الآن',
        event,
      );
    }
    return copy(
      'On the way',
      eta ? `Arriving in about ${eta} min` : 'The worker is on the way',
      event,
    );
  },
  [NotificationEventType.WORKER_ARRIVED]: (locale, event) =>
    locale === 'ar'
      ? copy('وصلت العاملة', 'وصلت العاملة إلى موقعك', event)
      : copy('She has arrived', 'The worker has arrived at your location', event),
  [NotificationEventType.JOB_STARTED]: (locale, event) =>
    locale === 'ar'
      ? copy('بدأ العمل', 'بدأت العاملة بتنفيذ الطلب', event)
      : copy('Job started', 'The worker has started the job', event),
  [NotificationEventType.JOB_COMPLETED]: (locale, event) =>
    locale === 'ar'
      ? copy('تم إنجاز الطلب', 'تم إنجاز طلبك بنجاح', event)
      : copy('Job completed', 'Your booking has been completed', event),
  [NotificationEventType.BOOKING_CANCELLED]: (locale, event) =>
    locale === 'ar'
      ? copy('تم إلغاء الطلب', 'تم إلغاء هذا الطلب', event)
      : copy('Booking cancelled', 'This booking has been cancelled', event),
  [NotificationEventType.NO_WORKER_FOUND]: (locale, event) =>
    locale === 'ar'
      ? copy('لم نجد عاملة متاحة', 'لم نعثر على عاملة متاحة حاليًا، يمكنك المحاولة مرة أخرى', event)
      : copy(
          'No worker found',
          'No available worker was found right now — please try again',
          event,
        ),
  [NotificationEventType.NEW_OFFER]: (locale, event) => {
    const service = event.context.serviceName;
    const label = service
      ? locale === 'ar'
        ? service.ar
        : service.en
      : locale === 'ar'
        ? 'طلب جديد'
        : 'a new job';
    return locale === 'ar'
      ? copy('طلب جديد بانتظارك', `${label} — بانتظار ردك`, event)
      : copy('New job request', `${label} is waiting for your response`, event);
  },
  [NotificationEventType.OFFER_TAKEN]: (locale, event) =>
    locale === 'ar'
      ? copy('انتهت فرصة هذا الطلب', 'تم قبول هذا الطلب من مزودة أخرى', event)
      : copy('Offer no longer available', 'This job was accepted by another provider', event),
  [NotificationEventType.SCHEDULED_REMINDER]: (locale, event) =>
    locale === 'ar'
      ? copy('تذكير بموعد قريب', 'لديك طلب محجوز قريبًا، لا تنسَ الاستعداد', event)
      : copy(
          'Upcoming booking reminder',
          "You have a booking coming up — don't forget to get ready",
          event,
        ),
};

export function buildNotificationCopy(
  event: BookingNotificationEvent,
  locale: string,
): NotificationCopy {
  const resolvedLocale = locale === 'en' ? 'en' : 'ar'; // 'ar' is the project default — see User.locale
  return TEMPLATES[event.type](resolvedLocale, event);
}
