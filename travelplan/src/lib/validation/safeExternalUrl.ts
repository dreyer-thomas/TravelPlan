/**
 * The write-side link rule: an allowlist of `http:` and `https:`, in the `scheme://host` spelling.
 *
 * `z.string().url()` asks only whether `new URL()` succeeds, so it accepts `javascript:alert(1)`,
 * `data:text/html,<h1>x` and `ftp://x.example/a`. Four byte-identical copies of this predicate had
 * accumulated to close that hole (`dayPlanItemSchemas.ts`, `travelSegmentSchemas.ts`,
 * `TripDayTravelSegmentDialog.tsx`, inline in `tripImportSchemas.ts`) before Story 6.29 added a fifth
 * consumer, which is when a rule with four implementations stops being a duplication and starts being a
 * way for one site to drift. Not every column is gated even now - the import path still validates the
 * accommodation and day-plan-item links with `.url()` alone (see the ledger); every *mutation* schema
 * that stores a user-supplied link is.
 *
 * Deliberately *not* merged with `isSafeLink` (`TripDayPlanItemContent.tsx`), which is the render-side
 * rule: a prefix test on a trimmed lowercase string, no `try`, no allocation, safe to call on every
 * render of every card. What the two layers must satisfy is that **anything this gate stores, that guard
 * renders** - otherwise a link saves without complaint and then silently fails to appear.
 *
 * The `//` requirement is what buys that. For a special scheme the WHATWG parser forgives a missing
 * slash pair, so `new URL("https:booking.example/x")` parses happily as `https://booking.example/x` -
 * which the gate used to accept and the prefix guard then dropped at all three render sites. Requiring
 * the canonical spelling on the way in is cheaper and less surprising than teaching every render path to
 * parse, and it costs a caller nothing: no browser ever produces the shorthand.
 *
 * No `"use client"`: route handlers and schemas import this, and a client module cannot be reached
 * from server code.
 */
export const isSafeExternalUrl = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};
