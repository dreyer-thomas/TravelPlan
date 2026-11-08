---
baseline_commit: fa840614b877da110d266cd8dc6c13493c1b6df8
---
# Story 16.3: Take-Along in the Day Email

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a traveller who reads the day offline in my mail app,
I want the day's take-along list in the day email,
so that I see it in the morning without opening the app.

*Added 2026-11-08 (Tommy, with John/PM). FR covered: FR51 (amended 2026-11-08: "including the day's take-along packing items"). Depends on Story 16.2 (done; day links via `PackingItemDay`). Sequenced after 16.6 (done). Source: `epics.md` → Epic 16 / Story 16.3; `sprint-change-proposal-2026-11-08-packing-list.md` (effort: small). Builds on Story 9.3 (the day email).*

## Acceptance Criteria

1. **Section after the plan.** When the day email is built for a day with linked packing items, both parts (HTML and plain text) contain a "Mitnehmen" / "Take along" section placed **after** the day's plan (after the last itinerary row, or after the "nothing recorded" sentence when the plan is empty). Heading text = existing key `trips.packingList.dayTitle`.
2. **Grouped like the app.** Items are grouped by category with `groupPackingItems` (the same rules as the trip list and the day section: categories alphabetical, locale-aware, case-insensitive; items without a category under "Sonstiges" / "Other" = `trips.packingList.other`, last; items alphabetical within a group). Group labels carry **no** packed/total count (as in the day view's section).
3. **Language.** Every label comes from the mail's `t` / `language` (the request's `lang` cookie, as for the rest of the mail). German mail: "Mitnehmen" and "Sonstiges"; English mail: "Take along" and "Other". The grouping collator uses the mail's `language` as locale.
4. **No empty section.** A day without linked items has no section at all in either part: no heading, no empty sentence.
5. **Only this day's items.** Items of the trip that are not linked to this day, and items linked only to other days, are not in the mail.
6. **Escaped.** Item names and category labels are HTML-escaped at interpolation in the HTML part (through the module's existing `escapeHtml`), and appear raw in the text part. Nothing loads: the section adds no image, URL, stylesheet or `<style>` (the existing "loads nothing" test stays green).
7. **Same content in both parts.** HTML and text are rendered from one list of groups (the module's rule from 9.3 AC6: no content in one part that the other lacks).
8. **Nothing else changes.** Subject, intro, day link, documents sentence, plan rows, the 20 MB cap measurement and the attach/too-large/none logic are unchanged. The send route still reads no body. Viewers can still send (and get the section; viewers read the packing list).
9. **Tests** cover: both languages, HTML and text, a day without items (no heading in either part), grouping/order incl. the "Other" group last, HTML escaping of item names **and** categories, and end to end through the route that a linked item is in the sent mail and an item linked only to another day is not.

**Out of scope:** a separate packing email; the trip list in the email; a packed mark in the email (see Dev Notes → "Decisions"); the print sheet and the document packet (they share the print payload but do not get the section); connector tools (16.4).

## Tasks / Subtasks

- [x] **Task 1: Repository read for one day** (AC: 5, 8)
  - [x] In `src/lib/repositories/packingListRepo.ts` add `export type PackingItemForDay = { id: string; name: string; category: string | null; packed: boolean }` and `export const listPackingItemsForDay = async ({ userId, tripId, tripDayId }): Promise<PackingItemForDay[]>`.
  - [x] One query: `prisma.packingItem.findMany({ where: { tripId, days: { some: { tripDayId } }, trip: { OR: [{ userId }, { members: { some: { userId } } }] } }, select: { id, name, category, packed }, orderBy: [{ nameKey: "asc" }, { id: "asc" }] })`. The participant clause is defence in depth (the route already checked read access); a non-participant simply gets `[]`. Every participant reads (viewer included) — same rule as `listPackingItemsForTrip`.
  - [x] Update the module docblock: the day email is a reader of `PackingItem` through this function (the docblock currently lists the readers).
- [x] **Task 2: The mail builder** (AC: 1–4, 6, 7)
  - [x] `src/lib/notifications/dayEmail.ts`: `buildDayEmail` gains a parameter `packingItems: readonly PackingItemForDay[]` (**required**, not optional — every caller must decide; the only callers are the route and `test/dayEmail.test.ts`). Import the type from the repo with `import type` (keeps the module pure: no Prisma at runtime).
  - [x] Compute once: `const packingGroups = groupPackingItems(packingItems, t("trips.packingList.other"), language)`; `const takeAlong = t("trips.packingList.dayTitle")`.
  - [x] Text part: when `packingGroups.length > 0`, append after the plan rows (as further `"\n\n"`-joined blocks): `takeAlong.toUpperCase()` (same treatment as `itinerary.toUpperCase()`), then one block per group: the group label on its own line followed by one line per item `- {name}`. When there are no groups, append nothing (no trailing empty block — the text must equal today's text exactly; assert this).
  - [x] HTML part: when groups exist, after the plan rows and before `</div></body></html>`: a section heading in **exactly** the itinerary heading's style (the `font-size:12px;text-transform:uppercase;...` div; add a top margin, e.g. `margin:20px 0 8px 0`), then per group a group label (`font-weight:bold;font-size:14px`, `TEXT_STYLE`) and a `<ul style="margin:4px 0 12px 0;padding-left:20px">` with one `<li style="${TEXT_STYLE}">` per item. Every interpolated string through `escapeHtml`. Inline styles only, no new colours beyond the existing `MUTED`/`#1a1a1a`.
  - [x] Keep the "Row" model untouched — the packing section is a separate list rendered after it; HTML and text both iterate `packingGroups` (AC 7). Extend the function docblock with one paragraph on the section (Story 16.3, FR51 amended).
- [x] **Task 3: The route** (AC: 5, 8)
  - [x] `src/app/api/trips/[id]/days/[dayId]/email/route.ts`: after `payload` is loaded (inside the existing `try`), `const packingItems = await listPackingItemsForDay({ userId, tripId, tripDayId: dayId })`; pass it into `compose` → `buildDayEmail({ ..., packingItems })`. Read once, used by both `compose` calls (attached / tooLarge). A DB failure lands in the existing catch (500, no mail) — correct, a mail without the section would silently drop it.
  - [x] Do **not** add packing items to `TripDayPrintPayload` / `getTripDayPrintPayloadForUser` (tripRepo): that payload also feeds the print page and the packet route, and the repo rule of Epic 16 is that packing reads go through `packingListRepo`.
  - [x] Add one sentence to the route docblock (the mail carries the day's take-along items).
- [x] **Task 4: Tests** (AC: 9) — see Dev Notes → "Testing".
- [x] **Task 5: Gates** — `npm run typecheck`, `npm run lint` (0 errors), `npm test` (full suite green; baseline **268 files / 4293 tests** after 16.6's review — re-measure, the working tree carries 16.2/16.6 uncommitted), `npm run build`. No i18n keys are added (reused keys only), so `test/i18nDictionaries.test.ts` is unaffected — if you do add one, add it to both `de.ts` and `en.ts`.

### Review Findings

- [x] [Review][Patch] Escaping test uses one string for both item name and category, so it cannot show which of the two is escaped (AC9 asks for both) — use distinct hostile strings for name and category and assert each escaped form [travelplan/test/dayEmail.test.ts:333]
- [x] [Review][Defer] Interior newlines in a packing item name or category break the text part's `- name` list (continuation lines lose the `- ` prefix; a blank line fakes a group break) [travelplan/src/lib/notifications/dayEmail.ts:217] — deferred, pre-existing (`packingListSchemas` trims only the ends; root fix belongs in validation, before the 16.4 connector writes names)

## Dev Notes

### Decisions (made here, open to Tommy's override)

- **No packed mark in the mail.** The AC asks for the items grouped by category, nothing more. The mail is a snapshot; a "packed" state frozen at send time goes stale the moment someone ticks the trip list, and the morning reader should take everything on the list anyway. The day view keeps its live packed mark. (Listed as a question for Tommy at the end of the story run.)
- **Section is the mail's last block**, after the plan rows. "After the day's plan" is read literally; the documents sentence and link stay at the top as in 9.3.
- **Reuse, don't add, dictionary keys**: `trips.packingList.dayTitle` (Mitnehmen / Take along) and `trips.packingList.other` (Sonstiges / Other) already exist in both dictionaries (en.ts:419/444, de.ts:398/423). Same word on the day view and in the mail.

### Current state of the files touched

- **`src/lib/notifications/dayEmail.ts` (221 lines)** — pure builder (no I/O, no clock, no env). `buildDayEmail({ payload, language, t, dayUrl, documents })` → `{ subject, text, html }`. Content flows `timeline → toRows → rowToText / rowToHtml`; text = blocks joined by `"\n\n"` ending with the rows (or `trips.dayPrint.empty`); HTML = one 600px column, inline styles, ends with the rows then `</div></body></html>`. `escapeHtml` (module-private, escapes `& < > " '`) is applied at every interpolation. **Preserve:** purity, "nothing loads", escaping at interpolation only (raw values in data), identical content in both parts, the exact current output for days without packing items.
- **`src/app/api/trips/[id]/days/[dayId]/email/route.ts` (173 lines)** — guard order CSRF → session → params → `hasTripReadAccess` (404) → user email → `getTripDayPrintPayloadForUser` (404) → `getRequestI18n` → `compose(which)` closure → `buildDayPacket` → measure with `MailComposer` against `MAX_DAY_EMAIL_BYTES` → send (awaited) → `{ sentTo, attachment }`. **Preserve:** body never read (recipient = session account only), one `getRequestI18n` call, logging rules (no address/subject/body in logs), `NO_STORE` everywhere. The packing read goes inside the existing `try` so its failure yields the existing 500 "Unable to prepare the day email".
- **`src/lib/repositories/packingListRepo.ts` (452 lines)** — every app read/write of `PackingItem`/`PackingItemDay`. Readers check participation with `OR: [{ userId }, { members: { some: { userId } } }]`; `listPackingItemsForTrip` (~:165) is the trip-wide read (returns `accessRole` + `PackingItemDetail[]` with days). Do not reuse it for the mail: it loads the whole trip list with every day link; the mail needs one day's items and four fields.
- **`src/lib/trips/packingList.ts`** — `groupPackingItems<T extends { id; name; category; packed }>(items, otherLabel, locale)` → `PackingGroup<T>[]` (`key`, `label`, `packed`, `total`, `items`). Its header already names the day email as an intended reader. Reuse as is; `PackingItemForDay` satisfies `GroupableItem`.
- **Schema** — `PackingItem` (`tripId`, `name`, `nameKey`, `category?`, `packed`, cascade on trip) and `PackingItemDay` (`@@id([packingItemId, tripDayId])`, index on `tripDayId`, cascade both sides). No migration.

### Architecture / project rules that apply

- Packing reads/writes only through `packingListRepo` (Epic 16 shared rules). Access per trip: every participant reads (FR30), the route already refuses non-members with 404.
- All UI text in German and English via the dictionaries; `formatMessage` only where placeholders exist (none here).
- Mail HTML: inline `style=""` only, no remote content, one column `max-width:600px` (9.3 rules in the builder's docblock).
- `tripRepo.ts` contains a byte that makes plain `grep` treat it as binary and print nothing — use `grep -a` if you search it (not expected to be touched here).

### Testing

Vitest; route tests run real Prisma against the per-worker test DB and the in-memory outbox (`getEmailOutbox` / `clearEmailOutbox`) — no network.

- **`test/dayEmail.test.ts`** (unit, pure): update the `build` helper to pass `packingItems` (default `[]`) and the direct `buildDayEmail({...})` call in "escapes the link inside the href" (add `packingItems: []`). New cases in the existing `describe`:
  - English: items in "Electronics" and no category → text contains `TAKE ALONG`, `Electronics`, `- Charger`, `Other`, `- Sunscreen`; HTML contains `Take along` and the names; the "Other" group comes after "Electronics" in both parts (index comparison); items alphabetical within a group; the section comes after the last plan row (index of the heading > index of the last row's title) in both parts.
  - German: same items → `MITNEHMEN` / `Mitnehmen` and `Sonstiges`.
  - No items: neither part contains the heading (en and de words), and the output equals the output built before this story for the same payload (e.g. `build(payload(FULL_DAY))` text ends with the last row's content).
  - Escaping: an item name and a category `<b>x</b> & "y"` → HTML has `&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;` and no `<b>`; text has the raw string.
  - Grouping ignores case in category ("technik" and "Technik" → one group), mirroring `groupPackingItems`.
  - The existing "loads nothing" test: run it with a non-empty `packingItems` too (or extend `FULL_DAY` builds to include items) so the URL set is still only `DAY_URL`.
- **`test/tripDayEmailRoute.test.ts`** (end to end): one new case — owner day plus a second day (`endDate` one day later, or create the item on another trip day), item A linked to the emailed day (with a category), item B linked only to the other day, item C unlinked; POST → outbox mail's `text` and `html` contain A and its category, not B or C, and the heading. A day with no links → no heading (the existing "writes the plan in English by default" case can assert `not.toContain("Take along")`). Create items with `prisma.packingItem.create({ data: { tripId, name, nameKey: packingNameKey(name), category } })` and `prisma.packingItemDay.create({ data: { packingItemId, tripDayId } })`. Add `await prisma.packingItemDay.deleteMany(); await prisma.packingItem.deleteMany();` at the top of the file's `beforeEach` (cascade from `trip.deleteMany()` would also clear them, but explicit is the file's style).
- **Repo**: a short case in `test/packingListRepo.test.ts` for `listPackingItemsForDay`: returns only the day's items in name-key order, `[]` for a non-participant, a viewer gets the items.
- `test/tripDayEmailRouteCap.test.ts` and the SMTP-failure file need no change (the route reads packing items for every day; no items → `[]`).

### Previous story intelligence (16.2, 16.6)

- 16.2 deliberately kept `TripDayView.loadDay` and `GET /api/trips/[id]` free of packing items (the connector's query count is pinned by `test/mcpTripRouteSinglePass.test.ts`) — the same reason this story does not widen the print payload.
- 16.2's day section groups with `groupPackingItems(dayItems, t("trips.packingList.other"), locale)` and shows group labels **without** counts — the mail follows that, not the trip list's "Technik 4/7".
- Reviews in 16.1/16.2/16.6 repeatedly flagged copied helpers ("`resolveApiError` copied instead of shared") — reuse `groupPackingItems` and `escapeHtml`, do not write a second grouping or escaper.
- Open deferrals DW-438..441 concern the day section and the category chips; none touches the mail.

### Git intelligence

- `c111d8e` (16.1) introduced `packingListRepo`, `packingList.ts`, the schema; 16.2 and 16.6 are implemented and reviewed but **uncommitted** in the working tree (`git status`): `day-links/` route, `shared.ts`, `TripDayPackingSection.tsx`, and edits to the repo/lib. Build on the working tree, not on `c111d8e`.
- `dd85166`/`5d86bb8` (15.8) and 9.3's files are the day email's latest state; nothing since touched `dayEmail.ts` or the email route.

### Latest tech information

No new library or version. Uses existing `nodemailer` (`MailComposer` for the measurement, unchanged), Prisma client, Vitest.

### Project Structure Notes

- Modified only: `src/lib/repositories/packingListRepo.ts`, `src/lib/notifications/dayEmail.ts`, `src/app/api/trips/[id]/days/[dayId]/email/route.ts`, `test/dayEmail.test.ts`, `test/tripDayEmailRoute.test.ts`, `test/packingListRepo.test.ts`. No new files, no migration, no i18n additions, no UI change.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 16.3: Take-Along in the Day Email]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 16: The Packing List] (shared rules: grouping, "Other" last, de/en)
- [Source: _bmad-output/planning-artifacts/prd.md] FR51 (amended 2026-11-08), FR59
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08-packing-list.md] §4.5 UX ("Day email: a 'Mitnehmen' / 'Take along' section after the plan")
- [Source: _bmad-output/implementation-artifacts/9-3-the-day-in-my-inbox.md] day email rules
- [Source: _bmad-output/implementation-artifacts/16-2-what-the-day-needs.md] day section grouping, no counts
- [Source: travelplan/src/lib/notifications/dayEmail.ts], [Source: travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts], [Source: travelplan/src/lib/trips/packingList.ts#groupPackingItems], [Source: travelplan/prisma/schema.prisma#PackingItem]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Red phase confirmed for each task: repo (2 failing), builder (6 failing; the two "no items" cases passed before the change, pinning the pre-story output), route (9 failing until the route passed `packingItems`).
- The story's Git note was stale: 16.2/16.6 were already committed in `fa84061` (= baseline_commit); nothing else differed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Task 1: `listPackingItemsForDay` + `PackingItemForDay` in `packingListRepo.ts` - one `findMany` with the day link and participant clause, four fields, name-key order; docblock names the day email as a reader.
- Task 2: `buildDayEmail` takes a required `packingItems`; `groupPackingItems(items, t("trips.packingList.other"), language)` once, both parts iterate the same groups. Text: `TAKE ALONG` / `MITNEHMEN` block, then one block per group (`label` + `- name` lines). HTML: heading in the itinerary heading's style (top margin 20px), bold 14px group label, `<ul>`/`<li>`, all through `escapeHtml`. No items → no blocks; output identical to before (asserted: text ends with the last row, HTML closes right after it). No packed mark, no counts (per the story's decision).
- Task 3: route reads the items once inside the existing `try` (DB failure → existing 500), passes them to both `compose` calls; print payload untouched; docblock sentence added.
- Task 4: 11 new tests - 2 repo, 8 builder (en/de, order incl. "Other" last and after the plan / after the empty sentence, case-insensitive merge, no counts, no section without items in both languages, escaping of names and categories; "loads nothing" now runs with items), 1 route end-to-end (linked item + category in, other day's and unlinked out); the English default route case asserts no heading; the viewer case asserts the viewer's mail carries the section (AC8).
- Task 5: typecheck clean; lint 0 errors (80 pre-existing warnings, touched files clean); full suite 268 files / 4304 tests green (baseline 4293 + 11); build passes. No i18n keys added.
- Open question for Tommy: the mail shows no packed mark (snapshot would go stale) - say if you want one.

### File List

- travelplan/src/lib/repositories/packingListRepo.ts (modified)
- travelplan/src/lib/notifications/dayEmail.ts (modified)
- travelplan/src/app/api/trips/[id]/days/[dayId]/email/route.ts (modified)
- travelplan/test/packingListRepo.test.ts (modified)
- travelplan/test/dayEmail.test.ts (modified)
- travelplan/test/tripDayEmailRoute.test.ts (modified)
- _bmad-output/implementation-artifacts/16-3-take-along-in-the-day-email.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)

### Change Log

- 2026-11-08: Story 16.3 implemented - day email gains a "Take along" / "Mitnehmen" section after the plan (grouped, escaped, both parts, none without items); new `listPackingItemsForDay`; 11 tests added. Status -> review.
