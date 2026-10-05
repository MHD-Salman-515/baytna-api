import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { VerificationStatus } from './schemas/worker-profile.schema';
import { WorkerProfilesService } from './worker-profiles.service';

/**
 * Enforces the core Phase 3/3.1 invariant: holding Role.WORKER does not by
 * itself confer any real capability — only an APPROVED verificationStatus
 * does. Every route with a real-world effect for a worker (appearing in
 * public listings, going available, and — in later phases — setting
 * prices, receiving bookings, going online, anything else "live") MUST use
 * this guard IN ADDITION TO @Roles(Role.WORKER), never the role check alone.
 * Routes that are part of GETTING verified (profile editing, document
 * upload, submit) must NOT use this guard — they're exactly how an
 * unapproved worker becomes approved.
 */
@Injectable()
export class ApprovedWorkerGuard implements CanActivate {
  constructor(private readonly workerProfilesService: WorkerProfilesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const profile = await this.workerProfilesService.getOwn(request.user.userId);

    if (profile.verificationStatus !== VerificationStatus.APPROVED) {
      throw new ForbiddenException(
        `This action requires an APPROVED worker profile (current status: ${profile.verificationStatus})`,
      );
    }

    return true;
  }
}
