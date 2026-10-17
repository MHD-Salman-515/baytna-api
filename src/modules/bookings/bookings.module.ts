import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServicesModule } from '../services/services.module';
import { UsersModule } from '../users/users.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { NearestAvailableAssignmentStrategy } from './assignment/nearest-available-assignment.strategy';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { InstantMatchingSweepService } from './instant-matching-sweep.service';
import { InstantMatchingService } from './instant-matching.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { LogNotifier } from './notifications/log-notifier';
import { BookingOffer, BookingOfferSchema } from './schemas/booking-offer.schema';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { WorkerBookingsController } from './worker-bookings.controller';
import { WorkerOffersController } from './worker-offers.controller';
import { WorkerSlotsController } from './worker-slots.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: BookingOffer.name, schema: BookingOfferSchema },
    ]),
    WorkersModule,
    ServicesModule,
    CountriesModule,
    PricingModule,
    UsersModule,
    AuditLogModule,
  ],
  // WorkerBookingsController ('workers/me/bookings/...'), WorkerOffersController
  // ('workers/me/offers/...'), and WorkerSlotsController ('workers/:id/slots')
  // have no overlapping literal path segment with each other or with
  // anything in WorkersModule — see WorkerSlotsController's own comment —
  // so registration order here doesn't matter.
  controllers: [
    BookingsController,
    WorkerBookingsController,
    WorkerOffersController,
    WorkerSlotsController,
    AdminBookingsController,
  ],
  providers: [
    BookingsService,
    DirectAssignmentStrategy,
    NearestAvailableAssignmentStrategy,
    InstantMatchingService,
    InstantMatchingSweepService,
    BookingExpiryService,
    // LogNotifier (DEV ONLY) — Phase 8 swaps the useClass for a real
    // push/websocket implementation of BookingNotifier; nothing else here changes.
    { provide: BOOKING_NOTIFIER, useClass: LogNotifier },
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
