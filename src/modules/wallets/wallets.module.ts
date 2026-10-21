import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminWalletsController } from './admin-wallets.controller';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WalletEntry, WalletEntrySchema } from './schemas/wallet-entry.schema';
import { WalletsService } from './wallets.service';
import { WorkerWalletController } from './worker-wallet.controller';

// No dependency on BookingsModule/NotificationsModule/RealtimeModule at all
// — WalletsService resolves BOOKING_NOTIFIER lazily via ModuleRef instead
// of a constructor injection, specifically so BookingsModule can import
// THIS module (for chargeCommission/chargeCancellationPenalty) without a
// cycle. See WalletsService's own comment.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletEntry.name, schema: WalletEntrySchema },
    ]),
    WorkersModule,
    CountriesModule,
    AuditLogModule,
  ],
  controllers: [WorkerWalletController, AdminWalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
