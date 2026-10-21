import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ReportStatus } from '../schemas/report.schema';

// RESOLVED is reached only through POST .../resolve, which also records the
// outcome — never through this plain status-change endpoint.
const ASSIGNABLE_STATUSES = [ReportStatus.OPEN, ReportStatus.INVESTIGATING, ReportStatus.DISMISSED];

export class ChangeReportStatusDto {
  @ApiProperty({ enum: ASSIGNABLE_STATUSES })
  @IsIn(ASSIGNABLE_STATUSES)
  status!: ReportStatus;
}
