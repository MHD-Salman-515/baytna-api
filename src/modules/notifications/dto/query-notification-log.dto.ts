import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { NotificationOutcome } from '../schemas/notification-log.schema';

export class QueryNotificationLogDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'A NotificationEventType value' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ enum: NotificationOutcome })
  @IsOptional()
  @IsEnum(NotificationOutcome)
  outcome?: NotificationOutcome;
}
