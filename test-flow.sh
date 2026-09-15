#!/usr/bin/env bash
# Verifies: after 6 teams have won, a 7th team's correct answer is still
# accepted and processed (marked "answered late"), not blocked outright.
#
# Usage:
#   1. In one terminal: npm start   (leave it running)
#   2. In another terminal, from the qr-game folder:
#        ADMIN_PASSWORD=your-real-password bash test-flow.sh
#
set -e
BASE="${BASE_URL:-http://localhost:3000}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD to your .env value first}"
JAR_DIR=$(mktemp -d)
ADMIN_JAR="$JAR_DIR/admin.txt"

echo "== Reset the game so we start clean =="
curl -s -c "$ADMIN_JAR" -X POST "$BASE/api/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" > /dev/null
curl -s -b "$ADMIN_JAR" -X POST "$BASE/api/admin/reset" > /dev/null
echo "  done"

# QR -> correct answer, matching the riddle set currently seeded in server/db.js
get_answer() {
  case "$1" in
    1) echo "Light" ;;
    2) echo "Gravity" ;;
    3) echo "Current" ;;
    4) echo "Pressure" ;;
    5) echo "Matter" ;;
    6) echo "Momentum" ;;
  esac
}

echo "== Register 6 teams, one per QR code (these will be the winners) =="
for qr in 1 2 3 4 5 6; do
  jar="$JAR_DIR/team$qr.txt"
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/register" \
    -H "Content-Type: application/json" \
    -d "{\"qrId\":$qr,\"teamId\":\"WIN$qr\",\"player1Name\":\"P1-$qr\",\"player2Name\":\"P2-$qr\"}" > /dev/null
  echo "  registered WIN$qr on QR$qr"
done

echo "== Register a 7th team on QR1 (second slot) — this is the one we're testing =="
LATE_JAR="$JAR_DIR/late.txt"
curl -s -c "$LATE_JAR" -b "$LATE_JAR" -X POST "$BASE/api/register" \
  -H "Content-Type: application/json" \
  -d '{"qrId":1,"teamId":"LATE7","player1Name":"P1-late","player2Name":"P2-late"}' > /dev/null
echo "  registered LATE7 on QR1"

echo "== Start the game =="
curl -s -b "$ADMIN_JAR" -X POST "$BASE/api/admin/start" > /dev/null
echo "  game is LIVE"

echo "== Submit correct answers for the 6 winning teams =="
for qr in 1 2 3 4 5 6; do
  jar="$JAR_DIR/team$qr.txt"
  answer="$(get_answer "$qr")"
  result=$(curl -s -b "$jar" -X POST "$BASE/api/answer" \
    -H "Content-Type: application/json" \
    -d "{\"answer\":\"$answer\"}")
  echo "  WIN$qr -> $result"
done

echo ""
echo "== THE ACTUAL TEST: LATE7 submits the correct QR1 answer AFTER 6 winners exist =="
result=$(curl -s -b "$LATE_JAR" -X POST "$BASE/api/answer" \
  -H "Content-Type: application/json" \
  -d '{"answer":"Light"}')
echo "$result"
echo ""
echo "Expected: outcome \"CORRECT_TOO_LATE\", team.status \"LOSE\", team.loseReason \"ANSWERED_LATE\""
echo "If you see that instead of a rejection/error, the fix is working: the 7th team's"
echo "answer was still processed, it just didn't win because all 6 slots were taken."

echo ""
echo "== Checking WIN1's status BEFORE admin publishes results =="
before=$(curl -s -b "$JAR_DIR/team1.txt" "$BASE/api/team/state")
echo "$before"
echo "Expected: status \"PENDING\" (not WINNER, even though WIN1 actually won)"

echo ""
echo "== Admin publishes results =="
curl -s -b "$ADMIN_JAR" -X POST "$BASE/api/admin/publish-results" > /dev/null
echo "  published"

echo ""
echo "== Checking WIN1's status AFTER admin publishes results =="
after=$(curl -s -b "$JAR_DIR/team1.txt" "$BASE/api/team/state")
echo "$after"
echo "Expected: status \"WINNER\" with a globalRank now visible"

rm -rf "$JAR_DIR"