/**
 * The booking lifecycle — modelled like a trip. See
 * bookings/booking.state-machine.ts for the single source of truth on legal
 * transitions between these; nothing else in the app may change `status`.
 */
export enum BookingStatus {
  // INSTANT only: a broadcast search is in progress across one or more
  // radius waves — see InstantMatchingService. Never used for SCHEDULED,
  // which starts at PENDING_WORKER instead.
  SEARCHING = 'SEARCHING',
  PENDING_WORKER = 'PENDING_WORKER',
  ACCEPTED = 'ACCEPTED',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  // INSTANT only, terminal: nobody accepted before the total request
  // timeout elapsed — see InstantMatchingSweepService.
  NO_WORKER_FOUND = 'NO_WORKER_FOUND',
  NO_SHOW = 'NO_SHOW',
}
