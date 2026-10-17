import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

/** Optional deviceToken lets the client unregister its push token in the same call as logging out. */
export class LogoutDto extends RefreshTokenDto {
  @ApiPropertyOptional({
    description: "This device's push token, to unregister it at the same time",
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  deviceToken?: string;
}
