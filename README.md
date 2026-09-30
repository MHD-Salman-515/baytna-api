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

Auth endpoints are listed under "Authentication" above. Countries/cities:

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
  database/      Mongoose root connection, idempotent seeders (+ diagnostics: doctor, uri:build)
  modules/
    countries/   implemented
    cities/      implemented
    users/       implemented — schema, PhoneValidationService, UsersService
    auth/        implemented — otp/ (sender + store + service), tokens/ (rotation + reuse
                 detection), auth.controller/service
    workers/ worker-documents/ services/ worker-services/
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
| 2 | Auth: phone OTP, JWT access/refresh with rotation | **Done** (this codebase) |
| 3 | Worker profiles and documents (national ID, criminal record — private/admin-only storage) | Planned |
| 4 | Service catalog and per-worker pricing (`HOURLY` / `BY_SIZE` / `FIXED`) | Planned |
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
