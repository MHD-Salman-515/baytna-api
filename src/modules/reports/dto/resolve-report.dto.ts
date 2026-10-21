import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ReportResolutionAction } from '../schemas/report.schema';

export class ResolveReportDto {
  @ApiProperty({ enum: ReportResolutionAction })
  @IsEnum(ReportResolutionAction)
  action!: ReportResolutionAction;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({ description: 'Required (and only used) when action is WALLET_ADJUSTMENT' })
  @ValidateIf((dto: ResolveReportDto) => dto.action === ReportResolutionAction.WALLET_ADJUSTMENT)
  @IsInt()
  adjustAmount?: number;
}
