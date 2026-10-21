import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocalizedNameDto } from '../../../common/dto/localized-name.dto';

export class CountryBookingPolicyDto {
  @ApiPropertyOptional({ default: 12, description: 'Hours a worker has to accept/reject' })
  @IsOptional()
  @IsInt()
  @Min(1)
  responseDeadlineHours?: number;

  @ApiPropertyOptional({
    default: 90,
    description: 'Max days in the future a booking may be placed',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  bookingHorizonDays?: number;

  @ApiPropertyOptional({
    default: 30,
    description: 'Travel buffer kept free between jobs, in minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  interBookingBufferMinutes?: number;

  @ApiPropertyOptional({
    default: 24,
    description: 'Hours before scheduledFor that cancel for free',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeCancellationHours?: number;

  @ApiPropertyOptional({
    default: 2000,
    description: 'Basis points of basePrice owed on a late cancel',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  cancellationFeeBasisPoints?: number;
}

export class CountryInstantMatchingPolicyDto {
  @ApiPropertyOptional({
    default: [3000, 6000, 10000],
    description: 'Progressive broadcast radii in meters, nearest first',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  radiusStepsMeters?: number[];

  @ApiPropertyOptional({ default: 20, description: 'Seconds one wave waits before expanding' })
  @IsOptional()
  @IsInt()
  @Min(1)
  waveTimeoutSeconds?: number;

  @ApiPropertyOptional({ default: 90, description: 'Total seconds before NO_WORKER_FOUND' })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalRequestTimeoutSeconds?: number;

  @ApiPropertyOptional({
    default: 120,
    description: 'Max heartbeat age, in seconds, to stay eligible',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  heartbeatStalenessSeconds?: number;
}

export class CountryWalletPolicyDto {
  @ApiPropertyOptional({
    default: -5000,
    description: 'Signed — balance floor before auto-suspension',
  })
  @IsOptional()
  @IsInt()
  negativeBalanceFloor?: number;

  @ApiPropertyOptional({
    default: -2000,
    description: 'Balance at/below which a low-balance warning fires',
  })
  @IsOptional()
  @IsInt()
  lowBalanceWarningThreshold?: number;

  @ApiPropertyOptional({
    default: 0,
    description: "Charged to the worker's wallet when she cancels after accepting",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  workerCancellationPenaltyAmount?: number;
}

export class CreateCountryDto {
  @ApiProperty({ example: 'SY', description: 'ISO alpha-2 country code' })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'code must be a 2-letter uppercase ISO alpha-2 code' })
  code!: string;

  @ApiProperty({ type: LocalizedNameDto })
  @ValidateNested()
  @Type(() => LocalizedNameDto)
  name!: LocalizedNameDto;

  @ApiProperty({ example: 'SYP' })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter uppercase code' })
  currencyCode!: string;

  @ApiProperty({ example: '+963' })
  @IsString()
  @Matches(/^\+\d{1,4}$/, { message: 'phonePrefix must look like +963' })
  phonePrefix!: string;

  @ApiProperty({ example: 'Asia/Damascus', description: 'IANA timezone name' })
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @ApiPropertyOptional({ type: CountryBookingPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CountryBookingPolicyDto)
  bookingPolicy?: CountryBookingPolicyDto;

  @ApiPropertyOptional({ type: CountryInstantMatchingPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CountryInstantMatchingPolicyDto)
  instantMatchingPolicy?: CountryInstantMatchingPolicyDto;

  @ApiPropertyOptional({ type: CountryWalletPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CountryWalletPolicyDto)
  walletPolicy?: CountryWalletPolicyDto;

  @ApiPropertyOptional({ type: [String], example: ['CASH'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledPaymentMethods?: string[];

  @ApiProperty({ example: 1500, description: 'Basis points, e.g. 1500 = 15%' })
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionRate!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
