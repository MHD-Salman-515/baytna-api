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
  workerProfileId: string;
}

/**
 * The "who gets this booking" decision, behind an interface specifically so
 * Phase 6 can add a NearestAvailableAssignmentStrategy for INSTANT bookings
 * (search nearby available workers, pick one) WITHOUT touching
 * BookingsService.create — it already calls `strategy.resolveWorker(...)`
 * exactly once; Phase 6 only needs to register a second implementation and
 * select it by BookingType, not change the booking lifecycle itself.
 *
 * In this phase the customer always picks the worker directly (via
 * workerServiceId), so DirectAssignmentStrategy does no matching — it only
 * validates that a choice was actually made and passes it through. Every
 * eligibility check (APPROVED, available, serviceAreas, overlap, etc.) stays
 * in BookingsService, since those are generic booking rules, not
 * matching-strategy concerns.
 */
export interface BookingAssignmentStrategy {
  resolveWorker(request: AssignmentRequest): Promise<AssignmentResult>;
}
