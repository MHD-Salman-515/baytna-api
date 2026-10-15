import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums/booking-status.enum';

/**
 * Who is allowed to perform a given action — distinct from the Role enum
 * because EXPIRE is performed by the system (the expiry sweep), not by any
 * authenticated user.
 */
export type BookingActor = 'CUSTOMER' | 'WORKER' | 'ADMIN' | 'SYSTEM';

export enum BookingAction {
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
  ON_THE_WAY = 'ON_THE_WAY',
  ARRIVED = 'ARRIVED',
  START = 'START',
  COMPLETE = 'COMPLETE',
  CUSTOMER_CANCEL = 'CUSTOMER_CANCEL',
  WORKER_CANCEL = 'WORKER_CANCEL',
  ADMIN_FORCE_CANCELLED = 'ADMIN_FORCE_CANCELLED',
  ADMIN_FORCE_NO_SHOW = 'ADMIN_FORCE_NO_SHOW',
  EXPIRE = 'EXPIRE',
}

interface TransitionRule {
  from: BookingStatus[];
  to: BookingStatus;
  actor: BookingActor;
}

/**
 * The single source of truth for legal booking transitions — the trip:
 * PENDING_WORKER -> ACCEPTED -> ON_THE_WAY -> ARRIVED -> IN_PROGRESS -> COMPLETED,
 * plus REJECTED/CANCELLED/EXPIRED/NO_SHOW off to the side. Every service
 * method that changes `status` must go through assertValidAction first;
 * nothing else in the app may set it directly.
 *
 * CUSTOMER_CANCEL stops being legal once IN_PROGRESS (the job has started);
 * WORKER_CANCEL only exists from ACCEPTED onward (declining before that is
 * REJECT, not a cancellation) and likewise stops at IN_PROGRESS.
 */
const TRANSITIONS: Record<BookingAction, TransitionRule> = {
  [BookingAction.ACCEPT]: {
    from: [BookingStatus.PENDING_WORKER],
    to: BookingStatus.ACCEPTED,
    actor: 'WORKER',
  },
  [BookingAction.REJECT]: {
    from: [BookingStatus.PENDING_WORKER],
    to: BookingStatus.REJECTED,
    actor: 'WORKER',
  },
  [BookingAction.ON_THE_WAY]: {
    from: [BookingStatus.ACCEPTED],
    to: BookingStatus.ON_THE_WAY,
    actor: 'WORKER',
  },
  [BookingAction.ARRIVED]: {
    from: [BookingStatus.ON_THE_WAY],
    to: BookingStatus.ARRIVED,
    actor: 'WORKER',
  },
  [BookingAction.START]: {
    from: [BookingStatus.ARRIVED],
    to: BookingStatus.IN_PROGRESS,
    actor: 'WORKER',
  },
  [BookingAction.COMPLETE]: {
    from: [BookingStatus.IN_PROGRESS],
    to: BookingStatus.COMPLETED,
    actor: 'WORKER',
  },
  [BookingAction.CUSTOMER_CANCEL]: {
    from: [
      BookingStatus.PENDING_WORKER,
      BookingStatus.ACCEPTED,
      BookingStatus.ON_THE_WAY,
      BookingStatus.ARRIVED,
    ],
    to: BookingStatus.CANCELLED,
    actor: 'CUSTOMER',
  },
  [BookingAction.WORKER_CANCEL]: {
    from: [BookingStatus.ACCEPTED, BookingStatus.ON_THE_WAY, BookingStatus.ARRIVED],
    to: BookingStatus.CANCELLED,
    actor: 'WORKER',
  },
  [BookingAction.ADMIN_FORCE_CANCELLED]: {
    from: [
      BookingStatus.PENDING_WORKER,
      BookingStatus.ACCEPTED,
      BookingStatus.ON_THE_WAY,
      BookingStatus.ARRIVED,
      BookingStatus.IN_PROGRESS,
    ],
    to: BookingStatus.CANCELLED,
    actor: 'ADMIN',
  },
  [BookingAction.ADMIN_FORCE_NO_SHOW]: {
    from: [
      BookingStatus.ACCEPTED,
      BookingStatus.ON_THE_WAY,
      BookingStatus.ARRIVED,
      BookingStatus.IN_PROGRESS,
    ],
    to: BookingStatus.NO_SHOW,
    actor: 'ADMIN',
  },
  [BookingAction.EXPIRE]: {
    from: [BookingStatus.PENDING_WORKER],
    to: BookingStatus.EXPIRED,
    actor: 'SYSTEM',
  },
};

/**
 * Validates `action` against the booking's current status and the actor
 * attempting it, and returns the resulting status if legal. Throws
 * ForbiddenException for a role mismatch (e.g. a customer attempting a
 * worker-only action) and BadRequestException for an illegal transition
 * (naming both the current status and the attempted target status).
 */
export function assertValidAction(
  currentStatus: BookingStatus,
  action: BookingAction,
  actor: BookingActor,
): BookingStatus {
  const rule = TRANSITIONS[action];

  if (rule.actor !== actor) {
    throw new ForbiddenException(`${action} may only be performed by ${rule.actor}, not ${actor}`);
  }

  if (!rule.from.includes(currentStatus)) {
    throw new BadRequestException(
      `Cannot ${action} a booking from status ${currentStatus} to ${rule.to} ` +
        `(requires current status to be one of: ${rule.from.join(', ')})`,
    );
  }

  return rule.to;
}
