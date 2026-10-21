import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FinancialStatus } from '../../workers/schemas/worker-profile.schema';

export class QueryAdminWalletsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FinancialStatus })
  @IsOptional()
  @IsEnum(FinancialStatus)
  status?: FinancialStatus;

  @ApiPropertyOptional({
    description: "true: only wallets at/below their country's negativeBalanceFloor",
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowBalance?: boolean;
}
