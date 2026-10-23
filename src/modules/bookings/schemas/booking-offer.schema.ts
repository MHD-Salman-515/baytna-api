import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';

export type BookingOfferDocument = HydratedDocument<BookingOffer>;

export enum BookingOfferOutcome {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  // The booking stopped searching (customer cancelled, or the total
  // timeout elapsed) while this offer was still outstanding.
  STALE = 'STALE',
}

/**
 * One record per (booking, worker) INSTANT offer — operational data for
 * debugging/measuring match quality ("workers complain they never get
 * requests"), and the backing store for GET /workers/me/offers. A worker
 * gets at most one offer per booking regardless of how many waves it takes
 * to reach her (enforced by the unique index below) — "deduplicate across
 * waves" from the spec. A LOST outcome is never treated as a rejection
 * against her stats anywhere in this codebase — losing a race for an
 * instant job she never actually turned down.
 */
@Schema({ collection: 'booking_offers', ...baseSchemaOptions })
export class BookingOffer extends BaseSchema {
  // MongooseSchema.Types.ObjectId — see the project-wide ObjectId-casting
  // audit. bookingId was already consistently written as a real ObjectId
  // (from booking._id, see acceptOffer/instant-matching.service.ts), so this
  // fix is a no-op for it; workerProfileId/workerServiceId below were not.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  // This candidate's own offering for the booking's service — her price
  // preview below is computed against this, not against whichever
  // WorkerService eventually wins.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WorkerService', required: true })
  workerServiceId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  wave!: number;

  @Prop({ type: Number, required: true, min: 0 })
  radiusMeters!: number;

  @Prop({ type: Number, required: true, min: 0 })
  distanceMeters!: number;

  // A preview only — never the frozen price. BookingsService.acceptOffer
  // re-quotes fresh at acceptance time rather than trusting this value.
  @Prop({ type: Number, required: true })
  estimatedPrice!: number;

  @Prop({ type: Number, required: true })
  estimatedWorkerEarnings!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: Date, required: true })
  sentAt!: Date;

  @Prop({ type: Date, default: null })
  respondedAt!: Date | null;

  @Prop({
    type: String,
    enum: BookingOfferOutcome,
    required: true,
    default: BookingOfferOutcome.PENDING,
  })
  outcome!: BookingOfferOutcome;
}

export const BookingOfferSchema = SchemaFactory.createForClass(BookingOffer);

BookingOfferSchema.index(
  { bookingId: 1, workerProfileId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
BookingOfferSchema.index({ workerProfileId: 1, outcome: 1 });
BookingOfferSchema.index({ bookingId: 1 });
