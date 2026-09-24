import { Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { OtpRecord, OtpStore } from './otp-store.interface';

/**
 * Used when REDIS_URL is set — required as soon as there's more than one app
 * instance, or OTP state needs to survive a restart. Record fields are
 * stored as a Redis hash (not a JSON blob) specifically so incrementAttempts
 * can use HINCRBY and be genuinely atomic under concurrent verify attempts.
 */
export class RedisOtpStore implements OtpStore, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger('RedisOtpStore');

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { lazyConnect: false });
    this.client.on('error', (error) => this.logger.error(`Redis connection error: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async get(phone: string): Promise<OtpRecord | null> {
    const data = await this.client.hgetall(this.recordKey(phone));
    if (!data || !data.codeHash) {
      return null;
    }
    return {
      codeHash: data.codeHash,
      expiresAt: Number(data.expiresAt),
      attempts: Number(data.attempts),
      requestedAt: Number(data.requestedAt),
    };
  }

  async set(phone: string, record: OtpRecord): Promise<void> {
    const key = this.recordKey(phone);
    const ttlMs = Math.max(1, record.expiresAt - Date.now());

    const pipeline = this.client.pipeline();
    pipeline.del(key); // a new request fully supersedes any prior record, including its attempt count
    pipeline.hset(key, {
      codeHash: record.codeHash,
      expiresAt: String(record.expiresAt),
      attempts: String(record.attempts),
      requestedAt: String(record.requestedAt),
    });
    pipeline.pexpire(key, ttlMs);
    await pipeline.exec();
  }

  async delete(phone: string): Promise<void> {
    await this.client.del(this.recordKey(phone));
  }

  async incrementAttempts(phone: string): Promise<number> {
    const key = this.recordKey(phone);
    const exists = await this.client.exists(key);
    if (!exists) {
      return 0;
    }
    return this.client.hincrby(key, 'attempts', 1);
  }

  async recordRequestAndCountInWindow(phone: string, windowMs: number): Promise<number> {
    const key = this.requestsKey(phone);
    const now = Date.now();

    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(key, 0, now - windowMs);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.pexpire(key, windowMs);
    const results = await pipeline.exec();

    const countResult = results?.[2]?.[1];
    return typeof countResult === 'number' ? countResult : 1;
  }

  private recordKey(phone: string): string {
    return `otp:record:${phone}`;
  }

  private requestsKey(phone: string): string {
    return `otp:requests:${phone}`;
  }
}
