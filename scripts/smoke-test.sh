#!/usr/bin/env bash
# End-to-end smoke test for Phase 1 (countries + cities).
#
# Prerequisites (this script does NOT start them for you):
#   1. docker compose up -d        (or: npm run db:up)
#   2. npm run start:dev           (running in another terminal)
#   3. .env is populated, and ADMIN_API_KEY is exported in this shell:
#        export ADMIN_API_KEY=<value from your .env>
#
# Usage: bash scripts/smoke-test.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api/v1}"
DOCS_URL="${DOCS_URL:-http://localhost:3000/docs}"

if [ -z "${ADMIN_API_KEY:-}" ]; then
  echo "FAIL: export ADMIN_API_KEY=<value from your .env> before running this script" >&2
  exit 1
fi

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
json_field() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log($1)}catch(e){console.error('JSON parse/field error:',e.message);process.exit(1)}})"; }

echo "== Waiting for API to respond =="
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL/countries" > /dev/null 2>&1; then
    pass "API is up"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "API at $BASE_URL did not respond after 30s — is 'npm run start:dev' running?"
  fi
  sleep 1
done

echo "== Seeding twice and comparing counts (idempotency) =="
npm run seed
COUNT1=$(curl -s "$BASE_URL/countries/admin?limit=100" -H "x-admin-key: $ADMIN_API_KEY" | json_field "JSON.parse(d).meta.total")
npm run seed
COUNT2=$(curl -s "$BASE_URL/countries/admin?limit=100" -H "x-admin-key: $ADMIN_API_KEY" | json_field "JSON.parse(d).meta.total")
if [ "$COUNT1" = "$COUNT2" ]; then
  pass "Seeding twice: country count stable ($COUNT1)"
else
  fail "Country count changed across two seed runs: $COUNT1 -> $COUNT2"
fi

echo "== GET /countries returns SY and IQ =="
COUNTRIES=$(curl -s "$BASE_URL/countries")
echo "$COUNTRIES" | grep -q '"code":"SY"' || fail "SY missing from public countries list: $COUNTRIES"
echo "$COUNTRIES" | grep -q '"code":"IQ"' || fail "IQ missing from public countries list: $COUNTRIES"
pass "Public countries list includes SY and IQ"

SY_ID=$(echo "$COUNTRIES" | json_field "JSON.parse(d).data.find(c=>c.code==='SY').id")
[ -n "$SY_ID" ] || fail "Could not extract SY country id"

echo "== GET /cities?countryId=<SY id> returns only Syrian cities =="
CITIES=$(curl -s "$BASE_URL/cities?countryId=$SY_ID&limit=50")
echo "$CITIES" | grep -q 'Damascus' || fail "Damascus missing from Syrian cities: $CITIES"
if echo "$CITIES" | grep -q 'Baghdad'; then
  fail "Iraqi city (Baghdad) leaked into Syrian cities response"
fi
pass "Cities correctly filtered by countryId (Syrian cities only)"

echo "== Admin route without x-admin-key is rejected =="
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/countries/admin")
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  pass "Admin route without header returned $STATUS"
else
  fail "Admin route without header returned $STATUS, expected 401/403"
fi

echo "== Soft-delete SY via admin route =="
DELETE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE_URL/countries/admin/$SY_ID" -H "x-admin-key: $ADMIN_API_KEY")
[ "$DELETE_STATUS" = "204" ] || fail "DELETE /countries/admin/$SY_ID returned $DELETE_STATUS, expected 204"
pass "Soft-delete returned 204"

PUBLIC_AFTER=$(curl -s "$BASE_URL/countries")
if echo "$PUBLIC_AFTER" | grep -q '"code":"SY"'; then
  fail "SY still visible in public list after soft-delete: $PUBLIC_AFTER"
fi
pass "SY no longer visible in public list"

ADMIN_AFTER=$(curl -s "$BASE_URL/countries/admin/$SY_ID" -H "x-admin-key: $ADMIN_API_KEY")
echo "$ADMIN_AFTER" | grep -q '"code":"SY"' || fail "SY not visible via admin GET after soft-delete: $ADMIN_AFTER"
echo "$ADMIN_AFTER" | grep -q '"isDeleted":true' || fail "Admin view does not show isDeleted:true: $ADMIN_AFTER"
pass "SY still visible (and marked isDeleted:true) in admin view"

echo "== Re-seeding to leave the DB with an active SY for future runs =="
# The soft-deleted SY keeps its own _id (undelete isn't a Phase 1 feature); the
# partial unique index lets the seeder create a fresh active SY alongside it.
npm run seed > /dev/null
pass "Re-seeded"

echo "== GET /docs responds 200 =="
DOCS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$DOCS_URL")
[ "$DOCS_STATUS" = "200" ] || fail "GET $DOCS_URL returned $DOCS_STATUS, expected 200"
pass "Swagger docs respond 200"

echo ""
echo "ALL SMOKE TESTS PASSED"
