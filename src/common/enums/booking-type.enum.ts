/**
 * Only SCHEDULED is creatable in Phase 5 — INSTANT exists on the enum now so
 * Phase 6 adds a new code path (and a new BookingAssignmentStrategy), not a
 * schema migration. See bookings/assignment/booking-assignment-strategy.ts.
 */
export enum BookingType {
  SCHEDULED = 'SCHEDULED',
  INSTANT = 'INSTANT',
}
