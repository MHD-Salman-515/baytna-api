export const BOOKING_NOTIFIER = Symbol('BOOKING_NOTIFIER');

export interface BookingOfferNotification {
  workerProfileId: string;
  bookingId: string;
  wave: number;
  radiusMeters: number;
}

/**
 * How a worker learns an INSTANT offer exists. Deliberately not built in
 * this phase — LogNotifier (the only implementation here) just logs what
 * would have been sent, so InstantMatchingService and the whole broadcast
 * flow are fully testable end to end via the polling endpoint
 * (GET /workers/me/offers) without push infrastructure. Phase 8 swaps in a
 * real push/websocket implementation behind this same interface; nothing
 * in InstantMatchingService changes when it does.
 */
export interface BookingNotifier {
  notifyOffer(notification: BookingOfferNotification): Promise<void>;
}
