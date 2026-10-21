import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

/**
 * One per worker (lazily created on her first wallet operation — see
 * WalletsService.getOrCreate). `balance` is a cache for fast reads;
 * WalletEntry is the authoritative source of truth (see its own doc
 * comment) — `npm run wallet:verify` recomputes every wallet's balance
 * from its entries and reports any drift as a bug, loudly.
 *
 * Deliberately NOT BaseSchema: a wallet is never soft-deleted — it lives
 * exactly as long as the worker profile it belongs to, and "deleting" one
 * would make no sense while its ledger still exists. `timestamps: true`
 * alone covers audit needs, same reasoning as RefreshToken's own deviation.
 */
@Schema({ collection: 'wallets', timestamps: true })
export class Wallet {
  @Prop({ type: Types.ObjectId, ref: 'WorkerProfile', required: true })
  workerProfileId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Country', required: true })
  countryId!: Types.ObjectId;

  // Signed — may go negative down to the country's negativeBalanceFloor.
  @Prop({ type: Number, required: true, default: 0 })
  balance!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// One wallet per worker, ever.
WalletSchema.index({ workerProfileId: 1 }, { unique: true });
