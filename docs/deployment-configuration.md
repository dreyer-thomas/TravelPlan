# Deployment Configuration

The process manager, service names and install paths were discovered on the server during **Story
8.1** and are recorded in [deployment-guide.md](deployment-guide.md), which is the operational
reference. This file holds the configuration detail: environment variables, the systemd unit, and the
reverse proxy.

Still not written down anywhere: **how new code reaches the server.** See
[deployment-guide.md](deployment-guide.md#deployment-process).

## Environment variables

These are the thirteen variables the source tree reads (`grep -r 'process\.env\.' travelplan/src`, excluding
`NODE_ENV`). Two of the first five have silent fallbacks, which is worth more attention than the three that
fail loudly: a variable that defaults to something plausible is one nobody discovers is unset. The next
three (Story 12.1) belong to the optional AI day suggestions and are read only in `src/lib/ai/config.ts`.
The last five (Story 8.8) are the SMTP settings for password-reset email, read only in
`src/lib/notifications/smtpConfig.ts`; in production the server refuses to start without them (see
*Password-reset email* below). `travelplan/.env.example` lists all thirteen for local development; [`deploy/travelplan.env.example`](../deploy/travelplan.env.example) is the production starting point for a new server (all thirteen plus `NODE_ENV`, the non-secret values below, empty secrets).

| Variable | Required | Notes |
|---|---|---|
| `MEDIA_STORAGE_ROOT` | **Yes, in production** | Absolute path to the directory that holds uploaded media. See below. |
| `DATABASE_URL` | Yes | SQLite connection string, e.g. `file:/absolute/path/prisma/dev.db`. In production it is `file:/home/app/apps/TravelPlan/travelplan/prisma/prod.db` — **inside the application tree**, which is the same hazard this file spends several paragraphs warning about for media, except that nothing validates it at startup. A deploy that replaces the tree rather than updating it in place destroys production data. Tracked as `DW-328`. |
| `JWT_SECRET` | Yes | Session signing key (HS256). |
| `APP_BASE_URL` | **In practice yes** | Origin used to build the link in password-reset emails (`password-reset/request/route.ts`). **Falls back to `http://localhost:3000` with no warning**, so if it is unset in production every reset email links to localhost and the flow is unusable, with nothing in any log to say why. Set it to the public origin. From Story 12.2 it is also the contact named in the `User-Agent` of the Wikimedia picture lookups (see *AI day suggestions* below). **This was unset in production until 2026-08-12** — the failure predicted in this row had been live for the entire life of the deployment, and was found by enumerating the service's environment during Story 8.1 rather than by anybody reporting a broken email. It is now `https://plan.dreyer-travels.de`. |
| `OSRM_BASE_URL` | No | Route-geometry service. Defaults to the public `https://routing.openstreetmap.de`; set it only to point at a self-hosted deployment. |
| `ANTHROPIC_API_KEY` | No (feature off without it) | Claude API key for the AI day suggestions. Unset or blank, the feature is off: the search endpoint answers `503 ai_unavailable` and the day page is told the capability is missing. **A secret** — see the warning below. |
| `ANTHROPIC_MODEL` | No | Model for the suggestions. Defaults to `claude-haiku-5-5`. A `claude-haiku-*` model is sent the basic web search tool (`web_search_20250305`), any other model `web_search_20260209`. |
| `AI_SUGGESTIONS_DAILY_LIMIT` | No | Searches per user per server-local day. Defaults to `20`; a missing, non-numeric or non-positive value also means `20`. The count is kept in process memory, so a restart resets it. |
| `SMTP_HOST` | **Yes, in production** | Outgoing mail server. Production: `smtp.strato.de`. |
| `SMTP_PORT` | **Yes, in production** | `465` = implicit TLS (production). Any other port must offer STARTTLS, which is then required; `587` is the fallback if the server cannot reach 465. A whole number from 1 to 65535. |
| `SMTP_USER` | **Yes, in production** | SMTP login. Production: `webmaster@dreyer-travels.de`, the only mailbox in the Strato contract. |
| `SMTP_PASS` | **Yes, in production** | The **mailbox** password of `SMTP_USER`, set in the Strato customer area under "Postfach bearbeiten". **Not** the Strato customer login. **A secret**: see the warning below. |
| `MAIL_FROM` | **Yes, in production** | From header of every mail. Production: `TravelPlan <system@plan.dreyer-travels.de>` (no quotes in the value; the unit line below quotes the whole assignment). The address is an alias on the `SMTP_USER` mailbox; Strato accepts only addresses that mailbox owns. |
| `FILE_LINK_SECRET` | **Yes, with `MCP_ENABLED=true` in production** | HMAC key for the connector's signed download links `/f/<fileId>?w=&exp=&sig=` (Story 15.8): base64url, at least 32 bytes after decoding. Generate with `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='`. With the connector on, startup refuses a missing or short value (`instrumentation.ts`). Rotating it invalidates every open link at once, which is the only revocation besides expiry. **A secret**: see the warning below. |
| `FILE_LINK_TTL_SECONDS` | No | Lifetime of the connector's signed download links in seconds (Story 15.8), an integer from 60 to 86400. Missing or anything else means `900` (15 minutes). The tool descriptions state it to the model. |

### Password-reset email

Since Story 8.8, `sendEmail` (`src/lib/notifications/email.ts`) sends over SMTP when `NODE_ENV=production`.
Before that it silently did nothing in production, so no reset email was ever delivered. In every other
environment (development, test, CI) mail goes to an in-memory outbox and no connection is made, even if
the SMTP variables are set.

- **Startup refuses a missing setting.** With `NODE_ENV=production` and any of the five unset or empty,
  `src/instrumentation.ts` throws with the names of the missing variables (never their values). As with
  `MEDIA_STORAGE_ROOT`, that shows as **500 on every request, with the reason in the journal**, not as an
  exiting process. `next build` is exempt. **So the variables go into the unit before a build containing
  Story 8.8 is started.**
- **A failed send is logged, not shown.** The reset endpoint answers `{ success: true }` at once and sends
  the mail in the background, so a known address answers exactly like an unknown one, in content and in
  time. A failure appears in the journal, possibly seconds after the request, as
  `password-reset/request: reset email not sent` with nodemailer's error code (`EAUTH`, `ECONNECTION`,
  `ETIMEDOUT`…), the server's reply code and the message, with any mail address in it replaced by
  `<address>`. The token, the link and the credentials are never logged. Connect, greeting and socket
  inactivity each time out after 15 s, so a stuck background send ends.
- **Delivery rests on DKIM.** `dreyer-travels.de` publishes DMARC `p=reject` (which also governs
  `plan.dreyer-travels.de`) and **no SPF record**, so a receiver accepts the mail only because Strato signs
  it with DKIM (`strato-dkim-0002` / `-0003`). Verified on 2026-10-21: a test mail reached the GMX inbox.
  Recommended but not required: `v=spf1 include:_spf.strato.com -all` as a TXT record on both
  `dreyer-travels.de` and `plan.dreyer-travels.de`.
- **Checking the server can reach Strato** (the host has no `nc`):
  `timeout 5 bash -c "</dev/tcp/smtp.strato.de/465" && echo open`. If 465 is blocked, try 587 and set
  `SMTP_PORT=587` before changing anything else.
- **The mail** is plain text, in the account's chosen language (`preferredLanguage`), with the link
  `APP_BASE_URL/auth/reset-password?token=…`, valid for one hour.

### AI day suggestions: cost and data

**Every search is paid by the operator, per call** — model tokens plus a per-search web-search fee, and
one search can run up to five web searches. The daily per-user limit above is a guard against runaway
use, not a budget: **the spend limit set in the Anthropic console is the real cost cap**, so set one
before adding the key.

What leaves the server on each search is exactly this, and nothing else: the day's date, the start and
end places (stay names, address labels and coordinates — or the trip's start location), the traveller's
free-text wish, the travel mode, and the titles of the day's existing activities. No user account,
email, trip name, member list, note, cost or link field is sent. That is a promise about **fields**, not
about what people type into them: a stay called "Airbnb – Müller family", an address label or a wish
that names someone goes to Anthropic as written, and may end up in web-search queries. The suggested
places are then checked against Nominatim (OpenStreetMap), one lookup per second across the whole
server, under the `User-Agent` `TravelPlan/0.1 suggestions`.

Finally each suggestion gets up to three pictures from Wikimedia (Story 12.2): the server asks
`en.wikipedia.org` for the article's lead image (sending the suggestion's title) and
`commons.wikimedia.org` for files near its coordinates, all at once, under the `User-Agent`
`TravelPlan/0.1 (suggestion images; <contact>)`. Wikimedia's access policy asks for a contact, and the
contact is **`APP_BASE_URL`** when it is a public URL, otherwise the words "self-hosted; no public URL" —
one more reason to set it. The pictures themselves are served from `thumb.wikimedia.org` (thumbnails)
and `upload.wikimedia.org` (originals). The **browser** loads the thumbnails directly when it shows the
suggestions (from Story 12.3), and the server downloads the chosen ones on *Übernehmen* (Story 12.4).
So outbound HTTPS to these four hosts must be allowed, alongside Nominatim, OSRM and `api.anthropic.com`.
No key is needed, and a Wikimedia failure only leaves the pictures out; the search still succeeds.
The browser loads those thumbnails with `referrerPolicy="no-referrer"`, so Wikimedia sees each member's
IP address but not which page of the app they came from. The app sets no Content Security Policy, so
there is no `img-src` list to extend; if you add a CSP in front of the app, allow `thumb.wikimedia.org`
and `upload.wikimedia.org` as image sources.

Taking ticked suggestions over (Story 12.4) is two requests, and neither calls Claude or counts against
the daily limit. The **preview** asks OSRM once for the whole chain of stops in the search's travel mode
(one request per click, as FOSSGIS's fair-use rule asks), at most 8 s. The **apply** asks OSRM nothing:
it writes the legs the preview showed. It downloads the chosen pictures on the server, from
`thumb.wikimedia.org` (the 1920 px, 1280 px and 250 px thumbnails) and `upload.wikimedia.org` (the original),
**without following redirects**, at most **5 MB** per picture, and keeps only bytes that are a JPEG, PNG
or WebP by their signature; four at a time, at most 15 s in all. A picture that fails is left out and
logged by host only. Both requests stay well inside nginx's default 60 s, so they need no `location` of
their own.

**One search can take about 80 seconds**: up to 60 s for the model call with its web searches, then up
to 10 s of place checks, then up to 8 s of picture lookups — at most 78 s. nginx's default
`proxy_read_timeout` is 60 s, which would cut the user off with a gateway error after the search has
already counted against their daily limit. Raise it for this path:

```nginx
location ~ ^/api/trips/[^/]+/days/[^/]+/suggestions$ {
    proxy_pass http://127.0.0.1:3001;
    proxy_read_timeout 90s;
    # … the same proxy_set_header lines as `location /`
}
```

`AI_SUGGESTIONS_DAILY_LIMIT` and `ANTHROPIC_MODEL` also fail quietly. A non-numeric limit becomes 20,
and a mistyped model name makes every search fail with a generic `502 ai_failed` that still uses up a
search; the log line then shows `upstream: "APIError"` with `status: 404`.

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

## The systemd unit

`/etc/systemd/system/TravelPlan.service`. The shape that matters:

```ini
[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/home/app/apps/TravelPlan/travelplan

Environment=NODE_ENV=production
Environment="JWT_SECRET=…"
Environment="DATABASE_URL=file:/home/app/apps/TravelPlan/travelplan/prisma/prod.db"
Environment="MEDIA_STORAGE_ROOT=/var/lib/travelplan/media"
Environment="APP_BASE_URL=https://plan.dreyer-travels.de"
# Optional, Story 12.1 - AI day suggestions are off without the key.
Environment="ANTHROPIC_API_KEY=…"
Environment="AI_SUGGESTIONS_DAILY_LIMIT=20"
# Required since Story 8.8 - the server will not start without them.
Environment="SMTP_HOST=smtp.strato.de"
Environment="SMTP_PORT=465"
Environment="SMTP_USER=webmaster@dreyer-travels.de"
Environment="SMTP_PASS=…"
Environment="MAIL_FROM=TravelPlan <system@plan.dreyer-travels.de>"

Environment=PATH=/opt/node-24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/node-24/bin/npm start

Restart=on-failure
RestartSec=3
```

Three things about it are load-bearing:

1. **`PATH` is as important as `ExecStart`.** `npm start` spawns `next start`, whose shebang resolves
   `node` from `PATH`. Pinning only `ExecStart` leaves the child's interpreter to whatever `PATH`
   yields — which is `/usr/bin/node`, i.e. Node 20.
2. **`PORT` and `HOST` are not set, and must not be relied on.** They were present historically and
   were removed as dead: `npm start` is `next start -p 3001 -H 127.0.0.1`, whose explicit flags win,
   and `grep -r 'process\.env\.' travelplan/src` finds no reader for either. Changing `PORT` in the
   unit would move nothing, which is a confusing hour for whoever tries it.
3. `TravelBlogs.service` is the same shape but uses `EnvironmentFile=…/travelblogs/.env` instead of
   inline variables — which is the better pattern of the two, see below. It was migrated to Node 24 on
   2026-08-15 and now carries the same `PATH` and `ExecStart` pinning; while the two majors coexisted
   it deliberately did not, and that difference was the entire mechanism keeping the applications on
   separate runtimes.

### Secrets in the unit are readable by every local user

`JWT_SECRET`, `SMTP_PASS` and `ANTHROPIC_API_KEY` (once it is set) are inline `Environment=` values.
**`systemctl show -p Environment TravelPlan` returns them to any unprivileged local account**, because
the values are served from the systemd manager over D-Bus rather than read from the file — so
tightening the unit file's permissions does not help. Unit files are also mode `644` by default, so
`systemctl cat` exposes them as well.

The API key is a different kind of secret from the session key: whoever reads it can spend the
operator's money on the Claude API until the console spend limit stops them, without touching this
application at all. `SMTP_PASS` is a third kind: whoever reads it can send mail as
`webmaster@dreyer-travels.de` and read that mailbox. The accepted risk below was decided for
`JWT_SECRET`; adding either secret is a reasonable moment to reconsider the `EnvironmentFile=` move.

**This is an accepted risk, not an outstanding recommendation.** The decision was taken on 2026-08-15
(`DW-331`): the inline `Environment=` values stay as they are. The host has two accounts that matter —
`app` and the maintainer's own — and against that population the exposure buys little. **The revisit
trigger is named: if the host ever gains accounts beyond those two, move the secret.**

The move, when it comes, is `EnvironmentFile=` pointing at a file **outside the application tree**,
`root:root` mode `600`. systemd reads it as PID 1 before dropping to `User=app`, so the service user
never needs read access to the secret at all — stronger than TravelBlogs' in-tree `.env`. Two traps to
avoid at that point: Next.js auto-loads `.env.production` when `NODE_ENV=production`, so an in-tree
file under that name becomes a second config source; and it must not be committable. The second half is
already closed — `travelplan/.gitignore` now covers `.env.production` alongside `.env` and `.env.local`.

The current secret was rotated on 2026-08-12 after it was exposed during Story 8.1's discovery pass.
Rotating invalidates every active session and forces all users to sign in again.

## CI/CD

No automated deployment exists. The two GitHub Actions workflows and their caveats — including the fact
that CI runs on x64 while production is arm64 — are documented in
[deployment-guide.md](deployment-guide.md#cicd-details).

## Docker

Not used. There is no `Dockerfile` and no `docker-compose.yml`, and the deployment is a plain systemd
service running `next start` behind nginx. Nothing here is containerised.

## Hosting

Single Linux host, `arm64`, host name `Travelblog` — named after the *other* application that shares
it. Both applications run as the `app` user under system-level systemd units. `next start -p 3001 -H
127.0.0.1` binds loopback only; nginx terminates TLS and proxies. `next.config.ts` documents the
required nginx `client_max_body_size 620m` (320m until 2026-10-16, when the import ceiling went from
300 to 600 MB), which is what lets a large trip backup reach the import route to be accepted or
refused on its own terms.

See [deployment-guide.md](deployment-guide.md#the-server-in-one-place) for the full table of paths,
versions and unit names.

## Environments

There is **one** environment: production, on the host above. There is no staging deployment, so any
change is exercised in exactly two places — a developer machine and production. That is worth stating
plainly rather than leaving implied, because it sets the bar for how much verification a change needs
before it is restarted on the server.

Development and test need no `MEDIA_STORAGE_ROOT`: the default `<repo>/travelplan/var` is correct
there, `travelplan/.gitignore` ignores `var/`, and the suite overrides it per worker
(`test/setup.ts`).
