#!/usr/bin/env bash
# Smoke RF12 against production (or PROD_API_URL).
# Usage:
#   export API_SERVICE_KEY=...   # same as compliance .env
#   ./scripts/smoke-resolve-phone-prod.sh
# Optional: NAME=... EMAIL=... PROD_API_URL=https://api.compliance.opcore.com.br
set -euo pipefail

BASE="${PROD_API_URL:-https://api.compliance.opcore.com.br}"
BASE="${BASE%/}"
NAME="${NAME:-Joao Silva}"
EMAIL="${EMAIL:-joao.silva@example.com}"

if [[ -z "${API_SERVICE_KEY:-}" ]]; then
  echo "API_SERVICE_KEY is required" >&2
  exit 1
fi

echo "== health =="
curl -sS "$BASE/health" | jq .

echo "== auth =="
TOKEN=$(curl -sS -X POST "$BASE/auth/token" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_SERVICE_KEY}" \
  -d '{"sub":"smoke-resolve-phone","service":"ops"}' | jq -r .token)
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "failed to obtain JWT" >&2
  exit 1
fi

echo "== resolve-phone (expect 200 after deploy) =="
HTTP=$(curl -sS -o /tmp/resolve-phone-smoke.json -w '%{http_code}' \
  -X POST "$BASE/v1/contacts/resolve-phone" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg n "$NAME" --arg e "$EMAIL" '{name:$n,email:$e}')")
echo "HTTP $HTTP"
jq . /tmp/resolve-phone-smoke.json
if [[ "$HTTP" != "200" ]]; then
  echo "FAIL: expected HTTP 200" >&2
  exit 1
fi
echo "OK"
