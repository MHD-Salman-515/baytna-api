import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

export enum AuditAction {
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
  DOCUMENT_APPROVED = 'DOCUMENT_APPROVED',
  DOCUMENT_REJECTED = 'DOCUMENT_REJECTED',
  WORKER_APPROVED = 'WORKER_APPROVED',
  WORKER_REJECTED = 'WORKER_REJECTED',
  WORKER_SUSPENDED = 'WORKER_SUSPENDED',
  // Not in the original spec list, added for the retention/purge script
  // (see purge-documents.ts) — the append-only trail must cover deletions too.
  DOCUMENT_PURGED = 'DOCUMENT_PURGED',
}

/**
 * Append-only by construction: AuditLogService exposes only `record` and
 * `query` — no update/delete method exists anywhere in the app layer. No
 * BaseSchema (no soft delete either) for the same reason a RefreshToken
 * doesn't get one — deletability would defeat the point of an audit trail.
 */
@Schema({ collection: 'audit_logs', timestamps: { createdAt: 'timestamp', updatedAt: false } })
export class AuditLog {
  // null for actions taken by a script rather than an admin (e.g. the retention purge).
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  actorUserId!: Types.ObjectId | null;

  @Prop({ type: String, enum: AuditAction, required: true, index: true })
  action!: AuditAction;

  @Prop({ type: String, required: true })
  targetType!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  targetId!: Types.ObjectId;

  @Prop({ type: String, default: null })
  ip!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  timestamp?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ timestamp: -1 });
