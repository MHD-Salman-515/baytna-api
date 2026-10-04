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

  // --- Storage (Phase 3) ---
  // Used to build local-dev presigned-style download links (LocalFileStorage)
  // and nowhere else. Defaults to http://localhost:<PORT>.
  PUBLIC_BASE_URL: Joi.string().uri().optional(),

  // Local dev storage default: directory documents are written to, outside
  // anything this app serves. Ignored once S3_BUCKET is set.
  STORAGE_LOCAL_DIR: Joi.string().default('.local-storage'),

  // Set S3_BUCKET to switch from LocalFileStorage to S3CompatibleStorage
  // (Cloudflare R2, Backblaze B2, MinIO, or real AWS S3 — plain S3 API only).
  // Once set, region/access key/secret key are required.
  S3_BUCKET: Joi.string().optional(),
  S3_REGION: Joi.string().when('S3_BUCKET', { is: Joi.exist(), then: Joi.required() }),
  S3_ACCESS_KEY_ID: Joi.string().when('S3_BUCKET', { is: Joi.exist(), then: Joi.required() }),
  S3_SECRET_ACCESS_KEY: Joi.string().when('S3_BUCKET', { is: Joi.exist(), then: Joi.required() }),
  // Custom endpoint for R2/B2/MinIO; leave unset for real AWS S3.
  S3_ENDPOINT: Joi.string().uri().optional(),
  // Some S3-compatible providers need path-style URLs instead of virtual-hosted-style.
  S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true').falsy('false').default(false),

  // Days a rejected/orphaned worker's documents are retained after her
  // profile/account is soft-deleted, before `npm run purge:documents` removes
  // them. See the "Document retention" section in the README.
  DOCUMENT_RETENTION_DAYS: Joi.number().integer().positive().default(90),
});
