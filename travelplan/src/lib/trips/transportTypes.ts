/**
 * The lowercase wire vocabulary for `TravelTransportType`, and the per-mode rules that go with it.
 *
 * This module exists because Story 6.16's review found the distance rule spelled out three separate
 * times - once in the zod schema, once in the dialog, once in the day view - none of them typed
 * against the enum. Every enum-to-string *mapper* in the codebase is exhaustive with a `never` guard
 * so the compiler catches the next added mode; the rules that key off the enum have to earn the same
 * guarantee, or adding a sixth mode fails to compile in five places and silently does the wrong thing
 * in four others.
 *
 * Deliberately zod-free and dependency-free: client components import it, and pulling
 * `travelSegmentSchemas.ts` into the browser bundle to reach a string array would drag zod with it.
 */

export const TRANSPORT_TYPES = ["car", "ship", "flight", "walking", "cycling", "train", "bus"] as const;

export type TransportType = (typeof TRANSPORT_TYPES)[number];

/**
 * The distance rule for every mode, stated once.
 *
 * - **Car** requires a distance. That rule predates every other mode and is untouched.
 * - **Walking and cycling** (Story 6.16 / AC6) allow one and do not require it. Requiring it would turn
 *   a two-minute walk between adjacent stops into a form error over a number nobody has; forbidding
 *   it would throw away the 40 km of a cycled leg, and would make the route import for those modes
 *   pointless, since it prefills exactly duration *and* distance.
 * - **Train and bus** (Story 6.31, Tommy's ruling of 2026-10-15) allow one and do not require it.
 *   Rail and coach kilometres are rarely known, but worth keeping when they are. Neither mode has a
 *   route import, so the number is only ever typed in.
 * - **Ship and flight** do not allow one. Those are the only two modes the rule forbids, which is why
 *   the schema's error message names them rather than the modes that are allowed.
 */
export const TRANSPORT_TYPES_ALLOWING_DISTANCE = [
  "car",
  "walking",
  "cycling",
  "train",
  "bus",
] as const satisfies readonly TransportType[];

export const TRANSPORT_TYPES_REQUIRING_DISTANCE = ["car"] as const satisfies readonly TransportType[];

export const transportTypeAllowsDistance = (value: TransportType): boolean =>
  (TRANSPORT_TYPES_ALLOWING_DISTANCE as readonly TransportType[]).includes(value);

export const transportTypeRequiresDistance = (value: TransportType): boolean =>
  (TRANSPORT_TYPES_REQUIRING_DISTANCE as readonly TransportType[]).includes(value);

/**
 * A value off the wire or out of the database, narrowed. The column is bare `TEXT` on SQLite with no
 * CHECK constraint (see `prisma/schema.prisma`), so a row *can* hold something outside the union and
 * display surfaces need to say so rather than guess.
 */
export const isTransportType = (value: string): value is TransportType =>
  (TRANSPORT_TYPES as readonly string[]).includes(value);
