import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { PresenceLocationDto } from './dto/presence-location.dto';
import { WorkerPresenceService } from './worker-presence.service';
import { WorkerProfilesService } from './worker-profiles.service';

/** Going live for INSTANT work is exactly the kind of capability ApprovedWorkerGuard exists for. */
@ApiTags('workers/me/presence')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/presence')
export class WorkerPresenceController {
  constructor(
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerPresenceService: WorkerPresenceService,
  ) {}

  @Get()
  async getOwn(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerPresenceService.getOwn(profile.id as string);
  }

  @Post('online')
  async goOnline(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresenceLocationDto) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerPresenceService.goOnline(profile.id as string, dto.location);
  }

  @Post('offline')
  @HttpCode(HttpStatus.NO_CONTENT)
  async goOffline(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    await this.workerPresenceService.goOffline(profile.id as string);
  }

  @Post('heartbeat')
  async heartbeat(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresenceLocationDto) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerPresenceService.heartbeat(profile.id as string, dto.location);
  }
}
