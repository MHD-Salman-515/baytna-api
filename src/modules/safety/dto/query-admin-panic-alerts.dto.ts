import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PanicAlertStatus } from '../schemas/panic-alert.schema';

export class QueryAdminPanicAlertsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PanicAlertStatus })
  @IsOptional()
  @IsEnum(PanicAlertStatus)
  status?: PanicAlertStatus;
}
