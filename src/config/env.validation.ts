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

  // Optional. Gates GET /dev/last-otp (StoredOtpSender/DevOtpController —
  // see README "Dev OTP retrieval"). Never required in production; that
  // route refuses to even construct when NODE_ENV === 'production'
  // regardless of whether this is set.
  DEV_OTP_ACCESS_KEY: Joi.string().min(20).optional(),

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

  // --- Bookings (Phase 5) ---
  // Disables the periodic EXPIRED sweep entirely (e.g. for a worker instance
  // that shouldn't run background jobs). See BookingExpiryService.
  BOOKING_EXPIRY_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  // How often the sweep runs, in seconds.
  BOOKING_EXPIRY_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(300),

  // --- INSTANT matching (Phase 6) ---
  // Disables the periodic wave-expansion/timeout sweep entirely. See InstantMatchingSweepService.
  BOOKING_INSTANT_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  // How often the sweep runs, in seconds — deliberately more frequent than
  // the expiry sweep, since wave timeouts can be as short as ~20s.
  BOOKING_INSTANT_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(5),

  // How long before a SCHEDULED booking's scheduledFor the worker gets a reminder.
  SCHEDULED_REMINDER_LEAD_MINUTES: Joi.number().integer().positive().default(60),
  SCHEDULED_REMINDER_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  SCHEDULED_REMINDER_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(300),

  // --- Wallet (Phase 8) ---
  COMMISSION_CHARGE_RETRY_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  COMMISSION_CHARGE_RETRY_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(300),

  // --- Notifications / realtime / tracking (Phase 7) ---
  // 'log' (default) never touches a push provider and needs no credentials
  // — safe for dev and the test suite. 'fcm' requires the three FCM_* vars
  // below; 'onesignal' requires the two ONESIGNAL_* vars below. FCM isn't
  // reliably reachable in every market this app serves — OneSignal is the
  // verified alternative there; both stay available as a config choice.
  NOTIFICATION_PUSH_PROVIDER: Joi.string().valid('log', 'fcm', 'onesignal').default('log'),
  FCM_PROJECT_ID: Joi.string().when('NOTIFICATION_PUSH_PROVIDER', {
    is: 'fcm',
    then: Joi.required(),
  }),
  FCM_CLIENT_EMAIL: Joi.string().when('NOTIFICATION_PUSH_PROVIDER', {
    is: 'fcm',
    then: Joi.required(),
  }),
  FCM_PRIVATE_KEY: Joi.string().when('NOTIFICATION_PUSH_PROVIDER', {
    is: 'fcm',
    then: Joi.required(),
  }),
  ONESIGNAL_APP_ID: Joi.string().when('NOTIFICATION_PUSH_PROVIDER', {
    is: 'onesignal',
    then: Joi.required(),
  }),
  ONESIGNAL_REST_API_KEY: Joi.string().when('NOTIFICATION_PUSH_PROVIDER', {
    is: 'onesignal',
    then: Joi.required(),
  }),

  // Wires the socket.io Redis adapter for horizontal scaling (reuses
  // REDIS_URL from Phase 2). Off by default — a single dev instance doesn't
  // need it, and it must never be required to boot.
  WEBSOCKET_REDIS_ADAPTER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),

  // Minimum gap between accepted worker location updates for one booking.
  LOCATION_UPDATE_MIN_INTERVAL_SECONDS: Joi.number().integer().positive().default(5),
  // Bounded trail per booking — oldest points drop off once this cap is hit.
  LOCATION_TRAIL_MAX_POINTS: Joi.number().integer().positive().default(200),
  // How long a trail survives after its booking terminates, for dispute handling.
  LOCATION_TRAIL_RETENTION_HOURS: Joi.number().integer().positive().default(24),
  LOCATION_TRAIL_PURGE_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  LOCATION_TRAIL_PURGE_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(300),
  // How long a share-trip link keeps working after its booking terminates.
  SHARE_TRIP_GRACE_PERIOD_MINUTES: Joi.number().integer().positive().default(60),
  SHARE_TRIP_PURGE_SWEEP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  SHARE_TRIP_PURGE_SWEEP_INTERVAL_SECONDS: Joi.number().integer().positive().default(300),
}).custom((value: Record<string, string | undefined>, helpers) => {
  // Production-only cross-field guards. Both checks exist because a
  // misconfiguration here doesn't fail loudly on its own — a non-HTTPS
  // presigned URL or a wildcard CORS origin "works" right up until it's
  // actually exploited, so these are rejected at startup instead.
  if (value.NODE_ENV !== 'production') {
    return value;
  }

  // Presigned document URLs (national ID photos, criminal-record
  // certificates) must never be issued over plain http. PUBLIC_BASE_URL is
  // optional elsewhere (defaults to http://localhost:<PORT> for local dev,
  // see configuration.ts) — that default must never silently apply in
  // production, so it's required and HTTPS-only here instead.
  if (!value.PUBLIC_BASE_URL || !value.PUBLIC_BASE_URL.startsWith('https://')) {
    return helpers.message({
      custom:
        'PUBLIC_BASE_URL must be explicitly set to an https:// URL when NODE_ENV=production — presigned document URLs must never be issued over plain http.',
    });
  }
  if (value.S3_ENDPOINT && !value.S3_ENDPOINT.startsWith('https://')) {
    return helpers.message({
      custom:
        'S3_ENDPOINT must use https:// when NODE_ENV=production — same reasoning as PUBLIC_BASE_URL.',
    });
  }

  // An allowlist that includes "*" anywhere reflects any origin (see
  // app.enableCors in main.ts) — fine in development, never in production.
  const corsOrigins = (value.CORS_ORIGINS ?? '*').split(',').map((origin) => origin.trim());
  if (corsOrigins.includes('*')) {
    return helpers.message({
      custom:
        'CORS_ORIGINS must be an explicit comma-separated allowlist when NODE_ENV=production — "*" is not permitted.',
    });
  }

  return value;
});
