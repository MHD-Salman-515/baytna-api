// Per-phone limits — deliberately NOT environment-configurable. These bound
// how many codes one phone number can request/verify no matter which IP
// it's coming from, so they stay fixed across every environment.
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_COOLDOWN_MS = 60 * 1000; // 60 seconds between requests
export const OTP_MAX_REQUESTS_PER_WINDOW = 5;
export const OTP_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

// Per-IP limit on POST /auth/otp/request (AuthController's @Throttle
// override — the 'otp' named throttler registered in app.module.ts is a
// generous no-op base everywhere else). Unlike every constant above, this
// one IS environment-configurable: production wants it tight (anyone
// burst-requesting OTPs from one IP across many phone numbers is almost
// certainly abusive), but the same tightness makes automated staging/test
// runs that legitimately hit this endpoint in a burst get locked out for
// 5-25 minutes. Read directly from process.env, not via ConfigService —
// @Throttle()'s argument is evaluated once, when this module is first
// loaded (decorator application time), before Nest's DI container exists;
// process.env is already populated by then because main.ts's very first
// import (./config/load-env) loads .env as a side effect ahead of every
// other import, the same guarantee the standalone scripts rely on.
export const OTP_IP_THROTTLE_LIMIT = parseInt(process.env.OTP_IP_THROTTLE_LIMIT ?? '10', 10);
export const OTP_IP_THROTTLE_TTL_MS = parseInt(
  process.env.OTP_IP_THROTTLE_TTL_MS ?? String(60 * 60 * 1000),
  10,
);

/** DI tokens — OtpSender/OtpStore are interfaces, so they need a token to inject by. */
export const OTP_SENDER = Symbol('OTP_SENDER');
export const OTP_STORE = Symbol('OTP_STORE');
