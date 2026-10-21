import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CountriesModule } from '../countries/countries.module';
import { CountriesService } from '../countries/countries.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceTokensService } from '../notifications/device-tokens.service';
import { NotificationLogService } from '../notifications/notification-log.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { PricingModule } from '../pricing/pricing.module';
import { ServicesModule } from '../services/services.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { WalletsModule } from '../wallets/wallets.module';
import { WorkersModule } from '../workers/workers.module';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { DirectAssignmentStrategy } from './assignment/direct-assignment.strategy';
import { NearestAvailableAssignmentStrategy } from './assignment/nearest-available-assignment.strategy';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CommissionChargeRetrySweepService } from './commission-charge-retry-sweep.service';
import { InstantMatchingSweepService } from './instant-matching-sweep.service';
import { InstantMatchingService } from './instant-matching.service';
import { LocationTrackingService } from './location-tracking.service';
import { LocationTrailPurgeSweepService } from './location-trail-purge-sweep.service';
import { BOOKING_NOTIFIER } from './notifications/booking-notifier.interface';
import { createBookingNotifier } from './notifications/booking-notifier.factory';
import { ScheduledReminderSweepService } from './scheduled-reminder-sweep.service';
import {
  BookingLocationTrail,
  BookingLocationTrailSchema,
} from './schemas/booking-location-trail.schema';
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
      { name: BookingLocationTrail.name, schema: BookingLocationTrailSchema },
    ]),
    WorkersModule,
    ServicesModule,
    CountriesModule,
    PricingModule,
    UsersModule,
    AuditLogModule,
    NotificationsModule,
    WalletsModule,
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
    ScheduledReminderSweepService,
    LocationTrackingService,
    LocationTrailPurgeSweepService,
    CommissionChargeRetrySweepService,
    {
      provide: BOOKING_NOTIFIER,
      // ModuleRef, not RealtimeGateway directly — RealtimeGateway lives in
      // RealtimeModule, which imports BookingsModule (isPartyToBooking,
      // LocationTrackingService); injecting it here even via forwardRef
      // created a circular factory-provider dependency that resolved to
      // null at runtime (BaseNotifier resolves it lazily instead — see its
      // own comment on the `gateway` getter).
      inject: [
        NotificationPreferencesService,
        NotificationLogService,
        DeviceTokensService,
        UsersService,
        CountriesService,
        WorkerProfilesService,
        ModuleRef,
        ConfigService,
      ],
      useFactory: createBookingNotifier,
    },
  ],
  exports: [BookingsService, LocationTrackingService],
})
export class BookingsModule {}
