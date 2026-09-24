import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LocalizedNameDto {
  @ApiProperty({ example: 'دمشق' })
  @IsString()
  @IsNotEmpty()
  ar!: string;

  @ApiProperty({ example: 'Damascus' })
  @IsString()
  @IsNotEmpty()
  en!: string;
}
