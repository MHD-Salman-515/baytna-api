import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber } from 'class-validator';

export class GeoPointDto {
  @ApiProperty({ enum: ['Point'], example: 'Point' })
  @IsIn(['Point'])
  type!: 'Point';

  @ApiProperty({
    description: '[longitude, latitude]',
    example: [36.2765, 33.5138],
    type: [Number],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  coordinates!: [number, number];
}
