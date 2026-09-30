import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString, MinLength } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ description: 'Country the phone number belongs to' })
  @IsMongoId()
  countryId!: string;

  @ApiProperty({
    example: '0911111111',
    description: 'Local or E.164 format — validated against the country',
  })
  @IsString()
  @MinLength(4)
  phone!: string;
}
