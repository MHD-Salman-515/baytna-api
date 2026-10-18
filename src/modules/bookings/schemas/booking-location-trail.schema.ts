import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../cities/schemas/city.schema';

export type BookingLocationTrailDocument = HydratedDocument<BookingLocationTrail>;

@Schema({ _id: false })
export class LocationTrailPoint {
  @Prop({ type: GeoPointSchema, required: true })
  point!: GeoPoint;

  @Prop({ type: Date, required: true })
  recordedAt!: Date;
}
export const LocationTrailPointSchema = SchemaFactory.createForClass(LocationTrailPoint);

/**
 * One document per booking — created lazily on the worker's first accepted
 * location update. Never grows unbounded: `points` is capped at
 * location.trailMaxPoints via `$push`+`$slice` (see LocationTrackingService),
 * so it's always downsampled to the most recent points, never the full
 * history of a long job. Purged entirely a short, configurable retention
 * after `terminatedAt` is set (see LocationTrailPurgeSweepService) — kept
 * that long specifically so a no-show/dispute can still be investigated
 * shortly after the booking ends, not indefinitely.
 */
@Schema({ collection: 'booking_location_trails' })
export class BookingLocationTrail {
  // No `unique: true` here — the explicit index below already covers this
  // field, and having both produced a "duplicate schema index" warning.
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: [LocationTrailPointSchema], default: [] })
  points!: LocationTrailPoint[];

  @Prop({ type: Date, default: null })
  lastRecordedAt!: Date | null;

  // Set once, at the ON_THE_WAY -> ARRIVED transition (BookingsService.arrived),
  // from whatever position was last reported — never recomputed afterwards.
  @Prop({ type: Number, default: null })
  arrivalDistanceMeters!: number | null;

  // Set when the booking reaches a terminal status — see
  // LocationTrackingService.markTerminated. Null means "still active or
  // never tracked"; the purge sweep only ever looks at non-null values.
  @Prop({ type: Date, default: null })
  terminatedAt!: Date | null;
}

export const BookingLocationTrailSchema = SchemaFactory.createForClass(BookingLocationTrail);

BookingLocationTrailSchema.index({ bookingId: 1 }, { unique: true });
BookingLocationTrailSchema.index({ terminatedAt: 1 });
