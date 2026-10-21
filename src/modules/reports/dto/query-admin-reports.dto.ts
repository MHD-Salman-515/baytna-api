import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ReportCategory, ReportStatus } from '../schemas/report.schema';

export class QueryAdminReportsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportCategory })
  @IsOptional()
  @IsEnum(ReportCategory)
  category?: ReportCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'A User id, a WorkerProfile id, or a Booking id' })
  @IsOptional()
  @IsMongoId()
  subjectId?: string;
}
