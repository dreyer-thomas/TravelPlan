/**
 * Second argument for the `src/app/api/trips/[id]/**` route handlers.
 *
 * The handlers take `{ params: Promise<{ id?: string }> }` - Next 15 made the dynamic segments a
 * promise - and they `await context.params`. A bare object literal, whose `params` key holds a plain
 * `{ id: trip.id }` instead of a promise, runs fine anyway because `await` passes a non-thenable
 * straight through - so 90 call sites across eight route suites passed one and none of them
 * type-checked: TS2353, `'id' does not exist in type 'Promise<{ id?: string }>'`. Seven further
 * sites in `tripDayPlanItemsRoute.test.ts` silenced the same error by casting the literal through
 * `unknown` to the context type, asserting a promise that is not there. Building the context here
 * means a call site cannot express either mistake.
 *
 * What that does *not* yet buy: `grep -c "params: Promise.resolve" test/**` still counts ~129 sites that
 * spell the context inline. Those are correct - they hold a real promise - so they do not error and the
 * completeness grep cannot see them, because it searches only for the broken spelling (the bare-object
 * one) and these hold a promise. The nine suites that were erroring are converted and hold no inline
 * copy; the rest are a separate sweep. Until it happens, a change to the handlers' contract still lands
 * in many files.
 *
 * Adapted from the local helper Story 5.13 added to `test/bucketListRoute.test.ts`, whose own
 * erroring cases never called it.
 *
 * `id` is the only segment for the eight trip-level route suites this serves, so the signature stays a
 * single string rather than a params bag. It is **not** the only segment in the app: the four handlers
 * under `days/[dayId]/` - `route/route.ts`, `print/route.ts`, `image/route.ts` and
 * `documents/packet/route.ts` - declare `dayId` alongside it, and each needs its own context builder
 * rather than a widened `Record<string, string>` here, or the compiler stops telling a caller which
 * keys the handler actually reads.
 *
 * Do not rely on the compiler to enforce that boundary: because both keys are optional,
 * `Promise<{ id?: string }>` is assignable to `Promise<{ id?: string; dayId?: string }>`, so handing
 * this to a `[dayId]` handler type-checks and then fails its params schema at runtime, answering 400
 * from the wrong branch. Reach for a `dayId` handler and you write a new builder, not this one.
 *
 * `tripId` is **required**, and the absent-segment case has its own builder below rather than being an
 * omitted argument here. An optional parameter would mean `routeContext(maybeUndefined)` compiles and
 * silently answers from the handler's not-found branch, so a test asserting only a status passes for the
 * wrong reason - and it would be a real loss for the suites converted here, several of which previously
 * spelled a local helper whose parameter was required. Two names cost nothing and keep the mistake
 * unspellable.
 */
export type RouteContext = {
  params: Promise<{ id?: string }>;
};

export const routeContext = (tripId: string): RouteContext => ({
  params: Promise.resolve({ id: tripId }),
});

/**
 * The context Next hands a handler when the dynamic segment is absent - `params` resolving to `{}`.
 *
 * Its own export because that is the only shape whose *point* is the missing `id`: the handlers guard
 * it (`src/app/api/trips/[id]/route.ts:31`) and the guard needs covering, but reaching it by passing
 * `undefined` to `routeContext` is indistinguishable at the call site from passing a value that happens
 * to be `undefined`. Named, it reads as the case under test.
 */
export const absentSegmentContext = (): RouteContext => ({
  params: Promise.resolve({}),
});
