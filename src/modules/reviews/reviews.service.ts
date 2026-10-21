import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResult, buildPaginationMeta } from '../../common/dto/paginated-result.interface';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { Role } from '../../common/enums/role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log.schema';
import { BookingsService } from '../bookings/bookings.service';
import { CountriesService } from '../countries/countries.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { HideReviewDto } from './dto/hide-review.dto';
import { QueryAdminReviewsDto } from './dto/query-admin-reviews.dto';
import { Review, ReviewDocument } from './schemas/review.schema';

export interface ReviewPairForBooking {
  mine: ReviewDocument | null;
  theirs: ReviewDocument | null;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    private readonly bookingsService: BookingsService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly countriesService: CountriesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async submit(userId: string, bookingId: string, dto: CreateReviewDto): Promise<ReviewDocument> {
    const { booking, role: authorRole } = await this.bookingsService.resolveOwnParty(
      userId,
      bookingId,
    );

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Only a COMPLETED booking may be reviewed');
    }

    const country = await this.countriesService.findActiveById(booking.countryId.toString());
    const deadline = new Date(
      booking.completedAt!.getTime() + country.reviewPolicy.reviewWindowDays * 86_400_000,
    );
    if (Date.now() > deadline.getTime()) {
      throw new BadRequestException(
        `The ${country.reviewPolicy.reviewWindowDays}-day review window for this booking has closed`,
      );
    }

    const subjectId =
      authorRole === Role.CUSTOMER
        ? booking.workerProfileId!.toString()
        : booking.customerId.toString();

    try {
      const review = await this.reviewModel.create({
        bookingId: booking.id,
        authorId: userId,
        authorRole,
        subjectId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      });

      if (authorRole === Role.CUSTOMER) {
        await this.recomputeWorkerRating(subjectId);
      }

      return review;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('You have already reviewed this booking');
      }
      throw error;
    }
  }

  /**
   * The blind-reveal read path: `theirs` is `null` outright — not a review
   * object with a hidden flag — until both directions exist or the review
   * window has closed. `mine` is always visible to its own author,
   * regardless of either of those.
   */
  async getForBooking(userId: string, bookingId: string): Promise<ReviewPairForBooking> {
    const { booking, role: authorRole } = await this.bookingsService.resolveOwnParty(
      userId,
      bookingId,
    );
    const otherRole = authorRole === Role.CUSTOMER ? Role.WORKER : Role.CUSTOMER;

    const [mine, theirs] = await Promise.all([
      this.reviewModel.findOne({ bookingId: booking.id, authorRole, isDeleted: false }).exec(),
      this.reviewModel
        .findOne({ bookingId: booking.id, authorRole: otherRole, isDeleted: false })
        .exec(),
    ]);

    if (!theirs) {
      return { mine, theirs: null };
    }

    const bothSubmitted = mine !== null;
    let windowClosed = false;
    if (!bothSubmitted) {
      const country = await this.countriesService.findActiveById(booking.countryId.toString());
      const deadline = new Date(
        booking.completedAt!.getTime() + country.reviewPolicy.reviewWindowDays * 86_400_000,
      );
      windowClosed = Date.now() > deadline.getTime();
    }

    return { mine, theirs: bothSubmitted || windowClosed ? theirs : null };
  }

  async listForAdmin(query: QueryAdminReviewsDto): Promise<PaginatedResult<ReviewDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.isHidden !== undefined) filter.isHidden = query.isHidden;
    if (query.subjectId) filter.subjectId = query.subjectId;

    const [data, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async hide(adminUserId: string, reviewId: string, dto: HideReviewDto): Promise<ReviewDocument> {
    const review = await this.reviewModel.findOne({ _id: reviewId, isDeleted: false }).exec();
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    review.isHidden = true;
    review.hiddenReason = { ar: dto.reason.ar, en: dto.reason.en };
    review.hiddenBy = adminUserId as unknown as ReviewDocument['hiddenBy'];
    review.hiddenAt = new Date();
    await review.save();

    await this.auditLogService.record({
      actorUserId: adminUserId,
      action: AuditAction.REVIEW_HIDDEN,
      targetType: 'Review',
      targetId: reviewId,
      metadata: { reason: dto.reason },
    });

    if (review.authorRole === Role.CUSTOMER) {
      await this.recomputeWorkerRating(review.subjectId.toString());
    }

    return review;
  }

  /**
   * The only place WorkerProfile.rating may be written from the review
   * side — always a full recompute against every non-hidden Review for
   * this worker, never an increment. Also used by reviews:verify.
   */
  async recomputeWorkerRating(workerProfileId: string): Promise<number> {
    const [result] = await this.reviewModel.aggregate<{ average: number }>([
      {
        $match: {
          subjectId: new Types.ObjectId(workerProfileId),
          authorRole: Role.CUSTOMER,
          isHidden: false,
          isDeleted: false,
        },
      },
      { $group: { _id: null, average: { $avg: '$rating' } } },
    ]);
    const rating = result ? Math.round(result.average * 10) / 10 : 0;
    await this.workerProfilesService.setRating(workerProfileId, rating);
    return rating;
  }
}
