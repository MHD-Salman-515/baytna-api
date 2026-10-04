import { BadRequestException } from '@nestjs/common';
import { VerificationStatus } from './schemas/worker-profile.schema';

const ALLOWED_TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  [VerificationStatus.DRAFT]: [VerificationStatus.PENDING_REVIEW],
  [VerificationStatus.PENDING_REVIEW]: [VerificationStatus.APPROVED, VerificationStatus.REJECTED],
  [VerificationStatus.APPROVED]: [VerificationStatus.SUSPENDED],
  [VerificationStatus.REJECTED]: [VerificationStatus.PENDING_REVIEW],
  [VerificationStatus.SUSPENDED]: [VerificationStatus.APPROVED],
};

/**
 * The single source of truth for legal worker-verification transitions —
 * the client never sets `verificationStatus` directly; every service method
 * that changes it must go through this first.
 */
export function assertValidTransition(from: VerificationStatus, to: VerificationStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Cannot transition worker verification status from ${from} to ${to}`);
  }
}
