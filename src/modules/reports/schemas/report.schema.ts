import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { Role } from '../../../common/enums/role.enum';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportSubjectType {
  USER = 'USER',
  WORKER = 'WORKER',
  BOOKING = 'BOOKING',
}

export enum ReportCategory {
  NO_SHOW = 'NO_SHOW',
  PROPERTY_DAMAGE = 'PROPERTY_DAMAGE',
  THEFT = 'THEFT',
  HARASSMENT = 'HARASSMENT',
  UNSAFE_CONDITIONS = 'UNSAFE_CONDITIONS',
  PAYMENT_DISPUTE = 'PAYMENT_DISPUTE',
  QUALITY = 'QUALITY',
  OTHER = 'OTHER',
}

// Surfaced at the top of the admin queue, never buried — see
// ReportsService.listForAdmin's default sort.
export const HIGH_SEVERITY_CATEGORIES: ReadonlySet<ReportCategory> = new Set([
  ReportCategory.HARASSMENT,
  ReportCategory.THEFT,
]);

export enum ReportStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum ReportResolutionAction {
  SUSPEND_WORKER = 'SUSPEND_WORKER',
  FORCE_NO_SHOW = 'FORCE_NO_SHOW',
  WALLET_ADJUSTMENT = 'WALLET_ADJUSTMENT',
  DISMISS = 'DISMISS',
}

@Schema({ _id: false })
export class ReportAttachment {
  @Prop({ type: String, required: true })
  storageKey!: string;

  @Prop({ type: String, required: true })
  mimeType!: string;

  @Prop({ type: Number, required: true })
  sizeBytes!: number;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;
}
export const ReportAttachmentSchema = SchemaFactory.createForClass(ReportAttachment);

// Never returned to any user, never even to the reporter — admin-only, by
// construction: no projection in this app reads `internalNotes` for a
// non-admin viewer. See ReportsService.addInternalNote.
@Schema({ _id: false })
export class ReportInternalNote {
  // MongooseSchema.Types.ObjectId, not the bare `Types.ObjectId` value class
  // — see Review schema's own doc comment on why @nestjs/mongoose mistypes it.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 2000 })
  note!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}
export const ReportInternalNoteSchema = SchemaFactory.createForClass(ReportInternalNote);

@Schema({ collection: 'reports', ...baseSchemaOptions })
export class Report extends BaseSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId!: Types.ObjectId;

  @Prop({ type: String, enum: [Role.CUSTOMER, Role.WORKER], required: true })
  reporterRole!: Role.CUSTOMER | Role.WORKER;

  @Prop({ type: String, enum: ReportSubjectType, required: true })
  subjectType!: ReportSubjectType;

  // A User id, a WorkerProfile id, or a Booking id, depending on subjectType.
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  subjectId!: Types.ObjectId;

  // Set whenever the report concerns a specific booking, regardless of
  // subjectType — lets admins jump straight to the booking either way.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', default: null, index: true })
  bookingId!: Types.ObjectId | null;

  @Prop({ type: String, enum: ReportCategory, required: true, index: true })
  category!: ReportCategory;

  // Derived from category at creation time (HARASSMENT/THEFT) and stored,
  // rather than recomputed with an `$in` on every query, so the admin queue
  // can sort/filter on an indexed field directly.
  @Prop({ type: Boolean, required: true, index: true })
  isHighSeverity!: boolean;

  @Prop({ type: String, required: true, trim: true, maxlength: 4000 })
  description!: string;

  @Prop({ type: [ReportAttachmentSchema], default: [] })
  attachments!: ReportAttachment[];

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.OPEN, index: true })
  status!: ReportStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null, index: true })
  assignedTo!: Types.ObjectId | null;

  @Prop({ type: [ReportInternalNoteSchema], default: [] })
  internalNotes!: ReportInternalNote[];

  @Prop({ type: String, enum: ReportResolutionAction, default: null })
  resolutionAction!: ReportResolutionAction | null;

  @Prop({ type: String, trim: true, default: null })
  resolution!: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

// High-severity reports must surface first — see listForAdmin's sort, which
// orders on isHighSeverity before falling back to recency.
ReportSchema.index({ status: 1, isHighSeverity: -1, createdAt: -1 });
ReportSchema.index({ assignedTo: 1, status: 1 });
