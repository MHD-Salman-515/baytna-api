export interface OtpRecord {
  codeHash: string;
  expiresAt: number; // epoch ms
  attempts: number;
  requestedAt: number; // epoch ms — used for the cooldown check
}

/**
 * Backs OTP state (Redis is not available in every environment). Implemented
 * by InMemoryOtpStore (dev default) and RedisOtpStore (used when REDIS_URL is
 * set) — OtpService only ever talks to this interface.
 */
export interface OtpStore {
  /** The active record for `phone`, or null if none exists or it has expired. */
  get(phone: string): Promise<OtpRecord | null>;
  /** Replaces any existing record for `phone` — a new request always fully supersedes the old one. */
  set(phone: string, record: OtpRecord): Promise<void>;
  /** Removes the record — used on successful (single-use) verification, or once exhausted/expired. */
  delete(phone: string): Promise<void>;
  /** Atomically increments the stored attempt counter and returns the new value (0 if no record exists). */
  incrementAttempts(phone: string): Promise<number>;
  /** Records a request "now" and returns how many requests for `phone` fall within the trailing `windowMs`. */
  recordRequestAndCountInWindow(phone: string, windowMs: number): Promise<number>;
}
