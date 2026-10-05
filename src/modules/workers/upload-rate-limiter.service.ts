import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_UPLOADS_PER_WINDOW = 20;

/**
 * Genuinely per-user (not per-IP): the global ThrottlerGuard runs before
 * JwtAuthGuard (see app.module.ts — that order is deliberate, so abusive
 * unauthenticated traffic gets rejected before any auth-check cost), which
 * means `request.user` isn't populated yet when ThrottlerGuard would need it
 * for a per-user @Throttle() tracker. Rather than reorder the global guards
 * (and lose "reject junk before auth" for every route to get this one),
 * uploads get their own tiny limiter — same in-memory sliding-window +
 * sweep shape as InMemoryOtpStore, keyed by userId instead of phone.
 */
@Injectable()
export class UploadRateLimiterService implements OnModuleDestroy {
  private readonly requestLog = new Map<string, number[]>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor() {
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepInterval);
  }

  /** Throws 429 if this user has already hit the window limit; otherwise records this attempt. */
  assertNotRateLimited(userId: string): void {
    const now = Date.now();
    const timestamps = (this.requestLog.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);

    if (timestamps.length >= MAX_UPLOADS_PER_WINDOW) {
      throw new HttpException(
        'Too many document uploads — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.requestLog.set(userId, timestamps);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [userId, timestamps] of this.requestLog) {
      const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
      if (fresh.length === 0) this.requestLog.delete(userId);
      else this.requestLog.set(userId, fresh);
    }
  }
}
