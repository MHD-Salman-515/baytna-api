import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BookingsModule } from '../bookings/bookings.module';
import { StorageModule } from '../storage/storage.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

// BookingsModule for resolveOwnParty/forceStatus reuse, WorkersModule for
// reviewWorker (disciplinary suspension — never financialStatus), WalletsModule
// for the ADJUSTMENT resolution action — all one-directional, same as
// ReviewsModule/SafetyModule.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
    BookingsModule,
    WorkersModule,
    WalletsModule,
    StorageModule,
    AuditLogModule,
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
