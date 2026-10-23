import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type WalletEntryDocument = HydratedDocument<WalletEntry>;

export enum WalletEntryType {
  TOPUP = 'TOPUP',
  COMMISSION_CHARGE = 'COMMISSION_CHARGE',
  CANCELLATION_FEE = 'CANCELLATION_FEE',
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
  REVERSAL = 'REVERSAL',
}

/**
 * The money ledger — double-entry-style and append-only by construction:
 * WalletsService exposes no update or delete path for this collection,
 * anywhere. A mistake is corrected by writing a REVERSAL entry that
 * references the original via `reversesEntryId`, never by editing or
 * removing what's already here (see AuditLogService's identical discipline
 * for the same reasoning — the record itself IS the guarantee).
 *
 * `balanceAfter` is a snapshot of the wallet's balance immediately after
 * this entry was applied — not recomputed later, frozen at write time, so
 * the ledger reads as a true running balance even if the wallet document
 * itself is ever rebuilt. `idempotencyKey` is globally unique: charging the
 * same booking twice, even under a retry or a genuine concurrent race, can
 * never produce two entries (see WalletsService.recordEntry).
 */
@Schema({ collection: 'wallet_entries', timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class WalletEntry {
  // MongooseSchema.Types.ObjectId — see the project-wide ObjectId-casting audit.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Wallet', required: true, index: true })
  walletId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', default: null })
  bookingId!: Types.ObjectId | null;

  @Prop({ type: String, enum: WalletEntryType, required: true })
  type!: WalletEntryType;

  // Signed integer — positive credits the wallet (TOPUP, REFUND, a
  // REVERSAL that undoes a debit), negative debits it (COMMISSION_CHARGE,
  // CANCELLATION_FEE, a REVERSAL that undoes a credit). Never a float.
  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  // Null only in the narrow window between claiming this entry's
  // idempotencyKey and actually applying its amount to the wallet — see
  // WalletsService.recordEntry's own comment on why that's safe, and
  // `wallet:verify`'s treatment of a never-completed entry as drift.
  @Prop({ type: Number, default: null })
  balanceAfter!: number | null;

  @Prop({ type: String, required: true, unique: true })
  idempotencyKey!: string;

  // null for a system-initiated entry (a commission charge, a cancellation
  // penalty) — set to the admin's userId for TOPUP/ADJUSTMENT/REVERSAL.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  // Set only on a REVERSAL entry — the original entry it corrects.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WalletEntry', default: null })
  reversesEntryId!: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt?: Date;
}

export const WalletEntrySchema = SchemaFactory.createForClass(WalletEntry);

WalletEntrySchema.index({ walletId: 1, createdAt: -1 });
