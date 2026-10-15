import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingAddressDto } from './booking-address.dto';

/**
 * Never a price — the client supplies only enough to compute one (estimated
 * hours / room count), and PricingService.quote() does the rest. Only
 * SCHEDULED is creatable in this phase, so `type` isn't even a field here —
 * BookingsService.create always sets it server-side.
 */
export class CreateBookingDto {
  @ApiProperty({ description: 'The specific WorkerService (offering) being booked' })
  @IsMongoId()
  workerServiceId!: string;

  @ApiProperty({ description: "Must be one of the worker's serviceAreas" })
  @IsMongoId()
  cityId!: string;

  @ApiProperty({ example: '2026-11-10T09:00:00.000Z' })
  @IsDateString()
  scheduledFor!: string;

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
