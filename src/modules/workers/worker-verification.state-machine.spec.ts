import { BadRequestException } from '@nestjs/common';
import { VerificationStatus } from './schemas/worker-profile.schema';
import { assertValidTransition } from './worker-verification.state-machine';

const S = VerificationStatus;

// The exact same table the implementation uses, kept independent here (not
// imported) so this test would actually fail if the implementation's table
// silently drifted from the spec.
const LEGAL: Record<VerificationStatus, VerificationStatus[]> = {
  [S.DRAFT]: [S.PENDING_REVIEW],
  [S.PENDING_REVIEW]: [S.APPROVED, S.REJECTED],
  [S.APPROVED]: [S.SUSPENDED],
  [S.REJECTED]: [S.PENDING_REVIEW],
  [S.SUSPENDED]: [S.APPROVED],
};

const ALL_STATUSES = Object.values(VerificationStatus);

describe('assertValidTransition — exhaustive 5x5 matrix', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const isLegal = LEGAL[from].includes(to);

      it(`${isLegal ? 'allows' : 'rejects'} ${from} -> ${to}`, () => {
        if (isLegal) {
          expect(() => assertValidTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertValidTransition(from, to)).toThrow(BadRequestException);
        }
      });
    }
  }
});

describe('assertValidTransition — spec scenarios', () => {
  it('DRAFT -> PENDING_REVIEW is legal (submission)', () => {
    expect(() => assertValidTransition(S.DRAFT, S.PENDING_REVIEW)).not.toThrow();
  });

  it('PENDING_REVIEW -> APPROVED is legal (admin approval)', () => {
    expect(() => assertValidTransition(S.PENDING_REVIEW, S.APPROVED)).not.toThrow();
  });

  it('PENDING_REVIEW -> REJECTED is legal (admin rejection)', () => {
    expect(() => assertValidTransition(S.PENDING_REVIEW, S.REJECTED)).not.toThrow();
  });

  it('REJECTED -> PENDING_REVIEW is legal (resubmission)', () => {
    expect(() => assertValidTransition(S.REJECTED, S.PENDING_REVIEW)).not.toThrow();
  });

  it('APPROVED -> SUSPENDED is legal (admin suspends)', () => {
    expect(() => assertValidTransition(S.APPROVED, S.SUSPENDED)).not.toThrow();
  });

  it('SUSPENDED -> APPROVED is legal (admin reinstates)', () => {
    expect(() => assertValidTransition(S.SUSPENDED, S.APPROVED)).not.toThrow();
  });

  it('rejects skipping review entirely: DRAFT -> APPROVED', () => {
    expect(() => assertValidTransition(S.DRAFT, S.APPROVED)).toThrow(BadRequestException);
  });

  it('rejects an already-approved worker being "approved" again', () => {
    expect(() => assertValidTransition(S.APPROVED, S.APPROVED)).toThrow(BadRequestException);
  });

  it('rejects going straight from DRAFT to SUSPENDED', () => {
    expect(() => assertValidTransition(S.DRAFT, S.SUSPENDED)).toThrow(BadRequestException);
  });

  it('rejects REJECTED -> APPROVED (must go through PENDING_REVIEW)', () => {
    expect(() => assertValidTransition(S.REJECTED, S.APPROVED)).toThrow(BadRequestException);
  });

  it('rejects SUSPENDED -> REJECTED', () => {
    expect(() => assertValidTransition(S.SUSPENDED, S.REJECTED)).toThrow(BadRequestException);
  });

  it('error message names both the source and target status', () => {
    expect(() => assertValidTransition(S.DRAFT, S.APPROVED)).toThrow(/DRAFT.*APPROVED/);
  });
});
