export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_COOLDOWN_MS = 60 * 1000; // 60 seconds between requests
export const OTP_MAX_REQUESTS_PER_WINDOW = 5;
export const OTP_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** DI tokens — OtpSender/OtpStore are interfaces, so they need a token to inject by. */
export const OTP_SENDER = Symbol('OTP_SENDER');
export const OTP_STORE = Symbol('OTP_STORE');
