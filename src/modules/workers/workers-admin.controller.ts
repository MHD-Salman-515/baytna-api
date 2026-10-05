import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AdminFindWorkersQueryDto } from './dto/admin-find-workers-query.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { ReviewWorkerDto } from './dto/review-worker.dto';
import { WorkerDocumentsService } from './worker-documents.service';
import { WorkerProfilesService } from './worker-profiles.service';
import { WorkerServicesService } from './worker-services.service';

@ApiTags('admin/workers')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/workers')
export class WorkersAdminController {
  constructor(
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerDocumentsService: WorkerDocumentsService,
    private readonly workerServicesService: WorkerServicesService,
  ) {}

  @Get()
  listQueue(@Query() query: AdminFindWorkersQueryDto) {
    return this.workerProfilesService.listForAdmin(query);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const [profile, documents] = await Promise.all([
      this.workerProfilesService.getForAdmin(id),
      this.workerDocumentsService.listForAdmin(id),
    ]);
    return { profile, documents };
  }

  @Get(':id/documents/:docId/url')
  getDocumentUrl(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') workerProfileId: string,
    @Param('docId') docId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    return this.workerDocumentsService.getDownloadUrlForAdmin(
      admin.userId,
      workerProfileId,
      docId,
      {
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    );
  }

  @Post(':id/documents/:docId/review')
  reviewDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') workerProfileId: string,
    @Param('docId') docId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.workerDocumentsService.reviewDocument(
      admin.userId,
      workerProfileId,
      docId,
      dto.action,
      dto.reason,
    );
  }

  @Post(':id/review')
  reviewWorker(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') workerProfileId: string,
    @Body() dto: ReviewWorkerDto,
  ) {
    return this.workerProfilesService.reviewWorker(admin.userId, workerProfileId, dto);
  }

  // Read-only, for support and dispute handling — admins never create or edit a worker's pricing.
  @Get(':id/services')
  listServices(@Param('id') workerProfileId: string) {
    return this.workerServicesService.listForAdmin(workerProfileId);
  }
}
