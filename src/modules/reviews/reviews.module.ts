import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CountriesModule } from '../countries/countries.module';
import { WorkersModule } from '../workers/workers.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { BookingReviewsController } from './booking-reviews.controller';
import { Review, ReviewSchema } from './schemas/review.schema';
import { ReviewsService } from './reviews.service';

// Safe to import BookingsModule directly: BookingsModule itself only
// registers the Review *schema* locally (for its own customer-rating
// lookup — see bookings.service.ts), never this module, so there is no
// cycle. See ReviewsService's own comment on resolvePartyRole for why it
// reuses BookingsService rather than touching the Booking model directly.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    BookingsModule,
    WorkersModule,
    CountriesModule,
    AuditLogModule,
  ],
  controllers: [BookingReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
