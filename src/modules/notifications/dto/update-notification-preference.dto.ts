import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class NotificationChannelsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  socket?: boolean;
}

export class QuietHoursDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must look like "HH:mm"' })
  startTime?: string;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must look like "HH:mm"' })
  endTime?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional({ type: [String], description: 'Notification event types to never receive' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  mutedTypes?: string[];

  @ApiPropertyOptional({ type: NotificationChannelsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationChannelsDto)
  channels?: NotificationChannelsDto;

  @ApiPropertyOptional({ type: QuietHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}
