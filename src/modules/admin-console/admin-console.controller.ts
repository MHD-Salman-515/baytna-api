import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AdminConsoleService } from './admin-console.service';
import { AdminMetricsQueryDto } from './dto/admin-metrics-query.dto';
import { AdminSearchQueryDto } from './dto/admin-search-query.dto';

@ApiTags('admin/console')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/console')
export class AdminConsoleController {
  constructor(private readonly adminConsoleService: AdminConsoleService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminConsoleService.getDashboard();
  }

  @Get('search')
  search(@Query() query: AdminSearchQueryDto) {
    return this.adminConsoleService.search(query);
  }

  @Get('workers/:id/360')
  getWorker360(@Param('id', ParseObjectIdPipe) workerProfileId: string) {
    return this.adminConsoleService.getWorker360(workerProfileId);
  }

  @Get('metrics')
  getMetrics(@Query() query: AdminMetricsQueryDto) {
    return this.adminConsoleService.getMetrics(query.sinceDays);
  }
}
