# Deployment Guide

The infrastructure half of this guide was discovered on the server during **Story 8.1** and is
recorded below. One thing is still missing and is called out where it belongs: **how new code reaches
the server**. Everything else — host, process manager, unit files, service user, install paths, both
Node versions and which application uses which — is written down.

Nothing in this guide is inferable from the repository. There is no `Dockerfile`, no
`docker-compose.yml`, no PM2 config and no systemd unit in the source tree. The only Node version pins
in the repo are `travelplan/package.json`'s `engines.node`, the root `.nvmrc`, and `node-version` in
the two GitHub Actions workflows — all four added by Story 8.1.

## The server, in one place

| | |
|---|---|
| Host name | `Travelblog` — **named after the other application**, not this one |
| Architecture | `arm64` (`aarch64`). Note CI runs on `ubuntu-latest`, which is **x64** — CI never exercises production's architecture |
| Process manager | **systemd**, system-level units in `/etc/systemd/system/` |
| Units | `TravelPlan.service`, `TravelBlogs.service` |
| Service user | **`app` for both applications** — they share it |
| TravelPlan tree | `/home/app/apps/TravelPlan/travelplan` |
| TravelBlogs tree | `/home/app/apps/TravelBlogs/travelblogs` |
| TravelPlan runtime | Node **24.19.0** (ABI 137) at `/opt/node-24` → `/opt/node-v24.19.0-linux-arm64` |
| TravelBlogs runtime | Node **20.19.6** (ABI 115) at `/usr/bin/node`, from the NodeSource apt repo |
| Media root | `/var/lib/travelplan/media` |
| Database | `/home/app/apps/TravelPlan/travelplan/prisma/prod.db` — **inside the application tree**, see the warning below |
| Listens on | `127.0.0.1:3001`, behind nginx |

**The shared `app` user is the constraint that shapes everything else.** Because both applications run
as the same user, anything that selects a Node version *for that user* — `nvm`, a line in
`~/.profile`, a change to the system-wide `node` — moves both applications at once. Per-version
selection must therefore be **per systemd unit**, never per user. With systemd that is easy; it would
have been considerably harder under PM2, whose daemon is per-user.

## Infrastructure requirements

- Node.js **24.x** for TravelPlan, pinned by `engines.node: ">=24 <25"` in `travelplan/package.json`
  and by the unit file. TravelBlogs remains on Node 20 and is out of scope — but note that Node 20
  reached end of life, so TravelBlogs carries the exposure TravelPlan just shed.
- SQLite on disk, via `@prisma/adapter-better-sqlite3`. Single-process — `next start` must not be run
  as a multi-instance cluster against one database file.
- A reverse proxy. `npm start` is `next start -p 3001 -H 127.0.0.1`, bound to loopback.
  `next.config.ts` documents an nginx `client_max_body_size 320m`, which is what lets a large trip
  backup reach the import route to be accepted or refused on its own terms.
- **The proxy must not serve `/uploads/` itself.** Uploaded media is authorised by a route handler, so
  a `location` block that answers those paths from disk bypasses the session check entirely and
  publishes every trip photo. This was live until 2026-08-05. Full detail and the one-line check in
  [deployment-configuration.md](deployment-configuration.md#reverse-proxy--uploads-must-reach-the-application).
- **A persistent media directory outside the application tree** — see below. This is the one
  infrastructure requirement that will silently destroy user data if it is missed.

## Environment configuration

The source tree reads five variables. Three fail loudly when unset; two fall back silently, and those
are the ones to watch. Full table in
[deployment-configuration.md](deployment-configuration.md#environment-variables).

| Variable | Notes |
|---|---|
| `MEDIA_STORAGE_ROOT` | Absolute path to the uploaded-media directory. **The server refuses to start without it** — it answers `500` to every request rather than exiting, so health-check for `200` on a real route, not for an open port. |
| `DATABASE_URL` | `file:` URL to the SQLite database. |
| `JWT_SECRET` | Session signing key. |
| `APP_BASE_URL` | Public origin for password-reset email links. **Silently defaults to `http://localhost:3000`** — unset in production, every reset email is unusable and nothing logs it. |
| `OSRM_BASE_URL` | Optional. Route geometry; defaults to the public OSRM instance. |

### The media root

Since Story 8.3, uploaded photos and documents are **not** served as static files. They live outside
`public/` and are read back through `/uploads/[...path]`, a route handler that checks the session and
the caller's access to the trip before streaming any bytes — closing NFR2 for media, which until then
held only for database rows.

For the operator that means one directory to get right:

- Set `MEDIA_STORAGE_ROOT` to an **absolute path outside the application tree**
  (`/var/lib/travelplan/media` is the conventional shape; the concrete path is Story 8.1's to record).
- The **service user must be able to read and write it.**
- **It must survive a redeploy.** A root inside the application tree — which is what an unset variable
  would give you, since the default is `<cwd>/var` — is emptied the first time a deploy replaces that
  tree, with no error anywhere to explain where the photos went. This is why `src/instrumentation.ts`
  validates the root at startup rather than only documenting the rule: the check also refuses a
  relative root, a root inside `public/`, and a `public/uploads/` directory that has reappeared and
  would be served statically ahead of the authorising route. `next build` is exempt, so the
  application still builds without the variable.
- Keep the **whole subtree on one filesystem**: trip import relies on `fs.rename` within
  `<root>/uploads/trips/`, which fails with `EXDEV` across mounts. The root being its own mount is
  fine; splitting the subtree across mounts is not.

### Upgrading past Story 8.3 — one manual step, before the new build starts

The existing contents of `travelplan/public/uploads/` must be moved to `$MEDIA_STORAGE_ROOT/uploads/`
by hand, with the application stopped, and the file count and total size verified on the far side
before anything is deleted on the near side. There is deliberately no script for this. The exact
commands are in
[deployment-configuration.md](deployment-configuration.md#one-time-migration-when-upgrading-past-story-83).

No stored URL and no database row changes: a stored URL is `/uploads/trips/<tripId>/…` before and
after.

**And check the reverse proxy in the same pass**, because the move alone does not finish the job — this
is what went wrong on 2026-08-05. Remove any `location` that answers `/uploads/` from the filesystem,
then verify **through the public hostname**:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/uploads/trips/x/y.png   # must be 401, not 404
```

`401` means the request reached the authorising handler. `404` means the proxy is still answering it
and the authorisation gate is bypassed. Checking `127.0.0.1:3001` instead proves nothing here — it
skips the proxy, which is exactly how this defect stayed invisible.

## ⚠️ The production database lives inside the application tree

`DATABASE_URL=file:/home/app/apps/TravelPlan/travelplan/prisma/prod.db`.

Everything this guide says about `MEDIA_STORAGE_ROOT` needing to sit outside the application tree
applies to that file too, and nothing enforces it: `src/instrumentation.ts` validates the media root at
startup, but no equivalent check exists for the database. **A deploy that replaces the application
directory rather than updating it in place destroys production data.** A `git pull` or an in-place
`rsync` is safe; a fresh-checkout-and-swap is not. This is unresolved and tracked as `DW-328` — settle
it before changing how deploys work, not after.

## Deployment process

**How new code reaches `/home/app/apps/TravelPlan/travelplan` is the one thing still not written
down.** It was not discoverable from the box without watching a deploy happen. Whoever runs the next
one should record it here, and answer the database question above in the same pass.

What *is* established:

- `npm start` is `next start -p 3001 -H 127.0.0.1` — loopback only, nginx in front.
- Both applications install **dev dependencies** on the server (`node_modules/vitest` is present in
  both trees). That has a consequence for the security gate, recorded as `DW-329`.
- No schema migration runs automatically. `postinstall` is `prisma generate`, which only regenerates
  the client. Applying migrations is a separate, manual step.
- The media-root move described above must happen **before** the first start of a build containing
  Story 8.3.

### Restarting

```sh
sudo systemctl restart TravelPlan     # never `systemctl restart node` or anything user-scoped
systemctl status TravelPlan --no-pager
```

### The health check that actually works

**Do not health-check the port, and do not health-check `/auth/login`.** Both report success through
real outages:

- An unset or invalid `MEDIA_STORAGE_ROOT` leaves the process alive with the port bound, answering
  `500` to everything.
- `/auth/login` renders a static form and touches neither the database nor `better-sqlite3`, so it
  answers `200` while the data layer is completely dead. This was observed for real during the Story
  8.1 upgrade: the application returned `200` on that route while running an ABI-115 interpreter
  against an ABI-137 `node_modules`, in which state every data-bearing request failed.

Use a request that forces a database read:

```sh
T=$(curl -s -c /tmp/cj http://127.0.0.1:3001/api/auth/csrf | grep -oE '[a-f0-9]{64}' | head -1)
curl -s -b /tmp/cj -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' -H "x-csrf-token: $T" \
  --data '{"email":"nobody@example.invalid","password":"wrong"}' -w '\nHTTP %{http_code}\n'
```

`invalid_credentials` + **`401`** means a user lookup reached SQLite and answered. **`500`** means the
native module failed to load, whatever the rest of the site appears to do.

## Changing TravelPlan's Node version

The two applications are separated **only** by their unit files. Both `ExecStart` lines invoke `npm`,
and `npm` resolves `node` through its shebang, so **the unit's `PATH` matters as much as its
`ExecStart`**: `npm start` spawns `next start`, and that child resolves `node` from `PATH`. Pinning one
without the other leaves the interpreter to chance.

TravelPlan's unit therefore carries both:

```ini
Environment=PATH=/opt/node-24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/node-24/bin/npm start
```

`TravelBlogs.service` is deliberately untouched: it keeps `ExecStart=/usr/bin/npm run start` and the
default `PATH`, so it resolves `/usr/bin/node` (v20).

### Installing a Node version alongside the existing one

**Never install a new Node major from the NodeSource apt repository.** The package is named `nodejs`
regardless of major version, so apt *replaces* `/usr/bin/node` — and because both units resolve node
through `PATH`, that silently migrates TravelBlogs too. Use the official tarball in its own prefix:

```sh
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-arm64.tar.xz
sudo tar -xJf node-v24.19.0-linux-arm64.tar.xz -C /opt
sudo chown -R root:root /opt/node-v24.19.0-linux-arm64   # the tarball's uid 1000 maps to `app` here
sudo ln -sfn /opt/node-v24.19.0-linux-arm64 /opt/node-24
/opt/node-24/bin/node -v && /opt/node-24/bin/node -p process.versions.modules
/usr/bin/node -v                                          # MUST be unchanged
```

### Reinstalling `node_modules` after a version change

Native modules are compiled against Node's ABI, so **a Node major change requires a full reinstall**,
and the tree is unusable by the old version afterwards. `prisma generate` runs as `postinstall` and
needs `DATABASE_URL`, which a manual shell does not inherit from the unit:

```sh
sudo -u app -H bash -c '
  set -e
  test -x /opt/node-24/bin/npm || { echo "FATAL: prefix missing"; exit 1; }
  cd /home/app/apps/TravelPlan/travelplan
  export PATH=/opt/node-24/bin:$PATH
  export DATABASE_URL=file:/home/app/apps/TravelPlan/travelplan/prisma/prod.db
  echo "installing with: $(/opt/node-24/bin/node -v)"
  rm -rf node_modules
  /opt/node-24/bin/npm ci
  ls node_modules/better-sqlite3/build/Release/
'
```

Invoke `npm` by **absolute path**. `export PATH=/nonexistent:$PATH` is not an error — the shell simply
falls through to the system `npm` and installs against the wrong runtime with no failure. That happened
during Story 8.1 and was caught only by the `EBADENGINE` warning that `engines.node` now produces.

Two success markers:

- **No `EBADENGINE` for `travelplan@0.1.0`.** Its presence means the wrong interpreter ran.
- **`ls` prints only `better_sqlite3.node`.** `obj/`, `obj.target/` and `sqlite3.a` mean a source
  compile, which means the prebuild for that ABI/platform was not found. `better-sqlite3` 12.11.1
  publishes `node-v137` for `linux-arm64` but **no `node-v115`** — which is why this server compiled
  from source on Node 20 and stopped doing so on Node 24. The build toolchain is consequently optional
  on 24 and required on 20; keep it installed while a rollback is still plausible.

### Ordering, and why it is not reversible halfway

The reinstall makes `node_modules` ABI-137, which the running Node 20 process cannot load. From that
moment until the unit is switched, the application is broken for any data-bearing request — and
`Restart=on-failure` will happily restart it into a crash loop. **Do the reinstall and the unit change
in one sitting.**

```sh
# 1. install Node 24 in its own prefix, verify /usr/bin/node unchanged
# 2. reinstall node_modules as `app` on Node 24
# 3. edit TravelPlan.service: add the PATH line, repoint ExecStart
sudo systemd-analyze verify /etc/systemd/system/TravelPlan.service
sudo systemctl daemon-reload && sudo systemctl restart TravelPlan
# 4. verify — all three, not just the first
sudo readlink -f /proc/$(systemctl show -p MainPID --value TravelPlan)/exe    # /opt/node-24/...
sudo readlink -f /proc/$(systemctl show -p MainPID --value TravelBlogs)/exe   # /usr/bin/node
#    then the database-touching health check above
```

`systemd-analyze verify` only checks syntax. It passes happily on a file whose edits were never saved,
which is exactly how a restart during Story 8.1 came back on the old interpreter. **Confirm with
`readlink`, not with `verify` and not with "the site loads".**

### Rollback

Reverting `ExecStart` alone is **not** a rollback: it leaves Node 20 facing an ABI-137 tree, which
cannot load. Both steps are required.

```sh
sudo cp ~/TravelPlan.service.bak /etc/systemd/system/TravelPlan.service
sudo -u app -H bash -c '
  cd /home/app/apps/TravelPlan/travelplan
  export DATABASE_URL=file:/home/app/apps/TravelPlan/travelplan/prisma/prod.db
  rm -rf node_modules && /usr/bin/npm ci
'
sudo systemctl daemon-reload && sudo systemctl restart TravelPlan
```

That second `npm ci` compiles `better-sqlite3` from source, so it needs `gcc`, `make` and `python3`
present.

## CI/CD details

**There is no automated deployment.** CI runs two GitHub Actions workflows and neither touches the
server:

| Workflow | Trigger | What it does |
|---|---|---|
| `security-audit.yml` | push to `main`/`master`, PRs, weekly cron, manual | `npm ci --ignore-scripts`, package provenance, `npm run audit:check` |
| `migration-guard.yml` | push to `main`/`master`, PRs | `npm run check:migrations` — migration immutability |

Both pin `node-version: 24` to match production, as of Story 8.1. Two caveats worth knowing:

- **`ubuntu-latest` is x64; production is arm64.** No CI job runs on the production architecture, so
  architecture-specific problems — a missing native prebuild, most obviously — can only be caught on
  the server.
- `--ignore-scripts` on the audit job exists because `postinstall` → `prisma generate` needs a
  `DATABASE_URL` that CI does not have. It is unrelated to the Node version.

Also note that `npm run audit:check` runs `npm audit --omit=dev`, while the server installs dev
dependencies — so the audited tree and the deployed tree are not the same tree. Tracked as `DW-329`.
