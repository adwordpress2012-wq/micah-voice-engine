#!/usr/bin/env bash
# Smoke-tests the live production Micah voice API.
# Run from the micah-web directory:
#   bash .claude/skills/run-micah-web/smoke.sh
# Or against the production domain directly — no local server needed.
set -euo pipefail

BASE="${1:-https://micah.directiveos.com.au}"

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }

echo "=== Micah voice smoke tests → $BASE ==="

# 1. GET /api/voice/process returns the route description
OUT=$(curl -s "$BASE/api/voice/process")
echo "$OUT" | grep -q "Micah AI reply" && pass "GET /api/voice/process" || fail "GET /api/voice/process — unexpected: $OUT"

# 2. GET /api/voice/incoming returns the route description
OUT=$(curl -s "$BASE/api/voice/incoming")
echo "$OUT" | grep -q "gather" && pass "GET /api/voice/incoming" || fail "GET /api/voice/incoming — unexpected: $OUT"

# 3. POST /api/voice/process with empty SpeechResult (bad sig → immediate silent gather)
OUT=$(curl -s -X POST "$BASE/api/voice/process" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "SpeechResult=&CallSid=CA-smoke-test&From=%2B61400000000&To=%2B61259506382")
echo "$OUT" | grep -q "<Gather" && pass "POST /api/voice/process empty speech → silent Gather" || fail "POST /api/voice/process empty speech — unexpected: $OUT"

# 4. Confirm no listening filler in any TwiML response
echo "$OUT" | grep -qi "listening" && fail "Found 'listening' in TwiML response — BAD" || pass "No 'listening' in TwiML"

# 5. Static MP3 assets reachable
for ASSET in micah-dos-sba-greeting-v2.mp3 micah-demo-dos-answer.mp3; do
  STATUS=$(curl -sI "$BASE/$ASSET" | head -1 | awk '{print $2}')
  [ "$STATUS" = "200" ] && pass "Static $ASSET (200)" || fail "Static $ASSET → HTTP $STATUS"
done

echo ""
echo "=== All smoke tests passed ==="
