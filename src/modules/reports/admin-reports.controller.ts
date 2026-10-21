import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AddReportNoteDto } from './dto/add-report-note.dto';
import { AssignReportDto } from './dto/assign-report.dto';
import { ChangeReportStatusDto } from './dto/change-report-status.dto';
import { QueryAdminReportsDto } from './dto/query-admin-reports.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('admin/reports')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  list(@Query() query: QueryAdminReportsDto) {
    return this.reportsService.listForAdmin(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.reportsService.getForAdmin(id);
  }

  @Get(':id/attachments/:index/url')
  getAttachmentUrl(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.reportsService.getAttachmentDownloadUrlForAdmin(admin.userId, id, index);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignReportDto,
  ) {
    return this.reportsService.assign(admin.userId, id, dto);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeReportStatusDto,
  ) {
    return this.reportsService.changeStatus(admin.userId, id, dto);
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddReportNoteDto,
  ) {
    return this.reportsService.addInternalNote(admin.userId, id, dto);
  }

  @Post(':id/resolve')
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reportsService.resolve(admin.userId, id, dto);
  }
}
