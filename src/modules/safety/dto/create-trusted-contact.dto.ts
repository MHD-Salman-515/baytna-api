import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTrustedContactDto {
  @ApiProperty({ example: 'Mother' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '+963900000000' })
  @IsString()
  @MinLength(4)
  phone!: string;

  @ApiProperty({ example: 'Mother' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relationship!: string;
}
