/**
 * What the user typed into a place field, read *before* anything reaches the geocoder.
 *
 * Story 6.28, and it exists because of two complaints reported from real use on 2026-08-06 about one
 * field. The second of them is this module's whole job: "I would rather type the coordinates myself —
 * Google Maps gives them to me. It does not accept them." There was no coordinate input anywhere. A
 * pasted `-36.8485, 174.7633` went to Nominatim's `/search` as a search string, `/search` does not
 * resolve a bare pair, and the user was told no place was found. (The first complaint — an activity
 * name pinning the best *name* match anywhere on earth — is fixed in `api/geocode/route.ts` and in the
 * candidate list, not here.)
 *
 * This is the **only** place any of these rules live. `handleLookupLocation` exists five times over
 * four components, byte-similar each time, and the story's own Dev Notes refuse to refactor those five
 * into one while four dialog stories are in flight. Consolidating the *parsing* instead is what keeps
 * the fifth call site from drifting: each of the five calls this and branches on `status`.
 *
 * **Why not `normalizeDecimalInput` next door.** Story 6.27 put a comma-aware parser in
 * `parseAmount.ts`, and it is the wrong one here on four counts: it strips whitespace standing where a
 * thousands separator would stand — which is this module's *pair* separator — it reads a lone `1,000`
 * as one, it has no notion of two numbers at all, and its gates reject a leading `-`, i.e. every
 * coordinate south of the equator. 6.27's own Dev Notes make this argument about the travel-segment
 * distance field; this is the second instance of it, not a new idea. The two modules stay neighbours
 * and share nothing.
 *
 * **The separator rule, resolved by precedence, refusing what stays ambiguous.** On a German keyboard
 * `48,8584` is the natural spelling, so a comma is both the decimal separator and the pair separator
 * and `48,8584,2,2945` cannot be resolved by counting commas. Rather than pick a reading — which would
 * reintroduce the silent-wrong-pin bug this story removes, through the front door — the order is:
 *
 * ```
 * (first)      → separator noise is removed: a trailing "," or ";" on the whole value, and whitespace
 *                standing immediately beside a "," or ";". See the amendments below.
 * ";"          → the pair separator.       `48,8584; 2,2945`                  → (48.8584, 2.2945)
 * whitespace   → the pair separator; a single trailing "," or ";" on the left half is punctuation.
 *                                          `48,8584 2,2945`                   → resolve
 * exactly one "," (no ";", no inner space) → the pair separator.
 *                                          `48.8584,2.2945`, and `48.8584, 2.2945` once the space
 *                                          beside the comma is gone                → resolve
 * otherwise    → two or more commas ⇒ `ambiguous` (refuse, and name the accepted spelling);
 *                fewer ⇒ not a pair at all ⇒ `search`, exactly as today.
 * ```
 *
 * `12,5` therefore resolves as the pair (12, 5): a lone German decimal is not a coordinate under any
 * reading, and one comma has to mean something. `trips.location.searchHelper` states the recommended
 * spellings on every one of the five fields so nobody arrives at the refusal by accident.
 *
 * **Two amendments from the 6.28 review, both about one keystroke's distance from the documented
 * spelling.** First, separator *noise* is removed before the rules above are consulted: a trailing `,`
 * or `;` on the whole value, and whitespace standing immediately beside a separator, carry no meaning
 * (`48.8584 , 2.2945`, `48.8584 ,2.2945` and `48.8584, 2.2945,` all used to reach Nominatim as search
 * strings and come back "no matching place found" — the very report this module answers). The rejected
 * alternative was to widen each rule to tolerate stray whitespace itself, which would have put the same
 * tolerance in three places and let them drift; normalising once keeps the precedence table readable.
 * Only the whitespace *before* a separator is removed, which is what keeps `48,8584 , 2,2945` and
 * `48,8584, 2,2945` resolving as German pairs: the space that survives on the far side still wins the
 * precedence table. `48,8584,2,2945`, with no space anywhere, is untouched and still refuses.
 *
 * Second, a **lone German decimal is not reported as an out-of-range longitude.** `50,1109` (Frankfurt's
 * latitude on a German keyboard) resolved as the pair (50, 1109) and the range check then told the user
 * "Longitude must be between -180 and 180" about a number 1109 they never typed. Where the whole value
 * can be read as one German decimal number, a failing range check means the *reading* was wrong rather
 * than the coordinate — so the answer is `ambiguous`, whose message names both accepted spellings.
 * `48, 2` still resolves (it is in range) and `91.0, 2.0` is still `out_of_range` (the dots settle the
 * spelling), which is what the matrix pins.
 *
 * **A discriminated union on `status:`, not `T | null`.** The other pure helpers in this directory
 * return `T | null`, but this one has four outcomes and three of them drive different user-visible
 * text — a caller that forgot an arm would silently do nothing. `status:` matches the repository
 * convention (`dayPlanItemRepo.ts`) and makes the omission a compile error at each of the five sites.
 *
 * No lat/lng swap detection, deliberately: two valid latitudes are indistinguishable, so the order is
 * *stated* in the helper text and shown back in the read-only coordinate line instead of guessed at.
 */

export type LocationInputParse =
  | { status: "coordinates"; lat: number; lng: number }
  | { status: "search" }
  | { status: "ambiguous" }
  | { status: "out_of_range"; field: "lat" | "lng" };

/**
 * The characters a coordinate pair can be spelled with, and nothing else. A single letter anywhere
 * means this is a place name — which is the common case and must stay free — so the gate is what keeps
 * `Sky Tower` and `Hafenrundfahrt` out of the separator rules below rather than each rule having to
 * survive them.
 */
const COORDINATE_CHARSET = /^[0-9+\-.,;\s]+$/;

/** One half of a pair: an optional sign, digits, and at most one decimal group behind `.` or `,`. */
const COORDINATE_HALF = /^[+-]?\d+(?:[.,]\d+)?$/;

/** Google Maps' address bar: `/maps/@48.8584,2.2945,17z/data=…`. The zoom segment is ignored. */
const AT_SEGMENT = /@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/;

/**
 * A `q=` / `query=` / `ll=` value that *begins and ends* with a pair — `q=Sky Tower` must fall through
 * to search.
 *
 * Two shapes Google Maps itself produces are allowed past the anchors, because a fully anchored pattern
 * sent both to a place search (6.28 review): the `loc:` prefix the desktop share menu writes, and the
 * ` (Label)` tail a right-click "directions to here" adds. Nothing else — the tail must be end-of-string
 * or a parenthesis, so `q=1,2 Main Street` stays a street address rather than becoming a pin off the
 * Gulf of Guinea. The rejected alternative was a loose "first pair anywhere in the value" search, which
 * would mine a house number out of every shared address.
 */
const PARAM_PAIR = /^\s*(?:loc:\s*)?([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*(?:$|\()/i;

const COORDINATE_PARAMS = ["q", "query", "ll"] as const;

/**
 * The whole value read as **one** German decimal number — `50,1109`, and the same with a stray space
 * beside the comma. The single reason the range check's verdict is ever overruled; see the block that
 * uses it at the bottom of `parseLocationInput`.
 */
const LONE_GERMAN_DECIMAL = /^[+-]?\d+\s*,\s*\d+$/;

/**
 * Both numbers against `locationSchemas.ts`'s own bounds, latitude first.
 *
 * Latitude first is a decision the callers depend on: with `91, 181` only one message can be shown, and
 * naming the latitude matches the reading order of the pair the user typed. AC4 is the reason the check
 * exists at all — a silently wrong pin must not be replaced by a differently wrong one, so an
 * out-of-range pair sets nothing and says so.
 */
const rangeChecked = (lat: number, lng: number): LocationInputParse => {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { status: "out_of_range", field: "lat" };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { status: "out_of_range", field: "lng" };
  return { status: "coordinates", lat, lng };
};

const toNumber = (half: string) => Number.parseFloat(half.replace(",", "."));

/**
 * Separator noise removed before the precedence table is consulted (6.28 review).
 *
 * A trailing `,` or `;` on the whole value is punctuation, and whitespace standing immediately *before* a
 * separator says nothing the separator does not already say. Both were fatal before: `48.8584, 2.2945,`
 * split into two halves the second of which ended in a comma, and `48.8584 , 2.2945` split into *three*
 * whitespace tokens — each answered `search` and each reached Nominatim, one keystroke away from the
 * spelling the helper text recommends.
 *
 * **Only the whitespace before the separator, deliberately.** Collapsing it on both sides was the first
 * attempt and it took `48,8584, 2,2945` — a German pair with the separator the writer is used to, and the
 * most likely spelling from the phone this story was reported on — from resolving to `ambiguous`, because
 * the surviving space was the only thing distinguishing it from `48,8584,2,2945`. Trimming only the
 * leading side keeps that space, so whitespace still wins the precedence table and the pair resolves,
 * while all three shapes the review found still parse. `48,8584,2,2945` with no space anywhere is
 * untouched and still refuses, which is what the I/O matrix pins.
 */
const normalizeSeparators = (value: string) =>
  value
    .replace(/[,;]$/, "")
    .replace(/\s+([,;])/g, "$1")
    .trim();

/**
 * The two halves of a pair, or `null` when the text is not a pair at all, or `"ambiguous"` for the comma
 * soup that has two readings and no way to choose between them.
 *
 * Inside a URL the separators are always dot and comma, so the URL branch never comes through here.
 */
const splitPair = (value: string): [string, string] | "ambiguous" | null => {
  const parts = (() => {
    if (value.includes(";")) return value.split(";");
    if (/\s/.test(value)) return value.split(/\s+/);
    const commas = value.split(",").length - 1;
    // Two commas or more is the German-keyboard case the story names, and the one place refusing beats
    // choosing: `48,8584,2,2945` reads as (48.8584, 2.2945) and as four numbers with equal right.
    if (commas >= 2) return "ambiguous" as const;
    if (commas === 1) return value.split(",");
    return null;
  })();

  if (parts === null || parts === "ambiguous") return parts;
  if (parts.length !== 2) return null;

  // A trailing separator on the left half is punctuation once the separator itself has been decided.
  // `normalizeSeparators` above already removes the common spellings of it; this stays for the ones it
  // cannot see, e.g. a `;`-separated value whose left half ends in a comma.
  return [parts[0].trim().replace(/[,;]$/, ""), parts[1].trim()];
};

/**
 * The pair carried by a pasted Google Maps link, or `null`.
 *
 * Both shapes people actually produce: the `@lat,lng,zoom` the address bar shows while panning, and a
 * `q=` / `query=` / `ll=` parameter carrying a pair. Anything else that happens to be a URL — a link to
 * a hotel page, a `maps.app.goo.gl` short link — carries no pair and is an ordinary **search term**,
 * never an error (Trap 3). No dependency for this: `URL` plus two regular expressions.
 */
const parseUrlPair = (value: string): [number, number] | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const atMatch = AT_SEGMENT.exec(url.pathname);
  if (atMatch) return [Number.parseFloat(atMatch[1]), Number.parseFloat(atMatch[2])];

  for (const name of COORDINATE_PARAMS) {
    const raw = url.searchParams.get(name);
    if (!raw) continue;
    const paramMatch = PARAM_PAIR.exec(raw);
    if (paramMatch) return [Number.parseFloat(paramMatch[1]), Number.parseFloat(paramMatch[2])];
  }

  return null;
};

/**
 * Total by construction: every input has one of the four answers, and `search` is the answer for
 * everything that is not recognisably a coordinate — including the empty string. The callers still gate
 * emptiness with `trips.location.searchRequired` before they get here, because "type something" is a
 * better message than "no matching place found".
 */
export const parseLocationInput = (raw: string): LocationInputParse => {
  const value = raw.trim();

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const pair = parseUrlPair(value);
    return pair ? rangeChecked(pair[0], pair[1]) : { status: "search" };
  }

  if (!COORDINATE_CHARSET.test(value)) return { status: "search" };

  // Every rule below reads the *normalised* value, including the "no dot anywhere" test at the end: the
  // question that test asks is how this writer spells decimals, and stray whitespace does not answer it.
  const normalized = normalizeSeparators(value);

  const split = splitPair(normalized);
  if (split === "ambiguous") return { status: "ambiguous" };
  if (split === null) return { status: "search" };

  const [left, right] = split;
  // A half that is not a number is not a refusal: `1,2,3 4,5` is nothing anybody meant as a pair, and
  // the geocoder's "no matching place" is the honest answer for it. Only the comma soup above is
  // *plausibly* a coordinate with two readings, which is what `ambiguous` is reserved for.
  if (!COORDINATE_HALF.test(left) || !COORDINATE_HALF.test(right)) return { status: "search" };

  const checked = rangeChecked(toNumber(left), toNumber(right));
  /*
    The lone German decimal, and the one place the range check is evidence about the *reading* rather
    than about the numbers. `50,1109` is Frankfurt's latitude typed on a German keyboard: read as a pair
    it is (50, 1109), and reporting "Longitude must be between -180 and 180" names a value the user never
    typed and cannot correct, because the mistake was the reading. So when the whole value is *also*
    readable as one German decimal, an out-of-range half means the pair reading was wrong, and
    `ambiguous` — which names both accepted spellings — is the message that helps. `50, 1109`, `50 , 1109`
    and `91,181` all take this branch; a stray space must not decide which message the same input gets.

    **The test is that reading, not "a comma is present" (6.28 follow-up review).** The looser condition
    answered `ambiguous` to every out-of-range pair written in German decimals with an *explicit*
    separator — `48,8584; 200,0` and `91,5 2,5` — telling a user who had spelled the pair exactly the way
    `searchHelper` prescribes that their coordinates were unclear and they should write them the way they
    just had. With `;` or a space between two comma-decimal halves there is no second reading to prefer,
    so the range error is the true and correctable answer. With dots present (`91.0, 2.0`) the spelling
    was already settled and the range error stood; with no comma at all (`91 181`) likewise — both are
    what the I/O matrix pins, and both still hold.
  */
  if (checked.status === "out_of_range" && LONE_GERMAN_DECIMAL.test(normalized)) {
    return { status: "ambiguous" };
  }

  return checked;
};

/**
 * The label a manually entered pair is stored under — `"48.858400, 2.294500"`.
 *
 * A pair has no `display_name` to keep, and `location.label` is optional and nullable in
 * `locationSchemas.ts`, so an empty one would be legal. It is filled anyway because a nameless pin
 * reads as a bug on the trip overview, in the map popups and in the print path, all of which show the
 * label and have nothing else to show. Six decimals, the same precision the read-only coordinate line
 * has always displayed, so the stored label and the line agree character for character.
 */
export const formatCoordinateLabel = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
