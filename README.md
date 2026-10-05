# Home Services Marketplace — Backend

Backend API for a home-services marketplace (housekeepers: cleaning, cooking, etc.) serving Syria
and Iraq — private/proprietary, not open source. Think "ride-hailing for housekeepers": each
booking goes through trip-like stages and the worker swipes to finish it. Multi-country by design
from day one: nothing about currency, phone prefixes, or locale is hardcoded — it all comes from
the `countries` collection, and every user/worker/booking references a `countryId`/`cityId`.

**Phases 1–2** (this codebase): global app setup, `countries`/`cities` reference data, and phone-OTP
authentication (no passwords — sign up and log in with a phone number and a one-time code).
Everything else (`workers`, `bookings`, ...) is scaffolded as empty module folders for later
phases — see "Roadmap" below.

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
development, `POST /auth/otp/request` logs the code to the **server console** instead:

```
[ConsoleOtpSender (DEV ONLY)] OTP code for +963911111111: 482913 (development mode — not actually sent)
```

Watch the terminal running `npm run start:dev` and copy the 6 digits into your `verify` call.
`ConsoleOtpSender` **refuses to start** (throws at boot) if `NODE_ENV=production` — there is
deliberately no way to accidentally ship "log the code to stdout" as your production OTP delivery.
A real `SmsSender`/`WhatsAppSender` implementing the same `OtpSender` interface is future work.

### Rate limiting and code lifecycle

- Code: 6 digits, `crypto.randomInt` (not `Math.random`), sha256-hashed with a server-side pepper
  (`OTP_PEPPER`) before storage — the plaintext code is never stored, and only ever logged by
  `ConsoleOtpSender` in dev.
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

`PricingService` (`src/modules/pricing/`) is the **only** place this arithmetic exists — a later
booking phase calls `quote()` (pre-booking estimate) or `recomputeFinal()` (same maths, actual
values, for completion) rather than reimplementing it. The full internal `Quote` carries
`commissionAmount`/`workerEarnings`; `toCustomerQuotePreview()` strips both before anything reaches
`GET /pricing/quote` — same allowlist discipline as the public worker projection, applied here
too, since commission/earnings are exactly the kind of internal-to-the-platform figures that
section already treats as never-customer-facing.

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
pricing" above. Countries/cities:

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
                 public projection (allowlist), upload rate limiter,
                 worker-me/worker-services/workers-admin/public-workers controllers
    pricing/     implemented — PricingService (the only place commission/rounding maths
                 lives), round-half-up-divide, customer-safe quote projection
    bookings/ realtime/locations/ reviews/ reports/ payments/
    notifications/ admin/          empty — later phases
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
| 5 | Bookings: `INSTANT` and `SCHEDULED`, trip-like state machine | Planned |
| 6 | Instant matching (customer ↔ nearby available worker) | Planned |
| 7 | Realtime location tracking during an active booking | Planned |
| 8 | Reviews and safety (reports, moderation) | Planned |
| 9 | Payments and admin dashboard | Planned |

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
