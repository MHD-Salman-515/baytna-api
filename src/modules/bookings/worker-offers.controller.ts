import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from '../workers/approved-worker.guard';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { BookingsService } from './bookings.service';

/**
 * How a worker sees and responds to INSTANT offers while LogNotifier (not
 * real push) is the only notifier — see BookingNotifier's own doc comment.
 * Receiving/accepting an offer is exactly the kind of "going live"
 * capability ApprovedWorkerGuard exists for.
 */
@ApiTags('workers/me/offers')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/offers')
export class WorkerOffersController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly workerProfilesService: WorkerProfilesService,
  ) {}

  @Get()
  async listPending(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.bookingsService.listPendingOffersForWorker(profile.id as string);
  }

  @Post(':bookingId/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Param('bookingId') bookingId: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.acceptOffer(profile.id as string, bookingId);
    return this.bookingsService.projectForWorker(booking);
  }
}
