import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedText, LocalizedTextSchema } from '../../../common/schemas/localized-text.schema';

export type WorkerProfileDocument = HydratedDocument<WorkerProfile>;

export enum VerificationStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Deliberately separate from VerificationStatus's own SUSPENDED value
 * (Phase 3, disciplinary) — this one is purely financial (Phase 8: her
 * wallet balance crossed the country's negativeBalanceFloor). Clearing one
 * must never clear the other: a worker may be APPROVED but financially
 * SUSPENDED, or disciplinarily SUSPENDED but financially fine. Matching
 * eligibility (WorkerProfilesService.findApprovedById /
 * filterApprovedAvailableInCity, PublicWorkersService) requires BOTH to be clear.
 */
export enum FinancialStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

@Schema({ collection: 'worker_profiles', ...baseSchemaOptions })
export class WorkerProfile extends BaseSchema {
  // No `index: true` here — the partial unique index below already covers
  // this field, and having both produced a "duplicate schema index" warning.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Country', required: true })
  countryId!: Types.ObjectId;

  // Nullable: POST /workers/me/apply creates a bare DRAFT profile with no
  // body, before she's ever chosen a city — filled in later via
  // POST /workers/me/profile. Never null by the time she's APPROVED in
  // practice (that route requires it), but not schema-enforced here.
  @Prop({ type: Types.ObjectId, ref: 'City', default: null })
  cityId!: Types.ObjectId | null;

  @Prop({ type: LocalizedTextSchema, default: {} })
  bio!: LocalizedText;

  @Prop({ type: Number, default: 0, min: 0 })
  yearsOfExperience!: number;

  @Prop({ type: [String], default: [] })
  languages!: string[];

  @Prop({ type: [Types.ObjectId], ref: 'City', default: [] })
  serviceAreas!: Types.ObjectId[];

  @Prop({ type: String, enum: VerificationStatus, default: VerificationStatus.DRAFT, index: true })
  verificationStatus!: VerificationStatus;

  @Prop({ type: LocalizedTextSchema, default: null })
  rejectionReason!: LocalizedText | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt!: Date | null;

  // Means nothing unless verificationStatus === APPROVED — she can toggle it any time either way.
  @Prop({ type: Boolean, default: false })
  isAvailable!: boolean;

  // Phase 8: set automatically when her wallet balance crosses
  // negativeBalanceFloor (WalletsService) or by an admin manual reinstate —
  // never touched by anything disciplinary. See FinancialStatus's own doc comment.
  @Prop({ type: String, enum: FinancialStatus, default: FinancialStatus.ACTIVE, index: true })
  financialStatus!: FinancialStatus;

  // Denormalized, computed in a later phase (reviews/bookings) — fields exist now, default 0.
  @Prop({ type: Number, default: 0 })
  rating!: number;

  @Prop({ type: Number, default: 0 })
  completedBookings!: number;
}

export const WorkerProfileSchema = SchemaFactory.createForClass(WorkerProfile);

// One profile per user, ever (among non-deleted profiles) — partial unique
// index, same reasoning as Country.code / User.phone.
WorkerProfileSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
// The public listing filters/sorts on these together.
WorkerProfileSchema.index({ verificationStatus: 1, isAvailable: 1 });
WorkerProfileSchema.index({ serviceAreas: 1 });
