import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BookingsModule } from '../bookings/bookings.module';
import { WorkersModule } from '../workers/workers.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    // No default secret on purpose — same reasoning as TokensModule/JwtAuthGuard:
    // the access-token secret is always passed explicitly on verify.
    JwtModule.register({}),
    // One-directional: BookingsModule no longer needs anything from here
    // (BOOKING_NOTIFIER resolves RealtimeGateway lazily via ModuleRef — see
    // BaseNotifier) — so this is a plain import, no forwardRef/cycle.
    BookingsModule,
    // For resolving a connected worker's own WorkerProfileId in the
    // location:update handler.
    WorkersModule,
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
