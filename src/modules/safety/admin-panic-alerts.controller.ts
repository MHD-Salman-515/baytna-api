import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { QueryAdminPanicAlertsDto } from './dto/query-admin-panic-alerts.dto';
import { ResolvePanicDto } from './dto/resolve-panic.dto';
import { PanicAlertsService } from './panic-alerts.service';

@ApiTags('admin/panic-alerts')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/panic-alerts')
export class AdminPanicAlertsController {
  constructor(private readonly panicAlertsService: PanicAlertsService) {}

  @Get()
  list(@Query() query: QueryAdminPanicAlertsDto) {
    return this.panicAlertsService.listForAdmin(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.panicAlertsService.getForAdmin(id);
  }

  @Post(':id/resolve')
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolvePanicDto,
  ) {
    return this.panicAlertsService.resolve(admin.userId, id, dto);
  }
}
