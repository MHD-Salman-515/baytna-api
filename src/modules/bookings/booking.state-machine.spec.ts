import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { assertValidAction, BookingAction, BookingActor } from './booking.state-machine';

const ALL_STATUSES = Object.values(BookingStatus);
const ALL_ACTORS: BookingActor[] = ['CUSTOMER', 'WORKER', 'ADMIN', 'SYSTEM'];

/**
 * Independently transcribed from the spec's trip diagram, not derived from
 * booking.state-machine.ts — this is the expected table the implementation
 * is checked against, action by action, status by status.
 */
const EXPECTED: Record<
  BookingAction,
  { from: BookingStatus[]; to: BookingStatus; actor: BookingActor }
> = {
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

describe('booking state machine', () => {
  describe('exhaustive transition table (every action x every status, with the correct actor)', () => {
    for (const action of Object.values(BookingAction)) {
      const rule = EXPECTED[action];

      for (const status of ALL_STATUSES) {
        const isLegal = rule.from.includes(status);

        it(`${action} from ${status} is ${isLegal ? 'LEGAL -> ' + rule.to : 'ILLEGAL'}`, () => {
          if (isLegal) {
            expect(assertValidAction(status, action, rule.actor)).toBe(rule.to);
          } else {
            expect(() => assertValidAction(status, action, rule.actor)).toThrow(
              BadRequestException,
            );
          }
        });
      }
    }
  });

  describe('role permission (wrong actor always rejected, regardless of status)', () => {
    for (const action of Object.values(BookingAction)) {
      const rule = EXPECTED[action];
      const wrongActors = ALL_ACTORS.filter((actor) => actor !== rule.actor);

      for (const wrongActor of wrongActors) {
        it(`${action} by ${wrongActor} is rejected even from a legal status`, () => {
          const legalStatus = rule.from[0];
          expect(() => assertValidAction(legalStatus, action, wrongActor)).toThrow(
            ForbiddenException,
          );
        });
      }
    }
  });

  it('a customer attempting a worker-only transition fails (ACCEPT)', () => {
    expect(() =>
      assertValidAction(BookingStatus.PENDING_WORKER, BookingAction.ACCEPT, 'CUSTOMER'),
    ).toThrow(ForbiddenException);
  });

  it('error message for an illegal transition names the current status and the attempted target status', () => {
    try {
      assertValidAction(BookingStatus.COMPLETED, BookingAction.ACCEPT, 'WORKER');
      fail('expected assertValidAction to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const message = (error as Error).message;
      expect(message).toContain(BookingStatus.COMPLETED);
      expect(message).toContain(BookingStatus.ACCEPTED);
    }
  });
});
