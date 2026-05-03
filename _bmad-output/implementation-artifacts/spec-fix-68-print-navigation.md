---
title: 'Fix 6.8 Print Navigation — From/To Names and Google Maps Link'
type: 'bugfix'
created: '2026-05-03'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** The Story 6.8 day-print document shows travel segments as `Car · 1h 31m · 81 km` with no from/to location context, and the map section either fails to render in browser print or lacks an offline-usable route link.

**Approach:** Derive from/to display names from adjacent timeline entries and render them below each travel segment row. Add a Google Maps directions link (capped at 9 stops) to the map section that always prints as clickable text, regardless of whether the static map image loads.

## Suggested Review Order

- [`travelplan/src/components/features/trips/TripDayPrintDocument.tsx:1`](../travelplan/src/components/features/trips/TripDayPrintDocument.tsx) — new helpers `buildGoogleMapsUrl` and `getEntryDisplayName`, updated travel segment and map section renders
- [`travelplan/test/tripDayPrintDocument.test.tsx:1`](../travelplan/test/tripDayPrintDocument.test.tsx) — two new tests for Google Maps link and from/to route label

## Spec Change Log

- 2026-05-03 (review): Capped `buildGoogleMapsUrl` at 9 stops with even sampling to avoid Google Maps URL truncation. Added `target="_blank" rel="noopener noreferrer"` to Maps link. Added `.trim() || null` to `stay.name` in `getEntryDisplayName`. Fixed test to assert coordinate order instead of substring presence.
