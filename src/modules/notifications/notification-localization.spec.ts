import { buildNotificationCopy } from './notification-localization';
import { BookingNotificationEvent, NotificationEventType } from './notification-event';

function event(overrides: Partial<BookingNotificationEvent> = {}): BookingNotificationEvent {
  return {
    type: NotificationEventType.BOOKING_ACCEPTED,
    recipientUserId: 'user-1',
    bookingId: 'booking-1',
    context: {},
    ...overrides,
  };
}

describe('buildNotificationCopy', () => {
  it('picks Arabic copy for locale "ar"', () => {
    const result = buildNotificationCopy(event(), 'ar');
    expect(result.title).toBe('تم قبول طلبك');
  });

  it('picks English copy for locale "en"', () => {
    const result = buildNotificationCopy(event(), 'en');
    expect(result.title).toBe('Your booking was accepted');
  });

  it('defaults to Arabic for an unrecognized locale', () => {
    const result = buildNotificationCopy(event(), 'fr');
    expect(result.title).toBe('تم قبول طلبك');
  });

  it('the data payload is always exactly { type, bookingId } — nothing else', () => {
    const result = buildNotificationCopy(event({ bookingId: 'booking-42' }), 'en');
    expect(result.data).toEqual({
      type: NotificationEventType.BOOKING_ACCEPTED,
      bookingId: 'booking-42',
    });
    expect(Object.keys(result.data)).toEqual(['type', 'bookingId']);
  });

  it('interpolates the worker name and ETA where provided', () => {
    const onTheWay = event({
      type: NotificationEventType.WORKER_ON_THE_WAY,
      context: { etaMinutes: 12 },
    });
    expect(buildNotificationCopy(onTheWay, 'en').body).toContain('12');
  });

  it('every event type produces non-empty title/body in both locales (no missing template)', () => {
    for (const type of Object.values(NotificationEventType)) {
      for (const locale of ['ar', 'en']) {
        const result = buildNotificationCopy(event({ type }), locale);
        expect(result.title.length).toBeGreaterThan(0);
        expect(result.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('never mentions an address, phone, or money figure regardless of what a caller stuffs into context', () => {
    const tampered = event({
      context: {
        workerDisplayName: 'Layla',
        // @ts-expect-error -- simulating accidental sensitive fields on context
        customerPhone: '+963900000000',
        exactAddress: 'Some Street, Building 4',
      },
    });
    const result = buildNotificationCopy(tampered, 'en');
    expect(result.title + result.body).not.toContain('+963900000000');
    expect(result.title + result.body).not.toContain('Some Street');
  });
});
