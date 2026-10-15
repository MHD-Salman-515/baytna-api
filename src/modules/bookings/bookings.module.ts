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
import { BookingExpiryService } from './booking-expiry.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { WorkerBookingsController } from './worker-bookings.controller';
import { WorkerSlotsController } from './worker-slots.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }]),
    WorkersModule,
    ServicesModule,
    CountriesModule,
    PricingModule,
    UsersModule,
    AuditLogModule,
  ],
  // WorkerBookingsController ('workers/me/bookings/...') and WorkerSlotsController
  // ('workers/:id/slots') have no overlapping literal path segment with each
  // other or with anything in WorkersModule — see WorkerSlotsController's own
  // comment — so registration order here doesn't matter.
  controllers: [
    BookingsController,
    WorkerBookingsController,
    WorkerSlotsController,
    AdminBookingsController,
  ],
  providers: [BookingsService, DirectAssignmentStrategy, BookingExpiryService],
  exports: [BookingsService],
})
export class BookingsModule {}
