import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BookingsModule } from '../bookings/bookings.module';
import { WorkersModule } from '../workers/workers.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    // No default secret on purpose — same reasoning as TokensModule/JwtAuthGuard:
    // the access-token secret is always passed explicitly on verify.
    JwtModule.register({}),
    // Mutual with BookingsModule — see the comment there. forwardRef on both
    // sides of this one edge is what lets Nest resolve the cycle.
    forwardRef(() => BookingsModule),
    // For resolving a connected worker's own WorkerProfileId in the
    // location:update handler — no cycle here, WorkersModule doesn't
    // depend on BookingsModule or RealtimeModule.
    WorkersModule,
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
