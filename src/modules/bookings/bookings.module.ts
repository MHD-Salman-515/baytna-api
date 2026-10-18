import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { CountriesService } from '../countries/countries.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { NotificationLogService } from '../notifications/notification-log.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { PricingModule } from '../pricing/pricing.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ServicesModule } from '../services/services.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { WorkersModule } from '../workers/workers.module';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { NearestAvailableAssignmentStrategy } from './assignment/nearest-available-assignment.strategy';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { InstantMatchingSweepService } from './instant-matching-sweep.service';
import { InstantMatchingService } from './instant-matching.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { createBookingNotifier } from './notifications/booking-notifier.factory';
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
    NotificationsModule,
    // RealtimeModule needs BookingsService (isPartyToBooking, for room-join
    // authorization) and BookingsModule needs RealtimeGateway (for the
    // BOOKING_NOTIFIER factory below) — a genuine mutual dependency, broken
    // with forwardRef on both sides (see realtime.module.ts).
    forwardRef(() => RealtimeModule),
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
    {
      provide: BOOKING_NOTIFIER,
      // forwardRef is supported at runtime for factory `inject` entries (see
      // @nestjs/core's injector), but its declared type only covers
      // InjectionToken | OptionalFactoryDependency — hence the cast.
      inject: [
        NotificationPreferencesService,
        NotificationLogService,
        DeviceTokensService,
        UsersService,
        CountriesService,
        WorkerProfilesService,
        forwardRef(() => RealtimeGateway) as unknown as typeof RealtimeGateway,
        ConfigService,
      ],
      useFactory: createBookingNotifier,
    },
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
