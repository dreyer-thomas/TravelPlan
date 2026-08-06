/**
 * Reduces a trip name to the `[a-z0-9-]` slug the two download routes put in `content-disposition`.
 *
 * Moved verbatim out of `api/trips/[id]/export/route.ts`, where it was module-private, because Story
 * 9.2's document-packet route needs the same rule and a second copy is how the two filenames eventually
 * stop agreeing. Behaviour is unchanged, which is what lets `tripExportRoute` and `tripBackupRoundTrip`
 * pass without an edit.
 *
 * The aggressive reduction is deliberate and is depended on: it is what keeps the header a plain
 * `filename="…"` with no RFC 5987 `filename*=UTF-8''…` encoding, so a non-ASCII trip name cannot produce
 * a header the client has to decode. `extractAttachmentFilename` in `src/lib/browser/blobDownload.ts`
 * records this from the other side.
 *
 * `"trip"` when nothing survives - a name of nothing but punctuation, or an empty one - because a
 * download called `-2026-08-06.zip` is worse than a generic one, and an empty `filename=""` is worse
 * than both.
 */
export const toSafeSlug = (name: string) => {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || "trip";
};
