import { Logger } from '@nestjs/common';
import { OtpSender } from './otp-sender.interface';

/**
 * Development-only OTP delivery: logs the code instead of sending a real SMS/
 * WhatsApp message. Never construct this in production — see the factory in
 * otp.module.ts, which refuses to wire it up when NODE_ENV === 'production'.
 */
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('ConsoleOtpSender (DEV ONLY)');

  async send(e164Phone: string, code: string): Promise<void> {
    this.logger.warn(`OTP code for ${e164Phone}: ${code} (development mode — not actually sent)`);
  }
}
