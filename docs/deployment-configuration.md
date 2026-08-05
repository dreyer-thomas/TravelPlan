# Deployment Configuration

Most of this file is still to be written. There is no `Dockerfile`, no `docker-compose.yml`, no
`.nvmrc` or `.node-version`, no PM2 config and no systemd unit anywhere in the repository, so the
process manager, service names and install paths are genuinely not knowable from the source tree.
**Story 8.1 owns discovering and recording them** — see the CI/CD, Docker, Hosting and Environments
sections below, which are deliberately left as they were.

What *is* known and load-bearing is the media storage root, added by Story 8.3. It is recorded here
and in [deployment-guide.md](deployment-guide.md).

## Environment variables

These are the five variables the source tree reads (`grep -r 'process\.env\.' travelplan/src`, excluding
`NODE_ENV`). Two of the five have silent fallbacks, which is worth more attention than the three that
fail loudly: a variable that defaults to something plausible is one nobody discovers is unset.

| Variable | Required | Notes |
|---|---|---|
| `MEDIA_STORAGE_ROOT` | **Yes, in production** | Absolute path to the directory that holds uploaded media. See below. |
| `DATABASE_URL` | Yes | SQLite connection string, e.g. `file:/absolute/path/prisma/dev.db`. |
| `JWT_SECRET` | Yes | Session signing key (HS256). |
| `APP_BASE_URL` | **In practice yes** | Origin used to build the link in password-reset emails (`password-reset/request/route.ts`). **Falls back to `http://localhost:3000` with no warning**, so if it is unset in production every reset email links to localhost and the flow is unusable, with nothing in any log to say why. Set it to the public origin. |
| `OSRM_BASE_URL` | No | Route-geometry service. Defaults to the public `https://routing.openstreetmap.de`; set it only to point at a self-hosted deployment. |

### `MEDIA_STORAGE_ROOT`

Every uploaded photo — and from Story 9.1, every uploaded document — is written beneath this
directory and read back out of it by `/uploads/[...path]`, which authorises each request before
streaming a byte. Nothing else in the application knows where media lives:
`src/lib/trips/uploadPaths.ts` is the single source of truth and the only thing that reads this
variable.

**The server refuses to start if it is unset.** `src/instrumentation.ts` validates the media root once
per server process, before the first request is served, and that is the only real enforcement of the
requirements below — documentation cannot stop a redeploy from emptying a directory. Unset, the root
would default to `<cwd>/var`, which on a server is inside the application tree.

Precisely what "refuses to start" means, because it matters for health checks: Next logs
`Failed to prepare server` with the reason and then **answers `500` to every request, including `/`**.
The process stays alive and the port stays bound, so a check that only tests whether the port is open
will not notice — **check for `200` on a real route.** Verified against a production build: with the
variable unset both `/` and `/auth/login` return `500`; with it set they return `200`, static assets
serve, and `/uploads/...` returns `401` without a session.

The startup check refuses three things, each of which is otherwise silent:

- **An unset root** — unless `NODE_ENV` is exactly `development` or `test`. The allow-list is
  deliberate: a server running with `NODE_ENV` unset, or set to `staging` or `prod`, is still a server,
  and none of those is a reason to accept media inside the application tree.
- **A relative or `public/`-resident root** — see the requirements below.
- **A `public/uploads/` directory that has reappeared** — from a rollback, a restore from an old
  backup, or a half-finished migration. Next serves it statically ahead of the authorising route, so
  every file under it is published again while the application keeps working perfectly and the test
  suite stays green. Nothing else in the system would notice.

`next build` is exempt (it reads and writes no media), so the application still builds without the
variable set.

Requirements, all four of which matter:

1. **Absolute, and outside the application tree.** A deploy replaces the application directory. Media
   inside it disappears the first time one runs, silently, with nothing in any log to trace it back
   to. `/var/lib/travelplan/media` is the conventional shape for this on a Linux host; the concrete
   path depends on the server, which Story 8.1 documents.
2. **Readable and writable by the service user** that runs `npm start`. Uploads are written by the
   four image routes and by trip import; reads go through the serve route as the same user.
3. **It must survive a redeploy.** Point 1 is how that is achieved; this is the property being bought.
4. **The whole subtree must be on one filesystem.** Trip import moves an existing trip's directory
   aside with `fs.rename` before writing the replacement, to a sibling within
   `<root>/uploads/trips/`, so it can be put back if the import fails. `fs.rename` fails with
   `EXDEV` across filesystems. Both sides are always inside `<root>/uploads/trips/`, so a root that
   is itself a separate mount is fine — what is **not** fine is a root whose subtree is split across
   mounts (for example `<root>/uploads` mounted separately from `<root>`).

**Not** inside `public/` — that is the whole point of Story 8.3. `public/` is served statically by
Next, ahead of any route handler and without consulting the session, so media placed there is
readable by anyone who learns the URL. Also not inside `.next/`, which a rebuild replaces.

Development and test do not need the variable: the default `<repo>/travelplan/var` is correct there,
`travelplan/.gitignore` ignores `var/`, and the test suite overrides it with a per-worker temp
directory (`test/setup.ts`).

### One-time migration when upgrading past Story 8.3

Media used to live in `travelplan/public/uploads/`. Moving it is a **manual operator step performed
before the new build starts**, not something the application does — there is no migration script for
this on purpose, because a half-completed automatic move of live media is worse than a documented
manual one.

```sh
# 1. Stop the application.
# 2. Move, do not copy-then-guess. `uploads` is a segment of the stored URL, so it must reappear
#    directly beneath the new root:
mkdir -p "$MEDIA_STORAGE_ROOT"
mv /path/to/app/travelplan/public/uploads "$MEDIA_STORAGE_ROOT/uploads"
# 3. Verify the far side before deleting anything on the near side:
find "$MEDIA_STORAGE_ROOT/uploads" -type f | wc -l
du -sh "$MEDIA_STORAGE_ROOT/uploads"
# 4. Confirm public/uploads is gone, then deploy and start.
```

No stored URL changes and there is no database migration: a stored URL is
`/uploads/trips/<tripId>/…` before and after, because `uploads` comes from the URL rather than from
the root.

## Reverse proxy — `/uploads/` must reach the application

**This is a hard requirement, not a tuning option, and it is the one that actually broke on the
2026-08-05 rollout.** No `location` block may answer `/uploads/` from the filesystem. Story 8.3 put an
authorising route handler in front of uploaded media, and that handler is only reached if nginx passes
the request through. A proxy that serves those paths itself bypasses the session check completely —
the application cannot detect it, no test can see it, and the URLs keep working, so nothing looks
wrong.

What was actually deployed, and what it cost:

```nginx
# WRONG — this was live and served every trip photo without any authorisation
location ^~ /uploads/ {
    alias /home/app/apps/TravelPlan/travelplan/public/uploads/;
    try_files $uri =404;
    access_log off;
    expires 7d;
    add_header Cache-Control "public";
}
```

Three separate problems in seven lines: `alias` + `try_files` served the bytes straight off disk with
no session check; `expires 7d` + `Cache-Control: public` told **browsers and any intermediary cache**
to keep trip photos for a week, which is the opposite of the route's `private, max-age=0,
must-revalidate`; and `access_log off` meant no record of who fetched what. NFR2 was therefore still
open after Story 8.3 shipped — what closed it in practice was moving the files out of nginx's reach,
not the route handler, which never saw those requests.

**The fix is to delete the block.** With no regex `location` competing, `/uploads/` then falls through
to `location / { proxy_pass http://127.0.0.1:3001; … }` like every other path, and no `^~` is needed.

If a future config does introduce an extension-based static block — `location ~* \.(png|jpe?g|webp)$`
is the common shape — then `/uploads/` needs an explicit exemption, and it must use `^~`:

```nginx
location ^~ /uploads/ {           # ^~ is required: a plain prefix location loses to a regex location
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### The one-line check, after every proxy change

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/uploads/trips/x/y.png
```

- **`401`** — correct. The request reached the route and was refused for having no session. The path
  need not exist; authentication is checked before the filesystem.
- **`404`** — the proxy is answering it, or serving from a root that has no such file. The
  authorisation gate is being bypassed. A `404` whose `Content-Type` is `text/html` is proof: the
  route only ever answers with `application/json`.

Verify from outside, through the real hostname. A check against `127.0.0.1:3001` bypasses the proxy
and will answer `401` even while the public URL is wide open — that is precisely why this defect
survived the story's own test suite and its browser pass, both of which talked to the port directly.

**Before Story 9.1 ships, this must be true.** 9.1 puts ticket PDFs — names, addresses, booking codes
— behind the same `/uploads/trips/<tripId>/…` scheme. Any proxy rule that bypasses the handler
publishes them.

## CI/CD
- TBD (Story 8.1)

## Docker
- TBD (Story 8.1)

## Hosting
- TBD (Story 8.1). The only ambient signal in the repository is `next.config.ts`'s reference to an
  nginx `client_max_body_size 320m`, and `npm start` being `next start -p 3001 -H 127.0.0.1` — i.e.
  bound to loopback behind a reverse proxy.

## Environments
- TBD (Story 8.1)
