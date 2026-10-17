export interface AssignmentRequest {
  // The customer's direct choice — only DirectAssignmentStrategy (SCHEDULED)
  // uses this; a future NearestAvailableAssignmentStrategy (INSTANT, Phase 6)
  // would ignore it and search instead.
  workerProfileId?: string;
  workerServiceId: string;
  serviceId: string;
  countryId: string;
  cityId: string;
  scheduledFor?: Date | null;
}

export interface AssignmentResult {
  // null signals "no worker yet — matching deferred" (INSTANT only). See
  // NearestAvailableAssignmentStrategy's own doc comment for why that
  // strategy can never resolve one inline, unlike DirectAssignmentStrategy.
  workerProfileId: string | null;
}

/**
 * The "who gets this booking" decision, behind an interface specifically so
 * Phase 6 could add a NearestAvailableAssignmentStrategy for INSTANT
 * bookings (broadcast to nearby eligible workers) WITHOUT touching the
 * booking lifecycle's state machine or transition methods — it only adds
 * BookingsService.createInstant as a sibling creation path next to the
 * existing createScheduled, selecting the strategy by BookingType.
 *
 * For SCHEDULED the customer always picks the worker directly (via
 * workerServiceId), so DirectAssignmentStrategy does no matching — it only
 * validates that a choice was actually made and passes it through,
 * resolving synchronously before the booking is even persisted. For
 * INSTANT there is no worker to resolve at creation time at all (matching
 * is an asynchronous broadcast that can take up to the country's total
 * request timeout, and offers need a real bookingId to reference), so
 * NearestAvailableAssignmentStrategy always returns `{ workerProfileId:
 * null }` — BookingsService.createInstant interprets that as "start
 * SEARCHING" and kicks off the actual matching (InstantMatchingService)
 * right after the booking is persisted. Every generic eligibility check
 * (APPROVED, available, serviceAreas, overlap, etc.) stays outside both
 * strategies, in BookingsService / InstantMatchingService, since those are
 * booking rules, not matching-strategy concerns.
 */
export interface BookingAssignmentStrategy {
  resolveWorker(request: AssignmentRequest): Promise<AssignmentResult>;
}
