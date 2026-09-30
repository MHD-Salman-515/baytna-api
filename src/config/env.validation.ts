import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),

  MONGODB_URI: Joi.string().uri().required(),

  API_PREFIX: Joi.string().default('api/v1'),

  CORS_ORIGINS: Joi.string().default('*'),

  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  // Optional: comma-separated DNS servers (e.g. "1.1.1.1,8.8.8.8") applied to
  // Node's resolver before any Mongo connection. See apply-dns-servers.ts.
  DNS_SERVERS: Joi.string().optional(),

  // --- Auth (Phase 2) ---
  // Signing secrets for access/refresh JWTs. Must be different from each
  // other (a leaked access token must not double as a valid refresh token).
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .messages({
      'any.invalid': 'JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET',
    }),

  // Server-side pepper mixed into the OTP code hash before storage, so a
  // leaked OTP store (in-memory dump or Redis) alone isn't enough to derive
  // valid codes — the attacker would also need this value.
  OTP_PEPPER: Joi.string().min(32).required(),

  // Optional. When set, the OTP store uses Redis (see redis-otp-store.ts);
  // when unset, an in-memory store is used (fine for a single dev/test
  // instance, useless across multiple processes/restarts).
  REDIS_URL: Joi.string().uri().optional(),

  // Optional. Full E.164 phone number for the seeder to idempotently create
  // (or promote to ADMIN) a bootstrap admin user. The admin's country is
  // inferred from the number itself. Skipped with a warning if unset.
  SEED_ADMIN_PHONE: Joi.string().optional(),
});
