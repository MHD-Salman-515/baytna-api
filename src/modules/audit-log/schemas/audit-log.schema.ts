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
  // Not in the original Phase 3 spec list, added for the retention/purge
  // script (see purge-documents.ts) — the append-only trail must cover
  // deletions too.
  DOCUMENT_PURGED = 'DOCUMENT_PURGED',
  // Added for the self-service "become a worker" endpoint — records the
  // moment a CUSTOMER account is granted WORKER and gets her first DRAFT
  // WorkerProfile. Written once, on creation, not on an idempotent replay.
  WORKER_APPLIED = 'WORKER_APPLIED',
  // Phase 5 — an admin forcing a booking to CANCELLED or NO_SHOW always
  // writes one of these, always with a reason (see BookingsService.forceStatus).
  BOOKING_FORCE_CANCELLED = 'BOOKING_FORCE_CANCELLED',
  BOOKING_FORCE_NO_SHOW = 'BOOKING_FORCE_NO_SHOW',
  // Phase 8 — wallet ledger. TOPUP/ADJUSTMENT/REVERSAL/manual reinstatement
  // are always admin-initiated and always audit-logged; a failed commission
  // charge is logged too (actorUserId null — it's the system, not an admin)
  // so "a completed job went uncharged" is never silent.
  WALLET_TOPUP = 'WALLET_TOPUP',
  WALLET_ADJUSTMENT = 'WALLET_ADJUSTMENT',
  WALLET_REVERSAL = 'WALLET_REVERSAL',
  WALLET_REINSTATED = 'WALLET_REINSTATED',
  WALLET_COMMISSION_CHARGE_FAILED = 'WALLET_COMMISSION_CHARGE_FAILED',
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
