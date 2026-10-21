import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedText, LocalizedTextSchema } from '../../../common/schemas/localized-text.schema';
import { Role } from '../../../common/enums/role.enum';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ collection: 'reviews', ...baseSchemaOptions })
export class Review extends BaseSchema {
  // `type: MongooseSchema.Types.ObjectId`, NOT `mongoose.Types.ObjectId` —
  // @nestjs/mongoose's SchemaFactory doesn't recognize the latter as a
  // SchemaType (it isn't one; `Types.ObjectId` is the BSON value class used
  // to *construct* ids, not the Mongoose SchemaType used to *declare* a
  // field). Passed that way, it silently collapses to an empty nested
  // schema (Mixed), and every id on this schema would be stored and
  // compared as a plain string — invisible in ordinary `.find()`/`.populate()`
  // queries (which stay internally consistent either way) but wrong the
  // moment anything does a real `new Types.ObjectId(x)` match in a raw
  // aggregation pipeline, as ReviewsService/BookingsService's rating
  // aggregations do.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', required: true, index: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  // Which side of the booking wrote this review — CUSTOMER or WORKER, never ADMIN.
  @Prop({ type: String, enum: [Role.CUSTOMER, Role.WORKER], required: true })
  authorRole!: Role.CUSTOMER | Role.WORKER;

  // Polymorphic by design, no `ref` (population would need to pick a
  // collection per row): a CUSTOMER's review's subjectId is the
  // WorkerProfile id being rated (matches WorkerProfile.rating's own
  // aggregation key directly); a WORKER's review's subjectId is the
  // customer's User id (customers have no separate "profile" document).
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ type: String, trim: true, maxlength: 1000, default: null })
  comment!: string | null;

  // Set by an admin moderation action only — never by either party. A
  // hidden review is excluded from both the blind-reveal view and the
  // aggregate; see ReviewsService.hide / recomputeWorkerRating.
  @Prop({ type: Boolean, default: false, index: true })
  isHidden!: boolean;

  @Prop({ type: LocalizedTextSchema, default: null })
  hiddenReason!: LocalizedText | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  hiddenBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  hiddenAt!: Date | null;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per direction per booking — a partial unique index (not a
// ledger-style idempotency key) since a review is a single mutable-ish row,
// not an append-only entry. Enforced here, not just in the service.
ReviewSchema.index(
  { bookingId: 1, authorRole: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
ReviewSchema.index({ subjectId: 1, isHidden: 1 });
