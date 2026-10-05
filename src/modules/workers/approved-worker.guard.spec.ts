import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { VerificationStatus } from './schemas/worker-profile.schema';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { WorkerProfilesService } from './worker-profiles.service';

describe('ApprovedWorkerGuard', () => {
  let guard: ApprovedWorkerGuard;
  let workerProfilesService: { getOwn: jest.Mock };

  function contextFor(userId: string): ExecutionContext {
    const request = { user: { userId, roles: [] } };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    workerProfilesService = { getOwn: jest.fn() };
    guard = new ApprovedWorkerGuard(workerProfilesService as unknown as WorkerProfilesService);
  });

  it('allows an APPROVED worker through', async () => {
    workerProfilesService.getOwn.mockResolvedValue({
      verificationStatus: VerificationStatus.APPROVED,
    });
    await expect(guard.canActivate(contextFor('worker-1'))).resolves.toBe(true);
  });

  it.each([
    VerificationStatus.DRAFT,
    VerificationStatus.PENDING_REVIEW,
    VerificationStatus.REJECTED,
    VerificationStatus.SUSPENDED,
  ])(
    'blocks a WORKER-roled user whose profile is %s, naming the actual status in the error',
    async (status) => {
      workerProfilesService.getOwn.mockResolvedValue({ verificationStatus: status });

      await expect(guard.canActivate(contextFor('worker-1'))).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(contextFor('worker-1'))).rejects.toThrow(new RegExp(status));
    },
  );

  it('propagates NotFoundException when the caller has no worker profile at all', async () => {
    workerProfilesService.getOwn.mockRejectedValue(
      new Error('Worker profile not found — create one first'),
    );
    await expect(guard.canActivate(contextFor('customer-1'))).rejects.toThrow(
      'Worker profile not found — create one first',
    );
  });

  it('always resolves the profile from the authenticated user on the request, never client input', async () => {
    workerProfilesService.getOwn.mockResolvedValue({
      verificationStatus: VerificationStatus.APPROVED,
    });
    await guard.canActivate(contextFor('worker-1'));
    expect(workerProfilesService.getOwn).toHaveBeenCalledWith('worker-1');
  });
});
