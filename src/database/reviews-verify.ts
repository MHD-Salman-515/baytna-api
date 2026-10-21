import { envFilePath, assertValidEnv, describeConfiguredMongoUri } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { preflightMongoDns } from '../config/preflight-mongo-dns';
import { redactMongoUrisInText } from '../config/redact-connection-string';
import { AppModule } from '../app.module';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { Booking, BookingDocument } from '../modules/bookings/schemas/booking.schema';
import { Review, ReviewDocument } from '../modules/reviews/schemas/review.schema';
import {
  WorkerProfile,
  WorkerProfileDocument,
} from '../modules/workers/schemas/worker-profile.schema';
import { assertLocalMongoUri } from './seeders/seed-guard';

const logger = new Logger('ReviewsVerify');

/**
 * WorkerProfile.rating and .completedBookings are denormalized for fast
 * reads — this script recomputes both from their real sources (the Review
 * and Booking collections respectively) and reports any drift loudly
 * (non-zero exit), the same contract as wallet:verify. Drift here means a
 * missed/failed recompute call (ReviewsService.hide/recomputeWorkerRating,
 * BookingsService.complete), not a tolerable rounding difference — ratings
 * are compared at the same one-decimal precision the services themselves
 * round to.
 */
async function bootstrap(): Promise<void> {
  logger.log(`Env file: ${envFilePath}`);
  assertValidEnv();
  assertLocalMongoUri(process.env.MONGODB_URI as string);
  applyDnsServersFromEnv();
  await preflightMongoDns(process.env.MONGODB_URI as string);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let ok = true;

  try {
    logger.log(`Verifying against ${describeConfiguredMongoUri()}`);

    const profileModel = app.get<Model<WorkerProfileDocument>>(getModelToken(WorkerProfile.name));
    const bookingModel = app.get<Model<BookingDocument>>(getModelToken(Booking.name));
    const reviewModel = app.get<Model<ReviewDocument>>(getModelToken(Review.name));

    const profiles = await profileModel.find({ isDeleted: false }).exec();
    logger.log(`worker profiles: ${profiles.length} document(s)`);

    let driftCount = 0;
    for (const profile of profiles) {
      const profileId = profile.id as string;

      const [completedCount, ratingAgg] = await Promise.all([
        bookingModel
          .countDocuments({ workerProfileId: profileId, status: BookingStatus.COMPLETED })
          .exec(),
        reviewModel.aggregate<{ average: number }>([
          {
            $match: {
              subjectId: profile._id,
              authorRole: Role.CUSTOMER,
              isHidden: false,
              isDeleted: false,
            },
          },
          { $group: { _id: null, average: { $avg: '$rating' } } },
        ]),
      ]);
      const recomputedRating = ratingAgg[0] ? Math.round(ratingAgg[0].average * 10) / 10 : 0;

      if (profile.completedBookings !== completedCount) {
        logger.error(
          `[DRIFT] worker ${profileId}: stored completedBookings ${profile.completedBookings} ` +
            `!== recomputed ${completedCount}`,
        );
        driftCount++;
        ok = false;
      }
      if (profile.rating !== recomputedRating) {
        logger.error(
          `[DRIFT] worker ${profileId}: stored rating ${profile.rating} ` +
            `!== recomputed ${recomputedRating}`,
        );
        driftCount++;
        ok = false;
      }
    }

    logger.log(
      driftCount === 0
        ? `All ${profiles.length} worker profile(s) verified — zero drift`
        : `${driftCount} drift issue(s) found across ${profiles.length} worker profile(s)`,
    );
  } finally {
    await app.close();
  }

  if (!ok) {
    logger.error('reviews:verify FAILED');
    process.exit(1);
  }
  logger.log('reviews:verify PASSED');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(redactMongoUrisInText(message));
  process.exit(1);
});
