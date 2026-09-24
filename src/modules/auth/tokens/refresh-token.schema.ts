import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export enum RefreshTokenStatus {
  ACTIVE = 'ACTIVE',
  ROTATED = 'ROTATED',
  REVOKED = 'REVOKED',
}

/**
 * Deliberately does NOT extend the domain's usual BaseSchema (timestamps +
 * soft delete): a rotating security token needs hard, exact revocation state
 * (`status`) and a real TTL-based expiry, not "soft deleted but still sitting
 * in the collection". `timestamps: true` alone covers audit needs.
 */
@Schema({ collection: 'refresh_tokens', timestamps: true })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  // Persists across every rotation in a session's lineage; used to revoke an
  // entire session at once (logout, logout-all, or reuse detection).
  @Prop({ type: String, required: true, index: true })
  familyId!: string;

  // Unique per issued token, changes on every rotation — the actual lookup key.
  @Prop({ type: String, required: true, unique: true })
  jti!: string;

  // Hash of the issued refresh token itself, so a DB read alone never yields a usable bearer value.
  @Prop({ type: String, required: true })
  tokenHash!: string;

  @Prop({ type: String, enum: RefreshTokenStatus, default: RefreshTokenStatus.ACTIVE })
  status!: RefreshTokenStatus;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

// jti's uniqueness is already declared via @Prop({ unique: true }) above.
// TTL index: Mongo hard-deletes the document once expiresAt passes, regardless of status.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
