import { z } from "zod";

/**
 * Story 12.1. The AI day-suggestion contract, shared by the server and (from Story 12.3) the dialog that
 * shows the suggestions. It lives here, beside the other `*Schemas.ts`, and not in `lib/ai/`, because
 * everything under `lib/ai/` is `server-only` and a client component has to import these types.
 */

export const SUGGESTION_MODES = ["car", "walking", "cycling"] as const;
export type SuggestionMode = (typeof SUGGESTION_MODES)[number];

export const suggestionsRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Describe what the day could hold").max(500, "Keep the wish under 500 characters"),
  mode: z.enum(SUGGESTION_MODES),
});

export type SuggestionsRequestInput = z.infer<typeof suggestionsRequestSchema>;

/**
 * The shape the model is asked for (`output_config.format`). It carries **no** numeric or length
 * constraints, not even `.int()` (zod 4 turns it into safe-integer bounds, which the SDK moves into the
 * field's description): the API does not support them in an output schema. The bounds are ours to
 * enforce, in `suggestionsResponseSchema` below.
 *
 * There is no URL field, and that is a guarantee rather than an omission: Story 12.2 must never show an
 * AI-produced image URL, and the simplest way to make sure it cannot is for the model to have nowhere to
 * put one.
 */
export const modelSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      locationLabel: z.string(),
      lat: z.number(),
      lng: z.number(),
      durationMinutes: z.number(),
      wikiTitle: z.string().optional(),
    }),
  ),
});

export const DESCRIPTION_MAX_LENGTH = 600;

/**
 * A long description is cut, not rejected: "about 600 characters" is guidance to the model, and throwing
 * away an otherwise good answer over a long paragraph would be the wrong trade. The cut lands on the last
 * word boundary that fits, with an ellipsis, and the result never exceeds the cap.
 */
export const truncateOnWordBoundary = (text: string, max = DESCRIPTION_MAX_LENGTH) => {
  if (text.length <= max) {
    return text;
  }
  const room = text.slice(0, max - 1);
  const boundary = room.search(/\s\S*$/);
  const cut = (boundary > 0 ? room.slice(0, boundary) : room).trimEnd();
  return `${cut}…`;
};

/**
 * One suggestion's fields and their bounds. Exported for Story 12.4, whose apply request carries the ticked
 * suggestions back and re-validates them with exactly these bounds (`daySuggestionApplySchemas.ts`).
 */
export const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .min(1)
    .transform((value) => truncateOnWordBoundary(value)),
  // `locationSchemas.ts`'s bound, so Story 12.4 can store the label on an activity unchanged.
  locationLabel: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  durationMinutes: z.number().int().min(10).max(600),
  // `.optional()` outside the transform, so the output key is optional (`wikiTitle?: string`), not a
  // required key that may hold `undefined`.
  wikiTitle: z
    .string()
    .trim()
    .transform((value) => (value ? value : undefined))
    .optional(),
});

export const MIN_SUGGESTIONS = 3;
export const MAX_SUGGESTIONS = 8;

// A `null` wikiTitle means "none", like a missing one (likely if the request ever runs without a format).
const withoutNullWikiTitle = (row: unknown) => {
  if (row && typeof row === "object" && (row as { wikiTitle?: unknown }).wikiTitle === null) {
    const rest: Record<string, unknown> = { ...row };
    delete rest.wikiTitle;
    return rest;
  }
  return row;
};

/**
 * Our own gate on the model's answer: the bounds `modelSuggestionsSchema` cannot carry, and 3–8 entries.
 *
 * **Entry by entry** (Story 12.1 review, Tommy's ruling): an entry that breaks a bound is dropped, and
 * so is a repeat of an earlier one (same title and label, ignoring case and spacing); the rest are kept,
 * at most 8. Only when fewer than 3 valid entries remain does the whole answer fail. One
 * 601-minute duration should not throw away an answer the operator has already paid for.
 */
// The first manual call (2026-10-16) returned the same stop twice, word for word in title and label.
const duplicateKey = (suggestion: { title: string; locationLabel: string }) =>
  `${suggestion.title}\u0000${suggestion.locationLabel}`.toLocaleLowerCase().replace(/\s+/g, " ");

export const suggestionsResponseSchema = z.object({
  suggestions: z.array(z.unknown()).transform((rows, ctx) => {
    const seen = new Set<string>();
    const valid = rows
      .flatMap((row) => {
        const parsed = suggestionSchema.safeParse(withoutNullWikiTitle(row));
        return parsed.success ? [parsed.data] : [];
      })
      .filter((suggestion) => {
        const key = duplicateKey(suggestion);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SUGGESTIONS);
    if (valid.length < MIN_SUGGESTIONS) {
      ctx.addIssue({ code: "custom", message: `Fewer than ${MIN_SUGGESTIONS} valid suggestions` });
      return z.NEVER;
    }
    return valid;
  }),
});

export type ModelDaySuggestion = z.infer<typeof suggestionSchema>;

/**
 * What verification (`verifySuggestions.ts`) hands on: the model's suggestion, plus whether a geocoder
 * found the place within 2 km of where the model put it. When it did, `lat`/`lng` are the geocoder's.
 * A type of its own so the image step (Story 12.2) is the only one that can turn it into a `DaySuggestion`.
 */
export type VerifiedDaySuggestion = ModelDaySuggestion & { verified: boolean };

/**
 * Story 12.2. One picture of a suggested place, both URLs from a Wikimedia API answer and never from the
 * model. `thumbnailUrl` is 250 px wide (the original when the source is narrower) and passes
 * `isWikimediaThumbnailUrl`; `originalUrl` is the full file, passes `isWikimediaUploadUrl`, and is what
 * Story 12.4 downloads. No author, licence or file page is kept (D4).
 */
export type SuggestionImage = { thumbnailUrl: string; originalUrl: string };

/**
 * The API shape (`200 { data: { suggestions: DaySuggestion[] } }`), consumed by Stories 12.3 and 12.4.
 * `verified` is verification's (above). `images` holds up to three pictures of the place, always present
 * and possibly empty (Story 12.2). There is deliberately no `id`: the dialog can key on the index, and
 * Story 12.4 receives the ticked objects back in its own request body.
 */
export type DaySuggestion = VerifiedDaySuggestion & { images: SuggestionImage[] };

/** Scheme, exact host, no port, no credentials: the rules both Wikimedia URL guards below share. */
const isHttpsUrlOnHost = (value: string, hosts: readonly string[]) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      hosts.includes(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
};

/**
 * Story 12.2. True only for an `https://upload.wikimedia.org/…` URL with no port and no credentials.
 *
 * The image step drops any Wikimedia answer that fails it, and Story 12.4 runs it again on its request
 * body before downloading `originalUrl` on the server: that URL comes back from the client, so without
 * this check the download would fetch whatever a crafted request named (SSRF). Pure and not
 * `server-only`, because both the route input and (from 12.3) client code import this module.
 */
export const isWikimediaUploadUrl = (value: string): boolean => isHttpsUrlOnHost(value, ["upload.wikimedia.org"]);

/**
 * Story 12.2. The check for `thumbnailUrl`. The story was written for `upload.wikimedia.org` alone, but
 * both APIs now hand thumbnails out on `thumb.wikimedia.org` (checked against the live API, 2026-10-16),
 * so the upload check would have dropped every one. The upload host stays allowed because a source
 * narrower than 250 px comes back with its original as the thumbnail. Kept apart from
 * `isWikimediaUploadUrl` so the check on what Story 12.4 downloads does not widen with it.
 */
export const isWikimediaThumbnailUrl = (value: string): boolean =>
  isHttpsUrlOnHost(value, ["thumb.wikimedia.org", "upload.wikimedia.org"]);
