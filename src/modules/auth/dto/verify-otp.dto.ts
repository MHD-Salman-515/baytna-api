import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString, Matches, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Country the phone number belongs to' })
  @IsMongoId()
  countryId!: string;

  @ApiProperty({ example: '0911111111' })
  @IsString()
  @MinLength(4)
  phone!: string;

  @ApiProperty({ example: '123456', description: '6-digit code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
