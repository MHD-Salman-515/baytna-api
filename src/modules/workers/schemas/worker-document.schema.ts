import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseSchema, baseSchemaOptions } from '../../../common/schemas/base.schema';
import { LocalizedText, LocalizedTextSchema } from '../../../common/schemas/localized-text.schema';

export type WorkerDocumentDocument = HydratedDocument<WorkerDocument>;

export enum DocumentType {
  NATIONAL_ID_FRONT = 'NATIONAL_ID_FRONT',
  NATIONAL_ID_BACK = 'NATIONAL_ID_BACK',
  CRIMINAL_RECORD = 'CRIMINAL_RECORD',
  PROFILE_PHOTO = 'PROFILE_PHOTO',
  OTHER = 'OTHER',
}

export enum DocumentReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ collection: 'worker_documents', ...baseSchemaOptions })
export class WorkerDocument extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  @Prop({ type: String, enum: DocumentType, required: true })
  type!: DocumentType;

  // Opaque, unguessable (see generateObjectKey) — never derived from any
  // user-identifying data, and never returned to any client as-is; reads
  // only ever happen via a short-lived presigned URL.
  @Prop({ type: String, required: true })
  storageKey!: string;

  @Prop({ type: String, required: true })
  mimeType!: string;

  @Prop({ type: Number, required: true, min: 0 })
  sizeBytes!: number;

  @Prop({ type: String, required: true })
  checksum!: string;

  @Prop({ type: String, enum: DocumentReviewStatus, default: DocumentReviewStatus.PENDING })
  status!: DocumentReviewStatus;

  @Prop({ type: LocalizedTextSchema, default: null })
  rejectionReason!: LocalizedText | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt!: Date | null;

  // Required for CRIMINAL_RECORD specifically (enforced in the service, not
  // the schema — Mongoose's conditional-required is awkward and this needs
  // a clear error message anyway); null for every other type.
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;
}

export const WorkerDocumentSchema = SchemaFactory.createForClass(WorkerDocument);

WorkerDocumentSchema.index({ workerProfileId: 1, type: 1 });
