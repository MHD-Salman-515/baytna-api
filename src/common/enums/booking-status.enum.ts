/**
 * The booking lifecycle — modelled like a trip. See
 * bookings/booking.state-machine.ts for the single source of truth on legal
 * transitions between these; nothing else in the app may change `status`.
 */
export enum BookingStatus {
  PENDING_WORKER = 'PENDING_WORKER',
  ACCEPTED = 'ACCEPTED',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  NO_SHOW = 'NO_SHOW',
}
