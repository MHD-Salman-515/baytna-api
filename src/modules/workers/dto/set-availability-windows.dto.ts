import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DateOverrideType } from '../schemas/worker-availability.schema';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class WeeklyWindowDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday ... 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must look like "HH:mm"' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must look like "HH:mm"' })
  endTime!: string;
}

export class DateOverrideDto {
  @ApiProperty({ example: '2026-11-01' })
  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must look like "YYYY-MM-DD"' })
  date!: string;

  @ApiProperty({ enum: DateOverrideType })
  @IsEnum(DateOverrideType)
  type!: DateOverrideType;

  @ApiProperty({ example: '09:00', required: false })
  @ValidateIf((dto: DateOverrideDto) => dto.type === DateOverrideType.EXTRA)
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must look like "HH:mm"' })
  startTime?: string;

  @ApiProperty({ example: '17:00', required: false })
  @ValidateIf((dto: DateOverrideDto) => dto.type === DateOverrideType.EXTRA)
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must look like "HH:mm"' })
  endTime?: string;
}

/** Full replace — PUT /workers/me/availability-windows always sends the whole set, never a partial patch. */
export class SetAvailabilityWindowsDto {
  @ApiProperty({ type: [WeeklyWindowDto] })
  @IsArray()
  @ArrayMaxSize(7 * 10)
  @ValidateNested({ each: true })
  @Type(() => WeeklyWindowDto)
  weeklyWindows!: WeeklyWindowDto[];

  @ApiProperty({ type: [DateOverrideDto] })
  @IsArray()
  @ArrayMaxSize(365)
  @ValidateNested({ each: true })
  @Type(() => DateOverrideDto)
  dateOverrides!: DateOverrideDto[];
}
