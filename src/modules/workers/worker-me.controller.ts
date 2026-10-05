import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MAX_FILE_SIZE_BYTES } from '../storage/storage.constants';
import { ApprovedWorkerGuard } from './approved-worker.guard';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpsertWorkerProfileDto } from './dto/upsert-worker-profile.dto';
import { UploadRateLimiterService } from './upload-rate-limiter.service';
import { WorkerDocumentsService } from './worker-documents.service';
import { WorkerProfilesService } from './worker-profiles.service';

@ApiTags('workers/me')
@ApiBearerAuth()
@Controller('workers/me')
export class WorkerMeController {
  constructor(
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly workerDocumentsService: WorkerDocumentsService,
    private readonly uploadRateLimiterService: UploadRateLimiterService,
  ) {}

  // Deliberately no @Roles() here — any authenticated, ACTIVE, non-deleted
  // user may apply, including one who doesn't hold WORKER yet (that's the
  // whole point). Rejection for SUSPENDED/soft-deleted happens inside the
  // service. Every other route below keeps @Roles(Role.WORKER), now at the
  // method level instead of the class level, since this one route can't have it.
  @Post('apply')
  apply(@CurrentUser() user: AuthenticatedUser) {
    return this.workerProfilesService.applyToBecomeWorker(user.userId);
  }

  @Roles(Role.WORKER)
  @Post('profile')
  upsertProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertWorkerProfileDto) {
    return this.workerProfilesService.upsertOwn(user.userId, dto);
  }

  @Roles(Role.WORKER)
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.workerProfilesService.getOwn(user.userId);
  }

  @Roles(Role.WORKER)
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Genuinely per-user, not per-IP — see UploadRateLimiterService for why
    // this isn't just a @Throttle() override like the OTP route.
    this.uploadRateLimiterService.assertNotRateLimited(user.userId);

    if (!file) {
      throw new BadRequestException('A file is required');
    }
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerDocumentsService.upload(
      profile.id as string,
      dto.type,
      { buffer: file.buffer, mimetype: file.mimetype },
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
  }

  @Roles(Role.WORKER)
  @Get('documents')
  async listDocuments(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    return this.workerDocumentsService.listOwn(profile.id as string);
  }

  @Roles(Role.WORKER)
  @Delete('documents/:id')
  async deleteDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') documentId: string) {
    const profile = await this.workerProfilesService.getOwn(user.userId);
    await this.workerDocumentsService.deleteOwn(profile.id as string, documentId);
  }

  @Roles(Role.WORKER)
  @Post('submit')
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.workerProfilesService.submit(user.userId);
  }

  // The important invariant: WORKER role alone is not enough to flip this on.
  // ApprovedWorkerGuard rejects outright (clear reason, no silent no-op) unless
  // verificationStatus === APPROVED. See the guard's own doc comment.
  @Roles(Role.WORKER)
  @UseGuards(ApprovedWorkerGuard)
  @Patch('availability')
  setAvailability(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetAvailabilityDto) {
    return this.workerProfilesService.setAvailability(user.userId, dto.isAvailable);
  }
}
