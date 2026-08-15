import { isSafeExternalUrl } from "@/lib/validation/safeExternalUrl";

/**
 * The same 2000 the write side already enforces on the one of these two columns that has a write
 * side at all: `imageUrlSchema` (`dayImageSchemas.ts`) caps a day image URL there, so a value longer
 * than this cannot have been written by the app and cannot round-trip back through it. There is no
 * matching number to inherit for `Trip.heroImageUrl`, which takes no string from a client on any
 * route - the hero is only ever set from a path the upload route generates itself - so the day
 * column's bound is the only evidence available and this predicate applies it to both. Length is
 * part of *this* predicate
 * rather than a `.max()` on the field schema on purpose: a `.max()` is a 400 for the whole archive,
 * and refusing to restore a backup over one absurd string is precisely what Story 2.32's AC2 rules
 * out. Over-long is simply not a stored-image address, so it is nulled and counted like any other.
 */
export const MAX_STORED_IMAGE_URL_LENGTH = 2000;

/**
 * The read-side rule for a *stored image* URL: the two spellings this app itself ever writes into
 * `Trip.heroImageUrl` and `TripDay.imageUrl`, and nothing else.
 *
 * Those two columns are rendered straight into an `<img src>`, and the import boundary - a
 * hand-edited backup - is the untrusted writer this rule is placed in front of. It is not the only
 * one: `dayImageUpdateSchema` (`dayImageSchemas.ts`) still guards the day-image PATCH route with the
 * same `z.string().url()` fallback described below, so any trip writer can still put a `javascript:`
 * or `data:` string into `TripDay.imageUrl` by hand. That route is deliberately outside this story
 * (DW-8 scopes the work to the import boundary and `tripDayImageRoute.test.ts` pins its current
 * behaviour), so this predicate closes one door of two and is deferred work, not a finished job.
 *
 * Before this rule `heroImageUrl` had no format
 * check at all and `days[].imageUrl` fell back to `z.string().url()`, which is no defence either: it
 * asks only whether `new URL()` succeeds, so `javascript:alert(1)`, `data:image/svg+xml,<svg/>` and
 * `file:///etc/passwd` all parse, and nothing downstream catches them
 * (`isForeignTripUploadUrl` in `tripRepo.ts` answers `false` for anything that is not path-shaped,
 * by design). So the accept set is stated positively here rather than as a list of schemes to
 * refuse: an allowlist stays correct when a scheme nobody thought of shows up.
 *
 * **Two members, and the second is not an oversight.** A relative `/uploads/…` path is what every
 * upload route stores. An absolute `http(s)` URL is what a v1 backup can legitimately carry - it is
 * pinned by `tripBackupRoundTrip.test.ts`, which drives `https://cdn.example.com/hero.jpg` through
 * the real import route and asserts the string back verbatim - so refusing it would not be a
 * stricter version of this rule but a regression of a shipped guarantee. That an `http(s)` hero is
 * still a third-party request on every trip-list render is knowingly left standing; it is a CSP
 * question, not an import-boundary one. `isSafeExternalUrl` decides that half rather than a second
 * prefix test, so the `https:host/x` shorthand it exists to refuse cannot creep back in here.
 *
 * **Not a containment check, and must not be mistaken for one.** `/uploads/trips/../../../etc/passwd`
 * starts with `/uploads/` and passes. What decides whether a path-shaped URL points inside the trip
 * being written is `isForeignTripUploadUrl`, which runs later, in the repository, with the created
 * trip's id in hand - knowledge this predicate does not have and should not grow. This one answers
 * only "is this a stored-image address at all".
 */
export const isSafeStoredImageUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length > MAX_STORED_IMAGE_URL_LENGTH) return false;
  return trimmed.startsWith("/uploads/") || isSafeExternalUrl(trimmed);
};
