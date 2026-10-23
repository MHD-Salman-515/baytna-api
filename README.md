# Home Services Marketplace — Backend

Backend API for a home-services marketplace (housekeepers: cleaning, cooking, etc.) serving Syria
and Iraq — private/proprietary, not open source. Think "ride-hailing for housekeepers": each
booking goes through trip-like stages and the worker swipes to finish it. Multi-country by design
from day one: nothing about currency, phone prefixes, or locale is hardcoded — it all comes from
the `countries` collection, and every user/worker/booking references a `countryId`/`cityId`.

**Phases 1–6** (this codebase): global app setup and `countries`/`cities` reference data;
phone-OTP authentication (no passwords); worker profiles with document verification; a service
catalog with admin-defined price ranges and per-worker pricing; the booking lifecycle itself —
a customer books an approved worker for a `SCHEDULED` slot, the worker accepts and moves through
the trip, and completion recomputes the final price; and INSTANT bookings, matched by broadcasting
to nearby online workers rather than picking one directly. See "Roadmap" below for what's left.

## Tech stack

- **Framework**: NestJS (TypeScript, strict mode)
- **Database**: MongoDB via Mongoose (`@nestjs/mongoose`)
- **Config**: `@nestjs/config` with Joi env validation — fails fast on missing/invalid env vars
- **Validation**: class-validator / class-transformer, global `ValidationPipe`
  (whitelist, forbidNonWhitelisted, transform)
- **Auth**: Phone OTP (no passwords) — `@nestjs/jwt` access/refresh tokens, `libphonenumber-js`
  for E.164 normalization, OTP state in-memory (dev) or Redis (`REDIS_URL`)
- **Docs**: Swagger at `/docs` (bearer-auth aware — see "Authentication")
- **Local infra**: Docker Compose for MongoDB/Redis (optional — see "MongoDB options")
- **Quality**: ESLint + Prettier, Jest (unit tests mock Mongoose models — no live DB needed to test)

## Prerequisites

- Node.js **20.18.1** (pinned in `.nvmrc` / `package.json#engines` — `nvm use` picks it up
  automatically if you use nvm)
- A MongoDB instance — three options, pick one (see "MongoDB options" below):
  Atlas (no local install), a local MongoDB install (no Docker), or Docker Compose.

## Setup (clone to running, exact steps)

```bash
git clone <this-repo>
cd new-service
npm install

cp .env.example .env
```

Now edit `.env`:

- `MONGODB_URI` — see "MongoDB options" below for the three ways to get one
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — two *different* long random strings, e.g.
  `openssl rand -hex 32` (run it twice)
- `OTP_PEPPER` — another long random string, e.g. `openssl rand -hex 32`
- `SEED_ADMIN_PHONE` — optional, but you'll want it: a full E.164 number (e.g.
  `+963911111111`) for the seeder to create as your first ADMIN user

Then:

```bash
npm run env:check    # sanity check: everything set, no typos, nothing printed in full
npm run seed          # idempotent — safe to re-run; prints created/updated/unchanged per collection
npm run seed:verify    # confirms indexes and document counts actually exist in Mongo
npm run start:dev
```

- API base: `http://localhost:3000/api/v1`
- Swagger docs: `http://localhost:3000/docs`

## Running

Quick reference — details for each are in the sections below.

| Command | What it does |
|---|---|
| `npm run start:dev` | Run the API with hot reload |
| `npm run seed` | Seed Syria/Iraq countries + cities (idempotent) |
| `npm run seed:verify` | Confirm seeded data and indexes actually exist in Mongo |
| `npm run db:doctor` | Diagnose a MongoDB connection problem end to end |
| `npm run env:check` | Show which env vars are set/missing (values masked) |
| `npm run purge:documents` | Retention policy enforcement for departed workers' documents (dry-run by default) |
| `npm run test` | Unit tests (no live database required) |
| `npm run test:cov` | Unit tests with coverage |
| `npm run lint` | ESLint (auto-fix) |
| `npm run build` | Production build (`dist/`) |

## Authentication (Phase 2)

Phone + one-time code, no passwords. A person can hold both `CUSTOMER` and `WORKER` roles at
once (an array, not a single field) — `ADMIN` is granted only via the seeder or an existing admin.

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/otp/request` | public | `{ countryId, phone }` → sends a 6-digit code. Response never reveals whether the phone is already registered. |
| POST | `/api/v1/auth/otp/verify` | public | `{ countryId, phone, code }` → `{ accessToken, refreshToken, isNewUser, user }` |
| POST | `/api/v1/auth/refresh` | public* | `{ refreshToken }` → a new pair (old refresh token is invalidated — see "Token rotation") |
| POST | `/api/v1/auth/logout` | public* | `{ refreshToken }` → revokes that one session (204) |
| POST | `/api/v1/auth/logout-all` | Bearer | revokes every session for the caller (204) |
| GET | `/api/v1/auth/me` | Bearer | returns the current user |

\* "public" meaning: not gated by the access-token guard. `refresh` and `logout` prove ownership
via the refresh token itself (verified inside `AuthService`), not a bearer access token — so
logging out still works even if your 15-minute access token already expired.

### Reading the OTP code in dev

There's no real SMS/WhatsApp sending yet (deferred on purpose — see `OtpSender` below). In
development, `POST /auth/otp/request` logs the code to the **server console**:

```
[ConsoleOtpSender (DEV ONLY)] OTP code for +963911111111: 482913 (development mode — not actually sent)
```

Watch the terminal running `npm run start:dev` and copy the 6 digits into your `verify` call. The
sender that prints this (`StoredOtpSender`) **refuses to construct** (throws at boot) if
`NODE_ENV=production` — there is deliberately no way to accidentally ship "log the code to stdout"
as your production OTP delivery. A real `SmsSender`/`WhatsAppSender` implementing the same
`OtpSender` interface is future work.

#### Dev OTP retrieval (staging only — no console access required)

Render's free tier doesn't expose live log streaming, so the console output above is unreachable
there. `StoredOtpSender` *also* persists the most recent code per phone to `dev_otp_codes`
(plaintext, `{ phone, code, createdAt, expiresAt, consumed }`, one row per phone — upserted, not
append-only), and `GET /dev/last-otp?phone=<e164>` reads it back:

```bash
curl -s "https://your-staging-host/api/v1/dev/last-otp?phone=%2B963911111111" \
  -H "x-dev-otp-key: $DEV_OTP_ACCESS_KEY"
# { "code": "482913", "expiresAt": "2026-01-01T00:05:00.000Z" }
```

This is **structurally impossible in production**, not just disabled by default:

- `DevOtpController`'s constructor throws immediately if `NODE_ENV=production`, regardless of
  whether `DEV_OTP_ACCESS_KEY` is set — the route doesn't exist on a production boot at all, the
  same way `StoredOtpSender` itself refuses to construct there.
- The route requires `DEV_OTP_ACCESS_KEY` as an `x-dev-otp-key` header, compared with
  `crypto.timingSafeEqual` (same discipline as the OTP hash comparison and presigned storage URLs
  elsewhere in this app). No key configured, a wrong key, a missing `phone`, or no live code for
  that phone — **all four return the identical plain 404**, so the response itself never reveals
  which case happened.
- A row auto-expires via a Mongo TTL index after 15 minutes regardless of anything else (a cleanup
  safety net, independent of the OTP's own 5-minute validity window, which is what the endpoint's
  `expiresAt` filter actually checks); `verifyOtp` also flips `consumed: true` on success, so a
  code that's already been used is never handed back even inside that window.
- The plaintext code **never** appears in `/auth/otp/request`'s own response body under any
  configuration — that response has always been, and remains, `{ message: "..." }` only; this
  endpoint is the *only* way to read a code back, and only with the dedicated key.

### Rate limiting and code lifecycle

- Code: 6 digits, `crypto.randomInt` (not `Math.random`), sha256-hashed with a server-side pepper
  (`OTP_PEPPER`) before storage in the real OTP store — the plaintext code never reaches that
  store. In dev/staging it's logged and separately persisted to `dev_otp_codes` by
  `StoredOtpSender` (see "Dev OTP retrieval" above); in production it only ever exists inside
  whatever real `OtpSender` is wired in.
- TTL: 5 minutes. Single-use: verifying (success or exhausting attempts) deletes the record.
- Cooldown: 60 seconds between requests for the same phone (429 otherwise).
- Max 5 requests per phone per hour, **plus** a separate per-IP throttle on the route itself
  (`@Throttle`, layered on top of the global throttler).
- Max 5 wrong verify attempts per code, then it's invalidated outright (must request a new one) —
  constant-time comparison against the stored hash either way.
- Storage: in-memory by default (fine for one dev process); set `REDIS_URL` to use Redis instead
  — needed as soon as you run more than one instance.

### Tokens

- Access: JWT, 15 minutes, payload `{ sub, roles }`, signed with `JWT_ACCESS_SECRET`.
- Refresh: JWT, 30 days, signed with `JWT_REFRESH_SECRET` (**must differ** from the access
  secret — the Joi schema rejects boot if they match).
- **Rotation**: every `/auth/refresh` call invalidates the presented refresh token and issues a
  new one in the same "family" (`familyId`, unchanged across rotations; `jti`, unique per token).
- **Reuse detection**: if an already-rotated (or revoked) refresh token is presented again, the
  *entire family* is revoked immediately and the attempt is logged as a warning — the only way
  that happens is a token got used from two places at once (e.g. stolen).
- Refresh tokens are stored hashed (sha256) in `refresh_tokens`, with a Mongo TTL index that
  hard-deletes expired records — no soft delete here (see the comment in
  `refresh-token.schema.ts` for why that's a deliberate deviation from the usual `BaseSchema`).
- Suspended/deleted users (`User.status`) can't obtain new tokens (`otp/verify`) or refresh
  existing ones (`/auth/refresh`) — checked at both points explicitly.

### Guards: `@Public()` and `@Roles()`

`JwtAuthGuard` and `RolesGuard` are registered globally (`APP_GUARD` in `app.module.ts`) — **every
route requires a valid access token by default.** Opt out per-route:

```ts
@Public()                 // no token required at all
@Get()
findActive() { ... }

@Roles(Role.ADMIN)        // token required AND must carry the ADMIN role
@Get('admin')
findAll() { ... }
```

This replaced the Phase 1 placeholder `AdminGuard`/`x-admin-key` header entirely — admin routes on
`countries`/`cities` now require a real bearer token from a user with the `ADMIN` role, same URL
paths as before.

### Getting an admin

Set `SEED_ADMIN_PHONE=+<full E.164 number>` in `.env` before running `npm run seed` — it
idempotently creates that phone as an `ADMIN` user (or promotes it, if it already exists with
other roles), inferring the country from the number itself. Log in through the same
`otp/request` → `otp/verify` flow as anyone else; there's no separate admin login.

## Worker verification (Phase 3)

The most privacy-sensitive data in the product: national ID photos and criminal-record
certificates for women applying to work in strangers' homes. Every design choice below exists
because a leak here is a safety incident, not just a data breach.

### Worker lifecycle: signup → apply → verify → approve

1. **Signup**: anyone registers via the normal OTP flow (Phase 2) and gets `CUSTOMER` by default.
2. **Apply**: `POST /workers/me/apply` — any authenticated, `ACTIVE`, non-deleted user may call
   this. It *adds* `Role.WORKER` to her `roles` array (never replaces `CUSTOMER` — a person can be
   both) and creates a bare `WorkerProfile` in `DRAFT` if she doesn't have one yet. **Idempotent**:
   calling it again just returns her existing profile unchanged — it never resets an `APPROVED` or
   `SUSPENDED` profile back to `DRAFT`. Rejected for `SUSPENDED` or soft-deleted users. Writes a
   `WORKER_APPLIED` audit entry (once, on creation — not on a repeat call).
3. **Verify**: she fills in her profile (`POST /workers/me/profile`) and uploads documents, then
   `POST /workers/me/submit` when complete — exactly the flow described below.
4. **Approve**: an admin reviews and approves her (`POST /admin/workers/:id/review`).

**The rule that matters: holding `Role.WORKER` is not a capability, it's an application state.**
Only `verificationStatus === APPROVED` unlocks anything with a real effect — appearing in the
public list, going available, and (in later phases) setting prices, receiving bookings, going
online. This is enforced structurally by `ApprovedWorkerGuard`
(`approved-worker.guard.ts`), not scattered `if` statements — its own doc comment states that
every future worker-capability route must use it. Routes that are part of *getting* verified
(profile editing, document upload, submit) deliberately do NOT use it, since requiring approval
to become approved would be circular.

### Endpoints

Worker (role `WORKER` — except `apply`, open to any `ACTIVE` user — own profile only;
`workerProfileId` is always resolved server-side from the caller's JWT, never accepted as client
input):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/workers/me/apply` | Any `ACTIVE` user. Grants `WORKER`, creates `DRAFT` profile. Idempotent. |
| POST | `/api/v1/workers/me/profile` | Create or update. Never touches `verificationStatus` either way. |
| GET | `/api/v1/workers/me/profile` | |
| POST | `/api/v1/workers/me/documents` | multipart; fields `type`, `file`, optional `expiresAt` (required for `CRIMINAL_RECORD`) |
| GET | `/api/v1/workers/me/documents` | her own, with status — no content/download URL here (see "Access control") |
| DELETE | `/api/v1/workers/me/documents/:id` | only while her profile is `DRAFT` or `REJECTED` |
| POST | `/api/v1/workers/me/submit` | `DRAFT`/`REJECTED` → `PENDING_REVIEW`; validates all required document types are present |
| PATCH | `/api/v1/workers/me/availability` | `{ isAvailable }` — **requires `APPROVED`** (`ApprovedWorkerGuard`); rejected outright otherwise, not silently ignored |

Admin (role `ADMIN`):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/workers?status=PENDING_REVIEW` | paginated queue; omit `status` to see everything, including soft-deleted |
| GET | `/api/v1/admin/workers/:id` | full profile + document list |
| GET | `/api/v1/admin/workers/:id/documents/:docId/url` | presigned download URL, **writes a `DOCUMENT_VIEWED` audit entry first** |
| POST | `/api/v1/admin/workers/:id/documents/:docId/review` | `{ action: "approve" \| "reject", reason? }` |
| POST | `/api/v1/admin/workers/:id/review` | `{ action: "approve" \| "reject" \| "suspend", reason? }` — `reason` required when rejecting |
| GET | `/api/v1/admin/audit-logs` | filter by `action`/`actorUserId`/`targetType`/`targetId`/`from`/`to` |

Public (role `CUSTOMER`):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workers?cityId=&serviceId=` | `APPROVED` + `isAvailable` only. `serviceId` is accepted but currently a no-op — no worker-to-service relation exists until Phase 4. |
| GET | `/api/v1/workers/:id` | same filter, single worker |

Both public routes return **only** `{ id, displayName, profilePhotoUrl, bio, rating, cityId,
serviceAreas }` — see "Public projection" below.

### Verification state machine

`verificationStatus` is never client-settable — every transition goes through
`assertValidTransition` in `worker-verification.state-machine.ts`:

```
DRAFT ────submit (complete)───→ PENDING_REVIEW
REJECTED ─submit (complete)───→ PENDING_REVIEW
PENDING_REVIEW ──admin approve──→ APPROVED
PENDING_REVIEW ──admin reject───→ REJECTED
APPROVED ──admin suspend──→ SUSPENDED
SUSPENDED ──admin approve──→ APPROVED
```

Any other transition (skip review, suspend a `DRAFT`, etc.) is rejected with a 400 naming both
the attempted source and target status. "Complete" for `submit` means: every required document
type (see below) has at least one non-`REJECTED` document, and a `CRIMINAL_RECORD` document's
`expiresAt` hasn't already passed.

Required document types are configuration, keyed by country code (`DEFAULT` today, nothing
country-specific yet — see `document-requirements.config.ts`), not hardcoded in the service.

### Storage: local (dev) vs S3-compatible (prod)

Everything goes through the `FileStorage` interface (`src/modules/storage/`):

- **No object is ever publicly readable.** Reads are always a presigned URL, generated per
  request, capped at 5 minutes, never cached or stored.
- **Object keys are unguessable** — 32 random bytes, hex-encoded, no userId/phone/name/document
  type folded in (`generate-object-key.ts`).
- **LocalFileStorage** (dev default): writes to `STORAGE_LOCAL_DIR` (default `.local-storage/`,
  gitignored). There's no real presigned-URL mechanism for a local filesystem, so it fakes one the
  same way S3 does — an HMAC over `(key, expiry)` — served by a dedicated
  `GET /_storage/local-download` route that checks the signature and expiry itself.
- **S3CompatibleStorage**: activates the moment `S3_BUCKET` is set. Plain S3 API only
  (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) — Cloudflare R2, Backblaze B2, MinIO, or
  real AWS S3 all work by env change alone, nothing else.

#### R2 setup (Cloudflare)

1. Cloudflare dashboard → R2 → create a bucket. Leave it private (R2 buckets have no public
   access by default — don't enable the public-bucket URL feature).
2. R2 → Manage API Tokens → create a token scoped to that bucket (read+write).
3. Set in `.env`:
   ```
   S3_BUCKET=<your bucket name>
   S3_REGION=auto
   S3_ACCESS_KEY_ID=<from the API token>
   S3_SECRET_ACCESS_KEY=<from the API token>
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   ```
4. Restart the app — `StorageModule`'s factory picks `S3CompatibleStorage` the moment `S3_BUCKET`
   is non-empty; no code change needed either way.

### Upload validation

Every upload (`POST /workers/me/documents`) goes through, in order:

1. Size check (max 5 MB), enforced by both Multer's own limit and a service-level check.
2. **Magic-byte detection** (`detectMimeTypeFromMagicBytes`) — the client-supplied `Content-Type`
   and filename extension are never trusted; only the leading bytes decide the real type. Allowed:
   JPEG, PNG, PDF.
3. For `CRIMINAL_RECORD`: `expiresAt` is required, rejected otherwise.
4. **EXIF stripping** for JPEG/PNG (`stripImageMetadata`, via `sharp` re-encode) — removes GPS
   coordinates and all other metadata before the file ever reaches storage. (PDFs aren't
   re-encoded; EXIF is a photo-metadata concept and doesn't apply to them.)
5. SHA-256 checksum computed over the *post-strip* bytes, stored alongside the document record.
6. Upload rate limiting: 20 uploads/hour **per user** (`UploadRateLimiterService`) — not per-IP.
   It's a dedicated in-memory limiter rather than the global `@Throttle()` mechanism, because the
   global `ThrottlerGuard` runs *before* `JwtAuthGuard` (deliberately, so abusive unauthenticated
   traffic is rejected cheaply before any auth cost) — which means `request.user` isn't populated
   yet when a `@Throttle()` tracker would need it. See the comment in
   `upload-rate-limiter.service.ts`.

### Access control

- A worker can only ever act on **her own** profile/documents — every `workers/me/*` route
  resolves `workerProfileId` server-side from the JWT, never from client input. There is no route
  that accepts someone else's id.
- A `CUSTOMER` cannot reach any document data by any route — the only `@Roles(Role.CUSTOMER)`
  endpoints are the two public ones, and both return only the allowlisted projection (next
  section). Document endpoints live exclusively under `@Roles(Role.WORKER)` or
  `@Roles(Role.ADMIN)`.
- A `SUSPENDED` or soft-deleted worker disappears from the public routes immediately — both
  filter `verificationStatus: APPROVED, isAvailable: true, isDeleted: false` on every query, not
  just at write time.
- Admin reads are deliberately **not** filtered by `isDeleted`, consistent with every other admin
  read in this app (audit/recovery visibility) — admin can still review a suspended or
  soft-deleted worker's documents.

### Public projection

`toPublicWorkerProfile()` (`public-worker-projection.ts`) is a hand-written allowlist — it never
spreads its input (`{...worker}`), it names exactly 7 output fields one at a time. `phone`,
`verificationStatus`, `rejectionReason`, `reviewedBy`, `countryId`, and anything else on either the
`WorkerProfile` or `User` documents has no code path into a public response, now or if either
schema grows new fields later. `PROFILE_PHOTO` is the one document type that *does* reach a
customer — once `APPROVED`, its presigned URL is embedded as `profilePhotoUrl` in the projection
itself; there's still no route that lets a customer list or browse documents directly.

### Audit log

Append-only (`AuditLogService` exposes only `record`/`query`, nothing else, in
`audit_logs`) — `actorUserId, action, targetType, targetId, ip, userAgent, timestamp, metadata`.
**Every** admin call to the document-URL endpoint writes a `DOCUMENT_VIEWED` entry *before* the
presigned URL is generated — if the audit write fails, no URL is returned, no exceptions. Document
and worker review actions (`DOCUMENT_APPROVED`/`REJECTED`, `WORKER_APPROVED`/`REJECTED`/
`SUSPENDED`) are logged the same way. Query it via `GET /admin/audit-logs` with any combination of
filters.

### Document retention

Documents are retained for `DOCUMENT_RETENTION_DAYS` (default 90) after a worker has **left** —
defined as her `User` account reaching `status: DELETED`, or the `User` record itself being
soft-deleted — measured from whichever happened. After that window:

```bash
npm run purge:documents              # dry run — reports what WOULD be purged, changes nothing
PURGE_EXECUTE=true npm run purge:documents   # actually deletes (storage object + DB row)
```

Deletion is real, not a soft delete — see the comment on `WorkerDocumentsService#deleteOwn` for
why that's the deliberate choice for sensitive documents once there's no remaining reason to keep
them — and each one writes a `DOCUMENT_PURGED` audit entry (`actorUserId: null`: a script, not an
admin, did it).

## Service catalog and pricing (Phase 4)

**Price range, not free pricing.** An admin defines a min/max price per (service, country,
pricing model). A worker picks her own price, but it must fall inside that range — there is no
way for her to price outside it, and no way to price a service at all until an admin has opened
a range for it in her country.

### Endpoints

Public:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/services` | active services, catalog metadata only |
| GET | `/api/v1/service-pricing-rules?serviceId=&countryId=` | the admin-defined ranges — shown in the worker's price-setting UI |

Admin (role `ADMIN`), same CRUD pattern as countries/cities/services:

| Method | Path | Notes |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/v1/services/admin[/:id]` | service catalog |
| GET/POST/PUT/DELETE | `/api/v1/service-pricing-rules/admin[/:id]` | the ranges; unique per (service, country, pricingType) |
| GET | `/api/v1/admin/workers/:id/services` | read-only — a worker's own pricing, for support/disputes |

Worker (role `WORKER` + `ApprovedWorkerGuard` — offering a priced service is exactly the kind of
"going live" capability that guard exists for):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workers/me/services` | her own offerings |
| POST | `/api/v1/workers/me/services` | `{ serviceId, pricingType, hourly / bySize / fixed, currency? }` |
| PATCH | `/api/v1/workers/me/services/:id` | re-validates fully against the (possibly new) pricingType's range |
| DELETE | `/api/v1/workers/me/services/:id` | soft delete |

Public preview (role `CUSTOMER`, same as worker browsing):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/pricing/quote?workerServiceId=&estimatedHours=&roomCount=` | `{ price, currency, pricingType, hours?, roomCount? }` — **never** commission or earnings |

### Pricing model

- **HOURLY**: `{ rate, minHours }`. A quote clamps any requested estimate up to `minHours`.
- **BY_SIZE**: `{ tiers: [{ maxRooms, price }] }` — strictly ascending `maxRooms`, no duplicates.
  A tier only carries an upper bound, so "no gaps" falls out for free: every room count from 1 up
  to the top tier's `maxRooms` is covered by exactly one tier the moment the sequence is strictly
  ascending. A room count past the last tier is rejected, naming the max.
- **FIXED**: `{ price }`.
- `currency` is denormalized from her country at creation and **never editable afterwards** — not
  even via an update DTO that would accept the field (there isn't one). An explicit `currency` at
  creation must match her country's `currencyCode` exactly or the request is rejected.

Every price (the rate, each tier, the flat price) is validated against the one active
`ServicePricingRule` for `(serviceId, countryId, pricingType)` — below min, above max, and "no
rule exists at all" (she can't price a service the admin hasn't opened in her country yet) are
all rejected with a message naming the actual allowed range. This validation lives in
`WorkerServicesService`, not just in a DTO — the same full re-validation runs on update, using
whichever pricing block (existing or newly supplied) ends up matching the resulting pricingType.

### Commission and the rounding rule

Each `Service` carries its own `commissionRate` (basis points); when it's `null`, `PricingService`
falls back to the country's own `commissionRate`. Whichever rate applies:

```
commissionAmount = roundHalfUpDivide(basePrice × rateBasisPoints, 10000)
workerEarnings    = basePrice − commissionAmount
```

**Round half up**, computed as pure integer arithmetic start to finish (see
`round-half-up-divide.ts`): the quotient comes from one float division (safe for any integers
within `Number.MAX_SAFE_INTEGER`), but the rounding decision itself is an exact integer comparison
(`remainder × 2 >= denominator`), never a float comparison that could be thrown off near the .5
boundary. `workerEarnings` is defined as `basePrice − commissionAmount`, not independently
rounded, so the two **always** sum to `basePrice` exactly — proven for a 500-sample random spread
in `round-half-up-divide.spec.ts`, not just a couple of hand-picked cases.

`PricingService` (`src/modules/pricing/`) is the **only** place this arithmetic exists for a
pre-booking estimate — `BookingsService.create` (Phase 5) calls `quote()` to freeze a booking's
pricing snapshot rather than reimplementing it. The full internal `Quote` carries
`commissionAmount`/`workerEarnings`; `toCustomerQuotePreview()` strips both before anything reaches
`GET /pricing/quote` — same allowlist discipline as the public worker projection, applied here
too, since commission/earnings are exactly the kind of internal-to-the-platform figures that
section already treats as never-customer-facing.

`PricingService.recomputeFinal()` exists but, in the end, **Phase 5's completion flow does not
call it** — see "Why completion doesn't call `PricingService.recomputeFinal()`" in the Phase 5
section below for why that turned out to matter.

### Public discovery

The public worker projection (`toPublicWorkerProfile`) gained one more allowlisted field:
`services: [{ serviceId, serviceName, pricingType, displayPrice, currency }]` —
`displayPrice` is the rate (HOURLY), the cheapest/"starting from" tier (BY_SIZE), or the flat price
(FIXED); see `getDisplayPrice()`. Commission rate and worker earnings have no code path into this
either. `GET /workers` now has `serviceId` as a real filter (only workers who actively offer that
service) and `sortBy=price` (only meaningful together with `serviceId` — it's that service's
price): sorting by a specific service's price can't be expressed as a Mongo-level sort on
`WorkerProfile` (the price lives in a different collection), so it's resolved in memory instead —
fine at today's scale, worth revisiting with an aggregation pipeline if the catalog or worker count
grows enough for "fetch every match unpaginated" to become a real cost.

## Bookings (Phase 5)

The heart of the product: a customer books an approved worker for a specific service, the worker
accepts and moves through the trip, and completion settles the final price. Only `SCHEDULED`
bookings are creatable in this phase — `INSTANT` exists on the enum and the schema's `type` field
now so Phase 6 adds a new matching path, not a migration (see "The Phase 6 matching seam" below).

### The trip (state machine)

```
PENDING_WORKER --accept--> ACCEPTED --on-the-way--> ON_THE_WAY --arrived--> ARRIVED --start--> IN_PROGRESS --complete--> COMPLETED
      |                        |                        |                     |
      |--reject--> REJECTED    |--cancel (worker)--> CANCELLED <--cancel (worker/customer)--|
      |
      |--expire (system, sweep)--> EXPIRED

Any of PENDING_WORKER / ACCEPTED / ON_THE_WAY / ARRIVED / IN_PROGRESS --admin force-status--> CANCELLED
Any of ACCEPTED / ON_THE_WAY / ARRIVED / IN_PROGRESS            --admin force-status--> NO_SHOW
```

`src/modules/bookings/booking.state-machine.ts` is the single source of truth: an explicit table of
`{ from: Status[], to: Status, actor }` per action (`ACCEPT`, `REJECT`, `ON_THE_WAY`, `ARRIVED`,
`START`, `COMPLETE`, `CUSTOMER_CANCEL`, `WORKER_CANCEL`, `ADMIN_FORCE_CANCELLED`,
`ADMIN_FORCE_NO_SHOW`, `EXPIRE`). `assertValidAction(currentStatus, action, actor)` throws
`ForbiddenException` for a role mismatch (a customer attempting a worker-only action) and
`BadRequestException` — naming both the current status and the attempted target status — for an
illegal transition from the right actor. Every status-changing method in `BookingsService` goes
through it; nothing sets `status` directly. Exhaustively tested: every `(action, status)` pair,
plus every wrong-actor combination, in `booking.state-machine.spec.ts`.

A customer may cancel from `PENDING_WORKER`/`ACCEPTED`/`ON_THE_WAY`/`ARRIVED` (not once
`IN_PROGRESS` — the job has started). A worker may cancel from `ACCEPTED`/`ON_THE_WAY`/`ARRIVED`
only — declining before accepting is `REJECT`, not a cancellation.

### Endpoints

Customer (role `CUSTOMER`):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/bookings` | validates eligibility, availability, and overlap; freezes the pricing snapshot; never accepts a price from the client |
| GET | `/api/v1/bookings` | her own only, filterable by `status`, paginated |
| GET | `/api/v1/bookings/:id` | her own only |
| POST | `/api/v1/bookings/:id/cancel` | `{ reason }` — fee computed per the country's cancellation policy |
| GET | `/api/v1/workers/:id/slots?date=YYYY-MM-DD` | free windows for the picker — her availability windows minus existing bookings (+ buffer) |

Worker (role `WORKER` + `ApprovedWorkerGuard`, own bookings only):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workers/me/bookings` | filterable by `status` |
| POST | `/api/v1/workers/me/bookings/:id/accept` | |
| POST | `/api/v1/workers/me/bookings/:id/reject` | `{ reason }` |
| POST | `/api/v1/workers/me/bookings/:id/on-the-way` | |
| POST | `/api/v1/workers/me/bookings/:id/arrived` | |
| POST | `/api/v1/workers/me/bookings/:id/start` | sets `startedAt` |
| POST | `/api/v1/workers/me/bookings/:id/complete` | the "swipe to finish" action — recomputes `finalPricing` for `HOURLY` from actual elapsed time |
| POST | `/api/v1/workers/me/bookings/:id/cancel` | `{ reason }` — no fee charged to the customer, but recorded |
| GET/PUT | `/api/v1/workers/me/availability-windows` | full replace — weekly recurring windows + per-date overrides |

Admin (role `ADMIN`):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/bookings` | full filters (`status`, `type`, `customerId`, `workerProfileId`, `countryId`), paginated |
| GET | `/api/v1/admin/bookings/:id` | |
| POST | `/api/v1/admin/bookings/:id/force-status` | `{ status: CANCELLED \| NO_SHOW, reason }` — always audit-logged (`BOOKING_FORCE_CANCELLED`/`BOOKING_FORCE_NO_SHOW`) |

### Creating a booking

`BookingsService.create` validates, in order: the worker is `APPROVED` + available (the same
visibility gate `PricingService` uses — a customer can never book a worker she couldn't otherwise
see, and the error never reveals which check actually failed); the requested `cityId` is one of
her `serviceAreas`; the service is active in her country; `scheduledFor` is in the future and
within the country's `bookingPolicy.bookingHorizonDays`; the job fits entirely inside one of her
available windows for that date (in her country's timezone — see "Worker availability windows"
below); and it doesn't overlap any of her existing non-terminal bookings once each is expanded by
`bookingPolicy.interBookingBufferMinutes` on both sides (a travel buffer between jobs). Only then
does it call `PricingService.quote()` and freeze the result into the booking — a later change to
her price or the service's commission can never retroactively change this booking.
`responseDeadline` is `now + bookingPolicy.responseDeadlineHours`, capped at `scheduledFor` itself
(never later than the job).

### Worker availability windows

`WorkerAvailability` (one document per worker) holds `weeklyWindows: [{ dayOfWeek, startTime,
endTime }]` (recurring) and `dateOverrides: [{ date, type: BLOCKED | EXTRA, startTime?, endTime?
}]` (exceptions). An override always **replaces** the weekly pattern for that date rather than
merging with it — `BLOCKED` means no windows at all that day; `EXTRA` means exactly the one window
given, instead of whatever the weekly pattern would say. `GET/PUT /workers/me/availability-windows`
replaces the whole set at once. `WorkerAvailabilityService.getWindowsForDate` resolves a date to
UTC instants using `luxon` and the worker's **country timezone** (`Country.timezone`, an IANA name
like `Asia/Damascus`) — never server local time, which matters the moment the server and a
customer aren't in the same zone.

`GET /workers/:id/slots?date=` (customer-facing picker) takes those windows and subtracts her
existing non-terminal bookings — each expanded by the buffer — via `subtractBusyIntervals`, a pure
interval-arithmetic helper, returning the disjoint free remainder.

### Expiry

A periodic sweep (`BookingExpiryService`) `EXPIRE`s any `PENDING_WORKER` booking past its
`responseDeadline`, registered through `@nestjs/schedule`'s `SchedulerRegistry` (not the static
`@Interval()` decorator) specifically so the cadence and the on/off switch come from config:
`BOOKING_EXPIRY_SWEEP_ENABLED` (default `true`) and `BOOKING_EXPIRY_SWEEP_INTERVAL_SECONDS`
(default `300`). The sweep is **claim-then-update, not read-then-write**: it only uses `find()` to
discover candidates, then flips each one individually via
`updateOne({ _id, status: PENDING_WORKER }, { status: EXPIRED })` — the status is re-checked
inside that same atomic update filter, so if two instances (or two overlapping ticks) race the same
booking, at most one `updateOne` actually matches; the other matches zero documents instead of
double-expiring anything or throwing. Safe to run concurrently or back-to-back.

### Cancellation policy

Data-driven per country (`Country.bookingPolicy`, admin-editable via `PUT /countries/admin/:id` —
**not** hardcoded in the bookings module):

- Customer cancels **more than** `freeCancellationHours` before `scheduledFor` → no fee.
- Customer cancels at or inside that window → a fee of `cancellationFeeBasisPoints` of
  `pricing.basePrice` (same `roundHalfUpDivide` used for commission — see Phase 4). The boundary
  itself belongs to the fee side, not the free side.
- Worker cancels after accepting → **no fee charged to the customer**, but it's still recorded
  (`cancellation.byRole = WORKER`, `feeAmount: 0`) — feeds her reliability score in a later phase.
- The fee is only ever computed and persisted on `booking.cancellation.feeAmount`. **No money
  moves in this phase** — the wallet arrives in Phase 8.

### Pricing snapshot, `finalPricing`, and why completion doesn't call `PricingService.recomputeFinal()`

`booking.pricing` is frozen at creation from `PricingService.quote()` — `pricingType`, estimated
`hours`/`roomCount`, `basePrice`, the commission rate/amount actually applied, `workerEarnings`,
`currency`, and (HOURLY only) the `hourlyRate`/`minHours` **in effect at that moment**. On
`complete()`, `finalPricing` is computed:

- `BY_SIZE`/`FIXED`: the original snapshot, unchanged.
- `HOURLY`: actual elapsed time (`completedAt - startedAt`), clamped up to the frozen `minHours`,
  multiplied by the **frozen** `hourlyRate` — never the worker's current `WorkerService` rate.

This final step deliberately does **not** call `PricingService.recomputeFinal()`, even though that
method exists and was built in Phase 4 specifically anticipating this call. Two reasons surfaced
while implementing it: `recomputeFinal()` re-fetches the worker's *current* `WorkerService` rate
(breaking the "a later rate change must never alter an existing booking" guarantee — for the final
price, not just the estimate) and re-checks `isAvailable` via the same gate `quote()` uses (a
worker very plausibly toggles herself unavailable while she's out doing the job she's completing,
which would then wrongly block her own completion). `compute-final-pricing.ts` instead works
**only** from what's already frozen on the booking — no live lookups at all — which is both simpler
and the actually-correct behavior here.

### Access control and the status-dependent projection

A customer's booking list/detail query is scoped by `customerId` in the query itself (never
fetch-then-filter); a worker's by `workerProfileId`. Until a booking has been `ACCEPTED` **at least
once** (`acceptedAt !== null`) — not merely "is it currently in an accepted-ish status" — the
customer never sees the worker's phone, and the worker sees only the city and the `landmark`, never
the map pin, the free-text address, the floor, or any notes. Once accepted, both stay revealed even
through a later cancellation (they really did already connect). Admin always sees everything.
Pricing is projected per viewer too: the customer sees what she pays (`basePrice`), the worker sees
her own cut (`workerEarnings`), neither sees the commission rate/amount; admin sees the full
breakdown. All of this is one allowlist function, `booking-projection.ts#toBookingView` — same
hand-written-object-literal discipline as the Phase 3/4 public worker projection, tested in
`booking-projection.spec.ts` for every viewer × before/after-acceptance combination.

### The Phase 6 matching seam

The customer picks the worker directly in this phase (via `workerServiceId`), so "who gets this
booking" is trivial — but it's still behind an interface,
`BookingAssignmentStrategy.resolveWorker()`, with `DirectAssignmentStrategy` as the only
implementation `BookingsService.create` uses for `SCHEDULED`. Phase 6 adds a
`NearestAvailableAssignmentStrategy` for `INSTANT` (searching nearby available workers) as a
sibling implementation — `BookingsService`'s call site doesn't change, only which strategy gets
selected for which `BookingType`.

### New environment variables

| Var | Default | Notes |
|---|---|---|
| `BOOKING_EXPIRY_SWEEP_ENABLED` | `true` | set `false` to disable the periodic sweep on an instance |
| `BOOKING_EXPIRY_SWEEP_INTERVAL_SECONDS` | `300` | how often the sweep runs |

(The booking horizon, response deadline, inter-booking buffer, and cancellation-fee policy are
**not** env vars — they're per-country, data-driven fields on `Country.bookingPolicy`; see
"Cancellation policy" above.)

### Tests

`booking.state-machine.spec.ts` (every transition × every actor), `bookings.service.spec.ts`
(creation validation, pricing-snapshot immutability, every lifecycle transition, cancellation fees
at both sides of the policy boundary, admin force-status + audit log), `compute-final-pricing.spec.ts`
(HOURLY recompute, minHours enforcement, immutability to a later rate), `booking-projection.spec.ts`
(phone/address revealed/hidden per viewer × acceptance state), `worker-availability.service.spec.ts`
(window validation, timezone-correct UTC resolution), `subtract-busy-intervals.spec.ts` (interval
arithmetic), and `booking-expiry.service.spec.ts` (idempotent, safe under a simulated concurrent
claim). See "Phase 5 — what shipped, and what didn't" under "Roadmap" below for what's deliberately
deferred.

## Instant bookings and broadcast matching (Phase 6)

`POST /bookings` with `type: INSTANT` skips the worker picker entirely — the customer names a
*service*, not a worker, and the job starts now (no `scheduledFor`). Finding a worker is a
broadcast: the request goes out to every eligible worker inside the current radius at once: first
to accept wins, everyone else gets a neutral "already taken". If nobody accepts in time, the radius
expands and it broadcasts again, up to a total time budget.

### Worker presence — a new concept

`WorkerProfile.isAvailable` is a stated intent ("I'm open for work in general"); it was never
enough on its own to receive a live broadcast. `WorkerPresence` (one document per worker) tracks
what actually matters right now:

- `isOnline` — she opened the app and explicitly went online.
- `lastLocation` — a GeoJSON Point, `2dsphere`-indexed.
- `lastHeartbeatAt` — last time her location was refreshed.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workers/me/presence` | her own current presence |
| POST | `/api/v1/workers/me/presence/online` | `{ location }` — sets `isOnline: true` + a fresh heartbeat |
| POST | `/api/v1/workers/me/presence/offline` | immediate — `isOnline: false` right away, dropping her out of the next broadcast wave with no further action needed |
| POST | `/api/v1/workers/me/presence/heartbeat` | `{ location }` — refreshes location + `lastHeartbeatAt`; rejected if she never went online |

A worker is **eligible** for one broadcast wave only when every one of these holds: `APPROVED`,
`isAvailable`, `isOnline`, `lastHeartbeatAt` within `instantMatchingPolicy.heartbeatStalenessSeconds`,
she has an active offering for the requested service, the requested city is one of her
`serviceAreas`, she's within the wave's radius of the job's location, and she has no other booking
in `ACCEPTED`/`ON_THE_WAY`/`ARRIVED`/`IN_PROGRESS` right now (a `PENDING_WORKER` SCHEDULED request
she hasn't responded to yet does **not** count as busy — she hasn't committed to it).
`WorkerPresenceService.findEligibleCandidates` runs the `$geoNear` + online/heartbeat/exclude-list
query and intersects it with her profile/offering eligibility; `InstantMatchingService` applies the
busy-booking filter on top (the presence module has no access to the Booking model, to avoid a
circular import back into `bookings`).

### New statuses

`SEARCHING` (a broadcast is in progress — INSTANT's starting status, taking the place of
`PENDING_WORKER`) and `NO_WORKER_FOUND` (terminal — nobody accepted before the total timeout).
Added to the same explicit transition table as Phase 5, with two new actions:
`ACCEPT_OFFER` (`SEARCHING -> ACCEPTED`, worker) and `EXHAUST_SEARCH` (`SEARCHING ->
NO_WORKER_FOUND`, system) — `CUSTOMER_CANCEL` now also accepts `SEARCHING`. Exhaustively
re-verified across every `(action, status)` pair, same as Phase 5.

### Why `workerProfileId`/`workerServiceId`/`pricing` had to become nullable

An INSTANT booking is created with none of the three known — there's no worker yet, so there's no
specific `WorkerService` to quote against, so there's no price to freeze. All three stay `null`
until a worker actually wins (`BookingsService.acceptOffer`), at which point they're resolved and
frozen exactly the way SCHEDULED does it at creation. `scheduledFor` and `responseDeadline` stay
`null` for INSTANT entirely — there's no planned time, and the expiry sweep (which only ever
queries `status: PENDING_WORKER`) never touches an INSTANT booking. From `ACCEPTED` onward an
INSTANT booking is structurally identical to a SCHEDULED one — completion's HOURLY recompute
(`compute-final-pricing.ts`) needed **zero** changes to support it.

### The broadcast: waves, radius, and offers

`Country.instantMatchingPolicy` (admin-editable, data-driven — not hardcoded):

| Field | Default | Meaning |
|---|---|---|
| `radiusStepsMeters` | `[3000, 6000, 10000]` | progressive broadcast radii, nearest first |
| `waveTimeoutSeconds` | `20` | how long one wave waits before expanding |
| `totalRequestTimeoutSeconds` | `90` | total budget before `NO_WORKER_FOUND` |
| `heartbeatStalenessSeconds` | `120` | max heartbeat age to stay eligible |

`InstantMatchingService.startSearch` broadcasts wave 0 right after the booking is persisted.
`broadcastWave` deduplicates against every `BookingOffer` already on record for that booking (one
offer per worker per booking, enforced by a unique index) — a worker who saw an earlier wave is
never re-notified, but once the radius steps are exhausted, later ticks keep re-broadcasting at the
same max radius to catch anyone newly eligible since the last tick (just came online, etc.). Each
`BookingOffer` records `bookingId`, `workerProfileId`, `workerServiceId`, `wave`, `radiusMeters`,
`distanceMeters`, a price preview (`estimatedPrice`/`estimatedWorkerEarnings`/`currency`, computed
fresh per candidate against *her own* offering), `sentAt`, and an `outcome`
(`PENDING`/`WON`/`LOST`/`STALE`) — operational data for debugging and measuring match quality
("workers complain they never get requests"). A `LOST` outcome is **never** treated as a rejection
against her stats anywhere in this codebase — she lost a race for a job she never actually turned
down.

### Race safety: exactly one worker wins

`BookingsService.acceptOffer` is a single atomic `findOneAndUpdate` with
`{ status: SEARCHING, workerProfileId: null }` in the filter — never read-then-write. Exactly one
concurrent caller's update matches the document; every other caller's update matches zero
documents, and gets back a neutral `409 Conflict` — *"This request was accepted by another
provider"* — that never implies she did anything wrong. Only the winner proceeds to resolve her own
`WorkerService` for the booking's service, freeze pricing fresh via `PricingService.quote()` (never
the offer's price preview — that was only ever a display estimate), and mark every offer resolved
(`resolveOffers`: the winner's own offer `WON`, everyone else's still-`PENDING` offer `LOST`).
Proven with a test that fires N concurrent `acceptOffer` calls at one booking and asserts exactly
one resolves and the booking ends up with exactly one `workerProfileId`.

### Timers: the matching sweep

Same approach as Phase 5's expiry sweep — a periodic sweep via `@nestjs/schedule`'s
`SchedulerRegistry` (`InstantMatchingSweepService`), not in-process `setTimeout` (dies with the
process, doesn't coordinate across instances), claim-then-update throughout: expanding to the next
wave re-checks the *old* `currentWaveIndex` in the same atomic update that bumps it, and the move to
`NO_WORKER_FOUND` re-checks `status: SEARCHING` in the same update that changes it — so two sweep
ticks (same instance or different instances) racing the same booking can't both apply.
`BOOKING_INSTANT_SWEEP_ENABLED` / `BOOKING_INSTANT_SWEEP_INTERVAL_SECONDS` (default `5s` —
deliberately more frequent than the expiry sweep's `300s`, since wave timeouts can be as short as
~20s).

### Pending offers and the pre-acceptance projection

`GET /workers/me/offers` (polling, not push — see "Notifications" below) returns her own `PENDING`
offers, each projected through `toOfferView`: service, its name, estimated duration, the price
preview (both `estimatedPrice` and `estimatedWorkerEarnings`), currency, an **approximate**
distance (rounded to the nearest 500m — never her precise geo-matched distance), the city, and the
landmark. Same allowlist discipline as `toBookingView` — and the same restriction: **never** the
customer's phone or exact address before she accepts. `POST /workers/me/offers/:bookingId/accept`
calls `acceptOffer`.

### Notifications: the Phase 7 seam

Workers need to learn an offer exists. This phase deliberately does **not** build push
notifications — `BookingNotifier` is an interface with one implementation, `LogNotifier`, which
just logs what would have been sent. The whole broadcast flow is fully testable end to end right
now via the polling endpoint above; Phase 7 (see "Realtime" below) adds a real push/websocket
implementation behind the same interface (bound via the `BOOKING_NOTIFIER` DI token in
`bookings.module.ts`) — nothing in `InstantMatchingService` changes when it does.

### Cancellation during SEARCHING

A customer may cancel while `SEARCHING` with **no fee** — no worker was ever committed — which
immediately stops the broadcast (the sweep only ever acts on bookings still in `SEARCHING`) and
marks every outstanding offer `STALE` so a worker who still has it open sees it's no longer
actionable. If an INSTANT booking cancels *after* being matched (`ACCEPTED`+), it's treated as
"inside the cancellation window" by default — there's no `scheduledFor` to measure against; the job
is either happening now or about to.

### Endpoints added in this phase

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/workers/me/presence` | WORKER + Approved | her own presence |
| POST | `/api/v1/workers/me/presence/online` | WORKER + Approved | `{ location }` |
| POST | `/api/v1/workers/me/presence/offline` | WORKER + Approved | immediate |
| POST | `/api/v1/workers/me/presence/heartbeat` | WORKER + Approved | `{ location }` |
| GET | `/api/v1/workers/me/offers` | WORKER + Approved | pending INSTANT offers |
| POST | `/api/v1/workers/me/offers/:bookingId/accept` | WORKER + Approved | atomic claim |

(`POST /bookings` and the rest of the booking lifecycle are unchanged routes — only `type: INSTANT`
is new input to the existing endpoint.)

### New environment variables

| Var | Default | Notes |
|---|---|---|
| `BOOKING_INSTANT_SWEEP_ENABLED` | `true` | set `false` to disable the wave/timeout sweep on an instance |
| `BOOKING_INSTANT_SWEEP_INTERVAL_SECONDS` | `5` | how often the sweep runs |

(The radius steps, wave timeout, total timeout, and heartbeat staleness window are **not** env vars
— they're per-country, data-driven fields on `Country.instantMatchingPolicy`, same reasoning as
`bookingPolicy` in Phase 5.)

### Tests

`booking.state-machine.spec.ts` (the two new actions × every status), `bookings.service.spec.ts`
(INSTANT creation, `acceptOffer` atomicity including the N-concurrent-callers test, `listPendingOffersForWorker`,
no-fee SEARCHING cancellation), `instant-matching.service.spec.ts` (wave broadcast, busy-worker
exclusion, dedup, the unique-index-race skip path), `instant-matching-sweep.service.spec.ts` (wave
expansion, the total-timeout path taking precedence, idempotent under a simulated concurrent
claim), `worker-presence.service.spec.ts` (the `$geoNear` query shape, eligibility intersection),
`offer-projection.spec.ts` (allowlist leak-prevention), and `booking-projection.spec.ts` (nullable
pricing/worker handled without throwing).

claim). See "Phase 6 — what shipped, and what didn't" under "Roadmap" below for what's deliberately
deferred.

## Realtime: push notifications, live tracking, and the WebSocket layer (Phase 7)

### Three delivery layers, deliberately redundant

Workers are on budget Android devices with aggressive background battery management — push can
arrive minutes late or not at all. So there are three layers, and **polling never stops working**:

1. **Push (FCM)** — reaches a closed app. Primary channel for "you have a new offer."
2. **WebSocket** — authoritative while the app is open; faster than push, no battery-manager delay.
3. **Polling** — every Phase 5/6 endpoint (`GET /workers/me/offers`, `GET /bookings/:id`, ...) still
   works exactly as before. Every event in this phase is reconstructible from a plain HTTP fetch;
   push and sockets only accelerate delivery, they are never the only source of truth. Turn off
   push and sockets entirely (`NOTIFICATION_PUSH_PROVIDER` doesn't matter if nothing's listening,
   and no client connects a socket) and the booking lifecycle is unaffected — same statuses, same
   offers, same transitions, just discovered a little later by whoever's polling.

### The notification pipeline: one seam, one shared pipeline

`BookingNotifier` (the Phase 6 seam) is unchanged in shape — `notifyOffer`'s signature and its only
call site (`InstantMatchingService`) are untouched — but now also exposes a generic `notify(event)`
for every other event type. `BaseNotifier` holds the entire shared pipeline (mute-list check,
quiet-hours check, localization, socket emission, push delivery, an append-only `NotificationLog`
entry for every channel attempted on every event); `LogNotifier` and `FcmNotifier` differ only in
how `sendPush` actually transmits. `createBookingNotifier` (a factory provider, not a class
binding) constructs whichever one `NOTIFICATION_PUSH_PROVIDER` selects **by hand** — so
`FcmNotifier`'s constructor, and any Firebase credential requirement, never runs unless that
provider is explicitly `fcm`. `log` (the default, in dev and in the test suite) requires no
Firebase setup at all.

The full event catalogue (`NotificationEventType`):

| Event | Recipient | Trigger |
|---|---|---|
| `BOOKING_ACCEPTED` | customer | worker/offer acceptance (`accept`, `acceptOffer`) |
| `WORKER_ON_THE_WAY` | customer | `onTheWay` |
| `WORKER_ARRIVED` | customer | `arrived` |
| `JOB_STARTED` | customer | `start` |
| `JOB_COMPLETED` | customer | `complete` |
| `BOOKING_CANCELLED` | the other party | `cancelByCustomer`/`cancelByWorker`/admin `forceStatus` (CANCELLED) |
| `NO_WORKER_FOUND` | customer | `InstantMatchingSweepService`'s total-timeout path |
| `NEW_OFFER` | worker | every `InstantMatchingService.broadcastWave` candidate |
| `OFFER_TAKEN` | every losing worker | `InstantMatchingService.resolveOffers` |
| `SCHEDULED_REMINDER` | worker | `ScheduledReminderSweepService`, `reminderLeadMinutes` before `scheduledFor` |

### Push delivery: FCM, OneSignal, multi-device, locale, and dead tokens

Three interchangeable `BookingNotifier` implementations behind the exact same
`NOTIFICATION_PUSH_PROVIDER` config switch — `log` (default), `fcm`, or `onesignal`. FCM isn't
reliably reachable in every market this app serves; OneSignal has been separately verified to
work there, so it's a config choice rather than a replacement — `FcmNotifier` stays in the
codebase either way, and switching providers later is changing one env var, not a rewrite.

`DeviceToken` (one row per install, upserted **by token alone** — a reinstall or account switch
just transfers ownership of that row): `userId`, `token`, `platform`, `appVersion`, `locale`,
`lastSeenAt`, `isActive`. `token` is deliberately provider-agnostic in the schema — for an
FCM-registered device it's an FCM registration token; for a OneSignal-registered device it's a
OneSignal player/subscription id. The client always registers it through the same
`POST /users/me/device-tokens`; nothing provider-specific lives in the schema or that endpoint —
only the notifier that eventually reads `token` back out knows which provider's id it is.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/users/me/device-tokens` | her own active tokens |
| POST | `/api/v1/users/me/device-tokens` | register (upsert by token) |
| POST | `/api/v1/users/me/device-tokens/refresh` | same operation, different client intent |
| DELETE | `/api/v1/users/me/device-tokens` | `{ token }` — unregister |

`POST /auth/logout` also accepts an optional `deviceToken` and deactivates it — a device that logs
out stops receiving push for that account immediately, without waiting for FCM to tell us it's gone.

Every active token for a user gets the push (multi-device). `FcmNotifier.sendPush` calls
`admin.messaging().sendEachForMulticast`; a response of `messaging/invalid-registration-token` or
`messaging/registration-token-not-registered` for a given token auto-deactivates it via
`DeviceTokensService.deactivateToken` (never scoped by user — FCM telling us a token is dead is
true regardless of whose it was) — a stale token fails once, then stops being retried forever. The
Firebase Admin app itself is lazily initialized on the *first* send, not at boot, and only when
`FcmNotifier` is actually constructed (i.e. `NOTIFICATION_PUSH_PROVIDER=fcm`).

`OneSignalNotifier.sendPush` posts to `onesignal.com/api/v1/notifications` with
`include_player_ids` set to the recipient's tokens. OneSignal reports dead ids differently from
FCM: a response can come back **200 OK** with `errors.invalid_player_ids` listing just the
specific ids that are no longer subscribed (the rest were still sent) — those, and only those,
get deactivated. If instead the *entire* batch is dead, OneSignal responds with an HTTP error
whose `errors` array is a flat list of human-readable strings (no per-id detail at all,
e.g. `"All included players are not subscribed"`) — `OneSignalNotifier` deactivates every id in
that batch only when the message text actually says so; any other failure (bad app id, rate
limit, ...) is logged as an ordinary failed delivery attempt with no deactivation, since it says
nothing about whether any individual token is still valid.

**Payload safety**: a push/socket payload is built from `NotificationCopy` — `title`, `body`
(localized ar/en via hand-written templates per event type, chosen from `User.locale`), and a
`data` field that is **always exactly** `{ type, bookingId }`. `BookingNotificationEvent.context`
(the only input the templates render from) is deliberately shaped with no address, phone, document,
or commission field to leak — there is nothing sensitive for a template to accidentally include,
and `notification-localization.spec.ts` asserts this even when a caller tries to stuff one in.

`User.locale` (`ar`/`en`, default `ar` — both current markets are Arabic-first) is the single
source of truth for localization; `PATCH /api/v1/users/me/locale` lets a user change it.

### Notification preferences and quiet hours

`NotificationPreference` is created **lazily** — no row until she customizes something; everyone
else gets the all-enabled defaults (`channels: { push: true, socket: true }`, `quietHours.enabled:
false`).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/users/me/notification-preferences` | defaults if never customized |
| PUT | `/api/v1/users/me/notification-preferences` | partial update, merged onto the current row |
| GET | `/api/v1/admin/notification-logs` | ADMIN — every delivery attempt, for "workers never get requests" complaints |

`mutedTypes` suppresses a type on **every** channel unconditionally — a user who's muted
`SCHEDULED_REMINDER` never gets one, full stop. Quiet hours are different: they suppress only
`SCHEDULED_REMINDER` (the one type in `isUrgentNotificationType`'s complement) and **never**
anything about an active booking — `BOOKING_ACCEPTED`/`WORKER_ON_THE_WAY`/.../`OFFER_TAKEN` always
go through regardless of the hour. The window itself is evaluated in the recipient's **country**
timezone (`isWithinQuietHours`, same `luxon` discipline as worker availability windows in Phase 5),
not server local time, and correctly handles an overnight window (e.g. `22:00`–`07:00`).

Every suppressed or failed attempt still gets a `NotificationLog` row (`outcome: SUPPRESSED` or
`FAILED`) — a muted/quiet-hours gap in delivery is visible in the log, not silent.

### WebSocket layer

`RealtimeGateway` authenticates a connecting socket with the **same** JWT verification
`JwtAuthGuard` uses (`jwtAccessSecret`, Bearer token from `handshake.auth.token` or an
`Authorization` header) — an unauthenticated socket is disconnected immediately, never left open.
Every authenticated socket auto-joins a per-user room (`user:<userId>`); a booking's room
(`booking:<bookingId>`) is joined only via `booking:join`, which re-checks
`BookingsService.isPartyToBooking` **on every join**, not just once at connection time — a customer
or worker may only ever join rooms for bookings they're actually a party to (tested explicitly:
joining someone else's user room isn't possible at all since rooms are server-assigned, and joining
an unrelated booking's room is rejected). **A socket connecting, by itself, changes nothing about
Phase 6 matching eligibility** — that's still `WorkerPresence` + explicit `online`/`heartbeat` calls.

Socket event catalogue:

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `booking:join` | `{ bookingId }` | re-checked per join |
| C→S | `booking:leave` | `{ bookingId }` | |
| C→S | `location:update` | `{ bookingId, point }` | worker only — see "Live tracking" |
| S→C | `booking:statusChanged` | `{ bookingId, title, body, data }` | recipient's **user** room; ACCEPTED/ON_THE_WAY/ARRIVED/STARTED/NO_WORKER_FOUND |
| S→C | `booking:completed` | ″ | user room |
| S→C | `booking:cancelled` | ″ | user room |
| S→C | `booking:reminder` | ″ | user room |
| S→C | `offer:new` | ″ | the worker's user room |
| S→C | `offer:taken` | ″ | the losing worker's user room |
| S→C | `location:update` | `{ bookingId, point, recordedAt }` | the **booking's** room (both parties) |

Rate limiting, two layers: `RealtimeGateway` keeps an in-process, per-connection,
per-message-type timestamp map (cleared on disconnect) that rejects a flood **before** it ever
reaches the database — cheap, but only correct for a single instance/connection. On top of that,
`LocationTrackingService.recordPoint`'s own throttle (see below) is the authoritative, state-based
check, correct across reconnects and multiple instances. Both read the same
`LOCATION_UPDATE_MIN_INTERVAL_SECONDS`.

**Horizontal scaling**: with more than one instance behind a load balancer, a `server.to(room).emit()`
issued on instance A never reaches a socket connected to instance B — by default, socket.io's
adapter is purely in-memory per process. `RedisIoAdapter` (wired in `main.ts`, behind
`WEBSOCKET_REDIS_ADAPTER_ENABLED`, reusing the same `REDIS_URL` `RedisOtpStore` uses) attaches
`@socket.io/redis-adapter` so every emit fans out across instances via Redis pub/sub. **Off by
default and not required in development** — a single instance works fine with socket.io's built-in
in-memory adapter.

### Live tracking

A worker's position is tracked **only** while her booking is `ON_THE_WAY`, `ARRIVED`, or
`IN_PROGRESS` — enforced structurally in `LocationTrackingService.recordPoint` (it re-reads the
real booking document and checks `status` there), not left as a client-side convention. Every other
status rejects the point with `reason: 'not_active'` — tested for all nine other statuses. A point
is also rejected if it arrives before `LOCATION_UPDATE_MIN_INTERVAL_SECONDS` has elapsed since the
last accepted one for that booking.

`BookingLocationTrail` — one document per booking, created lazily on the first accepted point.
`points` is capped at `LOCATION_TRAIL_MAX_POINTS` via `$push`+`$slice`, so it's always downsampled
to the most recent points, never an unbounded history of a long job. On every terminal transition
(`complete`, `cancelByCustomer`, `cancelByWorker`, admin `forceStatus`), `markTerminated` sets
`terminatedAt`; `LocationTrailPurgeSweepService` (same `SchedulerRegistry` sweep pattern as every
other sweep in this codebase) deletes a trail once `LOCATION_TRAIL_RETENTION_HOURS` has passed since
then — long enough to investigate a no-show dispute shortly after the booking ends, never kept
indefinitely.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/bookings/:id/location` | CUSTOMER | her own booking only (`getOwnForCustomer`'s existing ownership check) — current position + a rough ETA |

The ETA is deliberately simple: haversine distance from the worker's last reported point to
`booking.address.point`, divided by an assumed ~30 km/h. It's meant to say "about 10 minutes," not
to be a routing engine. At the `ON_THE_WAY → ARRIVED` transition, `BookingsService.arrived` records
the haversine distance between her last reported point and the booking address
(`arrivalDistanceMeters`, on the trail document) — evidence for a later no-show dispute, computed
once and never recomputed on subsequent points.

### New environment variables

| Var | Default | Notes |
|---|---|---|
| `NOTIFICATION_PUSH_PROVIDER` | `log` | `log`, `fcm`, or `onesignal` — `log` requires no provider credentials |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | — | required only when `NOTIFICATION_PUSH_PROVIDER=fcm` (Joi conditional); a service-account private key, with literal `\n` restored to real newlines |
| `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` | — | required only when `NOTIFICATION_PUSH_PROVIDER=onesignal` (Joi conditional) |
| `SCHEDULED_REMINDER_LEAD_MINUTES` | `60` | how long before `scheduledFor` the reminder fires |
| `SCHEDULED_REMINDER_SWEEP_ENABLED` | `true` | |
| `SCHEDULED_REMINDER_SWEEP_INTERVAL_SECONDS` | `300` | |
| `WEBSOCKET_REDIS_ADAPTER_ENABLED` | `false` | multi-instance fan-out — reuses `REDIS_URL` |
| `LOCATION_UPDATE_MIN_INTERVAL_SECONDS` | `5` | per-booking location-update throttle |
| `LOCATION_TRAIL_MAX_POINTS` | `200` | trail cap, enforced via `$slice` |
| `LOCATION_TRAIL_RETENTION_HOURS` | `24` | how long a terminated trail survives before purge |
| `LOCATION_TRAIL_PURGE_SWEEP_ENABLED` | `true` | |
| `LOCATION_TRAIL_PURGE_SWEEP_INTERVAL_SECONDS` | `300` | |

### Setting up real push (optional — `log` works out of the box)

**FCM:**

1. Firebase console → Project settings → Service accounts → Generate new private key → downloads a
   JSON file with `project_id`, `client_email`, and `private_key`.
2. Set `NOTIFICATION_PUSH_PROVIDER=fcm`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY`
   (paste the PEM key with literal `\n` for newlines — `.env` files can't hold a real multi-line
   value cleanly) in `.env`.

**OneSignal** (the verified alternative where FCM isn't reliably reachable):

1. OneSignal dashboard → your app → Settings → Keys & IDs → copy the **OneSignal App ID** and the
   **REST API Key**.
2. Set `NOTIFICATION_PUSH_PROVIDER=onesignal`, `ONESIGNAL_APP_ID`, and `ONESIGNAL_REST_API_KEY` in
   `.env`. Register each device's OneSignal player/subscription id the same way as any other
   device token — `POST /users/me/device-tokens`, same body shape, same endpoint.

Either way, that's it — `createBookingNotifier` picks the matching notifier up from the one env
var; nothing else changes, and switching providers later doesn't touch application code. Leave
`NOTIFICATION_PUSH_PROVIDER` unset (or `log`) for development and CI — the test suite never
touches Firebase or OneSignal.

### Tests

`log-notifier.spec.ts` (the full `BaseNotifier` pipeline: mute-list suppression, quiet-hours
suppression for a reminder but never for an urgent type, per-channel suppression, successful
socket+push delivery, no-active-tokens path, localization, `notifyOffer`'s
workerProfileId→userId resolution), `fcm-notifier.spec.ts` (multicast payload shape, invalid-token
deactivation vs. an ordinary transient failure, lazy app init), `onesignal-notifier.spec.ts`
(payload shape, partial invalid-id deactivation vs. whole-batch "not subscribed" deactivation vs.
an ordinary transient failure), `booking-notifier.factory.spec.ts`
(provider selection across all three), `quiet-hours.spec.ts` (overnight/same-day/zero-length windows, explicit
not-server-local-time), `notification-localization.spec.ts` (ar/en selection, leak-prevention,
every event type in both locales), `device-tokens.service.spec.ts` (register/upsert/ownership
transfer/deactivation), `notification-preferences.service.spec.ts`, `notification-log.service.spec.ts`,
`realtime.gateway.spec.ts` (connection auth, per-join `isPartyToBooking` re-check including
rejecting an unrelated booking, `location:update`'s own rejection/throttle paths),
`location-tracking.service.spec.ts` (every disallowed status rejected, the allowed three accepted,
the throttle window, trail capping via `$slice`, arrival-distance recording), `redis-io.adapter.spec.ts`
(adapter attachment, pub/sub client lifecycle), `location-trail-purge-sweep.service.spec.ts`, and
`scheduled-reminder-sweep.service.spec.ts` (claim-then-update, a losing claim sends nothing, a failed
profile lookup for one booking doesn't break the rest).

## Worker wallet, commission collection and suspension (Phase 8)

Phases 1-7 computed and persisted `commissionAmount`/`workerEarnings` on every booking, and even
`feeAmount` on a customer cancellation — but nothing ever moved money. This phase does. Payments in
this market are **cash**, handed directly from the customer to the worker; the platform never holds
it. Commission is instead collected from a **prepaid balance** each worker tops up (in person, or
through an agent — the admin records it), debited automatically when a booking completes.

### The ledger — append-only, not a mutable counter

`wallet_entries` is the source of truth; `wallets` caches the current balance only for fast reads.
Every write goes through one path, `WalletsService.recordEntry`, which:

- never updates or deletes an existing entry — `WalletsService` exposes no such method at all. A
  mistake is corrected by writing a new `REVERSAL` entry that references the original via
  `reversesEntryId`, with its own `amount` being the exact inverse of the original's.
- is idempotent on `idempotencyKey` (unique-indexed). Charging the same booking twice — including
  under a genuine concurrent race — produces exactly one `COMMISSION_CHARGE` entry: the first caller
  wins, every other caller's insert hits the duplicate key and returns the winner's entry instead of
  creating a second one.
- stamps `balanceAfter` on every entry, so the ledger is self-verifying independent of the wallet's
  cached `balance`.

Entry types: `TOPUP`, `COMMISSION_CHARGE`, `CANCELLATION_FEE`, `ADJUSTMENT`, `REFUND`, `REVERSAL`.
Money stays an integer (minor units), with `currency` recorded on every entry — same convention as
`Booking.pricing`/`finalPricing` elsewhere in this app.

**The non-transactional gap, documented on purpose.** Local MongoDB (docker-compose) is a standalone
instance with no replica set, so multi-document transactions aren't available there (only Atlas
guarantees one). `recordEntry` instead does `$inc` the wallet, then insert the entry under its unique
`idempotencyKey`; on a duplicate-key conflict it undoes its own `$inc` and returns the existing
winner's entry. The one case this doesn't cover is a process crash between the `$inc` and the
insert/undo — which would show up as the cached balance disagreeing with the sum of entries. That's
exactly what `npm run wallet:verify` is for: it recomputes every wallet's balance from its own
`wallet_entries` and reports any drift loudly (non-zero exit), both against the wallet's cached
balance and by re-walking each entry's own `balanceAfter` against the running sum. Drift means a bug,
not a UI state to paper over.

### Commission collection

On `BookingsService.complete()`, after the booking is saved as `COMPLETED`, a `COMMISSION_CHARGE` is
written for `finalPricing.commissionAmount` — the **final**, recomputed-from-actual-elapsed-time
figure, never the original estimate — keyed by `commission:${bookingId}`. If the ledger write fails
(wallet unreachable, transient DB error), the booking **still completes**: the failure is logged and
an audit-log entry (`WALLET_COMMISSION_CHARGE_FAILED`, `actorUserId: null` — a system action) is
written instead of silently losing the charge. `CommissionChargeRetrySweepService` polls every
`COMMISSION_CHARGE_RETRY_SWEEP_INTERVAL_SECONDS` for any `COMPLETED` booking with
`commissionChargedAt: null` and retries — safe to retry freely since the charge is idempotent.

Customer cancellation fees (`Booking.cancellation.feeAmount`, computed since Phase 5) are **not**
collected from anyone in this phase. The worker is never charged for a customer's cancellation — that
fee is recorded as context only (who owes what, for a future reconciliation/dispute view). Collecting
it from the customer is explicitly out of scope: payments are cash with no card on file, so there's
nothing to charge against.

A worker who cancels after accepting may owe her **own** wallet a `CANCELLATION_FEE` —
`Country.walletPolicy.workerCancellationPenaltyAmount`, defaulting to **0** so it can be enabled later
per-country without a code change. A wallet failure here is logged but never blocks the cancellation
itself (unlike completion's commission charge, there's no retry sweep for this one — a missed penalty
is a lenience, not lost revenue the booking had already earned).

### Suspension on insufficient balance — independent of disciplinary suspension

Each country's `walletPolicy` carries `negativeBalanceFloor` (default **-5000**, e.g. SYP) and
`lowBalanceWarningThreshold` (default **-2000**). Crossing below the floor — from a commission charge,
a cancellation penalty, or an admin `ADJUSTMENT`/`REVERSAL` — sets `WorkerProfile.financialStatus` to
`SUSPENDED`, automatically, the moment it happens (edge-triggered: an already-suspended worker isn't
re-processed or re-notified on a further charge). Staying at or below the warning threshold (but still
above the floor) sends a low-balance warning notification every time that condition is checked —
deliberately not edge-triggered, since nothing in the spec called for "only once" there.

**`financialStatus` is its own field, completely separate from the Phase 3 disciplinary
`verificationStatus`'s own `SUSPENDED` value.** Clearing one never clears the other — a worker can be
financially fine but disciplinarily suspended, or the reverse. Every eligibility check that already
gated on `verificationStatus === APPROVED` (`findApprovedById`, `filterApprovedAvailableInCity`,
`PublicWorkersService.findMany`/`findOne`) now **also** requires `financialStatus === ACTIVE` — a
financially suspended worker cannot receive instant offers, cannot be booked, and disappears from the
public list. She can still finish a job already in progress: none of those eligibility gates run
anywhere in the `accept → onTheWay → arrived → start → complete` path, only at offer/booking-creation
time, so a mid-job suspension never strands a customer.

Reinstatement is automatic **only** from a genuine `TOPUP` that brings the balance back above the
floor (`WalletsService.applyReinstatementCheck` is called exclusively from `topup()` — never from
`adjust`/`reverse`/a commission or penalty charge, so an admin correction crossing back above the
floor does *not* silently reinstate her). Admins may also lift a financial suspension manually via
`POST /admin/wallets/:workerProfileId/reinstate { reason }`, for disputes — audit-logged
(`WALLET_REINSTATED`, `metadata.manual: true`), and refused with a 400 if she isn't currently
financially suspended.

### Endpoints

Worker (own wallet only — enforced by resolving the wallet from her own profile, never from a client-
supplied id):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/workers/me/wallet` | balance, currency, country (lazily created with balance 0 on first read) |
| GET | `/api/v1/workers/me/wallet/entries` | her own ledger, paginated, newest first, each entry carrying its own `balanceAfter` |

Admin (`Role.ADMIN`), keyed by `:workerProfileId` — the same stable identifier `/admin/workers/:id`
already uses elsewhere in this app, deliberately reused instead of a separate internal wallet id a
caller would otherwise have to look up first:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/wallets` | paginated; `?status=SUSPENDED` or `?lowBalance=true` (resolved in-memory against each wallet's own country floor — same acceptable-at-this-scale tradeoff as the Phase 4 public-listing price sort) |
| GET | `/api/v1/admin/wallets/:workerProfileId` | |
| GET | `/api/v1/admin/wallets/:workerProfileId/entries` | paginated |
| POST | `/api/v1/admin/wallets/:workerProfileId/topup` | `{ amount, reference, note?, idempotencyKey? }` — `reference` (a receipt/agent id) is mandatory; audit-logged (`WALLET_TOPUP`) |
| POST | `/api/v1/admin/wallets/:workerProfileId/adjust` | `{ amount, reason }` — signed; audit-logged (`WALLET_ADJUSTMENT`) |
| POST | `/api/v1/admin/wallets/:workerProfileId/reverse` | `{ entryId, reason }` — writes the compensating `REVERSAL`; refuses to reverse a `REVERSAL`; audit-logged (`WALLET_REVERSAL`) |
| POST | `/api/v1/admin/wallets/:workerProfileId/reinstate` | `{ reason }` — manual financial reinstatement only; audit-logged (`WALLET_REINSTATED`) |

**Out of scope, on purpose:** self-service top-up (a payment-gateway integration) — every top-up here
is admin-recorded against a real-world reference, matching the cash-based, no-card-on-file model of
the rest of this market. Collecting a customer's cancellation fee is likewise out of scope for the
same reason (see above).

### New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COMMISSION_CHARGE_RETRY_SWEEP_ENABLED` | `true` | toggles `CommissionChargeRetrySweepService` |
| `COMMISSION_CHARGE_RETRY_SWEEP_INTERVAL_SECONDS` | `300` | its polling interval |

Plus, per-country in `Country.walletPolicy` (admin-editable via the existing country CRUD, not an env
var): `negativeBalanceFloor` (default `-5000`), `lowBalanceWarningThreshold` (default `-2000`),
`workerCancellationPenaltyAmount` (default `0`).

### `npm run wallet:verify`

Recomputes every wallet's balance from the sum of its own `wallet_entries` (and separately re-walks
each entry's own `balanceAfter` against the running sum) and reports any drift loudly — exits non-zero
if it finds any. Run it the same way as `npm run seed:verify`, including the same `ALLOW_REMOTE_SEED`
guard against accidentally pointing it at a shared/remote database by default.

### Tests

`wallets.service.spec.ts` covers `recordEntry`'s idempotency (a plain duplicate replay, and a genuine
race via a forced duplicate-key insert that exercises the compensating `$inc` undo),
`chargeCommission`'s suspension/warning thresholds (exactly at the floor, not before; never
re-suspending an already-suspended worker), `topup`'s auto-reinstatement (only when the new balance
actually clears the floor), `adjust`/`reverse` (including refusing to reverse a `REVERSAL`, and
reversing the same entry twice being a no-op), `reinstateManually`'s guard against reinstating a
worker who isn't suspended, and `listForAdmin`'s per-country `lowBalance` filtering.
`bookings.service.spec.ts` adds coverage for `complete()` charging the commission from `finalPricing`
and surviving a ledger failure without losing the COMPLETED transition (asserting the audit-log entry
instead), and `cancelByWorker()` charging the configured penalty (zero by default) without the
cancellation itself ever failing on a wallet error.
`commission-charge-retry-sweep.service.spec.ts` covers the retry query shape, a successful retry
stamping `commissionChargedAt`, a repeated failure re-audit-logging with `retry: true`, and one
booking's failure not blocking the rest of the batch. `worker-profiles.service.spec.ts`/
`public-workers.service.spec.ts` assert the new `financialStatus: ACTIVE` gate on every eligibility
query.

## Reviews, safety and disputes (Phase 9)

The final backend phase: trust (reviews), safety (panic alerts, trusted contacts, share-trip
links), disputes (reports), and the admin console to run the business day to day.

### Reviews — blind, two-sided, and never shown where they shouldn't be

Either party to a **COMPLETED** booking may review the other, once per direction, within the
country's configurable `reviewPolicy.reviewWindowDays` (default **14**). Neither side sees the
other's review until **both** have submitted or the window closes — enforced server-side in
`ReviewsService.getForBooking`, which returns `theirs: null` outright (never a review object with
a "hidden" flag) until that condition holds.

A **customer's** review of a worker recomputes `WorkerProfile.rating` from scratch — the average of
every non-hidden review she's received — the moment it's published; this is independent of the
blind-reveal rule, since the public aggregate isn't gated on the worker having reviewed back. A
**worker's** review of a customer is never denormalized anywhere: a customer's rating is computed
on demand (an aggregation over the Review collection), specifically so there's no stored field that
could ever leak through `GET /users/me` or any other self-service endpoint — **a customer can never
see her own rating**, by construction, not by a projection check that could be missed later. It's
visible to a worker deciding whether to accept an offer/booking (the `WORKER`/`ADMIN` booking and
pending-offer projections only) and to admins.

`WorkerProfile.completedBookings` (a Phase 3 placeholder, populated here) is recomputed — never
incremented — from a fresh `COUNT` against the Booking collection every time a booking completes,
independent of whether it's ever reviewed.

An admin may hide a review with a bilingual reason (`POST /admin/reviews/:id/hide`), audit-logged
(`REVIEW_HIDDEN`); hiding recomputes the worker's rating the same way publishing it did. `npm run
reviews:verify` mirrors `wallet:verify` exactly: recomputes every worker's `rating` and
`completedBookings` from their real sources and reports drift loudly.

### Safety — the emergency path

**Panic alerts.** `POST /bookings/:id/panic` — either party, only during an active booking
(`ON_THE_WAY`/`ARRIVED`/`IN_PROGRESS`). Records who, when, her last known location (best-effort,
never required), the booking, and an optional note, then immediately fans out to **every currently
active admin individually** through the Phase 7 notifier (`PANIC_ALERT_TRIGGERED` — urgent,
localized ar/en, never suppressed by quiet hours). One admin's failed delivery is logged and never
hides the alert from the rest, let alone fails the trigger itself back to the person in danger.
Admins list/view/resolve alerts under `admin/panic-alerts`, each resolution (with a required note)
audit-logged (`PANIC_ALERT_RESOLVED`).

**Trusted contacts.** `users/me/trusted-contacts` — any user registers her own emergency contacts
(name, phone, relationship). When a panic fires, the contacts to notify are **snapshotted onto the
alert at that moment**, not kept as a live reference, so a later edit or deletion of the contact
can't rewrite what the alert says was notified. Actually sending anything requires SMS, which this
app doesn't have — what *would* be sent is logged (`[TrustedContact (DEV ONLY)] Would SMS ...`),
exactly the same seam-and-log discipline Phase 6 used for push before FCM/OneSignal existed.

**Share-trip links — the one unauthenticated route in this entire app.** `POST
/bookings/:id/share-link` (either party) mints an opaque, unguessable token
(`crypto.randomBytes(32)`, hex-encoded — never the booking's own id). `GET /share-trip/:token`
needs no bearer token at all and returns exactly four fields, hand-built by construction (never a
document spread): the worker's **first name**, her live **position** and **ETA**, and the
booking's **status**. Nothing else — no phone, no address, no customer id, no pricing. Validity is
computed at *read time* from the booking's own termination timestamp plus a configurable grace
period (`SHARE_TRIP_GRACE_PERIOD_MINUTES`, default 60), never a fixed stored `expiresAt` — a job
that runs long never has its link expire mid-trip. Once the booking is terminal, live position/ETA
drop to `null` (there's nothing left to track) but the final status stays visible through the grace
period. A revoked token (`POST .../share-link/revoke`) and one that never existed return the
**identical 404** — same "doesn't exist for you" discipline used everywhere else, extended to the
one place in the system with zero authentication to fall back on.
`ShareTripPurgeSweepService` only tidies up rows that are unambiguously, permanently done; it is
hygiene, never the enforcement mechanism (`getPublicView` re-checks validity on every single read).

### Reports and disputes

Either party may file a report (`POST /reports`) against a `USER`, a `WORKER`, or a `BOOKING`
(`NO_SHOW` / `PROPERTY_DAMAGE` / `THEFT` / `HARASSMENT` / `UNSAFE_CONDITIONS` / `PAYMENT_DISPUTE` /
`QUALITY` / `OTHER`), with attachments uploaded through the exact same validated path as Phase 3's
worker documents (magic-byte MIME detection — the client's declared type is never trusted). A
report naming a booking is only accepted from one of that booking's own parties
(`BookingsService.resolveOwnParty`, shared with Reviews and Safety). `HARASSMENT` and `THEFT` are
flagged `isHighSeverity` at creation and always sort first in the admin queue, never buried behind
older low-priority reports.

The admin workflow — assign (`POST .../assign`), change status (`POST .../status`), add an internal
note (`POST .../notes`, **never** returned to the reporter: the reporter-facing projection has no
code path that even reads `internalNotes`) — resolves to exactly one outcome via `POST
.../resolve`: `SUSPEND_WORKER`, `FORCE_NO_SHOW`, `WALLET_ADJUSTMENT`, or `DISMISS`. Every one of
these calls straight into the service that already owns that operation —
`WorkerProfilesService.reviewWorker`, `BookingsService.forceStatus`, `WalletsService.adjust` —
never reimplemented here. In particular, `SUSPEND_WORKER` only ever sets `verificationStatus`
(disciplinary); the resolution path has no access to `financialStatus` at all, so a report-driven
suspension structurally cannot touch a worker's wallet eligibility, the same independence Phase 8
established between the two.

### Admin console

A read-only aggregator sitting on top of every other module — it owns no schema of its own and
reuses each domain's existing admin-facing method wherever one already existed, rather than
querying a raw model a second time.

- `GET /admin/console/dashboard` — bookings by status today/this week, pending verifications, open
  (+ investigating) reports, unresolved panic alerts, workers below their country's low-balance
  floor, and the INSTANT matching failure rate (`NO_WORKER_FOUND` share of INSTANT requests this
  week).
- `GET /admin/console/search?phone=&name=&bookingNumber=` — three independent lookups (users,
  resolved workers, bookings), each through its own existing projection — never a merged scan
  across unrelated collections.
- `GET /admin/console/workers/:id/360` — one worker's profile, documents, services, recent
  bookings, recent reviews, wallet, and reports, composed entirely from parallel calls into the
  services that already own each piece.
- `GET /admin/console/metrics?sinceDays=` — average time-to-accept, completion rate, cancellation
  rate by party (one aggregation pipeline against Booking, never loaded into memory to compute in
  JS), and the platform-wide average rating (restricted to workers who've actually completed a
  booking, so an unreviewed brand-new profile's 0 doesn't drag it down).

### New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SHARE_TRIP_GRACE_PERIOD_MINUTES` | `60` | how long a share-trip link keeps working after its booking terminates |
| `SHARE_TRIP_PURGE_SWEEP_ENABLED` | `true` | toggles `ShareTripPurgeSweepService` |
| `SHARE_TRIP_PURGE_SWEEP_INTERVAL_SECONDS` | `300` | its polling interval |

Plus, per-country in `Country.reviewPolicy` (admin-editable via the existing country CRUD, not an
env var): `reviewWindowDays` (default `14`).

### `npm run reviews:verify`

Recomputes every worker's `rating` (from the Review collection, excluding hidden reviews) and
`completedBookings` (from the Booking collection) and reports any drift against the stored,
denormalized values — loudly, non-zero exit, exactly like `wallet:verify`.

### Access control, restated

A customer never sees her own rating, another customer's reports, or any report's internal notes.
A worker sees a customer's rating only through the WORKER-viewer booking/offer projections — never
a dedicated "look up this customer" endpoint. `GET /share-trip/:token` is the only route in this
app with no `JwtAuthGuard` check at all; everything it returns is allowlisted by construction in
`ShareTripService.getPublicView`, not by stripping fields from a larger object afterward.

### Tests

`reviews.service.spec.ts` covers the blind-reveal rule explicitly returning `null` (not a
hidden-flagged object) for `theirs` before both sides submit or the window closes, review
eligibility (non-party, non-COMPLETED, duplicate, out-of-window all rejected), and
`recomputeWorkerRating`'s full-recompute discipline. `panic-alerts.service.spec.ts` covers the
active-status gate, the trusted-contact snapshot (not a live reference), and one admin's failed
notification never blocking the others or the trigger itself. `share-trip.service.spec.ts` is the
most adversarial suite in the app: it asserts the public view's response contains **only** the four
allowlisted keys, that a revoked token 404s identically to a nonexistent one, that position/ETA
drop to `null` once terminal, and that it expires once the grace period elapses.
`reports.service.spec.ts` covers every resolution action calling exactly the right existing service
with the right arguments, the two subject-type guards (`SUSPEND_WORKER`/`WALLET_ADJUSTMENT` both
require a `WORKER`-subject report), and that the reporter-facing projection never carries
`internalNotes`. `admin-console.service.spec.ts` asserts every dashboard count and the 360 view are
built from each owning service's own method, never a raw model query.

## MongoDB options

### Option A: Atlas (no local install)

1. Atlas → Database → Connect → Drivers → copy the `mongodb+srv://` connection string.
2. Paste it into `MONGODB_URI` in `.env`, filling in the real password (URL-encode it if it
   contains `:`, `/`, `@`, `?`, or `#` — easiest to just avoid those characters).
3. Atlas → Network Access → add your current IP (or `0.0.0.0/0` for a throwaway dev cluster only).
4. `npm run db:doctor` — connects end-to-end and tells you exactly what's wrong if it doesn't
   (see "DNS / connection troubleshooting" below; this is the machine-specific failure mode).

### Option B: local MongoDB (Windows, no Docker)

1. Download & run the MSI: https://www.mongodb.com/try/download/community (installs as a
   Windows service, starts automatically, no auth by default).
2. `MONGODB_URI=mongodb://localhost:27017/home-services` in `.env` — already the default in
   `.env.example`, no code change needed for this path (the seeder's local-host guard and env
   validation both already accept it).
3. `npm run seed` — no `ALLOW_REMOTE_SEED` needed, `localhost` is always allowed.

### Option C: Docker Compose (MongoDB + Redis, if you have Docker)

```bash
npm run db:up         # docker compose up -d — starts MongoDB + Redis, waits to become healthy
```

Set `MONGO_ROOT_PASSWORD` in `.env` first (see the comment above it in `.env.example`), and make
sure `MONGODB_URI` matches `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD`/`MONGO_PORT` exactly,
including `?authSource=admin`. Lifecycle scripts: `db:up` / `db:down` / `db:reset` / `db:logs`.

### Redis (optional — OTP state)

Not required: the OTP store defaults to in-memory, fine for a single dev/test process. Set
`REDIS_URL` once you run more than one instance, or want OTP state to survive a restart — either
Docker (`db:up` already starts a Redis container) or a managed free tier with no local install
(Upstash, Redis Cloud).

### Standalone scripts and env loading

`npm run start:dev` goes through Nest's `ConfigModule`, which loads `.env` automatically. The
seeder (`npm run seed`, `npm run seed:verify`) and `npm run env:check` run *outside* the Nest
app, so they load `.env` themselves via `src/config/load-env.ts` — imported as the first line of
each script, before anything else touches `process.env`. All of them validate against the exact
same Joi schema the app uses (`src/config/env.validation.ts`), so there's one source of truth for
what's required.

- Override which file gets loaded with `ENV_FILE=.env.staging npm run seed` (still resolved from
  the project root, not wherever you happened to run the command from).
- `npm run env:check` prints every expected var as found/missing, with every value masked to its
  last 4 characters (`MONGODB_URI` shows only the host — credentials never printed, anywhere,
  including in connection error messages).

```bash
npm run env:check
```

### Docker lifecycle scripts

| Script | What it does |
|---|---|
| `npm run db:up` | `docker compose up -d` |
| `npm run db:down` | `docker compose down` (containers stop, named volumes — and your data — survive) |
| `npm run db:reset` | `docker compose down -v && docker compose up -d` (wipes volumes, fresh DB) |
| `npm run db:logs` | tails the MongoDB container logs |

### Resetting the dev database

`npm run db:reset-dev -- --confirm` wipes every collection in the configured database and
re-runs the seeder — different from `db:reset` above (which only resets the local Docker
volumes). This is how the project-wide ObjectId schema fix below was actually rolled out: every
pre-existing id field across nine phases of demo data had been silently stored as a plain string
(see "Running this in production"), and rather than migrate that demo data in place, every
collection was wiped and reseeded once the schemas were corrected, so every document was written
through the fixed schemas from the start.

Three independent gates, since this is destructive and this dev database happens to be a shared
Atlas cluster, not a disposable local container:
- `--confirm` must be passed explicitly.
- `NODE_ENV` must literally be `development`.
- The `MONGODB_URI` host must look local, or `ALLOW_REMOTE_SEED=true` must be set (the exact
  guard `npm run seed` already uses — this is how `db:reset-dev` is actually meant to be run
  against this project's own Atlas-hosted dev database).

```bash
NODE_ENV=development ALLOW_REMOTE_SEED=true npm run db:reset-dev -- --confirm
```

### DNS / connection diagnostics

```bash
npm run db:doctor
```

Runs nine checks end to end — `.env` found, no malformed lines, `MONGODB_URI` parses, A-record,
SRV resolution (both with your default DNS and forced against 1.1.1.1/8.8.8.8, to tell "resolver
misconfigured" apart from "network blocked"), raw TCP to port 27017, TXT record (replicaSet), and
a real Mongoose connection + ping — then prints every problem it actually found (there can be more
than one — fixing DNS often just gets you to a *different* failure at the auth step, and the
doctor reports both rather than stopping at the first). Never prints credentials, including in
connection error messages.

If it diagnoses a DNS resolver problem (`querySrv ECONNREFUSED` when the URI is a `mongodb+srv://`
one, most commonly on Windows with certain VPNs/network adapters — `nslookup` works but Node's own
resolver can't reach the nameserver for SRV/TXT lookups specifically): add `DNS_SERVERS=1.1.1.1,
8.8.8.8` to `.env`. The app and every script already read it and apply it before connecting
(`src/config/apply-dns-servers.ts`) — no code change needed.

If SRV lookups fail even against 1.1.1.1/8.8.8.8 (network-level block, not just a resolver
problem), sidestep SRV/TXT DNS entirely:

```bash
npm run uri:build
```

Resolves the SRV/TXT records itself and prints the equivalent non-SRV `mongodb://` connection
string (real hosts, real `replicaSet`) with the password left as `PASSWORD_HERE` — nothing secret
is ever printed. Paste it into `MONGODB_URI` in `.env` yourself and fill in the real password.

### Smoke test

**Stale as of Phase 2**: `scripts/smoke-test.sh` predates the auth migration — it still
authenticates admin calls via the retired `x-admin-key`/`ADMIN_API_KEY`, which no longer exist.
It needs updating to drive the OTP flow (request → read the code from the `start:dev` console →
verify → use the returned `accessToken`) before it'll pass again. Left as-is rather than patched
blind, since scripting "scrape a 6-digit code out of server stdout" deserves its own look rather
than a rushed fix bundled into this phase.

## Testing

```bash
npm run test        # unit tests
npm run test:cov    # with coverage
```

## Troubleshooting

**Port already in use** (`Bind for 0.0.0.0:27017 failed: port is already allocated`)
Something else (a local Mongo install, another project) is already using that port. Either stop
it, or change `MONGO_PORT` (and the port in `MONGODB_URI`) in `.env` to something free, e.g.
`MONGO_PORT=27018` and `MONGODB_URI=mongodb://...@localhost:27018/...`.

**Mongo auth failure** (`bad auth: authentication failed` / `MongoServerError: Authentication failed`)
Not a DNS/network problem — `db:doctor` will show DNS and TCP passing and only the last step
("Mongoose connection + ping") failing. For Atlas: check the username/password in `MONGODB_URI`
against the database user in Atlas → Database Access (not your Atlas login), and that the user
actually exists and isn't still provisioning. For Docker Compose (Option C): `MONGODB_URI`'s
username/password/authSource must match `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD` exactly — the
root user is only created once, on first container startup with an empty volume, so changing the
password afterwards needs `npm run db:reset` (wipes local dev data) to take effect. Either way,
check the password doesn't contain unescaped `:`, `/`, `@`, `?`, or `#` — those need
URL-encoding inside the connection string.

**Seeder: connection refused / times out**
DNS-class failures (bad SRV/A record, unreachable resolver) fail immediately now with an
actionable message pointing at `npm run db:doctor` — see "DNS / connection diagnostics" above —
rather than retrying blindly. Genuinely transient errors (e.g. a `docker compose up -d` that just
started) still get 3 retries at 3s apart. If using Docker Compose: confirm `docker compose ps`
shows `mongodb` as `healthy`, and that `MONGODB_URI` in `.env` points at the same port as
`MONGO_PORT`.

**Seeder says `MONGODB_URI is not set` even though `.env` has it**
The seeder and `seed:verify` run outside the Nest app, so nothing loads `.env` for them unless
they do it themselves (see "Standalone scripts and env loading" above). Run `npm run env:check`
first — it tells you the exact `.env` path it resolved and whether the file was found at all,
which is the actual problem 9 times out of 10 (wrong working directory, `.env` never created from
`.env.example`, or a typo in the file — e.g. an accidentally duplicated `MONGODB_URI=` prefix).

**Seeder refuses to run** (`Refusing to seed MongoDB host "..."`)
`MONGODB_URI`'s host isn't `localhost`/`127.0.0.1`/`mongodb` — this is deliberate (see
`src/database/seeders/seed-guard.ts`) so a stray remote connection string (e.g. a MongoDB Atlas
`mongodb+srv://` URI) can't get seeded by accident. If you really mean to seed that host — e.g.
seeding an Atlas cluster for a one-off check — opt in for that single run rather than flipping the
default in `.env`:

```bash
# PowerShell
$env:ALLOW_REMOTE_SEED = 'true'; npm run seed

# CMD
set ALLOW_REMOTE_SEED=true&& npm run seed

# bash / Git Bash
ALLOW_REMOTE_SEED=true npm run seed
```

**`npm install` fails on `sharp`** (native binary download/build error)
`sharp` ships prebuilt binaries for common platform/arch combinations; a failure usually means no
prebuilt binary matches yours (unusual Node version, arch, or libc) or there's no network access
to fetch it during install. See sharp's own install troubleshooting docs; as a last resort,
`npm install --platform=<x> --arch=<y> sharp` can force a specific prebuilt binary.

**Document upload returns 400 "File type not recognized"**
The file's actual bytes don't match JPEG/PNG/PDF's magic number — this is deliberate (see "Upload
validation" above) and ignores the `Content-Type` header and filename extension entirely. Usually
means the file is genuinely a different type, or got corrupted/truncated in transit.

**Windows: PowerShell vs CMD vs Git Bash**
All `npm run ...` scripts in `package.json` are plain cross-shell commands (no `VAR=value cmd`
inline syntax), so they work unmodified in all three. The difference only shows up when *you*
need to set an env var inline for a single command (as above) — the three shells don't share
syntax for that, so match your actual shell: `$env:X = 'y'; cmd` (PowerShell, note the semicolon,
not `&&`), `set X=y&& cmd` (CMD, no space before `&&`), or `X=y cmd` (bash/Git Bash). Persistent
vars belong in `.env`, not the shell, for anything beyond a one-off override.

## API shape

All responses are wrapped consistently:

```json
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 8, "totalPages": 1 } }
```

Errors:

```json
{ "success": false, "error": { "statusCode": 404, "message": "...", "error": "Not Found" } }
```

## Admin routes

Admin CRUD endpoints (`/countries/admin/*`, `/cities/admin/*`) require a bearer access token from
a user whose `roles` include `ADMIN` (`@Roles(Role.ADMIN)` + the global `JwtAuthGuard`/
`RolesGuard` — see "Authentication" above). Get one via `SEED_ADMIN_PHONE` + the OTP flow.

Example (assuming `$ACCESS_TOKEN` came from `POST /auth/otp/verify`):

```bash
curl -X POST http://localhost:3000/api/v1/countries/admin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "code": "SY",
    "name": { "ar": "سوريا", "en": "Syria" },
    "currencyCode": "SYP",
    "phonePrefix": "+963",
    "enabledPaymentMethods": ["CASH"],
    "commissionRate": 1500
  }'
```

## Endpoints

Auth endpoints are listed under "Authentication" above; worker/admin/audit-log endpoints under
"Worker verification" above; service catalog/pricing/quote endpoints under "Service catalog and
pricing" above; booking/availability-window/slots endpoints under "Bookings" above;
presence/offers endpoints under "Instant bookings and broadcast matching" above; wallet/top-up/ledger
endpoints under "Worker wallet, commission collection and suspension" above; reviews, panic alerts,
trusted contacts, share-trip links, reports and the admin console under "Reviews, safety and
disputes" above. Countries/cities:

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/countries` | public | active countries only |
| GET | `/api/v1/countries/admin` | ADMIN | paginated, includes inactive **and soft-deleted** |
| GET | `/api/v1/countries/admin/:id` | ADMIN | includes soft-deleted |
| POST | `/api/v1/countries/admin` | ADMIN | |
| PUT | `/api/v1/countries/admin/:id` | ADMIN | only active (non-deleted) records |
| DELETE | `/api/v1/countries/admin/:id` | ADMIN | soft delete |
| GET | `/api/v1/cities?countryId=...` | public | active cities in a country, paginated |
| GET | `/api/v1/cities/admin` | ADMIN | all cities, including soft-deleted |
| GET | `/api/v1/cities/admin/:id` | ADMIN | |
| POST | `/api/v1/cities/admin` | ADMIN | |
| PUT | `/api/v1/cities/admin/:id` | ADMIN | |
| DELETE | `/api/v1/cities/admin/:id` | ADMIN | soft delete |

## Project structure

```
src/
  config/        env schema (Joi) + typed config
  common/        exception filter, response interceptor, pagination DTO,
                 base schema (timestamps + soft delete), localized name schema/DTO,
                 Role enum, @Public/@Roles/@CurrentUser decorators, JwtAuthGuard, RolesGuard
  database/      Mongoose root connection, idempotent seeders, diagnostics (doctor, uri:build),
                 purge-documents (retention policy enforcement)
  modules/
    countries/   implemented
    cities/      implemented
    users/       implemented — schema, PhoneValidationService, UsersService
    auth/        implemented — otp/ (sender + store + service), tokens/ (rotation + reuse
                 detection), auth.controller/service
    storage/     implemented — FileStorage interface, Local/S3-compatible implementations,
                 magic-byte detection + EXIF stripping, generate-object-key
    audit-log/   implemented — append-only schema/service, admin query endpoint
    services/    implemented — Service catalog, ServicePricingRule (admin-defined ranges)
    workers/     implemented — profile + document schemas, verification state machine,
                 required-document config, worker-service pricing (own validation layer),
                 worker availability windows (weekly + date overrides, timezone-correct),
                 worker presence (isOnline/lastLocation/lastHeartbeatAt, 2dsphere) +
                 eligibility bulk-filters for instant matching, public projection (allowlist),
                 upload rate limiter, worker-me/worker-services/worker-availability/
                 worker-presence/workers-admin/public-workers controllers
    pricing/     implemented — PricingService (the only place commission/rounding maths
                 lives), round-half-up-divide, customer-safe quote projection
    bookings/    implemented — Booking schema (nullable worker/pricing fields for INSTANT,
                 frozen pricing snapshot + finalPricing once known, reminderSentAt),
                 BookingOffer (per-wave offer records), BookingLocationTrail (capped,
                 downsampled location points + arrival distance), explicit role-aware state
                 machine (SCHEDULED + INSTANT statuses), BookingsService (creation for both
                 types, atomic acceptOffer, lifecycle transitions + notification dispatch,
                 cancellation fees, admin force-status), BookingAssignmentStrategy seam
                 (Direct for SCHEDULED, NearestAvailable + InstantMatchingService for
                 INSTANT), notifications/ (BookingNotifier, BaseNotifier/LogNotifier/
                 FcmNotifier sharing one pipeline, the config-driven factory), LocationTrackingService
                 + LocationTrailPurgeSweepService, ScheduledReminderSweepService,
                 status-dependent + offer projections (allowlist), expiry/instant-matching/
                 reminder/trail-purge sweeps (@nestjs/schedule), customer/worker/admin/
                 slots/offers controllers (+ GET :id/location)
    notifications/ implemented — DeviceToken (multi-device, upsert-by-token),
                 NotificationPreference (lazy, mute-list + quiet hours), NotificationLog
                 (append-only delivery record), the event catalogue + ar/en localization
                 templates + quiet-hours window math, device-tokens/notification-preferences
                 controllers, admin notification-log query endpoint
    realtime/    implemented — RealtimeGateway (JWT-authenticated sockets, per-user +
                 per-booking rooms, per-join isPartyToBooking re-check, location:update with
                 its own per-connection throttle), RedisIoAdapter (multi-instance fan-out,
                 behind a config flag)
    reviews/ reports/ payments/   empty — later phases
```

## Domain conventions (apply to every future module)

- Money: integers only, always paired with a currency code — never floats.
- User-facing names: `{ ar: string, en: string }`.
- Every collection: `timestamps: true` + soft delete (`isDeleted`, `deletedAt`) via the shared
  `BaseSchema` in `common/schemas/base.schema.ts`. Soft delete is **not** auto-filtered by a
  query hook — each service decides per method: public/active-only reads filter
  `isDeleted: false` explicitly; admin *read* methods (`findAll`, `findOne`) deliberately don't,
  so admins can see and audit deleted records. Admin *write* methods (`update`, `remove`) still
  only operate on non-deleted records — there's no "undelete" in Phase 1.
- Roles: `CUSTOMER`, `WORKER`, `ADMIN` — an array on `User.roles` (a person can hold more than
  one), enforced by the global `JwtAuthGuard`/`RolesGuard` + `@Roles()` (see "Authentication").
- Worker documents (national ID, criminal record certificate): private storage only, admin-only
  access — implemented in the `worker-documents` phase.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Global app setup, `countries` + `cities` reference data | **Done** |
| 2 | Auth: phone OTP, JWT access/refresh with rotation | **Done** |
| 3 | Worker profiles and documents (national ID, criminal record — private/admin-only storage) | **Done** (this codebase) |
| 4 | Service catalog and per-worker pricing (`HOURLY` / `BY_SIZE` / `FIXED`) | **Done** (this codebase) |
| 5 | Bookings: `SCHEDULED` trip-like state machine, availability windows, expiry sweep | **Done** (this codebase) |
| 6 | Instant matching: broadcast with progressive radius expansion, worker presence | **Done** (this codebase) |
| 7 | Realtime: push notifications, live location tracking, and the WebSocket layer | **Done** (this codebase) |
| 8 | Wallet and payments (settling computed cancellation fees, worker earnings) | Planned |
| 9 | Reviews, safety (reports, moderation), and admin dashboard | Planned |

### Phase 2 — what shipped, and what didn't

Delivered: the full OTP + JWT flow described under "Authentication" above — `users` module
(phone/countryId/cityId/roles-array/profile/status), hashed+peppered+single-use OTPs with
cooldown/rate-limit/attempt-limit, access+refresh JWTs with rotation and reuse detection,
`JwtAuthGuard`/`RolesGuard` replacing the Phase 1 placeholder `AdminGuard`, and an idempotent
`SEED_ADMIN_PHONE` bootstrap admin.

Deliberately deferred (real SMS/WhatsApp delivery was out of scope for this phase — see
`OtpSender` in `src/modules/auth/otp/otp-sender.interface.ts`): `ConsoleOtpSender` (logs the code,
refuses to run when `NODE_ENV=production`) is the only implementation. A future `SmsSender`/
`WhatsAppSender` — with the SMS-first, WhatsApp-fallback behavior originally envisioned for this
phase — implements the same interface; nothing else in the OTP flow changes when they land.

### Phase 3 — what shipped, and what didn't

Delivered: everything under "Worker verification" above — the self-service `apply` endpoint
(additive role grant, idempotent, `ApprovedWorkerGuard` enforcing role-is-not-capability on every
route with a real effect); private-only `FileStorage` (local/S3-compatible) with presigned,
time-limited reads; magic-byte-checked, EXIF-stripped, size-limited, per-user-rate-limited
uploads; the 5-state verification state machine; the explicit public-projection allowlist; the
append-only audit log with a view-then-read guarantee on every admin document access; and the
retention/purge script.

Deliberately deferred: an "undelete" path for a soft-deleted `WorkerProfile`, and a richer
application flow (e.g. an admin-visible queue of *applications* distinct from the document-review
queue) are both future work — `apply` today is a plain, instant, idempotent grant with no review
step of its own. (At the time this was written, `serviceId` on the public listing was a no-op
pending Phase 4's catalog — see the Phase 4 section below for where that landed.)

### Phase 4 — what shipped, and what didn't

Delivered: everything under "Service catalog and pricing" above — the `Service` catalog and
admin-defined `ServicePricingRule` ranges; `WorkerServicesService`'s full service-layer validation
(allowed pricing types, range checks at both bounds, BY_SIZE tier ordering, currency match);
`PricingService` as the single source of pricing maths (commission fallback, integer round-half-up
with a proven `commission + earnings === basePrice` identity, HOURLY estimate-vs-final entry
points ready for the booking phase to call); the customer-safe quote preview; and the public
listing's `serviceId` filter and `sortBy=price` now doing something real.

Deliberately deferred: the seeded pricing-rule ranges are explicit **placeholders** (see the
warning `npm run seed` prints, and the comment in `service-pricing-rules.seed-data.ts`) — real
market research has to replace every one before launch. There's no bulk "update all ranges for a
country" admin endpoint — each range is created/edited one at a time. Sorting by price only works
when also filtering by `serviceId` (a worker's "price" is otherwise ambiguous across multiple
services she offers); a cross-service "cheapest worker for anything" sort isn't implemented.

### Phase 5 — what shipped, and what didn't

Delivered: everything under "Bookings" above — the full `SCHEDULED` lifecycle through an explicit,
exhaustively tested, role-aware state machine; booking creation's full validation chain (worker
eligibility, serviceAreas, booking horizon, availability-window fit, overlap + travel buffer) and
frozen pricing snapshot; worker availability windows with timezone-correct (`luxon` + `Country.timezone`)
resolution and the customer-facing free-slots picker; completion's `finalPricing` recompute for
`HOURLY` — built as a dedicated, dependency-free function specifically so it never re-reads a
live rate or re-checks live availability (see the "why completion doesn't call
`PricingService.recomputeFinal()`" note in the Bookings section — this was a deliberate deviation
from what Phase 4 had anticipated, once actually implementing it showed why); the data-driven,
per-country cancellation policy; the status-dependent allowlist projection (phone/address gated on
`acceptedAt`); the claim-then-update expiry sweep; and the `BookingAssignmentStrategy` interface
with `DirectAssignmentStrategy`, ready for Phase 6 to add a sibling strategy without touching the
booking lifecycle.

Deliberately deferred, by this phase's own explicit scope: `INSTANT` bookings and any matching
logic — the `BookingType.INSTANT` enum value and the assignment-strategy seam exist precisely so
Phase 6 adds a path instead of a migration, but `BookingsService.create` only ever sets
`BookingType.SCHEDULED`. No money moves — `cancellation.feeAmount` is computed and persisted, not
charged (Phase 8, the wallet). No bulk "update all countries' booking policy" endpoint. The public
slots endpoint returns raw free `{ start, end }` intervals rather than pre-discretized picker slots
(e.g. fixed 30-minute increments) — left to the client to chunk for now. No `rejectedAt` /
`onTheWayAt` / `arrivedAt` timestamp fields — only the four the spec named
(`acceptedAt`/`startedAt`/`completedAt`/`cancelledAt`) are persisted; a `REJECTED` booking's reason
is still captured (`rejectionReason`), just without its own timestamp beyond `updatedAt`.

### Phase 6 — what shipped, and what didn't

Delivered: everything under "Instant bookings and broadcast matching" above — `POST /bookings` with
`type: INSTANT`; `WorkerPresence` and the online/offline/heartbeat endpoints (going offline is
immediate); the full eligibility rule (`APPROVED` + `isAvailable` + `isOnline` + fresh heartbeat +
offers the service + city in `serviceAreas` + not already busy); `SEARCHING`/`NO_WORKER_FOUND`
added to the exhaustively-tested state machine; progressive-radius broadcast waves with
per-candidate price previews and operational `BookingOffer` records (deduplicated across waves);
atomic, race-safe acceptance (`acceptOffer`'s single `findOneAndUpdate`, proven with a genuine
N-concurrent-callers test — exactly one winner, exactly one `workerProfileId`, losers get a neutral
409 never recorded against their stats); `GET /workers/me/offers` with the same
never-leak-the-exact-address-or-phone discipline as the booking projection; the claim-then-update
wave-expansion/timeout sweep; and no-fee cancellation during `SEARCHING`.

Deliberately deferred: real push notifications — `BookingNotifier`/`LogNotifier` exist precisely so
that's a Phase 7 provider swap, not a rewrite, and the whole flow is testable via polling today (see
"Realtime" below for how that swap actually landed). No cap on offers per wave (every eligible
candidate in radius gets one). No ranking signal beyond distance (no rating-weighted or
acceptance-rate-weighted ordering). `NO_WORKER_FOUND` is a dead end for this phase — no automatic
retry, no automatic fallback to a `SCHEDULED` request; the customer has to try again herself. No
wallet integration — an INSTANT booking's `cancellation.feeAmount` is computed and persisted
exactly like SCHEDULED's, not charged (still Phase 8).

One known narrow race, found live and left as-is rather than papered over: the sweep's wave-claim
atomically checks `status: SEARCHING` before bumping the wave index, but `broadcastWave` itself
(the geo query, the eligibility checks, a price quote, and an insert *per candidate*) takes real
wall-clock time — long enough that a booking can be accepted by an earlier wave's candidate while a
later wave is still being broadcast. The offer that lands after acceptance stays `PENDING` forever
instead of being swept to `STALE` (nothing currently revisits a `BookingOffer` once its wave
finishes). This never affects correctness where it matters: `acceptOffer`'s atomic claim still
guarantees exactly one winner, and `listPendingOffersForWorker` only ever returns offers whose
booking is still `SEARCHING` — so a worker never actually sees the stale offer in her list. It's
purely a gap in the operational bookkeeping (`BookingOffer.outcome` as "measure match quality"
data), worth fixing with a reconciliation sweep before that data is relied on for anything real.

### Phase 7 — what shipped, and what didn't

Delivered: everything under "Realtime" above — the full event catalogue wired into every real
transition (not a demo subset); `FcmNotifier`/`LogNotifier` sharing one pipeline
(`BaseNotifier`), selected by `NOTIFICATION_PUSH_PROVIDER` via a hand-constructing factory so
Firebase credentials are never required in dev/test; multi-device push with auto-deactivation on an
FCM invalid/unregistered response; `User.locale`-driven ar/en localization with a payload-safety
guarantee (`data` is always exactly `{ type, bookingId }`); per-user notification preferences and
country-timezone quiet hours that never suppress an active-booking event; `RealtimeGateway` with
JWT-authenticated sockets and per-join (not just per-connection) `isPartyToBooking` authorization;
structurally-gated live location tracking (`ON_THE_WAY`/`ARRIVED`/`IN_PROGRESS` only, enforced
against the real booking document) with a bounded/downsampled trail, a short post-termination
retention, a customer-facing position+ETA endpoint and socket event, and arrival-distance capture
for disputes; two independent rate-limiting layers on `location:update`; and the socket.io Redis
adapter for multi-instance fan-out, off by default.

Deliberately deferred: the ETA is a flat assumed-speed estimate, not a routing engine — no road
network, no traffic. No admin UI/endpoint for the notification log beyond the one paginated list
(no aggregate "delivery rate by type" dashboard). `arrivalDistanceMeters` is recorded but nothing
yet *acts* on it (e.g. auto-flagging a suspiciously large distance as a likely no-show) — that's a
disputes/moderation-phase decision. No WebRTC/voice, no in-app chat — the WebSocket layer here is
strictly notifications + location. `WorkerProfile` still has no display name of its own; the
`workerDisplayName` in a `BOOKING_ACCEPTED` notification comes from `User.profile.firstName`, which
is optional and may be blank for a worker who never filled it in (the template falls back to a
generic "the worker"/"العاملة"). The per-connection socket rate limiter is in-process only — on a
multi-instance deployment it limits each instance independently, not a connection's total rate
across reconnects to a different instance (the authoritative, cross-instance-correct check for
location updates specifically is still `LocationTrackingService`'s own database-backed throttle).

### Phase 8 — what shipped, and what didn't

Delivered: everything under "Worker wallet, commission collection and suspension" above — the
append-only, idempotent `wallet_entries` ledger with no update/delete path and `REVERSAL` as the only
correction mechanism; automatic commission collection on booking completion from the booking's
**final** pricing, resilient to a ledger failure (the booking still completes; a retry sweep catches
it); a configurable-per-country, zero-by-default worker cancellation penalty; automatic
suspension/reinstatement on the negative-balance floor, structurally independent from the Phase 3
disciplinary suspension; a financially suspended worker excluded from matching/booking/the public
list but never from finishing a job already in progress; the full worker-facing and admin wallet
endpoint surface, including admin top-up/adjustment/reversal/manual-reinstatement, each audit-logged;
and `npm run wallet:verify` as the drift detector that makes the ledger's "authoritative over the
cached balance" claim actually checkable.

Deliberately deferred: self-service top-up (a payment-gateway integration) — every top-up is still
admin-recorded against a real-world reference. Collecting a customer's cancellation fee is likewise
out of scope — cash payments, no card on file, nothing to charge against. No admin UI/dashboard beyond
the paginated endpoints (no aggregate "total commission collected this month" report). The
non-transactional `$inc`-then-insert compensation pattern in `recordEntry` has one documented narrow
gap — a crash between the two steps — caught only after the fact by `wallet:verify`, not prevented;
closing that gap for real would mean requiring a replica-set MongoDB (Atlas already is one) even for
local development, which this phase deliberately didn't force.

### Phase 9 — what shipped, and what didn't (final backend phase)

Delivered: everything under "Reviews, safety and disputes" above — blind two-sided reviews with the
other party's review genuinely withheld (not merely flagged) until both submit or the window
closes; `WorkerProfile.rating`/`completedBookings` populated from their Phase 3 placeholder state
and kept correct by full recomputation, never an increment, with `reviews:verify` as the drift
detector; a customer rating that is computed on demand specifically so no stored field could ever
leak it back to the customer herself; panic alerts that fan out to every admin individually and
degrade gracefully when one delivery fails; trusted-contact snapshotting with the SMS seam logged,
not sent; share-trip links — the one unauthenticated route in the app — with a hand-built,
by-construction allowlist and grace-period-based expiry re-checked on every read; reports with
high-severity queue sorting and a resolution step that calls straight into existing services
instead of reimplementing any of them, with the disciplinary suspension path structurally unable to
touch `financialStatus`; and an admin console built entirely by composing every other module's
existing admin-facing methods.

Deliberately deferred: actually sending an SMS to a trusted contact (no provider integrated — this
is the exact seam-and-log pattern Phase 6 used for push before FCM/OneSignal existed, ready to wire
up the same way). No aggregate historical trend charts in the admin console (the dashboard and
metrics endpoints are current-snapshot, not a time series). No bulk report/review moderation
actions (hide/resolve are one-at-a-time). The admin search's "name" match is a simple
case-insensitive substring on `profile.firstName`/`lastName` — no fuzzy matching, no phonetic
search. Self-service top-up and customer-side cancellation-fee collection remain out of scope,
exactly as Phase 8 left them — nothing in this phase changes that.

## Running this in production

A checklist of everything this project's nine phases deliberately deferred, left as a seam, or
left configured for local/staging convenience — go through this before pointing a production
deployment at real users and real money.

- **SMS provider for trusted contacts** (Phase 9): no provider is integrated. `PanicAlertsService`
  already snapshots the contacts and logs exactly what would be sent
  (`[TrustedContact (DEV ONLY)] Would SMS ...`) — wire a real provider (Twilio, a regional
  aggregator) behind that same seam, the way `OneSignalNotifier` was added alongside `FcmNotifier`
  in Phase "two targeted changes" without touching `LogNotifier`.
- **OneSignal/FCM credentials** (Phase 7): `NOTIFICATION_PUSH_PROVIDER` defaults to `log` — fine
  for dev/CI, useless for real push. Set real `ONESIGNAL_APP_ID`/`ONESIGNAL_REST_API_KEY` or
  `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` before launch.
- **R2/S3-compatible storage** (Phase 3): `LocalFileStorage` is the dev default and serves files
  from `STORAGE_LOCAL_DIR` through this same process — not acceptable once there's more than one
  instance, or for anything beyond a demo. Configure `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`/`S3_ENDPOINT` (R2, or any S3-compatible provider) first.
- **Seeded admin** (Phase 2): `SEED_ADMIN_PHONE` + `npm run seed` creates/promotes one admin from a
  phone number committed to `.env` for development. Rotate to a real operational phone number (or
  several, promoted via `UsersService.addRole`) before launch, and don't leave the dev phone number
  as a standing admin.
- **Dev OTP retrieval endpoint** (the "two targeted changes" phase): `GET /dev/last-otp` and
  `StoredOtpSender` both refuse to initialize when `NODE_ENV=production` — verify this is actually
  set in the production environment, not just assumed. If it somehow weren't, this endpoint would
  hand out live OTP codes.
- **Secrets rotation**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_PEPPER`, and
  `DEV_OTP_ACCESS_KEY` are all plain env vars with no rotation mechanism built in. Rotating
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` invalidates every live session; plan a rotation window,
  don't do it mid-incident without warning.
- **Demo data cleanup**: every phase in this project was demoed against the same long-lived Atlas
  cluster with real seed data plus whatever each live demo created (test bookings, wallets,
  reviews, panic alerts, reports, trusted contacts). `npm run db:reset-dev -- --confirm` (see
  "Resetting the dev database" above) wipes every collection and re-seeds — but it's gated to
  `NODE_ENV=development` specifically because it must never be reachable from a production
  environment. Before pointing a *different*, production database at real users, there's nothing
  to clean up (it never touched the dev data in the first place) — just make sure the production
  deploy's env vars point at that fresh database, not this project's dev Atlas cluster.
- **Project-wide ObjectId schema casting**: every `@Prop` across every schema in this project (all
  nine phases) declared `type: Types.ObjectId` — the BSON *value* class — where `@nestjs/mongoose`
  actually needs `mongoose.Schema.Types.ObjectId` (the SchemaType). Fed the former, it silently
  collapses the field to `Mixed` with no casting, so the field is stored as whatever type it
  happened to be written with (almost always a plain string, since that's what a route handler or
  DTO typically passes). This was invisible for nine phases because every `.find()`/`.populate()`
  query stays internally self-consistent either way, and only broke once Phase 9 added the first
  raw `new Types.ObjectId(x)` comparisons inside aggregation pipelines. Every schema is now
  corrected (`src/modules/**/*.schema.ts`, all using `MongooseSchema.Types.ObjectId`) — but that
  fix only applies going forward; it does nothing to data already stored as a string.
  `npm run ids:migrate` (dry-run by default, idempotent, `--apply` to actually write, never
  touches a value that isn't a real ObjectId or a valid 24-hex-char string) and
  `npm run ids:verify` (read-only, asserts every id field everywhere is a real ObjectId, non-zero
  exit on drift) both exist in the repo specifically for the day a database holding real,
  irreplaceable data needs this fix applied retroactively. Neither was ever run against this
  project's own dev database — `npm run db:reset-dev` was used instead (see above), since every
  document there was disposable demo data with nothing worth migrating. Before running
  `ids:migrate --apply` against a database that matters: take a snapshot/backup first (Atlas:
  Cluster → Backup → "Take Snapshot Now", confirmed *completed*, not just queued), and deploy the
  corrected schemas and run the migration in the same maintenance window — Mongoose casts both
  writes and query filters once a field is correctly typed, so a window where the code is fixed
  but the data isn't (or vice versa) makes existing documents briefly invisible to exact-match
  queries either way.
- **Redis** (Phase 2 OTP state, Phase 7 socket.io adapter): both are optional and fall back to
  in-process state (`REDIS_URL` unset, `WEBSOCKET_REDIS_ADAPTER_ENABLED=false`) — fine for a single
  instance, broken for OTP consistency and socket fan-out across more than one. Required once this
  runs on more than one instance.
- **MongoDB replica set** (Phase 8): the wallet ledger's `recordEntry` uses a non-transactional
  compensation pattern specifically because local development has no replica set. Atlas already is
  one — `npm run wallet:verify`/`reviews:verify` are the drift detectors for the narrow gap that
  remains even there (a crash between two non-transactional writes), not a reason to skip them.
- **Document retention** (Phase 3): `DOCUMENT_RETENTION_DAYS` controls how long rejected/expired
  worker documents survive before `purge-documents.ts` deletes them — confirm this matches whatever
  real data-retention policy the business has signed up to, not just the development default.
- **Rate limits and sweep intervals**: every `*_SWEEP_INTERVAL_SECONDS`/throttle value in
  `.env.example` was chosen for fast local iteration and demoing, not production load. Revisit
  `THROTTLE_TTL`/`THROTTLE_LIMIT`, the OTP-specific throttle, and every sweep's interval against
  real expected traffic before launch.
