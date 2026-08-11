/**
 * Story 8.5 (`DW-148`, `DW-151`). Which endpoint pairs a day's timeline actually draws — one rule, in
 * one place, for the two screens that both report figures derived from it.
 *
 * A travel segment is stored as a pair of endpoint ids beside a type discriminator, with no foreign
 * key and no adjacency check on the row itself. Whether it is *drawn* is therefore decided entirely by
 * the day's endpoint order (last night's stay → the day's activities → this night's stay), and every
 * surface that counts travel minutes has to decide it the same way or the app reports two different
 * numbers for one day.
 *
 * That is not hypothetical. `TripDayView` derives the drawn set from its `timelineEndpoints` array and
 * counts only those legs; the trip overview (`TripTimeline`) built each day's coverage bar from the
 * day's *unfiltered* segments and rendered it through the very same `trips.dayView.ganttSummary`
 * string — so on this story's own day-1 fixture the overview said "Planned 7h 45m" for a day the day
 * view said "Planned 7h 30m" about, the difference being a leg the day view simultaneously lists as
 * not counted. Two screens, one day, two figures. Hence one shared derivation rather than two local
 * ones that are free to drift.
 *
 * The key format is `TripDayView`'s original `buildSegmentKey`, unchanged, so nothing about the
 * existing matching behaviour moves with the extraction.
 */

export type DaySegmentEndpointType = "accommodation" | "dayPlanItem";

/** The minimum an endpoint needs to be matched against a stored segment: what it is, and which one. */
export type DaySegmentEndpoint = {
  type: DaySegmentEndpointType;
  id: string;
};

/** The stored side of the same pair, in the wire shape both components already hold. */
export type DaySegmentPairSource = {
  fromItemType: DaySegmentEndpointType;
  fromItemId: string;
  toItemType: DaySegmentEndpointType;
  toItemId: string;
};

/**
 * The pair key. Both halves carry their type because ids are only unique within a table: an
 * accommodation and an activity may hold the same id string in principle, and a key that dropped the
 * discriminator would let one match the other's segment.
 */
export const buildDaySegmentPairKey = (
  fromType: DaySegmentEndpointType,
  fromId: string,
  toType: DaySegmentEndpointType,
  toId: string,
) => `${fromType}:${fromId}::${toType}:${toId}`;

/** The same key for a stored row, so callers never re-spell the field order. */
export const buildDaySegmentPairKeyForSegment = (segment: DaySegmentPairSource) =>
  buildDaySegmentPairKey(segment.fromItemType, segment.fromItemId, segment.toItemType, segment.toItemId);

/**
 * The keys of the consecutive pairs of an ordered endpoint list — i.e. exactly the legs a timeline
 * built from that list can draw. Directional on purpose: `A → B` is drawn and `B → A` is not, which is
 * the same asymmetry `ensureSegmentItemsExist` applies server-side (`toIndex !== fromIndex + 1`).
 */
export const buildDrawnDaySegmentPairKeys = (endpoints: readonly DaySegmentEndpoint[]): Set<string> => {
  const keys = new Set<string>();
  for (let index = 0; index < endpoints.length - 1; index += 1) {
    keys.add(
      buildDaySegmentPairKey(
        endpoints[index].type,
        endpoints[index].id,
        endpoints[index + 1].type,
        endpoints[index + 1].id,
      ),
    );
  }
  return keys;
};

/** `true` when the day's timeline draws this stored row; `false` makes it an orphaned leg. */
export const isDrawnDaySegment = (drawnKeys: ReadonlySet<string>, segment: DaySegmentPairSource) =>
  drawnKeys.has(buildDaySegmentPairKeyForSegment(segment));
