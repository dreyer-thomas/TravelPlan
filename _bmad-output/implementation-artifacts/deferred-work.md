## Deferred from: fix-68-print-navigation (2026-05-03)

- **Map points missing location data create direct-line shortcuts in Google Maps URL** [TripDayPrintDocument.tsx] — items without coordinates are simply omitted from the route; `map.missingLocations` is available in the payload but not surfaced near the link. Consider adding a "(X locations not shown)" note when missingLocations.length > 0.
- **Test coverage gap: travel segment route label suppression when adjacent planItem has no title and empty content** [tripDayPrintDocument.test.tsx] — `getEntryDisplayName` returns null for such items (correct), but this exact case is untested.

## Deferred from: code review of 6-8-export-day-itinerary-pdf-for-offline-use (2026-05-03)

- **Image URLs rendered without domain allowlist validation** [TripDayPrintDocument.tsx:~213] — app-wide pattern; enforcement requires a broader CSP/URL policy decision
- **parsePrintablePlanText in tripRepo.ts duplicates parsePlanText client utility** [tripRepo.ts:344] — server/client boundary split; consolidation requires a shared pure-function package boundary
- **day.date.toISOString() throws on corrupted DB Date value** [tripRepo.ts:974] — data integrity enforced at write time; defensive guard here would mask deeper DB issues
- **Unauthenticated user sees print page loading state before 401 redirect** [print/page.tsx] — consistent with other client-rendered pages in this app; server-side auth redirect is a broader architectural change
