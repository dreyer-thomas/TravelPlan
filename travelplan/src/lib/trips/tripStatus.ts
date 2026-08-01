/**
 * The four trip-status states the Trips List renders as pills.
 *
 * EXPERIENCE.md names the four treatments but never draws the boundaries between them, and two of
 * them overlap on real data: a brand-new future trip has every day open, which under a naive
 * `openDayCount > 0` rule would render as a full-width warn row. The precedence ladder in
 * `deriveTripStatus` is the resolution. It is deliberately ordered so that the warn treatment always
 * means "your plan has holes" and never "you haven't started" - otherwise every newly created trip
 * immediately screams for attention and the gap signal stops meaning anything.
 */
export type TripStatus = "past" | "upcoming" | "gap" | "planned";

export type TripStatusInput = {
  /** ISO-8601 UTC, date-only in practice (`normalizeToUtcDate` on the write path). */
  startDate: string;
  endDate: string;
  dayCount: number;
  openDayCount: number;
  planItemCount: number;
};

/**
 * The UTC instant standing for the start of the viewer's *local* calendar day.
 *
 * Trip dates are UTC-normalized date-only values, so the comparison has to happen against a UTC
 * instant - but which calendar day counts as "today" belongs to the person looking at the screen.
 * Reading the UTC date here instead would mark a trip "Completed", dim it and sort it last from
 * 16:00 local onward at UTC-8, while the user is still on that trip.
 */
export const startOfTodayUtc = (now: Date) =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

export const deriveTripStatus = (trip: TripStatusInput, todayUtc: Date): TripStatus => {
  const today = todayUtc.getTime();
  const start = new Date(trip.startDate).getTime();
  const end = new Date(trip.endDate).getTime();

  // 1. A finished trip is archival (AC3). Announcing "3 days open" about a trip that already
  //    happened is noise, not an action - so past outranks every other state.
  if (end < today) return "past";
  // 2. Created but not yet planned: nothing booked, nothing scheduled, and not yet under way.
  //    `>=` rather than `>`: a trip created to start today is every bit as untouched as one
  //    created to start tomorrow, and rendering it as a warn row the instant it appears is the
  //    exact failure this ladder exists to prevent. A trip already under way falls through to
  //    rule 3, where open days are genuinely actionable.
  if (trip.openDayCount === trip.dayCount && trip.planItemCount === 0 && start >= today) return "upcoming";
  // 3. A plan exists and has holes.
  if (trip.openDayCount > 0) return "gap";
  // 4. AC2.
  return "planned";
};
