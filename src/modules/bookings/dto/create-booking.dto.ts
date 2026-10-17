import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BookingType } from '../../../common/enums/booking-type.enum';
import { BookingAddressDto } from './booking-address.dto';

/**
 * Never a price — the client supplies only enough to compute one (estimated
 * hours / room count), and PricingService.quote() does the rest (at creation
 * for SCHEDULED, at acceptance for INSTANT — see BookingsService.acceptOffer).
 *
 * The two booking types need different fields: SCHEDULED needs a specific
 * workerServiceId (the customer picked the worker) and a scheduledFor;
 * INSTANT needs only a serviceId (no worker chosen yet — that's the whole
 * point of the broadcast) and no scheduledFor (the job starts now). Both
 * conditional blocks live on one DTO rather than two, since every other
 * field (cityId, estimatedDurationMinutes, address, ...) is shared.
 */
export class CreateBookingDto {
  @ApiProperty({ enum: BookingType })
  @IsEnum(BookingType)
  type!: BookingType;

  @ApiPropertyOptional({
    description: 'SCHEDULED only — the specific WorkerService (offering) being booked',
  })
  @ValidateIf((dto: CreateBookingDto) => dto.type === BookingType.SCHEDULED)
  @IsMongoId()
  workerServiceId?: string;

  @ApiPropertyOptional({ description: 'SCHEDULED only' })
  @ValidateIf((dto: CreateBookingDto) => dto.type === BookingType.SCHEDULED)
  @IsDateString()
  scheduledFor?: string;

  @ApiPropertyOptional({
    description: 'INSTANT only — no specific worker is chosen; matching finds one',
  })
  @ValidateIf((dto: CreateBookingDto) => dto.type === BookingType.INSTANT)
  @IsMongoId()
  serviceId?: string;

  @ApiProperty({
    description:
      "Must be one of the worker's serviceAreas (SCHEDULED) or a city she could be matched in (INSTANT)",
  })
  @IsMongoId()
  cityId!: string;

  @ApiProperty({ minimum: 1, description: 'How long the job is expected to take' })
  @IsInt()
  @Min(1)
  estimatedDurationMinutes!: number;

  @ApiPropertyOptional({ minimum: 0.5, description: 'HOURLY pricing only' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  estimatedHours?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'BY_SIZE pricing only' })
  @IsOptional()
  @IsInt()
  @Min(1)
  roomCount?: number;

  @ApiProperty({ type: BookingAddressDto })
  @ValidateNested()
  @Type(() => BookingAddressDto)
  address!: BookingAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerNote?: string;
}
