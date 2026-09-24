# Home Services Marketplace — Backend

Backend API for a home-services marketplace (housekeepers: cleaning, cooking, etc.) serving Syria
and Iraq — private/proprietary, not open source. Think "ride-hailing for housekeepers": each
booking goes through trip-like stages and the worker swipes to finish it. Multi-country by design
from day one: nothing about currency, phone prefixes, or locale is hardcoded — it all comes from
the `countries` collection, and every user/worker/booking references a `countryId`/`cityId`.

**Phase 1** (this codebase): global app setup, `countries` and `cities` reference data. Everything
else (`auth`, `users`, `workers`, `bookings`, ...) is scaffolded as empty module folders for later
phases — see "Roadmap" below.

## Tech stack

- **Framework**: NestJS (TypeScript, strict mode)
- **Database**: MongoDB via Mongoose (`@nestjs/mongoose`)
- **Config**: `@nestjs/config` with Joi env validation — fails fast on missing/invalid env vars
- **Validation**: class-validator / class-transformer, global `ValidationPipe`
  (whitelist, forbidNonWhitelisted, transform)
- **Docs**: Swagger at `/docs`
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
- `ADMIN_API_KEY` — a long random string, e.g. `openssl rand -hex 32`

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

### Redis (needed starting Phase 2, not Phase 1)

Phase 1 doesn't use Redis. When Phase 2 (OTP) needs it: Docker (`db:up` already starts a Redis
container) if you have it, or a managed free tier with no local install — Upstash or Redis Cloud
both have one — pointed at via a `REDIS_URL` env var at that point.

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

With `db:up` and `start:dev` both running, in another terminal:

```bash
export ADMIN_API_KEY=<same value as in your .env>
npm run smoke:test
```

Runs `scripts/smoke-test.sh`: seeds twice and checks counts don't move, checks the public
countries/cities endpoints, checks an admin route 401s without the header, soft-deletes a
country and checks it disappears from the public list but stays visible (with `isDeleted:true`)
in the admin view, and checks `/docs` responds. Exits non-zero on the first failure.

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

## Admin routes (Phase 1 placeholder)

Admin CRUD endpoints (`/countries/admin/*`, `/cities/admin/*`) are protected by a **placeholder**
`AdminGuard` that checks a static `x-admin-key` header against `ADMIN_API_KEY`. This is
intentionally minimal — it will be replaced by real JWT + role-based auth in Phase 2.

Example:

```bash
curl -X POST http://localhost:3000/api/v1/countries/admin \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{
    "code": "SY",
    "name": { "ar": "سوريا", "en": "Syria" },
    "currencyCode": "SYP",
    "phonePrefix": "+963",
    "enabledPaymentMethods": ["CASH"],
    "commissionRate": 1500
  }'
```

## Endpoints (Phase 1)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/countries` | public | active countries only |
| GET | `/api/v1/countries/admin` | admin | paginated, includes inactive **and soft-deleted** |
| GET | `/api/v1/countries/admin/:id` | admin | includes soft-deleted |
| POST | `/api/v1/countries/admin` | admin | |
| PUT | `/api/v1/countries/admin/:id` | admin | only active (non-deleted) records |
| DELETE | `/api/v1/countries/admin/:id` | admin | soft delete |
| GET | `/api/v1/cities?countryId=...` | public | active cities in a country, paginated |
| GET | `/api/v1/cities/admin` | admin | all cities, including soft-deleted |
| GET | `/api/v1/cities/admin/:id` | admin | |
| POST | `/api/v1/cities/admin` | admin | |
| PUT | `/api/v1/cities/admin/:id` | admin | |
| DELETE | `/api/v1/cities/admin/:id` | admin | soft delete |

## Project structure

```
src/
  config/        env schema (Joi) + typed config
  common/        exception filter, response interceptor, pagination DTO,
                 base schema (timestamps + soft delete), localized name schema/DTO,
                 placeholder AdminGuard
  database/      Mongoose root connection, idempotent seeders
  modules/
    countries/   implemented
    cities/      implemented
    auth/ users/ workers/ worker-documents/ services/ worker-services/
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
- Roles: `CUSTOMER`, `WORKER`, `ADMIN` (enforced from Phase 2 onward).
- Worker documents (national ID, criminal record certificate): private storage only, admin-only
  access — implemented in the `worker-documents` phase.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Global app setup, `countries` + `cities` reference data | **Done** (this codebase) |
| 2 | Auth: phone OTP with WhatsApp fallback | Next — see below |
| 3 | Worker profiles and documents (national ID, criminal record — private/admin-only storage) | Planned |
| 4 | Service catalog and per-worker pricing (`HOURLY` / `BY_SIZE` / `FIXED`) | Planned |
| 5 | Bookings: `INSTANT` and `SCHEDULED`, trip-like state machine | Planned |
| 6 | Instant matching (customer ↔ nearby available worker) | Planned |
| 7 | Realtime location tracking during an active booking | Planned |
| 8 | Reviews and safety (reports, moderation) | Planned |
| 9 | Payments and admin dashboard | Planned |

### Phase 2 in detail

**Auth: phone-based OTP, with WhatsApp OTP as fallback.**

Context: SMS delivery is unreliable in Syria and Iraq, so OTP delivery needs a fallback path
from day one rather than bolted on later.

Planned shape:

- `POST /auth/otp/request` — accepts `{ countryId, phoneNumber }`, validates the number against
  the country's `phonePrefix`, generates a short-lived OTP, and attempts delivery via SMS first.
- Delivery abstraction (`OtpSenderService` with `SmsSender` / `WhatsAppSender` implementations)
  so the fallback is a provider swap, not an if/else scattered through the codebase. If the SMS
  provider fails or times out, fall back to WhatsApp Business API automatically.
- OTPs stored hashed with TTL (Redis, once the Redis client is wired up in this phase) rather
  than plaintext in Mongo.
- `POST /auth/otp/verify` — validates the OTP, creates or looks up the `User` (role `CUSTOMER`
  or `WORKER` depending on the flow), and issues a JWT access/refresh token pair.
- `AuthGuard` + `RolesGuard` replacing today's placeholder `AdminGuard`; existing admin routes
  swap over to `@Roles('ADMIN')` with no route-shape changes.
- Rate limiting per phone number/IP on the OTP request endpoint specifically, on top of the
  global throttler already in place, since OTP endpoints are the most common abuse target.
- `users` module gets its real schema (role, countryId, cityId, phone, profile) at the same time,
  since auth can't exist without a `User` to attach to.
