#!/usr/bin/env bash
#
# Read-only diagnostic for "a collaborator cannot open a shared trip".
# Answers two questions and changes nothing:
#   1. Which role does each collaborator actually hold? (VIEWER vs CONTRIBUTOR)
#   2. Is the running build new enough to contain Story 5.13's access fixes?
#
# Safe to run while TravelPlan.service is live: the database is opened read-only.
# Run on the server as the `app` user, or over ssh.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/app/apps/TravelPlan}"
APP_DIR="$REPO_DIR/travelplan"
DB="${DB:-$APP_DIR/prisma/prod.db}"
STORY_5_13_COMMIT="b759ec3"   # story 5-13-what-a-contributor-may-do-made-consistent

[ -r "$DB" ] || { echo "ERROR: cannot read $DB" >&2; exit 1; }

echo "=============================================================="
echo " TravelPlan access diagnostic — $(date +%Y-%m-%dT%H:%M:%S%z)"
echo " database: $DB"
echo "=============================================================="
echo

# --- 1. Which commit is actually deployed? ---------------------------------
echo "--- Deployed build ------------------------------------------"
if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$REPO_DIR" --no-pager log -1 --format='HEAD: %h %ad %s' --date=short
  if git -C "$REPO_DIR" merge-base --is-ancestor "$STORY_5_13_COMMIT" HEAD 2>/dev/null; then
    echo "Story 5.13 contributor-access fixes: PRESENT"
  else
    echo "Story 5.13 contributor-access fixes: *** MISSING — build predates $STORY_5_13_COMMIT ***"
  fi
else
  echo "(not a git checkout: $REPO_DIR)"
fi
echo

# --- 2. The data ------------------------------------------------------------
SQL="
.mode box
.headers on

SELECT '--- Accounts ---' AS '';
SELECT email,
       role                        AS account_role,
       must_change_password        AS must_change_pw,
       date(created_at)            AS created
FROM users
ORDER BY created_at;

SELECT '--- Trips and owners ---' AS '';
SELECT t.name AS trip, u.email AS owner
FROM trips t JOIN users u ON u.id = t.user_id
ORDER BY t.name;

SELECT '--- Memberships (THE ANSWER IS THIS TABLE) ---' AS '';
SELECT u.email       AS collaborator,
       t.name        AS trip,
       m.role        AS membership_role,
       date(m.created_at) AS granted
FROM trip_members m
JOIN users u ON u.id = m.user_id
JOIN trips t ON t.id = m.trip_id
ORDER BY u.email, t.name;

SELECT '--- Per-account summary ---' AS '';
SELECT u.email,
       SUM(CASE WHEN m.role = 'CONTRIBUTOR' THEN 1 ELSE 0 END) AS as_contributor,
       SUM(CASE WHEN m.role = 'VIEWER'      THEN 1 ELSE 0 END) AS as_viewer,
       (SELECT COUNT(*) FROM trips WHERE user_id = u.id)       AS owns
FROM users u LEFT JOIN trip_members m ON m.user_id = u.id
GROUP BY u.id ORDER BY u.email;
"

if command -v sqlite3 >/dev/null 2>&1; then
  # Dot-commands (.mode/.headers) are only honoured on stdin, not as an argument.
  printf '%s\n' "$SQL" | sqlite3 -readonly "$DB"
else
  # sqlite3 is not installed on this host; better-sqlite3 ships with the app.
  echo "(sqlite3 CLI not found - using the app's better-sqlite3)"
  echo
  NODE_BIN="${NODE_BIN:-$(command -v node || echo /opt/node-24/bin/node)}"
  JS="$(mktemp -t travelplan-access-XXXXXX).cjs"
  trap 'rm -f "$JS"' EXIT
  cat > "$JS" <<'NODEJS'
// Resolved by absolute path: this file lives in /tmp, so require() cannot find the
// app's node_modules on its own - and writing it into the app tree would leave the
// working copy dirty, which the deploy script refuses to run against.
const Database = require(process.env.APP_DIR + "/node_modules/better-sqlite3");
const db = new Database(process.env.DB, { readonly: true, fileMustExist: true });
const show = (title, sql) => {
  console.log("--- " + title + " ---");
  const rows = db.prepare(sql).all();
  if (!rows.length) console.log("(none)");
  else console.table(rows);
  console.log();
};
show("Accounts",
  "SELECT email, role AS account_role, must_change_password AS must_change_pw, date(created_at) AS created FROM users ORDER BY created_at");
show("Trips and owners",
  "SELECT t.name AS trip, u.email AS owner FROM trips t JOIN users u ON u.id = t.user_id ORDER BY t.name");
show("Memberships (THE ANSWER IS THIS TABLE)",
  "SELECT u.email AS collaborator, t.name AS trip, m.role AS membership_role, date(m.created_at) AS granted FROM trip_members m JOIN users u ON u.id = m.user_id JOIN trips t ON t.id = m.trip_id ORDER BY u.email, t.name");
show("Per-account summary",
  "SELECT u.email, SUM(CASE WHEN m.role = 'CONTRIBUTOR' THEN 1 ELSE 0 END) AS as_contributor, SUM(CASE WHEN m.role = 'VIEWER' THEN 1 ELSE 0 END) AS as_viewer, (SELECT COUNT(*) FROM trips WHERE user_id = u.id) AS owns FROM users u LEFT JOIN trip_members m ON m.user_id = u.id GROUP BY u.id ORDER BY u.email");
db.close();
NODEJS
  DB="$DB" APP_DIR="$APP_DIR" "$NODE_BIN" "$JS"
fi

echo "=============================================================="
echo "Read: no rows under Memberships -> the grant never reached the database.
      membership_role VIEWER  -> she is refused correctly; grant CONTRIBUTOR."
echo "      membership_role CONTRIBUTOR -> access control is not the fault; capture"
echo "      the failing request's HTTP status next."
echo "=============================================================="
