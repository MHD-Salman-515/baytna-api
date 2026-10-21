import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ReportsModule } from '../reports/reports.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SafetyModule } from '../safety/safety.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminConsoleController } from './admin-console.controller';
import { AdminConsoleService } from './admin-console.service';

/**
 * A pure read-side aggregator sitting on top of every other domain module —
 * nothing else in the app imports this one back, so there's no cycle risk
 * no matter how many modules it pulls in. It owns no schema of its own and
 * reuses every other service's existing admin-facing methods wholesale
 * (never a raw model, never reimplemented logic) — see AdminConsoleService's
 * own comments for why each lookup is shaped the way it is.
 */
@Module({
  imports: [
    BookingsModule,
    WorkersModule,
    ReviewsModule,
    WalletsModule,
    ReportsModule,
    SafetyModule,
    UsersModule,
  ],
  controllers: [AdminConsoleController],
  providers: [AdminConsoleService],
})
export class AdminConsoleModule {}
