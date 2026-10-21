import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { OTP_TTL_MS } from './otp.constants';
import { OtpSender } from './otp-sender.interface';
import { DevOtpCodeDocument } from './schemas/dev-otp-code.schema';

/**
 * Development/staging OTP delivery: logs the code (same as the old
 * ConsoleOtpSender) AND persists it to dev_otp_codes, so a developer on a
 * host where live log streaming isn't reachable (e.g. Render's free tier)
 * can still read it via GET /dev/last-otp. Never construct this in
 * production — see the factory in otp.module.ts, which refuses to wire up
 * any dev sender when NODE_ENV === 'production'.
 */
export class StoredOtpSender implements OtpSender {
  private readonly logger = new Logger('ConsoleOtpSender (DEV ONLY)');

  constructor(private readonly model: Model<DevOtpCodeDocument>) {}

  async send(e164Phone: string, code: string): Promise<void> {
    this.logger.warn(`OTP code for ${e164Phone}: ${code} (development mode — not actually sent)`);

    const now = new Date();
    await this.model
      .findOneAndUpdate(
        { phone: e164Phone },
        {
          phone: e164Phone,
          code,
          createdAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          consumed: false,
        },
        { upsert: true },
      )
      .exec();
  }

  async markConsumed(e164Phone: string): Promise<void> {
    await this.model.updateOne({ phone: e164Phone }, { consumed: true }).exec();
  }
}
