import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BookingsModule } from '../bookings/bookings.module';
import { UsersModule } from '../users/users.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminPanicAlertsController } from './admin-panic-alerts.controller';
import { BookingPanicController } from './booking-panic.controller';
import { BookingShareLinkController } from './booking-share-link.controller';
import { PanicAlertsService } from './panic-alerts.service';
import { PanicAlert, PanicAlertSchema } from './schemas/panic-alert.schema';
import { ShareTripToken, ShareTripTokenSchema } from './schemas/share-trip-token.schema';
import { TrustedContact, TrustedContactSchema } from './schemas/trusted-contact.schema';
import { ShareTripPublicController } from './share-trip-public.controller';
import { ShareTripPurgeSweepService } from './share-trip-purge-sweep.service';
import { ShareTripService } from './share-trip.service';
import { TrustedContactsController } from './trusted-contacts.controller';
import { TrustedContactsService } from './trusted-contacts.service';

// Same reasoning as ReviewsModule: BookingsModule only registers schemas
// locally, never imports SafetyModule, so importing BookingsModule here is
// a one-directional dependency, not a cycle.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PanicAlert.name, schema: PanicAlertSchema },
      { name: TrustedContact.name, schema: TrustedContactSchema },
      { name: ShareTripToken.name, schema: ShareTripTokenSchema },
    ]),
    BookingsModule,
    WorkersModule,
    UsersModule,
    AuditLogModule,
  ],
  controllers: [
    BookingPanicController,
    BookingShareLinkController,
    ShareTripPublicController,
    TrustedContactsController,
    AdminPanicAlertsController,
  ],
  providers: [
    PanicAlertsService,
    TrustedContactsService,
    ShareTripService,
    ShareTripPurgeSweepService,
  ],
  exports: [PanicAlertsService, TrustedContactsService, ShareTripService],
})
export class SafetyModule {}
