import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from '../workers/approved-worker.guard';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { BookingsService } from './bookings.service';
import { FindBookingsQueryDto } from './dto/find-bookings-query.dto';
import { ReasonDto } from './dto/reason.dto';

/** Every route here is a real worker capability — requires APPROVED, same as pricing and availability windows. */
@ApiTags('workers/me/bookings')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/bookings')
export class WorkerBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly workerProfilesService: WorkerProfilesService,
  ) {}

  @Get()
  async listOwn(@CurrentUser() user: AuthenticatedUser, @Query() query: FindBookingsQueryDto) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const { data, meta } = await this.bookingsService.listOwnForWorker(profile.id as string, query);
    return { data: await this.bookingsService.projectMany(data, 'WORKER'), meta };
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.accept(profile.id as string, id);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/reject')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.reject(profile.id as string, id, dto.reason);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/on-the-way')
  async onTheWay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.onTheWay(profile.id as string, id);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/arrived')
  async arrived(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.arrived(profile.id as string, id);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/start')
  async start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.start(profile.id as string, id);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.complete(profile.id as string, id);
    return this.bookingsService.projectForWorker(booking);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    const booking = await this.bookingsService.cancelByWorker(
      profile.id as string,
      user.userId,
      id,
      dto.reason,
    );
    return this.bookingsService.projectForWorker(booking);
  }
}
