import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DevOtpCodeDocument = HydratedDocument<DevOtpCode>;

const DEV_OTP_RECORD_RETENTION_SECONDS = 15 * 60; // cleanup safety net — independent of the OTP's own (shorter) validity window below

/**
 * STAGING/DEV ONLY — see StoredOtpSender and DevOtpController, both of which
 * refuse to run in production. One row per phone (upserted, not
 * append-only): `expiresAt` mirrors the real OTP's own short-lived validity
 * (OTP_TTL_MS) and is what GET /dev/last-otp filters on; the collection-level
 * TTL index below is a separate, longer cleanup window so a row never
 * lingers even if that filter logic ever had a bug.
 */
@Schema({ collection: 'dev_otp_codes', timestamps: false })
export class DevOtpCode {
  @Prop({ type: String, required: true })
  phone!: string;

  // Plaintext, deliberately — the whole point of this collection is letting
  // a developer read the code without console access. Never exposed outside
  // DevOtpController, which itself refuses to run in production.
  @Prop({ type: String, required: true })
  code!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Boolean, default: false })
  consumed!: boolean;
}

export const DevOtpCodeSchema = SchemaFactory.createForClass(DevOtpCode);

DevOtpCodeSchema.index({ phone: 1 }, { unique: true });
DevOtpCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: DEV_OTP_RECORD_RETENTION_SECONDS });
