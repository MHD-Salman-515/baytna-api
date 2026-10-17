import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { DevicePlatform } from '../schemas/device-token.schema';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'The FCM registration token (or equivalent) for this install' })
  @IsString()
  @MinLength(10)
  token!: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiProperty({ enum: ['ar', 'en'] })
  @IsIn(['ar', 'en'])
  locale!: string;
}
