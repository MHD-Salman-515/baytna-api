import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OTP_REQUEST_WINDOW_MS } from './otp.constants';
import { OtpRecord, OtpStore } from './otp-store.interface';

/**
 * Dev/single-process default. State lives in memory only — fine for local
 * dev and tests, useless across multiple instances or a restart (use
 * RedisOtpStore for that, via REDIS_URL).
 */
@Injectable()
export class InMemoryOtpStore implements OtpStore, OnModuleDestroy {
  private readonly records = new Map<string, OtpRecord>();
  private readonly requestLog = new Map<string, number[]>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor() {
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepInterval);
  }

  async get(phone: string): Promise<OtpRecord | null> {
    const record = this.records.get(phone);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.records.delete(phone);
      return null;
    }
    return record;
  }

  async set(phone: string, record: OtpRecord): Promise<void> {
    this.records.set(phone, record);
  }

  async delete(phone: string): Promise<void> {
    this.records.delete(phone);
  }

  async incrementAttempts(phone: string): Promise<number> {
    const record = this.records.get(phone);
    if (!record) return 0;
    record.attempts += 1;
    return record.attempts;
  }

  async recordRequestAndCountInWindow(phone: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const timestamps = (this.requestLog.get(phone) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    this.requestLog.set(phone, timestamps);
    return timestamps.length;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [phone, record] of this.records) {
      if (now > record.expiresAt) this.records.delete(phone);
    }
    for (const [phone, timestamps] of this.requestLog) {
      const fresh = timestamps.filter((t) => now - t < OTP_REQUEST_WINDOW_MS);
      if (fresh.length === 0) this.requestLog.delete(phone);
      else this.requestLog.set(phone, fresh);
    }
  }
}
