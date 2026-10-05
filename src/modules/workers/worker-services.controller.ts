import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { CreateWorkerServiceDto } from './dto/create-worker-service.dto';
import { UpdateWorkerServiceDto } from './dto/update-worker-service.dto';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkerServicesService } from './worker-services.service';

/**
 * Offering a priced service is a real worker capability — exactly the kind
 * ApprovedWorkerGuard's own doc comment calls out ("setting prices") — so
 * every route here requires APPROVED, same as /workers/me/availability.
 */
@ApiTags('workers/me/services')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/services')
export class WorkerServicesController {
  constructor(
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerServicesService: WorkerServicesService,
  ) {}

  @Get()
  async listOwn(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerServicesService.listOwn(profile.id as string);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkerServiceDto) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerServicesService.create(
      profile.id as string,
      profile.countryId.toString(),
      dto,
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkerServiceDto,
  ) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerServicesService.update(
      profile.id as string,
      profile.countryId.toString(),
      id,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    await this.workerServicesService.delete(profile.id as string, id);
  }
}
