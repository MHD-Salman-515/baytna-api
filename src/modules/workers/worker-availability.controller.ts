import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { SetAvailabilityWindowsDto } from './dto/set-availability-windows.dto';
import { WorkerAvailabilityService } from './worker-availability.service';
import { WorkerProfilesService } from './worker-profiles.service';

/** Managing her schedule is a "going live" capability, same as pricing — requires APPROVED. */
@ApiTags('workers/me/availability-windows')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/availability-windows')
export class WorkerAvailabilityController {
  constructor(
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerAvailabilityService: WorkerAvailabilityService,
  ) {}

  @Get()
  async getOwn(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerAvailabilityService.getOwn(profile.id as string);
  }

  @Put()
  async replaceOwn(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetAvailabilityWindowsDto) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerAvailabilityService.replaceOwn(profile.id as string, dto);
  }
}
