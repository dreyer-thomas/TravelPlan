#!/usr/bin/env bash
set -euo pipefail

SERVICE="TravelPlan"
REPO_DIR="/home/app/apps/TravelPlan"
APP_DIR="/home/app/apps/TravelPlan/travelplan"
BRANCH="main"
BACKUP_DIR="/home/app/backups"
KEEP_BACKUPS=10

echo "==> Deploy started: $(date -Is)"

# --- Vorprüfungen, solange der Dienst noch läuft -----------------------------
cd "$REPO_DIR"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: $REPO_DIR is not a git repository" >&2
  exit 1
fi

# Ein schmutziger Baum bedeutet, dass jemand direkt auf dem Server editiert hat.
# git pull --ff-only würde das wegwerfen oder abbrechen - lieber vorher sagen.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree in $REPO_DIR has local changes:" >&2
  git status --short >&2
  exit 1
fi

# Merken, wie die Abhängigkeiten VOR dem Pull aussahen.
LOCK_BEFORE=$(sha256sum "$APP_DIR/package-lock.json" | cut -d' ' -f1)

echo "==> Stopping service: $SERVICE"
sudo systemctl stop "$SERVICE"

# --- Ab hier ist der Dienst aus: JEDER Abbruch muss ihn wieder anwerfen. -----
# Ohne das beendet `set -e` das Skript vor dem Start und die Seite bleibt weg.
trap 'echo "!! Deploy failed - restarting $SERVICE with the previous build"; sudo systemctl start "$SERVICE" || true' ERR

# Sicherung. Der Dienst ist gestoppt, also schreibt niemand mehr - ein einfaches
# cp genügt und braucht kein sqlite3 auf der Maschine.
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/prod.db.$(date +%Y%m%d-%H%M%S)"
cp "$APP_DIR/prisma/prod.db" "$BACKUP"
echo "==> DB backed up to $BACKUP"
ls -1t "$BACKUP_DIR"/prod.db.* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

echo "==> Updating repo: $REPO_DIR (branch: $BRANCH)"
git fetch origin
git checkout "$BRANCH"

git pull --ff-only origin "$BRANCH"

cd "$APP_DIR"

# npm ci übersetzt bcrypt und better-sqlite3 per node-gyp neu. Das ist auf dieser
# Maschine minutenlang und speicherhungrig, also nur wenn sich die Lock-Datei
# wirklich geändert hat. Der Prisma-Client liegt im Git (src/generated/prisma),
# er braucht kein postinstall.
if [ "$LOCK_BEFORE" != "$(sha256sum package-lock.json | cut -d' ' -f1)" ]; then
  echo "==> package-lock.json changed - installing"
  npm ci --no-audit --no-fund
else
  echo "==> dependencies unchanged - skipping install"
fi

# No-op, wenn nichts anliegt. Story 6.16 hat keine Migration erzeugt, weil
# transport_type auf SQLite ein blankes TEXT ohne CHECK ist - aber die nächste
# echte Schemaänderung braucht diesen Schritt, und nichts sonst erinnert daran.
echo "==> Applying migrations"
npx prisma migrate deploy

# `.next` wird VOR dem Build geloescht, und das ist kein Aufraeumen - es schliesst
# ein Fail-Open. Seit Story 8.2 heisst der Auth-Gate `src/proxy.ts`, und Next baut
# diese Konvention als Node-Middleware: `loadNodeMiddleware()` laedt
# `.next/server/middleware.js` per require und verschluckt ENOENT und
# MODULE_NOT_FOUND still (`next-server.js:1065-1079`). Fehlt das Modul, liefert
# `getMiddleware()` undefined, `handleCatchallMiddlewareRequest` ruft
# `handleFinished()` - und die Anfrage laeuft OHNE Session-Pruefung weiter.
# Ein abgebrochener Build, der `functions-config-manifest.json` schon geschrieben
# hat und `server/middleware.js` noch nicht, hinterlaesst genau diesen Zustand:
# die App laeuft, `is-active` meldet gruen, und jede Route ist offen. Der ERR-Trap
# oben startet den Dienst genau auf so einem halben Build wieder. Inkrementell zu
# bauen spart hier weniger, als ein ungeschuetzter Server kostet.
echo "==> Removing previous build output"
rm -rf .next

echo "==> Building app"
npm run build

# --- Ab hier darf der normale Start laufen ----------------------------------
trap - ERR

echo "==> Starting service: $SERVICE"
sudo systemctl start "$SERVICE"

# Kurz warten und nachsehen, ob er auch oben BLEIBT - `start` kehrt zurück,
# bevor die App den Port belegt, und ein Absturz nach zwei Sekunden sähe sonst
# aus wie ein geglückter Deploy.
sleep 5
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "!! $SERVICE did not stay up:" >&2
  sudo journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi

# `is-active` sagt nur, dass der Prozess laeuft - nicht, dass er noch bewacht wird.
# Genau das ist die Luecke oben: ein Server ohne geladene Middleware ist aus Sicht
# von systemd tadellos. Also einmal wirklich anklopfen. `/trips` ist im Matcher von
# `src/proxy.ts`, und ohne Cookie muss der Gate mit 307 auf /auth/login umleiten.
# Kommt stattdessen 200, laeuft die App ohne Auth und der Deploy ist ein Vorfall,
# kein Erfolg - deshalb Abbruch mit Meldung statt einer Zeile im Log.
echo "==> Verifying the session gate is live"
GATE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "http://127.0.0.1:3001/trips" || echo "000")
if [ "$GATE_STATUS" != "307" ]; then
  echo "!! SESSION GATE NOT ACTIVE: anonymous GET /trips answered $GATE_STATUS, expected 307." >&2
  echo "!! The app is serving protected routes without authentication. Stopping $SERVICE." >&2
  sudo systemctl stop "$SERVICE" || true
  sudo journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi
echo "==> Session gate confirmed (anonymous /trips -> $GATE_STATUS)"

sudo systemctl --no-pager --full status "$SERVICE" || true
echo "==> Deploy finished: $(date -Is)"
