import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { BookingType } from '../../../common/enums/booking-type.enum';
import { PricingType } from '../../../common/enums/pricing-type.enum';
import { Role } from '../../../common/enums/role.enum';
import { GeoPoint, GeoPointSchema } from '../../cities/schemas/city.schema';

export type BookingDocument = HydratedDocument<Booking>;

/**
 * Addresses in our markets are informal — a map pin plus a free-text
 * landmark is the real identifier, so both are required.
 */
@Schema({ _id: false })
export class BookingAddress {
  @Prop({ type: GeoPointSchema, required: true })
  point!: GeoPoint;

  @Prop({ type: String, required: true, trim: true })
  text!: string;

  @Prop({ type: String, required: true, trim: true, minlength: 1 })
  landmark!: string;

  @Prop({ type: String, default: null })
  floor!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;
}
export const BookingAddressSchema = SchemaFactory.createForClass(BookingAddress);

/**
 * Frozen pricing, computed once via PricingService and copied in — never a
 * live reference to the worker's current price or the service's current
 * commission rate. See BookingPricingSnapshot usages in BookingsService.
 */
@Schema({ _id: false })
export class BookingPricingSnapshot {
  @Prop({ type: String, enum: PricingType, required: true })
  pricingType!: PricingType;

  @Prop({ type: Number, default: null })
  hours!: number | null;

  @Prop({ type: Number, default: null })
  roomCount!: number | null;

  @Prop({ type: Number, required: true })
  basePrice!: number;

  // Basis points actually applied — frozen, independent of any later change
  // to Service.commissionRate or Country.commissionRate.
  @Prop({ type: Number, required: true })
  commissionRate!: number;

  @Prop({ type: Number, required: true })
  commissionAmount!: number;

  @Prop({ type: Number, required: true })
  workerEarnings!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  // HOURLY only: the rate and minHours in effect AT CREATION TIME, frozen
  // alongside everything else here. completeBooking() recomputes the final
  // HOURLY price from these plus the actual elapsed hours — never from the
  // worker's current WorkerService — so a rate change after this booking
  // was made can't retroactively change what she's owed for it.
  @Prop({ type: Number, default: null })
  hourlyRate!: number | null;

  @Prop({ type: Number, default: null })
  minHours!: number | null;
}
export const BookingPricingSnapshotSchema = SchemaFactory.createForClass(BookingPricingSnapshot);

@Schema({ _id: false })
export class BookingCancellation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  byUserId!: Types.ObjectId;

  @Prop({ type: String, enum: Role, required: true })
  byRole!: Role;

  @Prop({ type: String, required: true })
  reason!: string;

  // Computed and persisted only — no money moves in this phase (wallet is Phase 7).
  @Prop({ type: Number, required: true, min: 0 })
  feeAmount!: number;
}
export const BookingCancellationSchema = SchemaFactory.createForClass(BookingCancellation);

/** HOURLY/BY_SIZE params the customer supplied at creation, needed to quote() once a worker is actually known — INSTANT only, see Booking.pendingQuoteParams. */
@Schema({ _id: false })
export class PendingQuoteParams {
  @Prop({ type: Number, default: null })
  estimatedHours!: number | null;

  @Prop({ type: Number, default: null })
  roomCount!: number | null;
}
export const PendingQuoteParamsSchema = SchemaFactory.createForClass(PendingQuoteParams);

/** INSTANT-only broadcast-search progress — see InstantMatchingService/InstantMatchingSweepService. */
@Schema({ _id: false })
export class InstantMatchingState {
  @Prop({ type: Date, required: true })
  searchStartedAt!: Date;

  @Prop({ type: Number, required: true, min: 0 })
  currentWaveIndex!: number;

  @Prop({ type: Date, required: true })
  currentWaveStartedAt!: Date;
}
export const InstantMatchingStateSchema = SchemaFactory.createForClass(InstantMatchingState);

@Schema({ collection: 'bookings', ...baseSchemaOptions })
export class Booking extends BaseSchema {
  // Short, human-readable, never sequential — see generate-booking-number.ts.
  @Prop({ type: String, required: true })
  bookingNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId!: Types.ObjectId;

  // Null while an INSTANT booking is SEARCHING — nobody has won it yet.
  // Always set for SCHEDULED (chosen at creation) and for any INSTANT
  // booking once ACCEPTED (whoever won the broadcast).
  @Prop({ type: Types.ObjectId, ref: 'WorkerProfile', default: null })
  workerProfileId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Service', required: true })
  serviceId!: Types.ObjectId;

  // Null until a worker is known — same reasoning as workerProfileId. An
  // INSTANT customer picks a *service*, never a specific worker's offering;
  // this is only resolved once someone actually wins the broadcast (see
  // BookingsService.acceptOffer), since different workers offering the same
  // service may price it differently or even use a different pricingType.
  @Prop({ type: Types.ObjectId, ref: 'WorkerService', default: null })
  workerServiceId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Country', required: true })
  countryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'City', required: true })
  cityId!: Types.ObjectId;

  @Prop({ type: String, enum: BookingType, required: true })
  type!: BookingType;

  // SCHEDULED starts at PENDING_WORKER; INSTANT starts at SEARCHING — see
  // BookingsService.create / createInstant.
  @Prop({
    type: String,
    enum: BookingStatus,
    required: true,
    default: BookingStatus.PENDING_WORKER,
    index: true,
  })
  status!: BookingStatus;

  // Required for SCHEDULED, enforced in BookingsService rather than here —
  // an INSTANT booking never has one (the job starts now, not at some
  // planned instant), so the expiry sweep (which filters on this field via
  // status: PENDING_WORKER) never touches an INSTANT booking either.
  @Prop({ type: Date, default: null, index: true })
  scheduledFor!: Date | null;

  @Prop({ type: Number, required: true, min: 1 })
  estimatedDurationMinutes!: number;

  @Prop({ type: BookingAddressSchema, required: true })
  address!: BookingAddress;

  // Frozen once a worker is known: at creation for SCHEDULED, at acceptance
  // for INSTANT (see acceptOffer) — null while an INSTANT booking is SEARCHING.
  @Prop({ type: BookingPricingSnapshotSchema, default: null })
  pricing!: BookingPricingSnapshot | null;

  // Written only on completion — HOURLY is recomputed from actual elapsed
  // time; BY_SIZE/FIXED just copy the original snapshot's numbers.
  @Prop({ type: BookingPricingSnapshotSchema, default: null })
  finalPricing!: BookingPricingSnapshot | null;

  // INSTANT only, set at creation — the raw estimate inputs, kept until a
  // worker is known and quote() can actually run against her rate.
  @Prop({ type: PendingQuoteParamsSchema, default: null })
  pendingQuoteParams!: PendingQuoteParams | null;

  // INSTANT only, set at creation, cleared implicitly once ACCEPTED (no
  // further sweep action applies once a worker has won).
  @Prop({ type: InstantMatchingStateSchema, default: null })
  instantMatching!: InstantMatchingState | null;

  // Past this instant with no worker response, a SCHEDULED booking EXPIRES
  // — see BookingExpiryService. Always <= scheduledFor. Null for INSTANT,
  // which uses instantMatching + Country.instantMatchingPolicy instead.
  @Prop({ type: Date, default: null })
  responseDeadline!: Date | null;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  // Set on the IN_PROGRESS transition (the "start" action).
  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: BookingCancellationSchema, default: null })
  cancellation!: BookingCancellation | null;

  // Set by the worker's REJECT action — there's no separate "rejection"
  // sub-document in the spec's schema, and this is the only place the
  // required request-body reason for that action has anywhere to go.
  @Prop({ type: String, default: null })
  rejectionReason!: string | null;

  @Prop({ type: String, default: null })
  customerNote!: string | null;

  // Set the first time ScheduledReminderSweepService sends a
  // SCHEDULED_REMINDER for this booking — guards against re-sending on
  // every sweep tick between then and scheduledFor. SCHEDULED only.
  @Prop({ type: Date, default: null })
  reminderSentAt!: Date | null;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Globally unique regardless of soft delete — bookings are never deleted
// (only cancelled), so there's no "tolerate a soft-deleted duplicate" case
// like Country.code/Service.key.
BookingSchema.index({ bookingNumber: 1 }, { unique: true });
BookingSchema.index({ customerId: 1, status: 1 });
BookingSchema.index({ workerProfileId: 1, status: 1 });
BookingSchema.index({ workerProfileId: 1, scheduledFor: 1 });
// Used by the expiry sweep to claim only PENDING_WORKER bookings past their deadline.
BookingSchema.index({ status: 1, responseDeadline: 1 });
BookingSchema.index({ 'address.point': '2dsphere' });
