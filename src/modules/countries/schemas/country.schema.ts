import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedName, LocalizedNameSchema } from '../../../common/schemas/localized-name.schema';

export type CountryDocument = HydratedDocument<Country>;

/**
 * Booking-related knobs that genuinely differ by market and must stay
 * data-driven (editable via PUT /countries/admin/:id), never hardcoded in
 * the bookings module. Every field has a schema-level default so existing
 * countries (and the seed data) get sensible values without a migration.
 */
@Schema({ _id: false })
export class CountryBookingPolicy {
  // How long a worker has to accept/reject before a booking EXPIRES. The
  // actual deadline is also capped at scheduledFor itself — see
  // BookingsService.computeResponseDeadline.
  @Prop({ type: Number, required: true, min: 1, default: 12 })
  responseDeadlineHours!: number;

  // How far in the future a SCHEDULED booking may be placed.
  @Prop({ type: Number, required: true, min: 1, default: 90 })
  bookingHorizonDays!: number;

  // Minimum gap kept free before/after a booking on the same worker's
  // schedule, for travel time between jobs.
  @Prop({ type: Number, required: true, min: 0, default: 30 })
  interBookingBufferMinutes!: number;

  // A customer cancelling more than this many hours before scheduledFor owes no fee.
  @Prop({ type: Number, required: true, min: 0, default: 24 })
  freeCancellationHours!: number;

  // Basis points of basePrice owed when a customer cancels inside the free-cancellation window.
  @Prop({ type: Number, required: true, min: 0, max: 10000, default: 2000 })
  cancellationFeeBasisPoints!: number;
}
export const CountryBookingPolicySchema = SchemaFactory.createForClass(CountryBookingPolicy);

/**
 * INSTANT broadcast-matching knobs — Phase 6. Same reasoning as
 * CountryBookingPolicy: these genuinely vary by market (a sparse rural
 * market needs wider radius steps and longer timeouts than a dense city)
 * and must stay admin-editable, never hardcoded in the matching code.
 */
@Schema({ _id: false })
export class CountryInstantMatchingPolicy {
  // Progressive broadcast radii, in meters, nearest first. Exhausted at the
  // last step: subsequent wave ticks keep re-broadcasting at that same
  // radius (to catch newly-online workers) until the total timeout.
  @Prop({ type: [Number], required: true, default: [3000, 6000, 10000] })
  radiusStepsMeters!: number[];

  // How long one wave waits for an acceptance before expanding/re-broadcasting.
  @Prop({ type: Number, required: true, min: 1, default: 20 })
  waveTimeoutSeconds!: number;

  // Total time budget across every wave before the booking moves to NO_WORKER_FOUND.
  @Prop({ type: Number, required: true, min: 1, default: 90 })
  totalRequestTimeoutSeconds!: number;

  // A worker's lastHeartbeatAt older than this makes her ineligible for a
  // new broadcast wave, even if isOnline is still true (she may have lost
  // connectivity without explicitly going offline).
  @Prop({ type: Number, required: true, min: 1, default: 120 })
  heartbeatStalenessSeconds!: number;
}
export const CountryInstantMatchingPolicySchema = SchemaFactory.createForClass(
  CountryInstantMatchingPolicy,
);

@Schema({ collection: 'countries', ...baseSchemaOptions })
export class Country extends BaseSchema {
  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{2}$/,
  })
  code!: string;

  @Prop({ type: LocalizedNameSchema, required: true })
  name!: LocalizedName;

  @Prop({ type: String, required: true, uppercase: true, trim: true })
  currencyCode!: string;

  @Prop({ type: String, required: true, match: /^\+\d{1,4}$/ })
  phonePrefix!: string;

  @Prop({ type: [String], default: [] })
  enabledPaymentMethods!: string[];

  @Prop({ type: Number, required: true, min: 0, max: 10000 })
  commissionRate!: number;

  // IANA timezone name (e.g. "Asia/Damascus") — bookings and availability
  // windows are always interpreted in the worker's country timezone, never
  // server local time. See worker-availability.service.ts.
  @Prop({ type: String, required: true, default: 'UTC' })
  timezone!: string;

  @Prop({ type: CountryBookingPolicySchema, default: () => ({}) })
  bookingPolicy!: CountryBookingPolicy;

  @Prop({ type: CountryInstantMatchingPolicySchema, default: () => ({}) })
  instantMatchingPolicy!: CountryInstantMatchingPolicy;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const CountrySchema = SchemaFactory.createForClass(Country);

// Partial unique index: `code` must be unique only among non-deleted countries,
// so a soft-deleted country doesn't block re-creating the same code later.
CountrySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
