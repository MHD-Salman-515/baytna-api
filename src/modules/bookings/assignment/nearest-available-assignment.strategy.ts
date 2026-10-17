import { Injectable } from '@nestjs/common';
import {
  AssignmentRequest,
  AssignmentResult,
  BookingAssignmentStrategy,
} from './booking-assignment-strategy.interface';

/**
 * Used for every INSTANT booking. Deliberately never resolves a worker
 * inline — see AssignmentResult/BookingAssignmentStrategy's own doc
 * comments for why: there's no bookingId yet for offers to reference, and
 * matching is an asynchronous broadcast, not a single lookup.
 * InstantMatchingService (not this class) does the actual
 * $geoNear/eligibility work, kicked off by BookingsService.createInstant
 * right after the booking is persisted with status SEARCHING.
 */
@Injectable()
export class NearestAvailableAssignmentStrategy implements BookingAssignmentStrategy {
  async resolveWorker(_request: AssignmentRequest): Promise<AssignmentResult> {
    return { workerProfileId: null };
  }
}
