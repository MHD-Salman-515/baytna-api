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

/**
 * Wallet/commission knobs — Phase 8. Same reasoning as the two policies
 * above: genuinely vary by market and must stay admin-editable.
 */
@Schema({ _id: false })
export class CountryWalletPolicy {
  // Signed — a worker's balance may go this far negative before she's
  // automatically suspended from new matching/bookings. Negative by
  // convention (e.g. -5000), never positive.
  @Prop({ type: Number, required: true, default: -5000 })
  negativeBalanceFloor!: number;

  // A low-balance warning notification fires once when her balance crosses
  // at-or-below this value — must be >= negativeBalanceFloor (less negative,
  // i.e. "closer to zero") so the warning always fires before suspension.
  // Not enforced at the schema level (crosses two fields); WalletsService
  // just treats whatever's configured as the warning line.
  @Prop({ type: Number, required: true, default: -2000 })
  lowBalanceWarningThreshold!: number;

  // Charged to the WORKER's wallet (never the customer) when she cancels
  // after already accepting. Zero by default — enabling it later is a
  // country-settings change, not a code change.
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  workerCancellationPenaltyAmount!: number;
}
export const CountryWalletPolicySchema = SchemaFactory.createForClass(CountryWalletPolicy);

/**
 * Review/safety knobs — Phase 9. Same reasoning as the policies above.
 */
@Schema({ _id: false })
export class CountryReviewPolicy {
  // Either party may submit her review of the other within this many days
  // of completedAt. After it closes, an un-reviewed direction simply never
  // gets reviewed — it does not retroactively reveal the other side's review.
  @Prop({ type: Number, required: true, min: 1, default: 14 })
  reviewWindowDays!: number;
}
export const CountryReviewPolicySchema = SchemaFactory.createForClass(CountryReviewPolicy);

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

  @Prop({ type: CountryWalletPolicySchema, default: () => ({}) })
  walletPolicy!: CountryWalletPolicy;

  @Prop({ type: CountryReviewPolicySchema, default: () => ({}) })
  reviewPolicy!: CountryReviewPolicy;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const CountrySchema = SchemaFactory.createForClass(Country);

// Partial unique index: `code` must be unique only among non-deleted countries,
// so a soft-deleted country doesn't block re-creating the same code later.
CountrySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
