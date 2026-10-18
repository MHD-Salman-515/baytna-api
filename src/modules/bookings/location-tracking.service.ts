import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { GeoPoint } from '../cities/schemas/city.schema';
import { haversineDistanceMeters } from './haversine-distance-meters';
import {
  BookingLocationTrail,
  BookingLocationTrailDocument,
} from './schemas/booking-location-trail.schema';
import { Booking, BookingDocument } from './schemas/booking.schema';

// A worker's position is only ever meaningful to track during an active
// job — tracking her at any other time (before dispatch, after the job
// ends) would be a privacy problem, not just an unnecessary one. This list
// is the one place that decision is made; recordPoint enforces it in code
// rather than merely documenting it.
const TRACKABLE_STATUSES = [
  BookingStatus.ON_THE_WAY,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

// A rough, deliberately simple assumption for the customer-facing ETA —
// city driving/motorbike speed. Precise enough to say "about 10 minutes",
// not precise enough (or intended) to be a routing engine.
const ASSUMED_SPEED_METERS_PER_SECOND = 8.3; // ~30 km/h

export type RecordPointRejection = 'not_found' | 'not_active' | 'throttled';

export interface CurrentPosition {
  point: GeoPoint;
  recordedAt: Date;
  distanceMeters: number;
  etaMinutes: number;
}

@Injectable()
export class LocationTrackingService {
  constructor(
    @InjectModel(BookingLocationTrail.name)
    private readonly trailModel: Model<BookingLocationTrailDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The structural enforcement point: a point is accepted only while the
   * booking is ON_THE_WAY/ARRIVED/IN_PROGRESS for THIS worker — never a
   * "should" left to the caller. Returns a rejection reason rather than
   * throwing; the gateway decides how to surface each one to the socket.
   */
  async recordPoint(
    workerProfileId: string,
    bookingId: string,
    point: GeoPoint,
  ): Promise<{ accepted: boolean; reason?: RecordPointRejection }> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return { accepted: false, reason: 'not_found' };
    }
    const booking = await this.bookingModel
      .findOne({ _id: bookingId, workerProfileId })
      .select('status')
      .exec();
    if (!booking) {
      return { accepted: false, reason: 'not_found' };
    }
    if (!TRACKABLE_STATUSES.includes(booking.status)) {
      return { accepted: false, reason: 'not_active' };
    }

    const minIntervalMs =
      this.configService.get<number>('location.updateMinIntervalSeconds', 5) * 1000;
    const existing = await this.trailModel.findOne({ bookingId }).select('lastRecordedAt').exec();
    if (
      existing?.lastRecordedAt &&
      Date.now() - existing.lastRecordedAt.getTime() < minIntervalMs
    ) {
      return { accepted: false, reason: 'throttled' };
    }

    const maxPoints = this.configService.get<number>('location.trailMaxPoints', 200);
    const now = new Date();
    await this.trailModel
      .findOneAndUpdate(
        { bookingId },
        {
          $push: { points: { $each: [{ point, recordedAt: now }], $slice: -maxPoints } },
          $set: { lastRecordedAt: now },
        },
        { upsert: true },
      )
      .exec();

    return { accepted: true };
  }

  /**
   * Called once, at the ON_THE_WAY -> ARRIVED transition
   * (BookingsService.arrived) — never recomputed on later points. A no-op
   * (not an error) when nothing was ever reported, since tracking is best-effort.
   */
  async recordArrivalDistance(bookingId: string, bookingAddressPoint: GeoPoint): Promise<void> {
    const trail = await this.trailModel.findOne({ bookingId }).select('points').exec();
    const lastPoint = trail?.points[trail.points.length - 1];
    if (!lastPoint) {
      return;
    }
    const distanceMeters = haversineDistanceMeters(lastPoint.point, bookingAddressPoint);
    await this.trailModel
      .updateOne({ bookingId }, { arrivalDistanceMeters: distanceMeters })
      .exec();
  }

  /** Scoped by the caller (BookingsService.getOwnForCustomer already throws for a booking that isn't hers) — this just assumes that check already happened. */
  async getCurrentPosition(
    bookingId: string,
    bookingAddressPoint: GeoPoint,
  ): Promise<CurrentPosition> {
    const trail = await this.trailModel.findOne({ bookingId }).select('points').exec();
    const lastPoint = trail?.points[trail.points.length - 1];
    if (!lastPoint) {
      throw new NotFoundException('No location has been reported for this booking yet');
    }

    const distanceMeters = haversineDistanceMeters(lastPoint.point, bookingAddressPoint);
    return {
      point: lastPoint.point,
      recordedAt: lastPoint.recordedAt,
      distanceMeters: Math.round(distanceMeters),
      etaMinutes: Math.round(distanceMeters / ASSUMED_SPEED_METERS_PER_SECOND / 60),
    };
  }

  /** Called on every terminal transition — see BookingsService. Starts the short retention window the purge sweep enforces; a booking never tracked is a harmless no-op. */
  async markTerminated(bookingId: string): Promise<void> {
    await this.trailModel.updateOne({ bookingId }, { terminatedAt: new Date() }).exec();
  }
}
