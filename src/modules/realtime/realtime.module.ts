import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BookingsModule } from '../bookings/bookings.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    // No default secret on purpose — same reasoning as TokensModule/JwtAuthGuard:
    // the access-token secret is always passed explicitly on verify.
    JwtModule.register({}),
    BookingsModule,
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
