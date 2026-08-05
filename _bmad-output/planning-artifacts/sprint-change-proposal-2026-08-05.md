# Sprint Change Proposal — 2026-08-05

**Project:** TravelPlan
**Raised by:** Tommy
**Facilitated by:** John (PM) via `bmad-correct-course`
**Scope classification:** Moderate — new epic, three new stories, one PRD addition, one design-system addition. No implemented work reverted.

---

## 1. Issue Summary

Two problems, raised together because the second was discovered while assessing the
first, and because building the first without the second means building it twice.

**Problem A — travel documents have no home.** Accommodations and activities accept
photos. What Tommy actually accumulates alongside them are *documents*: tickets and
booking confirmations. Today he screenshots them, which costs three things a photo
cannot give back:

- **Multi-page documents collapse to one page.** A booking confirmation is rarely one screen.
- **Legibility.** A screenshot is a raster at whatever the phone happened to be showing; the original is text.
- **The forwardable original.** A ticket that has to be sent to a fellow traveller has to be the file, not a picture of it.

Tickets are also frequently issued **per person**, so a single activity can carry two
or three documents that differ only by the name on them.

**Problem B — the uploads tree is served without authentication, and NFR2 already
forbids that.** The PRD states *"NFR2: The system shall require authenticated access to
all trip data."* Uploaded media **is** trip data. Every upload route writes beneath
`public/`, which Next.js serves as static files ahead of any route handler and without
consulting the session. Anyone holding a URL holds the file.

For documents this is acute — a booking confirmation carries a name, an address, and a
booking code. But Tommy named the sharper driver, and it applies to what is *already*
stored: **the photos in a trip are frequently not his to publish.** Serving them openly
is a rights exposure on content already in the system, independent of this feature.

So Problem B is not a new requirement introduced by the document feature. It is an
existing NFR2 gap that the document feature would otherwise widen.

**Trigger:** No triggering story. This arrived as a product request during planning,
after Story 5.11 closed. Category: *new requirement emerged from stakeholder*, with a
*compliance gap discovered during impact assessment*.

**Evidence:**

- `prisma/schema.prisma:239-267` — `AccommodationImage` and `DayPlanItemImage` exist; no document table does.
- `src/lib/trips/uploadPaths.ts:19` — `getPublicRoot()` resolves to `<cwd>/public`; every upload path is built from it.
- Stored URLs are uniformly `/uploads/trips/<tripId>/…` — five construction sites (`hero-image/route.ts:113`, `days/[dayId]/image/route.ts:148`, `accommodations/images/route.ts:164`, `day-plan-items/images/route.ts:171`, `importPhotos.ts:99-131`), all the same shape, `tripId` always the third segment.
- `prd.md:289` — NFR2, unqualified.
- `src/components/features/trips/TripDayPrintPage.tsx:60` — printing is `window.print()` on an HTML page; `package.json` has no PDF library.
- `DESIGN.md:252` — the system defines `photo-strip` and nothing for a non-image attachment.
- Layout arithmetic at 390px: the `tl-card` photo strip is three 56px thumbnails plus 6px gaps ≈ 180px. After card padding roughly 150px remains on the row, against 90–120px for one labelled chip.

---

## 2. Impact Analysis

### Epic impact

| Epic | Impact |
|---|---|
| Epic 8 — Maintenance & Infrastructure | Gains Story 8.3. Charter unchanged: closing an NFR2 gap on already-shipped behaviour adds no product capability, which is precisely what this epic is for. |
| Epic 9 (new) — Travel Documents | Created. Receives Stories 9.1 and 9.2. |
| Epics 1–7 | No impact. No existing story is modified, reverted, or renumbered. |

Epic 8 is currently last in `epics.md` (file ends at `:2859`), so Epic 9 is a pure
append and no renumbering is needed anywhere.

**Why Story 8.3 is not in Epic 9.** It delivers no capability a user can name. Filing
it as the first story of a document feature would also hide it: `bmad-loop run --epic 9`
would then mix a security hardening pass with a feature build, which is the exact
boundary problem the 2026-08-01 proposal created Epic 8 to fix.

**Why the sequence is structural, not just documented.** The loop reads
`sprint-status.yaml` in file order. The `epic-9` block placed after `epic-8` encodes
8.3 → 9.1 → 9.2 without relying on anyone remembering the dependency.

### Story impact

| Story | Change |
|---|---|
| 8.3 | **New.** Uploaded media moves out of `public/` and behind an authenticated route. |
| 9.1 | **New.** Documents on accommodations and activities: schema, upload, display, deletion. |
| 9.2 | **New.** Documents in the printed day plan, plus a single-PDF offline packet. |
| 8.1, 8.2 | Unaffected. Both sit ahead of 8.3 in Epic 8 and share nothing with it. |
| 2.16, 6.6 | Shipped. Their gallery code is the pattern 9.1 mirrors; neither is modified. |
| 2.31, 2.32 | Shipped. The v2 backup archive carries photo files. It must learn to carry documents too — see *Technical impact*. |
| 6.8 | Shipped. Its offline PDF export is the surface 9.2 extends. |
| 6.22, 6.26 | Shipped. Their `Medien & Links` tab is where 9.1's upload and delete controls go — no new tab. |

### Artifact conflicts

| Artifact | Required update |
|---|---|
| `prd.md` | Three new FRs (FR38–FR40) under a new *Travel Documents* heading; NFR2 annotated to state that uploaded media files are in scope and to name Story 8.3. |
| `epics.md` | Requirements Inventory gains FR38–FR40; FR Coverage Map gains three lines; Epic List gains an Epic 9 entry; Story 8.3 appended to Epic 8; new `## Epic 9` section appended. |
| `DESIGN.md` | New `doc-chip` component entry and `components.doc-chip` token block; the `tl-card` entry amended to name the document row. |
| `mockups/trip-overview-day-detail.html` | The `tl-card` specimen gains document chips in both the beside-photos and wrapped states. |
| `sprint-status.yaml` | `8-3-uploaded-media-behind-the-login: backlog` appended to the `epic-8` block; new `epic-9` block with 9.1, 9.2 and its retrospective. |
| `architecture.md` | `:253` (*"Static assets: `public/`"*), `:320` (source tree) and `:476` (*"Static assets under `public/assets`"*) each describe an uploads layout that Story 8.3 changes. |
| `docs/deployment-guide.md`, `docs/deployment-configuration.md` | The uploads directory moves outside the served tree, so it becomes a deployment concern: it must exist, be writable by the service, and survive a redeploy. Both files are 9-line TBD placeholders that Story 8.1 already commits to filling in. |
| `ux-design-specification.md` | No change. It describes screens and flows at a level the document row does not alter; the concrete definition belongs in `DESIGN.md`. |

### Technical impact

**Story 8.3 — smaller than it looks, with one sharp edge.**

The stored URLs already carry `tripId` as their third segment, and `getPublicRoot()`
is already the single source of truth for the write path. That combination means a
catch-all route handler at `src/app/uploads/[...path]/route.ts` can authorise and serve
every existing file **with no URL change, no data migration, and no component change.**
The access predicates already exist: `requireSession` plus `hasTripReadAccess`
(`tripAccess.ts:62-65`), which correctly admits owners, viewers and contributors.

The sharp edge: `public/` is served statically *ahead of* route handlers, so any file
left behind stays open. The move has to be complete, and a test has to hold that line
rather than a comment.

Four consequences worth naming now:

- `UPLOADS_PUBLIC_ROOT` — the env var the test setup uses to redirect writes — becomes a misnomer once the root is not public. Renaming it touches the test setup and the four image-route suites.
- `Cache-Control` flips from `public, max-age=0` to `private`. ETag and conditional requests are unaffected.
- Range requests matter here in a way they never did for photos: browser PDF viewers issue them, and a route that answers every request with a full 200 makes some viewers refuse to open the file inline.
- Serving user-uploaded bytes from our own origin through our own route is the moment to set `X-Content-Type-Options: nosniff` and derive `Content-Type` from the stored extension only. A file stored as `.png` whose bytes are HTML would otherwise be sniffable as same-origin HTML.

Export and import need no change of their own: both reach files through the
`uploadPaths.ts` helpers, so they follow the root automatically.

**Story 9.1 — mirrors an existing pattern, with one non-mirrored decision.**

Two new tables (`AccommodationDocument`, `DayPlanItemDocument`) shaped like their image
counterparts, with a migration. Two upload routes shaped like the image routes. The
non-mirrored part is the display: a document has no thumbnail, so the card element is a
*labelled* chip, not a square — see §4.4.

**The backup format is the ripple to watch.** Stories 2.31/2.32 built a v2 ZIP archive
holding `trip.json` plus the uploaded photo files. A document feature that does not
extend it produces a backup that silently drops documents, and a restore that silently
loses them — on the one mechanism whose entire purpose is not losing things. This is
carried as an acceptance criterion of 9.1 rather than deferred.

**Story 9.2 — the one place where the obvious approach does not work.**

Image documents append to the printed day plan as full pages trivially. **PDF documents
cannot be printed by the browser at all** — an embedded PDF in an `<iframe>` or
`<embed>` does not appear in print output. Since tickets are the case the story exists
for, the offline packet is produced server-side as a separate single PDF via `pdf-lib`
(one new dependency, no headless browser). Two files offline: the day plan, and the
document packet.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment (hybrid: one story into an existing epic, two into a new one). Effort: Medium. Risk: Low–Medium.**

Option 2 (rollback) is not applicable — nothing has been built. Option 3 (MVP review)
is not applicable — the MVP shipped long ago and this is post-MVP capability plus a
compliance fix; no MVP goal is touched.

**Rationale.**

*On sequencing.* Story 8.3 first is not a preference, it is arithmetic. If documents
land on the public path, the same files have to be moved and the same route written
afterwards, and in the meantime booking confirmations sit in an openly served
directory. Doing 8.3 first also front-loads the only genuinely uncertain part of the
serving story (Range, content type, cache semantics) onto content that already exists
and is already understood.

*On splitting 9.2 out.* It carries the story's only new dependency and its only
technical unknown. Held separately, it cannot block the part that fixes what actually
hurts today — the screenshot workaround — and if the merged output turns out to be
unsatisfying, 9.1 has already shipped.

*On effort honesty.* 9.1 is the largest of the three: two tables, two routes, a new
design-system component, i18n in both dictionaries, and the backup-format extension.
It is not a mirror of Story 2.16 with a different noun.

**Risk register.**

| Risk | Story | Mitigation |
|---|---|---|
| An orphaned file left in `public/uploads` stays publicly readable | 8.3 | An acceptance criterion asserting the directory is absent, not merely unused |
| PDFs fail to open inline in some viewers | 8.3 | Range support as an explicit criterion, verified against a real multi-page PDF |
| Documents silently lost on backup/restore | 9.1 | Round-trip criterion on the v2 archive |
| `pdf-lib` output is unsatisfying (page sizing, image orientation) | 9.2 | Isolated as the last story; 9.1 ships regardless |
| Two upload buckets accepting the same MIME types confuse the user | 9.1 | Two distinctly labelled fields; a file in one bucket never appears in the other |

**Deliberately excluded from this proposal.**

- **Trip-level documents** — insurance, passport copies, a flight booking with no single day. This is the next obvious wish once the feature lands, and it is a different surface with its own placement question. Naming it here so it is a decision later rather than scope creep now.
- **PDF preview thumbnails.** Rendering a PDF's first page needs a rasteriser in the request path. The chip's label is the identification mechanism instead.
- **OCR, auto-labelling, or extracting booking codes.** Nothing in the request implies it.
- **A document viewer inside the app.** Documents open in a new tab, in the viewer the user already trusts. `FullscreenPhotoViewer` stays for memories.

---

## 4. Detailed Change Proposals

### 4.1 `prd.md` — new functional requirements

**NEW** (appended after the *Idea Capture & Logbook* block, `:275-279`):

```markdown
### Travel Documents

- FR38: Users can attach documents (PDF or image files) to an accommodation entry and to a day plan item.
- FR39: Users can see attached documents on the entry in the day timeline, open them, and delete them from the entry's dialog.
- FR40: Users can produce an offline document packet as a single PDF containing a day's attached documents.
```

**Rationale:** FR38–FR40 are unused in both `prd.md` (highest existing: FR37) and
`epics.md` (highest existing: FR35), so the two documents' already-divergent numbering
is not deepened.

---

### 4.2 `prd.md:289` — NFR2 annotated

**OLD:**

```markdown
- NFR2: The system shall require authenticated access to all trip data.
```

**NEW:**

```markdown
- NFR2: The system shall require authenticated access to all trip data. **(2026-08-05: this explicitly includes uploaded media files — hero images, day images, accommodation and activity photos, and documents. Until Story 8.3 these were served as static files from `public/`, i.e. to anyone holding the URL. Story 8.3 closes that gap; the requirement itself is unchanged.)**
```

**Rationale:** The requirement was always right and was always unmet for media. An
annotation records that honestly; a new NFR would imply the rule is new.

---

### 4.3 `epics.md` — inventory, coverage map, and Epic List

**NEW** (Requirements Inventory, after the `FR35` line):

```markdown
FR38: Users can attach documents (PDF or image files) to an accommodation entry and to a day plan item.
FR39: Users can see attached documents on the entry in the day timeline, open them, and delete them from the entry's dialog.
FR40: Users can produce an offline document packet as a single PDF containing a day's attached documents.
```

**NEW** (FR Coverage Map, after the `FR35` line):

```markdown
FR38: Epic 9 - Travel Documents
FR39: Epic 9 - Travel Documents
FR40: Epic 9 - Travel Documents
```

**NEW** (Epic List, appended after the Epic 8 entry at `:150-152`):

```markdown
### Epic 9: Travel Documents
Users can keep tickets and booking confirmations as the original files on the stay or activity they belong to, see and open them from the day timeline, and take them offline as one PDF.
**FRs covered:** FR38, FR39, FR40
```

---

### 4.4 `DESIGN.md` — new `doc-chip` component

**NEW** (component list, inserted directly after the `photo-strip` entry at `:252`):

```markdown
- **doc-chip / doc-row** — A non-image attachment (ticket, booking confirmation) on an activity/stay `tl-card`. A {rounded.sm} chip on the {colors.pill-neutral} track carrying a ~14px file-type glyph and the document's name, single-line, ellipsised at {components.doc-chip.maxLabelWidth}. **The label is the content.** A `photo-strip` thumbnail identifies itself; a document does not, and three unlabelled squares would force the user to open each one to find the ticket with their own name on it — which is the case this component exists for, since tickets are commonly issued per person. Chips are {components.doc-chip.minHeight} tall, the same 44px floor every interactive element in this system carries: shorter reads as tidier and is the defect Story 5.11's review found on a 32px select. Since 44px is below the 56px photo strip, chips beside photos add no height to the card.

  Chips trail on the same bottom row as the `photo-strip` while the row can hold at least two of them; below that measured threshold the whole group wraps to its own row beneath the photos rather than truncating to one chip. Truncating was rejected: at 390px only one chip fits beside three thumbnails, and one named document out of three is exactly the information the label was added to carry.

  Overflow reuses the `+N` control the photo strip already uses — a second overflow vocabulary in the same row would read as a different kind of thing. It opens a **list of names**, not a viewer: there is nothing to page through, and the name is what the user is choosing between. Activating a chip opens the document in a new tab, including image documents — `FullscreenPhotoViewer` belongs to the trip's photographs, and a ticket is not one.
```

**NEW** (`components` token block, inserted after `photo-strip` at `:149-153`):

```yaml
  doc-chip:
    minHeight: 44px
    radius: '{rounded.sm}'
    bg: '{colors.pill-neutral}'
    glyphSize: 14px
    maxLabelWidth: 160px
    align: 'right (beside photo-strip) / left (wrapped row)'
```

**AMEND** (`tl-card` entry, `:247`) — the parenthetical becomes:

**OLD:**
> …render as a {rounded.md} `tl-card` (time pill, title, cost, then a `photo-strip` of 2–4 images along the bottom)…

**NEW:**
> …render as a {rounded.md} `tl-card` (time pill, title, cost, then a bottom media row: a `photo-strip` of 2–4 images leading, `doc-chip`s trailing, wrapping to a second row when the width cannot hold both)…

**Rationale:** The chip is a new kind of thing in the system, so it needs a definition
rather than an implementation. Recording *why* it is labelled and why it is 44px is what
stops the next screen from re-deriving a 32px unlabelled variant.

---

### 4.5 `epics.md` — Story 8.3 appended to Epic 8

```markdown
### Story 8.3: Uploaded Media Behind the Login

As a trip owner,
I want every uploaded photo and document to be reachable only by someone signed in with access to that trip,
So that content I hold no rights to is not published to anyone who learns a URL, and so that NFR2 is true of media and not only of database rows.

**FRs covered:** None (closes an existing NFR2 gap on already-shipped behaviour)

**Context:** Every upload route writes beneath `public/`, which Next.js serves statically ahead of any route handler and without consulting the session. NFR2 has always required authenticated access to all trip data; uploaded media is trip data, so the requirement has been unmet for media since Story 2.11 shipped the first hero image. The driver is rights rather than secrecy: trip photos are frequently not the owner's to publish. Documents (Epic 9) make it acute, which is why this story comes first — building Epic 9 on the public path means moving the same files and writing the same route afterwards.

The change is cheaper than it looks, and for a reason worth stating: every stored URL is `/uploads/trips/<tripId>/…` with `tripId` always the third segment, and `getPublicRoot()` (`uploadPaths.ts:19`) is already the single source of truth for the write path. A catch-all route handler can therefore authorise and serve every existing file with no URL change, no data migration, and no component change. The access predicates exist — `requireSession` plus `hasTripReadAccess`, which admits owners, viewers and contributors alike.

**Acceptance Criteria:**

**Given** uploaded files live under `public/uploads/trips/` and are served statically
**When** the move lands
**Then** they live under a root outside the statically served tree, `public/uploads/` no longer exists, and a test asserts its **absence** rather than merely that nothing writes to it — a file left behind stays publicly readable no matter what the code does
**And** `public/images/`, `public/hero-mountains.jpg` and the SVGs are untouched, because they are application assets and not trip data

**Given** a request for `/uploads/trips/<tripId>/…`
**When** it is served by the new route handler
**Then** an unauthenticated request is refused, a signed-in user with no access to that trip is refused, and the owner, a viewer and a contributor each succeed — the same three-way check `hasTripReadAccess` already encodes
**And** no stored URL anywhere in the database or in any component changes

**Given** the path segment arrives from the URL
**When** it is resolved to a file
**Then** a traversal attempt (`..`, an encoded separator, an absolute-looking segment) cannot escape the uploads root, and the resolution is asserted against those inputs rather than trusted to `path.join`

**Given** a browser PDF viewer requests a byte range
**When** the route answers
**Then** it serves `206` with the requested range, and a real multi-page PDF opens inline — a route that always answers `200` with the whole file makes some viewers refuse to open it at all

**Given** the files are no longer public
**When** the response headers are written
**Then** `Cache-Control` is `private`, the ETag and conditional-request behaviour are unchanged, `Content-Type` is derived from the stored extension only, and `X-Content-Type-Options: nosniff` is set — serving user bytes from our own origin is what makes sniffing a same-origin concern

**Given** `UPLOADS_PUBLIC_ROOT` is the env var the test setup uses to redirect writes away from real files
**When** the root is no longer public
**Then** the variable is renamed to match what it now means, all four image-route suites and the test setup follow, and the protection it exists for — that no test can reach the operator's real uploads — is re-verified rather than assumed

**Given** export and import reach files through the `uploadPaths.ts` helpers
**When** the root moves
**Then** both continue to work with no change of their own, verified by a round trip rather than by inspection

**Given** the uploads directory now sits outside the deployed application tree
**When** the deployment docs are updated
**Then** `docs/deployment-guide.md` and `docs/deployment-configuration.md` record where it lives, that the service user must be able to write to it, and that it must survive a redeploy — a media root inside the build output would be silently emptied on deploy

**Given** the printed day plan renders `<img>` tags against these URLs
**When** a day is printed after the move
**Then** the images still appear, because the browser sends the session cookie on a same-origin request — verified on screen, not reasoned about
```

---

### 4.6 `epics.md` — new Epic 9 section appended

```markdown
## Epic 9: Travel Documents

Users can keep tickets and booking confirmations as the original files on the stay or activity they belong to, see and open them from the day timeline, and take them offline as one PDF.

### Story 9.1: Documents on Stays and Activities

As a trip planner,
I want to attach the original ticket or booking confirmation to the accommodation or activity it belongs to,
So that I keep the multi-page, legible, forwardable file instead of a screenshot of its first screen.

**FRs covered:** FR38, FR39

**Depends on:** Story 8.3. Documents carry names, addresses and booking codes; they must not land in a publicly served directory even briefly.

**Context:** Photos already attach to both entry types (Stories 2.16, 6.6). Documents are the same gesture with a different payload and one genuinely different display problem: a document has no thumbnail, so the card element is a labelled chip rather than a square — see `DESIGN.md`'s `doc-chip`. Both dialogs already have a `Medien & Links` tab (Stories 6.22, 6.26); documents go there, not into a fifth tab.

PDF **and** image files are accepted, because the distinction between a photograph and a document is semantic rather than technical — a ticket screenshot is a document. The user places the file; the app does not guess from the MIME type.

**Acceptance Criteria:**

**Given** an accommodation and a day plan item
**When** the schema gains documents
**Then** `AccommodationDocument` and `DayPlanItemDocument` exist with the same shape and cascade behaviour as their image counterparts (`schema.prisma:239-267`), including the `(parentId, sortOrder)` uniqueness that keeps ordering total, and a migration is added

**Given** the `Medien & Links` tab of each dialog
**When** documents are added
**Then** the tab carries a document field **visibly distinct in label from the photo field**, so a JPEG's destination is the user's choice and not a guess, and a file placed in one bucket never appears in the other
**And** up to 10 documents per entry are accepted, each up to 10 MB — larger than the 5 MB photo limit because a ticket PDF carrying a map exceeds it

**Given** a picked file
**When** it is validated
**Then** PDF and the image types the photo fields already accept are allowed, the client-side gate mirrors the server's list the way `isSupportedImageUpload` already mirrors it (`imageUploads.ts:25`), and the upload route remains the authoritative check

**Given** an entry with documents
**When** its `tl-card` renders in the day timeline
**Then** `doc-chip`s appear per `DESIGN.md`: trailing on the media row beside the photo strip where the width allows at least two, wrapping to their own row below the photos where it does not, each labelled with the document's file name minus its extension and ellipsised
**And** the wrap threshold is **measured at 390px and at desktop width**, not chosen as a breakpoint — the arithmetic that motivates it (≈180px of photo strip against ≈150px of remaining row) is the reason it exists

**Given** more documents than the row shows
**When** the overflow control is used
**Then** it is the same `+N` affordance the photo strip uses, and it opens a list of document names rather than a viewer, each entry openable

**Given** a document chip or list entry
**When** it is activated
**Then** the document opens in a new tab — including image documents, which do not enter `FullscreenPhotoViewer`

**Given** a document attached to an entry
**When** it is deleted from the dialog
**Then** the row and the file on disk both go, matching how image deletion already behaves, and the dialog's dirty/discard semantics (Story 6.25) treat a staged-but-unsaved document the way it treats a staged photo

**Given** the v2 backup archive carries `trip.json` plus the uploaded photo files (Stories 2.31, 2.32)
**When** a trip with documents is exported and re-imported
**Then** the documents come back attached to the same entries with the same names and order — a backup mechanism that silently drops a class of files is worse than one that refuses to run

**Given** every user-facing string
**When** the feature lands
**Then** both dictionaries carry it under a `trips.documents.*` namespace, and `i18nDictionaries.test.ts` holds the two in agreement as it does for every other namespace

### Story 9.2: Documents in Print and an Offline Packet

As a traveller standing at a gate with no signal,
I want the day's tickets available as files I already have on my device,
So that the plan and the documents that make it usable are both offline.

**FRs covered:** FR40

**Depends on:** Story 9.1.

**Context:** The printed day plan is `window.print()` over an HTML page (`TripDayPrintPage.tsx:60`), and there is no PDF library in the project. Image documents can be appended to that output as full pages. **PDF documents cannot** — an embedded PDF in an `<iframe>` or `<embed>` is not rendered into print output by any browser, and tickets are the case this story exists for.

Two approaches were rejected. Rendering the whole day plan server-side through headless Chrome would produce one file, at the cost of a browser in the deployment for one feature. Listing documents by name only and leaving the user to print them is honest but is not an offline packet. So the day plan keeps printing as HTML, and the documents are merged server-side into their own PDF via `pdf-lib`. Two files offline, each doing its job, no rendering engine.

**Acceptance Criteria:**

**Given** a day whose entries carry image documents
**When** the day plan is printed
**Then** each image document appends as its own full page after the plan, page-broken, oriented so a portrait ticket is not printed sideways

**Given** a day whose entries carry PDF documents
**When** the day plan is printed
**Then** an appendix lists them by name and by the entry they belong to, and states plainly that they are not included in this output — a silent omission on an offline artefact is the failure mode that matters here

**Given** a day with documents of both kinds
**When** the document packet is requested
**Then** one PDF is returned containing every document of that day in timeline order: PDFs page-for-page, images embedded as pages, each preceded by or labelled with the entry name and the document name so the packet is navigable without the app

**Given** the packet route serves file contents
**When** it is called
**Then** it enforces the same access check as Story 8.3's serving route, and a day with no documents yields a clear refusal rather than an empty PDF

**Given** `pdf-lib` is a new dependency
**When** it is added
**Then** it is a runtime dependency of the server only, the 0-vulnerability audit gate stays green, and a real multi-page ticket PDF plus a portrait phone photo are both verified in the merged output — page count, orientation, and legibility, on screen
```

---

### 4.7 `sprint-status.yaml`

**OLD** (`:172-175`):

```yaml
  epic-8: backlog
  8-1-node-24-runtime-upgrade: backlog
  8-2-middleware-to-proxy: ready-for-dev
  epic-8-retrospective: optional
```

**NEW:**

```yaml
  epic-8: backlog
  8-1-node-24-runtime-upgrade: backlog
  8-2-middleware-to-proxy: ready-for-dev
  8-3-uploaded-media-behind-the-login: backlog
  epic-8-retrospective: optional

  epic-9: backlog
  9-1-documents-on-stays-and-activities: backlog
  9-2-documents-in-print-and-an-offline-packet: backlog
  epic-9-retrospective: optional
```

**Rationale:** File order is the loop's sequencing control (`next_actionable`: *"First
story in file order whose status allows starting work"*). The `epic-9` block after
`epic-8` makes 8.3 → 9.1 → 9.2 structural rather than remembered.

---

### 4.8 `architecture.md` — uploads no longer under `public/`

Three lines describe a layout Story 8.3 changes: `:253` (*"Static assets: `public/`"*),
the source tree at `:320`, and `:476` (*"Static assets under `public/assets`"*).

Each gains the distinction the document has never had to make: **application assets**
stay in `public/` and are served statically; **uploaded trip media** lives outside it
and is served by an authorised route handler. Exact wording is written with the story,
so the document describes what shipped rather than what was planned.

---

## 5. Implementation Handoff

**Scope: Moderate** — one PRD addition, one design-system addition, one new epic, three
new stories. No code changes in this proposal; no implemented work reverted.

| Task | Owner | Artifact |
|---|---|---|
| FR38–FR40 + NFR2 annotation | PM (John) | `prd.md` |
| Inventory, coverage map, Epic List entry | PM (John) | `epics.md` |
| Author Story 8.3 section | PM (John) | `epics.md` |
| Author Epic 9 with Stories 9.1, 9.2 | PM (John) | `epics.md` |
| `doc-chip` component + token block + `tl-card` amendment | UX (Sally) / PM | `DESIGN.md` |
| `tl-card` specimen with chips, both states | UX (Sally) | `mockups/trip-overview-day-detail.html` |
| Update sprint status | PM (John) | `sprint-status.yaml` |
| Architecture wording | Architect (Winston) | `architecture.md` — with Story 8.3 |
| Write the 8.3 / 9.1 / 9.2 story specs | SM / `bmad-create-story` | before each is dispatched |

### Success criteria

1. `bmad-loop run --epic 9 --dry-run` lists only 9.1 and 9.2 — no hardening work.
2. `public/uploads/` does not exist after 8.3, and a test fails if it reappears.
3. No stored media URL changed anywhere in the database or in any component as a result of 8.3.
4. A trip with documents survives an export/import round trip with its documents attached.
5. A day's offline packet opens as one PDF containing every document of that day, verified against a real multi-page ticket.
6. FR38, FR39 and FR40 each map to at least one acceptance criterion of a story in Epic 9.

### Sequencing after this change

```
8-1  8-2                        [Epic 8, independent of the below]
8-3  →  9-1  →  9-2             [uploads protected, then documents, then offline]
```

---

## 6. Open Items

- **The wrap threshold in Story 9.1 is deliberately unspecified as a number.** It is a measured value, and this project's history is emphatic that guessed layout arithmetic does not survive a browser — Story 6.26's `STAY_PANEL_MIN_HEIGHT` went from 300 by arithmetic to 400 by measurement. It is named as a browser-pass task rather than pinned here.
- **Trip-level documents** (insurance, passport, a flight booking with no single day) are excluded above and will be asked for. Worth a decision before Epic 9's retrospective, so it is a choice rather than a bolt-on.
- **`UPLOADS_PUBLIC_ROOT`'s rename** touches the mechanism that stops tests from deleting the operator's real uploads — a protection added after it destroyed a live dev hero image (`uploadPaths.ts:9-14`). It should be re-verified in the story, not carried over on trust.
- **Document labels come from file names**, which means the file name at upload time is the label forever. No rename exists. If tickets arrive as `booking_8f21c.pdf`, three chips will be equally unhelpful. A rename field is the obvious follow-up and is deliberately not in 9.1 — but it is the first thing to watch once real tickets are in there.

