# Deployment Guide

This guide is incomplete by design. The infrastructure half — process manager, service names, install
paths, the deployment process itself and CI/CD — is **Story 8.1's** to discover and write; none of it
is inferable from the repository, which contains no `Dockerfile`, no `docker-compose.yml`, no
`.nvmrc`, no PM2 config and no systemd unit.

What is recorded here is what Story 8.3 established and what a deploy will get wrong if it is not
written down: **where uploaded media lives**. Full detail in
[deployment-configuration.md](deployment-configuration.md).

## Infrastructure requirements

- Node.js. The current environment runs **v20.19.2**; nothing in the repository pins it (`engines` is
  absent). Story 8.1 owns the move to Node 24.
- SQLite on disk, via `@prisma/adapter-better-sqlite3`. Single-process — `next start` must not be run
  as a multi-instance cluster against one database file.
- A reverse proxy. `npm start` is `next start -p 3001 -H 127.0.0.1`, bound to loopback.
  `next.config.ts` documents an nginx `client_max_body_size 320m`, which is what lets a large trip
  backup reach the import route to be accepted or refused on its own terms.
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

## Deployment process

- TBD (Story 8.1) — except for the media-root move above, which must happen **before** the first
  start of a build that contains Story 8.3.

## CI/CD details

- TBD (Story 8.1)
