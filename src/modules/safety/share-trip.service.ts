import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingsService } from '../bookings/bookings.service';
import { LocationTrackingService } from '../bookings/location-tracking.service';
import { UsersService } from '../users/users.service';
import { WorkerProfilesService } from '../workers/worker-profiles.service';
import { ShareTripToken, ShareTripTokenDocument } from './schemas/share-trip-token.schema';

export const SHARE_TRIP_TERMINAL_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
  BookingStatus.NO_WORKER_FOUND,
  BookingStatus.NO_SHOW,
  BookingStatus.REJECTED,
];

export interface ShareTripView {
  workerFirstName: string | null;
  status: BookingStatus;
  position: { point: unknown; recordedAt: Date; distanceMeters: number } | null;
  etaMinutes: number | null;
}

@Injectable()
export class ShareTripService {
  constructor(
    @InjectModel(ShareTripToken.name) private readonly tokenModel: Model<ShareTripTokenDocument>,
    private readonly bookingsService: BookingsService,
    private readonly locationTrackingService: LocationTrackingService,
    private readonly workerProfilesService: WorkerProfilesService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async createForBooking(userId: string, bookingId: string): Promise<ShareTripTokenDocument> {
    const { role } = await this.bookingsService.resolveOwnParty(userId, bookingId);
    const token = randomBytes(32).toString('hex');
    return this.tokenModel.create({
      bookingId,
      token,
      createdByUserId: userId,
      createdByRole: role,
    });
  }

  async revokeForBooking(userId: string, bookingId: string): Promise<void> {
    await this.bookingsService.resolveOwnParty(userId, bookingId);
    await this.tokenModel
      .updateMany({ bookingId, revokedAt: null }, { revokedAt: new Date(), revokedBy: userId })
      .exec();
  }

  /**
   * The one unauthenticated read in this entire app — treat every line here
   * as hostile territory. The allowlist is enforced by construction: this
   * function builds the response object field by field, it never spreads a
   * Booking/WorkerProfile/User document. A revoked or definitively-expired
   * token is a 404, identical to one that never existed — never a
   * distinguishable "expired" vs "revoked" vs "not found" response, same
   * discipline as the dev-OTP endpoint's identical-404 rule.
   */
  async getPublicView(token: string): Promise<ShareTripView> {
    const row = await this.tokenModel.findOne({ token, isDeleted: false }).exec();
    if (!row || row.revokedAt) {
      throw new NotFoundException();
    }

    const booking = await this.bookingsService.getForAdmin(row.bookingId.toString());
    const isTerminal = SHARE_TRIP_TERMINAL_STATUSES.includes(booking.status);

    if (isTerminal) {
      const terminalAt =
        booking.completedAt ?? booking.cancelledAt ?? booking.updatedAt ?? new Date(0);
      const gracePeriodMs =
        this.configService.get<number>('safety.shareTripGracePeriodMinutes', 60) * 60_000;
      if (Date.now() > terminalAt.getTime() + gracePeriodMs) {
        throw new NotFoundException();
      }
    }

    const workerFirstName = booking.workerProfileId
      ? await this.getWorkerFirstName(booking.workerProfileId.toString())
      : null;

    // No live position/ETA once the job has ended — there is nothing left
    // to track, regardless of whether a trail still technically exists.
    if (isTerminal) {
      return { workerFirstName, status: booking.status, position: null, etaMinutes: null };
    }

    try {
      const current = await this.locationTrackingService.getCurrentPosition(
        row.bookingId.toString(),
        booking.address.point,
      );
      return {
        workerFirstName,
        status: booking.status,
        position: {
          point: current.point,
          recordedAt: current.recordedAt,
          distanceMeters: current.distanceMeters,
        },
        etaMinutes: current.etaMinutes,
      };
    } catch {
      return { workerFirstName, status: booking.status, position: null, etaMinutes: null };
    }
  }

  private async getWorkerFirstName(workerProfileId: string): Promise<string | null> {
    try {
      const profile = await this.workerProfilesService.getForAdmin(workerProfileId);
      const user = await this.usersService.findById(profile.userId.toString());
      return user.profile?.firstName ?? null;
    } catch {
      return null;
    }
  }
}
