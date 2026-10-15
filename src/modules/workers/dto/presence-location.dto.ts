import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { GeoPointDto } from '../../cities/dto/geo-point.dto';

/** Shared body shape for /presence/online and /presence/heartbeat. */
export class PresenceLocationDto {
  @ApiProperty({ type: GeoPointDto })
  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;
}
