import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MAX_FILE_SIZE_BYTES } from '../storage/storage.constants';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

/** Either party — customer or worker — files and tracks her own reports. */
@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.WORKER)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  file(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.reportsService.file(user.userId, user.roles, dto);
  }

  @Get()
  listOwn(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.reportsService.listOwn(user.userId, query);
  }

  @Get(':id')
  getOwn(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reportsService.getOwn(user.userId, id);
  }

  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.reportsService.uploadAttachmentOwn(user.userId, id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
    });
  }

  @Get(':id/attachments/:index/url')
  getAttachmentUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.reportsService.getAttachmentDownloadUrlOwn(user.userId, id, index);
  }
}
