# Deploy

Infrastructure that lives on the server but belongs in version control.

| File | Lives on the server at |
|---|---|
| [`deploy-travelplan.sh`](deploy-travelplan.sh) | `/usr/local/bin/deploy-travelplan.sh` |
| [`travelplan.env.example`](travelplan.env.example) | Template only: the production environment for a new server, with every variable, the reference non-secret values and empty secrets. Today the values live inline in `TravelPlan.service`; as a file it goes outside the application tree (`root:root`, `600`, `EnvironmentFile=`). A filled-in copy must never be committed (`deploy/*.env` is ignored). |

The operational reference — host, systemd units, Node runtime, health checks, rollback — is
[`docs/deployment-guide.md`](../docs/deployment-guide.md). This directory holds the artefacts
themselves so they can be diffed, reviewed and restored.

## The copy here is not the one that runs

Nothing synchronises the two. The server executes its own copy; this one is a record. **A change made
in one place has to be made in the other**, and the failure mode is quiet: a repository copy that has
drifted is worse than none, because it reads as authoritative.

Check them against each other before trusting either:

```sh
ssh app@<host> 'sha256sum /usr/local/bin/deploy-travelplan.sh'
sha256sum deploy/deploy-travelplan.sh
```

The version committed here was taken verbatim from the server on **2026-08-15**, after the `DW-332`
fix. It is what runs, not what we wish ran — see below for the difference.

## Why this is here at all

`DW-332`: the script backed up `prisma/dev.db` while the service reads `prisma/prod.db`. `dev.db` was
a zero-byte leftover, so `cp` succeeded, `set -e` never fired, and every deploy reported a successful
backup while writing nothing. It ran that way for months. **Production had no backups and nothing said
so.**

A defect that size survives because nobody can read the script. That is the argument for this
directory.

## Connector (Epic 15)

TravelPlan can be added to Claude as a custom connector (remote MCP server with its own OAuth sign-in).

- **URL to give users:** `https://plan.dreyer-travels.de/api/mcp`. In claude.ai: *Settings → Connectors →
  Add custom connector*. In Claude Code: `claude mcp add --transport http travelplan https://plan.dreyer-travels.de/api/mcp`,
  then `/mcp` to sign in.
- **Switch:** `MCP_ENABLED=true` in the unit's environment; anything else turns every connector endpoint
  into a 404. With the switch on, `APP_BASE_URL` must be `https://…` or startup fails (`instrumentation.ts`).
- **Who may connect:** `MCP_CLIENT_ID_HOSTS` (default `claude.ai`). A refused client logs
  `oauth/authorize: client_id host not allowed: <host>`; add a host only if it belongs to the assistant
  you mean to allow.
- **Nginx:** must pass `/.well-known/*`, `/oauth/*`, `/api/oauth/*` and `/api/mcp` to the app unchanged.
  All of them answer plain JSON or HTML, so no SSE or buffering settings are needed. Check with
  `curl -i https://plan.dreyer-travels.de/.well-known/oauth-authorization-server`: it must return JSON
  from the app, not an Nginx 404.
- **State:** codes and tokens live in the database (`oauth_authorization_codes`, `oauth_tokens`, hashed),
  so connections survive restarts and deploys.

## Known open items

Tracked in `_bmad-output/implementation-artifacts/deferred-work.md`, not fixed in the committed copy,
because the copy must match what actually runs:

- **`DW-334`** — the runtime is selected implicitly. `npm ci` and `npm run build` use whatever `node`
  the invoking shell resolves; the unit's `Environment=PATH` reaches only the process systemd spawns
  and never this script. It works today because `/opt/node-24/bin` is on the `app` user's `PATH`, which
  is ambient rather than declared. An explicit `export PATH=/opt/node-24/bin:$PATH` behind a `test -x`
  guard, plus `echo "$(node -v)"`, would put the build runtime in every deploy log.
- **`DW-334`** — verification is `systemctl is-active`, which is true of a process that is up and
  answering `500` to every request. That is precisely what a bad `MEDIA_STORAGE_ROOT` produces:
  `src/instrumentation.ts` fails startup validation, the port stays bound and the process stays alive.
  The replacement is in
  [the deployment guide](../docs/deployment-guide.md#the-health-check-that-actually-works) — a CSRF +
  login POST where `401` proves a real SQLite read and `500` proves the data layer is dead.
- The database path is hardcoded as `prod.db` rather than derived from the unit's `DATABASE_URL`. That
  is the same shape that produced `DW-332`. Two lines asserting the two agree would make it
  unrepeatable. Note that reading the unit environment pulls `JWT_SECRET` into scope, so never add
  `set -x` to this script.
- The `npm ci` comment claims `node-gyp` rebuilds are *"minutenlang und speicherhungrig"*. That was
  true on Node 20, for which `better-sqlite3` 12.11.1 publishes no `linux-arm64` prebuild. On Node 24
  it downloads `node-v137` and takes about twenty seconds. The skip-if-unchanged branch now saves
  little and is the thing most likely to hide an ABI mismatch after a future Node change.

## Not here yet

The two systemd units, `TravelPlan.service` and `TravelBlogs.service`, are equally load-bearing and
equally absent — tracked as `DW-353`. `TravelPlan.service` cannot be committed as-is because it holds
`JWT_SECRET` as an inline `Environment=` value (`DW-331`); a redacted template is the way in.
