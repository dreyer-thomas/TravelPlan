---
baseline_commit: f8b67c0
---

# Story 15.2: Claude Knows the Trip

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⛔ Prerequisites — read before starting

- **Story 15.1 is done** (`f981ede` + review fixes `f8b67c0`). This story builds on its `/api/mcp` endpoint, `src/lib/mcp/*` and the test fixtures in `test/helpers/oauthFixtures.ts`. If `src/lib/mcp/tools/whoami.ts` is missing, you are on the wrong base.
- Source of truth: Story 15.2 and the Epic 15 *shared rules* in `epics.md`; rulings R1 and R7 in `sprint-change-proposal-2026-10-29-mcp.md` §1; *MCP endpoint* in `architecture.md` (*API & Communication Patterns*).
- **Read only.** No schema change, no migration, no write tool, no UI, no i18n. Writes start in 15.4.
- **Viewer-only trips are invisible** (R1). Every tool answers *not found* for a trip the user cannot write, exactly as for a trip that does not exist. This is the one property the review will attack first.

## Story

As someone planning with Claude,
I want Claude to read my trips, days, activities, stays, legs, bucket list, costs, links and documents,
so that its suggestions build on what is already planned instead of on what I retype.

## Acceptance Criteria

1. **`list_trips`** returns the trips where I am owner or contributor, each with `id`, `name`, `startDate`, `endDate` (`YYYY-MM-DD`), `role` (`"owner"` | `"contributor"`) and `dayCount`, ordered as the app lists them. A trip where I am only a viewer is **not** in the list.
2. **`get_trip(tripId)`** returns the trip's `name`, `startDate`, `endDate`, and per day, in day order:
   - `id`, `date` (`YYYY-MM-DD`), `dayIndex`
   - `stay`: `{ name, status: "planned" | "booked" }` or `null`
   - `missingStay` (boolean, the overview's rule)
   - `activityCount`
   - `warnings` (FR47, see AC 5)
   
   **No budget and no cost totals** (Tommy, 2026-10-29): TravelPlan has no trip budget, and totals are not wanted. Costs are read **per entry**, with their payment split, in `get_day` and `get_bucket_list` (AC 4), so the model can analyse them itself.
3. **`get_day(tripId, dayId | date)`** takes exactly one of `dayId` or `date` (`YYYY-MM-DD`) and returns:
   - `id`, `date`, `dayIndex`
   - `previousStay`: last night's stay by the **schedule's** rule (raw row of the nearest earlier day with a lower `dayIndex`, whatever its name) as `{ id, name, checkOutTime }`, or `null`. `checkOutTime` is what the day's first flexible activity starts from (FR42; 10:00 default, 09:00 when there is no stay the night before).
   - `activities`, in the day's order (`compareDayPlanItemsByOrder`), each with the fields in AC 4
   - `legs`: each travel leg of the day with `id`, `from` and `to` as `{ type: "stay" | "activity", id }`, `mode` (the app's `TravelTransportType`), `durationMinutes`, `distanceKm`, `link`, `updatedAt`
   - `stay`: the night's stay, or `null` under the same rule as `missingStay`, with `id`, `name`, `status`, `checkInTime`, `checkOutTime` (`HH:MM` or `null`), `place`, `link`, `notes`, `cost`, `payments`, `documents`, `images`, `updatedAt`
   - `missingStay`, `warnings`
4. **Activity fields** (on a day and, where stated, in the bucket list):
   - `id`, `title` (`null` when empty), `description` (plain text, AC 7)
   - `mode`: `"flexible"` | `"fixed"`, `durationMinutes`
   - `startTime`, `endTime`: `HH:MM` as computed by the schedule (stored `fromTime`/`toTime`); both `null` means the activity does not fit in the day. **Not in the bucket list.**
   - `place`: `{ label, lat, lng }` or `null`
   - `link`: URL or `null`
   - `cost`: `null`, or `{ eurCents, original: { amountMinor, currency, rate, rateDate } | null }`. `original` is present only for a foreign-currency entry (FR41); `rate` is units of that currency per 1 EUR, as stored.
   - `payments`: the cost's split into instalments (deposit, balance, …) as entered in the dialog, `[{ amountEurCents, dueDate (YYYY-MM-DD), amountOriginalMinor? }]` in the app's order; `[]` when the cost is not split. **This is the point of the cost fields** (Tommy, 2026-10-29): cost and every instalment are passed on unchanged, for both activities and the night's stay, so the model can analyse what is due when. No sums are computed for it.
   - `documents`: `[{ id, fileName }]`; `images`: `[{ id, fileName }]` (file name = last path segment of the stored URL), each in `sortOrder`. **No URLs or storage paths** for files; 15.7's `get_file` takes the id.
   - `updatedAt` (ISO 8601 with milliseconds)
5. **Warnings (FR47)** are the app's `derivePlanConflicts` result for that day, the same list the overview and the day view show: `{ kind: "late", activityId, title, startTime, reachableAt, lateMinutes }` or `{ kind: "overflow", activityId, title }`. Never recomputed by a second rule.
6. **`get_bucket_list(tripId)`** returns the trip's parked activities (`tripDayId` null) with the AC 4 fields **minus** `startTime`, `endTime` and legs (`mode` is always `"flexible"` there), in the bucket list's order (title, then created, then id). A day's activities never appear in it, and a parked activity never appears on a day.
7. **Plain text.** `description` is the activity's `contentJson` converted by a new shared `tiptapDocToPlainText` in `src/lib/trips/planText.ts`: one line per block (paragraph, heading, blockquote, code block), list items prefixed `- ` (bullet) or `1. ` (ordered, counted), `hardBreak` as a newline, a link mark rendered as `text (url)` when the text differs from the URL, consecutive empty lines collapsed, trimmed. Invalid JSON gives `""`. `parsePlanText` stays **unchanged** (the print sheet, the day email and the labels depend on it).
8. **`updatedAt` on every entry** (activity, stay, leg, previous stay excluded) is the row's own `updatedAt`, so 15.4's write tools can compare it inside their transaction. Tool descriptions say so ("pass `updatedAt` back to write tools").
9. **Not found.** For a `tripId` I cannot write (viewer, not a member, nonexistent) every trip-scoped tool answers the MCP tool error `Trip not found`; for a `dayId` or `date` not in that trip, `Day not found`. The same text and the same `isError: true` for "does not exist" and "not yours", so nothing leaks existence. Access is checked per call with `getTripAccessForUser` + `canTripAccessRoleWrite` (shared rule), **and** the new day reader filters on writers in its own query (defence in depth, as `getTripWithDaysForUser` re-derives the role).
10. **Shared tool rules** (Epic 15), applied through one wrapper used by every tool, `whoami` included:
    - per-user rate limit `checkRateLimit("mcp-tool:" + userId, 120, 60_000)`; over it, the tool error `Rate limit reached: at most 120 TravelPlan tool calls per minute. Wait a minute and try again.`
    - log line `mcp: tool=<name> user=<id> trip=<tripId> outcome=<ok|error> ms=<n>` for trip-scoped tools (the `trip=` part only when a trip id was given, so `whoami`'s line is unchanged), never argument content
    - an unexpected exception becomes the tool error `TravelPlan could not answer this request; try again.`, logged with `console.error` (message only, no arguments); internal details never reach the model
    - annotations `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`
    - English descriptions written for the model, naming units (minutes, EUR cents, `HH:MM`, `YYYY-MM-DD`)
11. **Output format.** Each tool returns the result as `structuredContent` **and** as one `text` content item with the same JSON (as `whoami` does). Ids are the database ids. Dates `YYYY-MM-DD`, times `HH:MM`, timestamps ISO 8601.
12. **Repositories only.** Tools call repository and `src/lib/trips/*` functions, never `prisma` (shared rule). `whoami`'s direct `prisma.user.findUnique` moves into a repository function while you are there.
13. **Tests** (vitest, through `POST /api/mcp` with a real token, as in `test/mcpRoute.test.ts`) cover at least:
    - a viewer-only trip invisible in **every** read tool: absent from `list_trips`, `Trip not found` from `get_trip`, `get_day` and `get_bucket_list`, with the same text as a random id
    - an owner and a contributor reading the same trip with identical results (role aside)
    - `get_day` by `dayId` and by `date`; neither or both given refused by the input schema; a `dayId` from another trip answering `Day not found`
    - a day's full payload: order, computed times, a fixed and a flexible activity, a foreign-currency cost with payments, a leg, the previous stay's check-out, the night's stay with a document and an image, a `late` and an `overflow` warning, no file URLs anywhere in the JSON
    - the parked/day split: a parked activity only in `get_bucket_list`, a day activity only in `get_day`
    - `tiptapDocToPlainText`: paragraphs, bullet and ordered lists, hard break, link mark, heading, empty doc, invalid JSON
    - the rate limit (121st call in a minute refused; another user unaffected) and the log line with `trip=`
    - `tools/list` naming exactly `whoami`, `list_trips`, `get_trip`, `get_day`, `get_bucket_list` (update the existing `["whoami"]` assertion in `mcpRoute.test.ts`)
14. **Gates.** `npm test` (the 8 known Windows failures of DW-419 aside), `npm run typecheck`, `npm run lint` (no new errors), `npm run build`.

**Out of scope:** any write (15.4+); file contents (15.7 `get_file`); the KI/AI marker (the `aiChangedAt` column arrives with 15.4's migration; 15.4 adds `aiChanged` to these read outputs, see *Deviations*); AI suggestions (Epic 12); trip members, hero and day images as such, day notes.

## Tasks / Subtasks

- [ ] **Task 1: Plain text** (AC 7)
  - [ ] `tiptapDocToPlainText(contentJson: string): string` in `src/lib/trips/planText.ts`, next to `parsePlanText` and `plainTextToTiptapDoc`, pure, no client imports. Node types to handle: StarterKit's (`doc`, `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `blockquote`, `codeBlock`, `hardBreak`, `text`) plus the `link` mark (`TripDayPlanDialog.tsx:891`). Unknown nodes: walk their children.
  - [ ] Tests in a new `test/planText.test.ts`.
- [ ] **Task 2: Day reader for the connector** (AC 3, 4, 5, 8, 9)
  - [ ] New `src/lib/repositories/connectorReadRepo.ts` (all Prisma access for the read tools lives here):
    - `getPlannerDayForUser({ userId, tripId, day: { id } | { date } })` → `PlannerDay | null`. One `prisma.trip.findFirst` with `where: { id: tripId, OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }] }` (the `countPlannableTripsForUser` arms), then `deriveTripAccessRole` + `canTripAccessRoleWrite` on the loaded membership, `null` otherwise. Select all days' `id, dayIndex, date` plus the raw accommodation `id, name, checkOutTime` (for the previous-stay walk) and, for the target day only, items, legs and stay with `updatedAt`, payments (`orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]`, as `getTripWithDaysForUser`), images and documents (`orderBy sortOrder`).
    - Find the target day by id, or by `date.toISOString().slice(0, 10) === date`. Not in this trip → `null` day (the tool says `Day not found`); distinguish trip-null from day-null in the return type.
    - Previous stay: walk back to the nearest earlier day with a lower `dayIndex` (copy the loop and its comment from `getTripWithDaysForUser`, `tripRepo.ts:1258`; it is the writes' `readScheduleInputInTransaction` rule).
    - Order items with `compareDayPlanItemsByOrder` (`src/lib/trips/dayPlanItemOrder.ts`), warnings with `derivePlanConflicts(buildScheduleInput({ items, legs, previousStay }))` (`src/lib/trips/planConflicts.ts`), payments with `toPaymentDetails` (`paymentDetail.ts`), stay visibility and `missingStay` by `accommodation?.name.trim()` (the overview's rule, `tripRepo.ts:1269`).
    - `listParkedItemMediaForPlanner({ userId, tripId, itemIds })` → `Map<itemId, { documents, images }>`: one query per table, filtered by `dayPlanItem: { tripId, tripDayId: null }` and the writer check, for AC 6 (the bucket list read returns only `firstImageUrl`).
  - [ ] Repository tests in `test/connectorReadRepo.test.ts`: viewer → `null`, removed membership → `null`, by id and by date, previous stay across a gap in `dayIndex`, warnings equal to `getTripWithDaysForUser`'s for the same day (parity, not a second rule).
- [ ] **Task 3: Tool runtime** (AC 9, 10, 11, 12)
  - [ ] `src/lib/mcp/logging.ts`: `logToolCall(name, userId, run, tripId?)`; the `trip=` segment only when `tripId` is given.
  - [ ] New `src/lib/mcp/toolRuntime.ts`:
    - `runTool({ name, ctx, tripId? }, (userId) => Promise<CallToolResult>)`: resolves the user (`userIdFromAuthInfo`, `Not authenticated` without one), applies the rate limit, logs, catches unexpected errors (AC 10)
    - `toolResult(value)` → `{ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }`
    - `requireWritableTrip(userId, tripId)` → `true | CallToolResult` (`Trip not found`) via `getTripAccessForUser` + `canTripAccessRoleWrite`
    - `READ_ONLY_TOOL_ANNOTATIONS`
  - [ ] `whoami`: use `runTool`; move the email lookup into `userRepo.ts` (reuse an existing reader if one returns the email by id, otherwise add `getUserEmailById`). Its log line and output stay exactly as today.
- [ ] **Task 4: Read tools** (AC 1–6, 8–11)
  - [ ] `src/lib/mcp/tools/tripRead.ts` (one file per area, architecture) with `registerTripReadTools(server)` registering `list_trips`, `get_trip`, `get_day`, `get_bucket_list`; register it in `src/lib/mcp/server.ts` after `whoami`.
  - [ ] `src/lib/mcp/plannerShapes.ts` (pure mappers, unit-testable without the SDK): repository rows → the AC 1–6 JSON. One `toActivity(item, media, { withTimes })` shared by `get_day` and `get_bucket_list`, one `toCost`, `toPayments`, `toWarning`, `toLeg`, `toStay`, date as `toISOString().slice(0, 10)`.
  - [ ] `list_trips`: `listTripsForUser(userId)` filtered by `canTripAccessRoleWrite(trip.accessRole)`. Do not add a second query.
  - [ ] `get_trip`: `requireWritableTrip`, then `getTripWithDaysForUser(userId, tripId)` (`null` → `Trip not found`). `activityCount` = `day.dayPlanItems.length`; `stay` from `day.accommodation`; `warnings` from `day.planConflicts`. Do **not** output `plannedCostTotal`, `accommodationCostTotalCents` or `plannedCostSubtotal`. The description points the model to `get_day` for costs and payments.
  - [ ] `get_day`: `requireWritableTrip`, then `getPlannerDayForUser`.
  - [ ] `get_bucket_list`: `requireWritableTrip`, then `listParkedDayPlanItemsForTrip({ userId, tripId })` (`bucketListRepo.ts:180`, already writer-only) plus `listParkedItemMediaForPlanner`.
  - [ ] Input schemas with `zod` (`import { z } from "zod"`, v4; the SDK takes `z.object(...)` as `inputSchema`, see the `registerTool` example in `node_modules/@modelcontextprotocol/server/dist/mcp-*.d.mts`). Ids `z.string().trim().min(1).max(64)`; `date` `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`; `get_day` refines "exactly one of `dayId`, `date`". Handler signature `(args, ctx)`.
  - [ ] No `outputSchema` in this story: the shapes grow in 15.4 (`aiChanged`), and the SDK validates `structuredContent` strictly against it. Revisit when the shapes settle.
- [ ] **Task 5: Tests and gates** (AC 13, 14). See *Testing*.

## Dev Notes

### What exists, and what each tool reuses

| Need | Existing code | Gap and what to do |
|---|---|---|
| Trips the user may plan | `listTripsForUser(userId)` (`tripRepo.ts:874`) → `TripListPage { trips: TripSummary[], totalCount }`; `TripSummary` has `id, name, accessRole, startDate, endDate, dayCount, …`; **includes viewer trips**; capped at `TRIPS_LIST_LIMIT = 200` | Filter by `canTripAccessRoleWrite`. The cap is irrelevant at two users; do not work around it. |
| Trip overview | `getTripWithDaysForUser(userId, tripId)` (`tripRepo.ts:1100`) → `TripWithDays` with `plannedCostTotal`, `accommodationCostTotalCents` (both **not** output, Tommy's ruling), and per day `planConflicts`, `missingAccommodation`, `plannedCostSubtotal`, `accommodation` (null when the name is blank), `dayPlanItems`. **Admits viewers.** | Gate with `requireWritableTrip` first. Exactly what the overview page shows (`GET /api/trips/[id]`), so parity is free. |
| Day detail | No reader returns a day with `updatedAt` on items/stays and with media names. `getTripWithDaysForUser` has no `updatedAt` on items, stays or legs and no media; `getTripDayPrintPayloadForUser` (`:1480`) has media but no payments, no warnings, no `updatedAt`, and a third previous-stay rule (`dayIndex - 1`) | New `getPlannerDayForUser` in `connectorReadRepo.ts` (Task 2), reusing the pure helpers. **Do not** widen `getTripWithDaysForUser` (it feeds every page; adding media there would cost every overview load) and do not chain the six per-day list functions (six queries, six access checks, all admitting viewers, inconsistent snapshot). |
| Bucket list | `listParkedDayPlanItemsForTrip({ userId, tripId })` (`bucketListRepo.ts:180`) → `ParkedDayPlanItemDetail[]` (`id, title ("" if none), contentJson, durationMinutes, cost…, payments, linkUrl, location, firstImageUrl, createdAt, updatedAt`), **writer-only**, ordered title/createdAt/id | Add media through `listParkedItemMediaForPlanner`. Map `title: ""` to `null`. |
| Warnings | `derivePlanConflicts(buildScheduleInput({ items, legs, previousStay }))`, pure (`planConflicts.ts:76/87`); `DayPlanConflict = {kind:"late", itemId, title, fromTime, reachableAt, lateMinutes} \| {kind:"overflow", itemId, title}` | Reuse. Rename `itemId` → `activityId`, `fromTime` → `startTime` in the output only. |
| Rich text | `parsePlanText` (`planText.ts:16`) joins text nodes with **spaces**: paragraphs and list items run together | New `tiptapDocToPlainText` (AC 7). There is also a private copy `parsePrintablePlanText` in `tripRepo.ts:662`; leave it. |
| Access | `getTripAccessForUser` + `canTripAccessRoleWrite` (`src/lib/auth/tripAccess.ts`) | `requireWritableTrip`. Do **not** use `refuseUnlessTripWriter`: it answers HTTP `Response`s and a 403 for viewers, which would leak existence here. |
| Rate limit | `checkRateLimit(key, limit, windowMs)` (`src/lib/security/rateLimit.ts`), in-memory | Not yet applied to `/api/mcp` (15.1 did not); this story adds it for all tools. |

### Data facts the mappers depend on

- `TripDay.date` is a `DateTime` at UTC midnight; `dayIndex` starts at 1. `Trip.startDate`/`endDate` likewise. Always format with `toISOString().slice(0, 10)`, never local time.
- `DayPlanItem.tripDayId` null = parked. A DB CHECK forces parked items to be `FLEXIBLE`, times null, `sortOrder` 0.
- `scheduleMode` is `"FLEXIBLE" | "FIXED"` in the DB; output lower-case. `fromTime`/`toTime` are stored `HH:MM` strings written by every schedule recompute (`prisma/schema.prisma:243-247`), so reading them is reading the computed times.
- Costs on `Accommodation` and `DayPlanItem`: `costCents` (EUR), and the FR41 four `costOriginalAmount` (Int, **minor units** of the original currency), `costCurrency`, `costRate` (units per EUR; `toCents = round(amountOriginal / rate)`, `convertCost.ts:46`), `costRateDate` — all four set or all null.
- `PaymentDetail = { amountCents, dueDate, amountOriginal? }` (`paymentDetail.ts:18`), `amountOriginal` **omitted** for EUR rows. Build with `toPaymentDetails(rows)`.
- Accommodation `status` is `PLANNED | BOOKED` in the DB; `link` (not `linkUrl`) on stays, `linkUrl` on items and legs. `checkInTime`/`checkOutTime` are `HH:MM` strings or null.
- Legs: `fromItemType`/`toItemType` are `"accommodation" | "dayPlanItem"`; map to `"stay" | "activity"`. A leg from the previous night's stay has `fromItemType: "accommodation"` with the **previous** day's stay id; that is why `previousStay.id` is in the output.
- Media tables: `DayPlanItemImage`, `DayPlanItemDocument`, `AccommodationImage`, `AccommodationDocument`. Documents have `fileName`; images do not (derive it from `imageUrl`). No MIME column.
- `src/lib/repositories/tripRepo.ts` contains a non-UTF-8 byte: `grep` calls it binary, use `grep -a`.

### Tool contract sketch

```ts
// src/lib/mcp/tools/tripRead.ts (shape, not final code)
server.registerTool(
  "get_day",
  {
    title: "Read one day of a trip",
    description:
      "Returns one day of a TravelPlan trip: last night's stay and its check-out time (HH:MM), the activities in order " +
      "with computed start/end (HH:MM; null = does not fit in the day), duration in minutes, place, link, cost in EUR cents " +
      "(and original currency), payments, document and image ids, the travel legs between them, the night's stay, and plan " +
      "warnings. Give either dayId or date (YYYY-MM-DD). Every entry has updatedAt; pass it back unchanged to write tools.",
    inputSchema: getDayInput,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  },
  async (args, ctx) =>
    runTool({ name: "get_day", ctx, tripId: args.tripId }, async (userId) => {
      const gate = await requireWritableTrip(userId, args.tripId);
      if (gate !== true) return gate;
      const result = await getPlannerDayForUser({ userId, tripId: args.tripId, day: args.dayId ? { id: args.dayId } : { date: args.date! } });
      if (!result) return toolError("Trip not found");
      if (!result.day) return toolError("Day not found");
      return toolResult(toPlannerDay(result));
    }),
);
```

- `list_trips` description should tell the model to start there and that viewer-only trips are deliberately absent.
- `get_bucket_list` description: "parked activities, not on any day; schedule them onto a day with the write tools (later)". Do **not** name tools that do not exist yet.

### Testing

- Vitest, flat `test/`. Each test file gets its own copy of the migrated template DB and media root (`test/globalSetup.ts`, `test/setup.ts`, commit `c74abe6`); files run in parallel on 4 forks, so never rely on another file's rows.
- Move `issueAccessToken`, `rpc` and a new `callTool(token, name, args)` from `test/mcpRoute.test.ts` into `test/helpers/oauthFixtures.ts` (or a new `test/helpers/mcpClient.ts`) and import them in both files. Clean children first in `beforeEach`.
- Seed trips with Prisma directly in tests (as `mcpRoute.test.ts` does) or with the existing helpers (`test/helpers/createDayPlanItem.ts`, `settleSeededDay.ts`, `tripIdOfDay.ts`; see `test/bucketListRepo.test.ts` for a parked-item setup). Seed items through the repository create functions where you need computed times, or call `settleSeededDay` so `fromTime`/`toTime` are the schedule's, not hand-written.
- Rate-limit test: the store is a module-level `Map` on `globalThis`; use a fresh user id per test and `vi.setSystemTime` to cross the window rather than clearing the store.
- Suggested files: `test/planText.test.ts`, `test/connectorReadRepo.test.ts`, `test/mcpReadTools.test.ts` (end to end through `POST`), `test/mcpPlannerShapes.test.ts` (pure mappers), and the `tools/list` update in `test/mcpRoute.test.ts`.
- Assert "no file URLs": `JSON.stringify(result)` does not contain `/uploads/`.

### Previous story intelligence (15.1)

- The SDK is `@modelcontextprotocol/server` **2.4.0** (v2, pinned). Use the installed `.d.mts` as the truth for names; v1 docs on the web differ.
- `/api/mcp` serves two legs (2026-07-28 via `createMcpHandler({ legacy: "reject" })`, 2025-era via a per-request transport); both build the server with `createTravelPlanMcpServer()`, so registering the tools there covers both. Test at least one tool on each leg (the 2026-07-28 call needs `_meta` and the `Mcp-Method`/`Mcp-Name` headers, see `mcpRoute.test.ts` "answers a 2026-07-28 request").
- Read the user only from `ctx.http?.authInfo` via `userIdFromAuthInfo`; never fall back.
- Windows: 8 tests fail on this checkout regardless (DW-419); one focus test in `tripDayPlanDialog` was flaky once under parallel load. Report them, don't chase them.
- npm 11 blocks install scripts here; no dependency change is needed in this story.

### Deviations from the epic text (recorded, not silent)

- **"budget" and "the planned-cost total"** in `get_trip` (Tommy, 2026-10-29): dropped. TravelPlan has no budget field, and totals are not wanted. What is wanted is each entry's cost with its payment split, which `get_day` and `get_bucket_list` carry (AC 4).
- **"the KI/AI marker of each entry"** in `get_day` (Tommy, 2026-10-29: agreed, moved to 15.4): the column `aiChangedAt` is created by 15.4's migration (15.4 AC "Given the migration"). Reading a column that does not exist is not possible here, and outputting a constant `false` would be a lie in 15.4's first deploy if forgotten. 15.4 adds `aiChanged: boolean` to the activity, stay, leg, document and image shapes in `plannerShapes.ts`. Add this sentence to 15.4's story context when it is created.
- **Image "names"**: images have no name column; the last path segment of the stored URL stands in.

### Project Structure Notes

- New: `src/lib/repositories/connectorReadRepo.ts`, `src/lib/mcp/toolRuntime.ts`, `src/lib/mcp/plannerShapes.ts`, `src/lib/mcp/tools/tripRead.ts`. Modified: `src/lib/mcp/server.ts`, `src/lib/mcp/logging.ts`, `src/lib/mcp/tools/whoami.ts`, `src/lib/trips/planText.ts`, `src/lib/repositories/userRepo.ts`.
- Output JSON is `camelCase` (the app's JSON rule; the `snake_case` exception of 15.1 applies to OAuth wire fields only). Tool names are `snake_case` (epic).
- No route, page, proxy, schema or dictionary change. `test/proxy.test.ts` and `i18nDictionaries.test.ts` stay untouched.

### References

- `_bmad-output/planning-artifacts/epics.md`: Epic 15 shared rules, Story 15.2 (and 15.4 for what follows)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-29-mcp.md`: §1 rulings R1, R7
- `_bmad-output/planning-artifacts/architecture.md`: *API & Communication Patterns → MCP endpoint*, *Write origin and provenance*
- `_bmad-output/planning-artifacts/prd.md`: FR53, FR47, FR42, FR41, FR48
- `_bmad-output/implementation-artifacts/15-1-add-travelplan-to-claude.md`: SDK notes, test patterns, deviations
- Code: `src/lib/mcp/{server,logging,verifier}.ts`, `src/lib/mcp/tools/whoami.ts`, `src/app/api/mcp/route.ts`, `src/lib/auth/{tripAccess,tripAccessRole}.ts`, `src/lib/repositories/tripRepo.ts` (`listTripsForUser` :874, `getTripWithDaysForUser` :1100, `getTripDayPrintPayloadForUser` :1480), `src/lib/repositories/bucketListRepo.ts:180`, `src/lib/repositories/paymentDetail.ts`, `src/lib/trips/{planText,planConflicts,daySchedule,dayPlanItemOrder,convertCost}.ts`, `src/lib/security/rateLimit.ts`, `test/mcpRoute.test.ts`, `test/helpers/oauthFixtures.ts`

## Rulings (Tommy, 2026-10-29, after story creation)

- No budget and no cost totals in `get_trip`; costs per activity and stay, with their payment split, are passed on for analysis (AC 2, AC 4).
- KI/AI marker in the read tools moves to 15.4.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
