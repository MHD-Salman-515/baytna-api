import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import {
  OTP_COOLDOWN_MS,
  OTP_LENGTH,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_REQUEST_WINDOW_MS,
  OTP_SENDER,
  OTP_STORE,
  OTP_TTL_MS,
} from './otp.constants';
import { OtpSender } from './otp-sender.interface';
import { OtpRecord, OtpStore } from './otp-store.interface';

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_STORE) private readonly store: OtpStore,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    private readonly configService: ConfigService,
  ) {}

  /** Generates, stores (hashed), and delivers a fresh code. Enforces cooldown + hourly rate limit. */
  async requestOtp(e164Phone: string): Promise<void> {
    const existing = await this.store.get(e164Phone);
    if (existing && Date.now() - existing.requestedAt < OTP_COOLDOWN_MS) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const requestCount = await this.store.recordRequestAndCountInWindow(
      e164Phone,
      OTP_REQUEST_WINDOW_MS,
    );
    if (requestCount > OTP_MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        'Too many code requests — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const now = Date.now();
    const record: OtpRecord = {
      codeHash: this.hashCode(e164Phone, code),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      requestedAt: now,
    };
    await this.store.set(e164Phone, record);

    // The plaintext code exists only in this local variable and inside the
    // sender — it is never logged or returned from this service.
    await this.sender.send(e164Phone, code);
  }

  /** Throws BadRequestException on any invalid/expired/exhausted code. Deletes the record on success (single-use). */
  async verifyOtp(e164Phone: string, code: string): Promise<void> {
    const record = await this.store.get(e164Phone);
    if (!record) {
      throw new BadRequestException('Invalid or expired code');
    }

    if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      await this.store.delete(e164Phone);
      throw new BadRequestException('Too many attempts — request a new code');
    }

    const providedHash = this.hashCode(e164Phone, code);
    if (!this.constantTimeEquals(providedHash, record.codeHash)) {
      await this.store.incrementAttempts(e164Phone);
      throw new BadRequestException('Invalid or expired code');
    }

    await this.store.delete(e164Phone);
  }

  private generateCode(): string {
    return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  }

  private hashCode(phone: string, code: string): string {
    const pepper = this.configService.get<string>('otpPepper');
    return createHash('sha256').update(`${phone}:${code}:${pepper}`).digest('hex');
  }

  /** Compares hex-encoded hashes in constant time, per the spec — the primary defense against guessing is attempt-limiting, this closes the timing side channel on the comparison itself. */
  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
