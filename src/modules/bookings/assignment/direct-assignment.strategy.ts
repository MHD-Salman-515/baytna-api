import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AssignmentRequest,
  AssignmentResult,
  BookingAssignmentStrategy,
} from './booking-assignment-strategy.interface';

/** Used for every SCHEDULED booking — see the interface's own doc comment for the Phase 6 seam. */
@Injectable()
export class DirectAssignmentStrategy implements BookingAssignmentStrategy {
  async resolveWorker(request: AssignmentRequest): Promise<AssignmentResult> {
    if (!request.workerProfileId) {
      throw new BadRequestException(
        'workerProfileId is required to book a SCHEDULED service directly',
      );
    }
    return { workerProfileId: request.workerProfileId };
  }
}
