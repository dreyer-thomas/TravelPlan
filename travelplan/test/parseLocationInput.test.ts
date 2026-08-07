import { describe, expect, it } from "vitest";
import { formatCoordinateLabel, parseLocationInput } from "@/lib/trips/parseLocationInput";
import { normalizeDecimalInput } from "@/lib/trips/parseAmount";

/**
 * Story 6.28. A pure function, so the table is the cheap place to make the rules explicit — and the
 * rules are the story: AC3 asks the parser to resolve the unambiguous spellings and **refuse** the
 * ambiguous ones, and every refusal below is a case where guessing would have reintroduced the
 * silent-wrong-pin bug the story exists to remove.
 *
 * Node environment: no DOM is involved, and `URL` is global in both.
 */
describe("parseLocationInput", () => {
  // AC1. The two spellings the report itself names, plus the signed pair the money parser rejects.
  it("reads a spaced dot-decimal pair", () => {
    expect(parseLocationInput("48.8584, 2.2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  it("reads a tight dot-decimal pair, where the one comma is the pair separator", () => {
    expect(parseLocationInput("48.8584,2.2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // Trap: `parseAmount`'s gates reject a leading `-`, which is every coordinate south of the equator —
  // and the reported paste was Auckland's.
  it("keeps both signs, including the leading minus the money parser would reject", () => {
    expect(parseLocationInput("-36.8485, +174.7633")).toEqual({
      status: "coordinates",
      lat: -36.8485,
      lng: 174.7633,
    });
  });

  // AC3. A semicolon is unambiguous whatever the decimal separator is, so it wins outright.
  it("takes a semicolon as the pair separator under German decimals", () => {
    expect(parseLocationInput("48,8584; 2,2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // AC3. Whitespace is the second unambiguous separator; this is the spelling a German keyboard gives
  // with no extra punctuation at all.
  it("takes whitespace as the pair separator under German decimals", () => {
    expect(parseLocationInput("48,8584 2,2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // The trailing comma on the left half is punctuation once the separator has been decided — `48.8584,
  // 2.2945` is exactly what a dot-decimal keyboard produces when the user also types the separator they
  // are used to, and it must not be a refusal for nothing.
  it("treats a trailing comma or semicolon on the left half as punctuation", () => {
    expect(parseLocationInput("48.8584, 2.2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
    expect(parseLocationInput("48.8584 ; 2.2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  /**
   * Story 6.28 review, P5. Whitespace standing next to a separator, and a trailing separator on the whole
   * value, are typing noise — and each of these three was one keystroke from the spelling `searchHelper`
   * recommends, yet each answered `search`, reached Nominatim and came back "No matching place found":
   * the exact symptom this story exists to remove.
   */
  it.each(["48.8584 , 2.2945", "48.8584 ,2.2945", "48.8584, 2.2945,", "48.8584 , 2.2945 ,"])(
    "reads %o, which is only the documented spelling with stray separator whitespace",
    (raw) => {
      expect(parseLocationInput(raw)).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
    },
  );

  /**
   * The German half of the same normalisation, and the reason it trims only the leading side. Both of
   * these are a German pair with the separator its writer is used to, and both keep the space *after* the
   * comma — which is what leaves whitespace winning the precedence table, so they resolve rather than
   * reading as three commas. Collapsing whitespace on both sides refused them, and refusing the most
   * likely spelling from the phone this story was reported on is not a defensible reading of AC3.
   */
  it.each(["48,8584 , 2,2945", "48,8584, 2,2945"])("reads %o as a German pair around its space", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // And the one that stays refused: with no space anywhere, nothing distinguishes the pair reading from
  // four numbers, which is the case the I/O matrix pins as `ambiguous`.
  it("still refuses German decimals with no separator whitespace at all", () => {
    expect(parseLocationInput("48,8584,2,2945")).toEqual({ status: "ambiguous" });
  });

  // And the spelling the normalisation must leave alone: nothing here stands next to a separator, so the
  // whitespace is still the pair separator and the German pair still resolves.
  it("leaves a whitespace-separated German pair untouched", () => {
    expect(parseLocationInput("48,8584 2,2945")).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  it("reads an integer pair", () => {
    expect(parseLocationInput("48, 2")).toEqual({ status: "coordinates", lat: 48, lng: 2 });
  });

  /**
   * AC3's refusal, and the case the story names. `48,8584,2,2945` reads as (48.8584, 2.2945) and as
   * four numbers with exactly equal right, and `48,8584,2.2945` is no better. A parser that picked one
   * would be back to pinning something the user did not ask for, which is the whole defect.
   */
  it.each(["48,8584,2,2945", "48,8584,2.2945"])("refuses the comma soup %s rather than choosing a reading", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "ambiguous" });
  });

  // AC2. The address bar's shape. The zoom segment after the pair must not be mistaken for a third
  // number, and the `data=` tail after it must not either.
  it("extracts the pair from a Google Maps address-bar URL", () => {
    expect(parseLocationInput("https://www.google.com/maps/@48.8584,2.2945,17z/data=!3m1!4b1")).toEqual({
      status: "coordinates",
      lat: 48.8584,
      lng: 2.2945,
    });
  });

  // AC2. The three query parameters that carry a pair in the links people actually share.
  it.each([
    ["https://www.google.com/maps?q=48.8584,2.2945", "q"],
    ["https://www.google.com/maps?query=48.8584,2.2945", "query"],
    ["https://maps.google.com/?ll=48.8584,2.2945&z=17", "ll"],
  ])("extracts the pair from %s", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // Trap 3. Someone will paste a link to a hotel page, and that is a search term, not a failure.
  it.each([
    "https://hotel.example/rooms",
    "https://www.google.com/maps/search/Sky+Tower",
    "https://maps.app.goo.gl/abc123",
  ])("treats %s, which carries no pair, as an ordinary search term", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "search" });
  });

  /**
   * Story 6.28 review, P6. Two shapes Google Maps produces itself, both of which fell through to a place
   * search while `PARAM_PAIR` was anchored at both ends: the `loc:` prefix the desktop share menu writes,
   * and the ` (Label)` tail a right-click adds. Each carries the pair in plain sight.
   */
  it.each([
    "https://www.google.com/maps?q=loc:48.8584,2.2945",
    "https://www.google.com/maps?q=48.8584,2.2945 (Eiffel Tower)",
  ])("extracts the pair from the Maps-produced shape %s", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "coordinates", lat: 48.8584, lng: 2.2945 });
  });

  // A URL parameter holding a *name* is a search term too — `q=` is Google's search box as often as it
  // is a coordinate carrier, so matching it loosely would turn every shared place link into a pin at
  // whatever number happened to appear in it.
  it("does not mine a q= parameter that is a place name", () => {
    expect(parseLocationInput("https://www.google.com/maps?q=Sky%20Tower")).toEqual({ status: "search" });
  });

  // The boundary the loosened tail must not cross: a street address opens with two numbers and a comma,
  // and reading them as a pair would pin a house number somewhere off the Gulf of Guinea.
  it("does not read a street-style q= value as a pair", () => {
    expect(parseLocationInput("https://www.google.com/maps?q=1,2%20Main%20Street")).toEqual({ status: "search" });
  });

  /**
   * AC4. A pin that is silently wrong must not be replaced by a differently wrong one, so an
   * out-of-range pair sets nothing and says which half is out. Latitude is checked first: with `91, 181`
   * only one message can be shown, and the pair is read latitude-first.
   */
  it("faults an out-of-range latitude", () => {
    expect(parseLocationInput("91.0, 2.0")).toEqual({ status: "out_of_range", field: "lat" });
  });

  it("faults an out-of-range longitude", () => {
    expect(parseLocationInput("48.0, 181.0")).toEqual({ status: "out_of_range", field: "lng" });
  });

  it("names the latitude first when both halves are out of range", () => {
    // Dotted deliberately: without a `.` anywhere the rule below applies instead, and the point being
    // made here is the ordering of the two range messages.
    expect(parseLocationInput("91.0, 181.0")).toEqual({ status: "out_of_range", field: "lat" });
  });

  /**
   * Story 6.28 review, P4. `50,1109` is Frankfurt's latitude typed on a German keyboard, and it used to be
   * answered with "Longitude must be between -180 and 180" — a range complaint about the number 1109,
   * which the user never typed and cannot correct, because the mistake was the *reading* and not the
   * value. Where the whole value is *also* readable as one German decimal number, a failing range check
   * means the pair reading was wrong: the answer is the refusal, whose message names both spellings that
   * work.
   */
  it.each(["50,1109", "50 , 1109", "91,181", "2026, 8"])(
    "refuses %o as a lone German decimal rather than reporting a range it never typed",
    (raw) => {
      expect(parseLocationInput(raw)).toEqual({ status: "ambiguous" });
    },
  );

  /**
   * 6.28 follow-up review. The rule above once tested only "a comma is present and no dot is", which swept
   * up every out-of-range pair written in German decimals with an **explicit** separator — and those have
   * no second reading, so "Coordinates unclear. Write 48.8584, 2.2945 or 48,8584; 2,2945." told a user who
   * had spelled the pair exactly the way `searchHelper` prescribes to write it the way they just had.
   * `48,8584; 200,0` is spelled correctly and has one wrong number in it; the message has to say which.
   */
  it.each([
    ["48,8584; 200,0", "lng"],
    ["48,8584 200,0", "lng"],
    ["91,5; 2,5", "lat"],
    ["91,5 2,5", "lat"],
    ["48,8584; 200", "lng"],
  ])("reports the range of %o, whose separator leaves no second reading", (raw, field) => {
    expect(parseLocationInput(raw)).toEqual({ status: "out_of_range", field });
  });

  // The two halves of that rule, both of which the I/O matrix pins. `48, 2` has no dot either but is in
  // range, so it is still a pair; `91.0, 2.0` has dots, so the spelling is settled and the range error
  // stands.
  it("keeps the in-range integer pair and the dotted out-of-range pair exactly as the matrix pins them", () => {
    expect(parseLocationInput("48, 2")).toEqual({ status: "coordinates", lat: 48, lng: 2 });
    expect(parseLocationInput("91.0, 2.0")).toEqual({ status: "out_of_range", field: "lat" });
  });

  // The other boundary of the same rule: with no comma anywhere there is no German-decimal reading to
  // prefer, so an out-of-range pair keeps the range message that names which half is wrong.
  it("keeps the range message when whitespace alone separated the pair", () => {
    expect(parseLocationInput("91 181")).toEqual({ status: "out_of_range", field: "lat" });
    expect(parseLocationInput("48 181")).toEqual({ status: "out_of_range", field: "lng" });
  });

  it("range-checks a pair that came out of a URL on the same terms", () => {
    expect(parseLocationInput("https://www.google.com/maps/@91.5,2.2945,17z")).toEqual({
      status: "out_of_range",
      field: "lat",
    });
  });

  // The common case, which must stay entirely free: a place name goes to the geocoder as it always has.
  it.each(["Sky Tower", "Hafenrundfahrt", "Frankfurt Airport"])("treats the place name %s as a search term", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "search" });
  });

  // A lone number is not a pair, so it stays a search term — which is what it was before this story.
  it("treats a lone number as a search term", () => {
    expect(parseLocationInput("48.8584")).toEqual({ status: "search" });
  });

  /**
   * Total by construction: the callers gate emptiness with `trips.location.searchRequired` before they
   * reach this, but a parser that threw on `""` would make that ordering load-bearing rather than merely
   * better-worded.
   */
  it.each(["", "   "])("answers search rather than throwing for %o", (raw) => {
    expect(parseLocationInput(raw)).toEqual({ status: "search" });
  });

  // Halves that are not numbers are not a *refusal*: nobody meant `1,2,3 4,5` as a pair, and the
  // geocoder's "no matching place" is the honest answer. `ambiguous` is reserved for input that is
  // plausibly a coordinate under two readings.
  it("treats numeric noise that is not a pair as a search term", () => {
    expect(parseLocationInput("1,2,3 4,5")).toEqual({ status: "search" });
    expect(parseLocationInput("48..8584 2.2945")).toEqual({ status: "search" });
  });

  /**
   * The Design Notes' one deliberately surprising case, pinned so it cannot drift silently: with exactly
   * one comma and nothing else to go on, the comma is the pair separator, so `12,5` is (12, 5) and not
   * twelve-and-a-half. A lone German decimal is not a coordinate under any reading, and `searchHelper`
   * states the recommended spellings on every field so nobody arrives here by accident.
   */
  it("reads a single comma as the pair separator, not as a lone German decimal", () => {
    expect(parseLocationInput("12,5")).toEqual({ status: "coordinates", lat: 12, lng: 5 });
  });

  /**
   * Story 6.27's `normalizeDecimalInput` is **not** in this call path, and this is the assertion that
   * says so rather than a comment claiming it. Two of its behaviours would be wrong here and both are
   * checked against the parser's own answer for the same input: it reads a lone `1,000` as one (so it
   * would turn the pair (1, 0) into a single number), and it strips whitespace standing where a
   * thousands separator would stand — which is precisely this module's *pair* separator.
   */
  it("does not route through the money parser's decimal normalisation", () => {
    expect(normalizeDecimalInput("1,000")).toBe("1.000");
    expect(parseLocationInput("1,000")).toEqual({ status: "coordinates", lat: 1, lng: 0 });

    // `48 123` is welded into the single number 48123 by the money path — its whitespace strip fires on
    // a digit followed by exactly three. Here that space is the *pair* separator and the answer is two
    // numbers, which is the clearest single reason the two modules cannot share a normalisation step.
    expect(normalizeDecimalInput("48 123")).toBe("48123");
    expect(parseLocationInput("48 123")).toEqual({ status: "coordinates", lat: 48, lng: 123 });

    // And the leading minus every southern-hemisphere coordinate carries survives here while the money
    // gate rejects it outright.
    expect(parseLocationInput("-36.8485 174.7633")).toEqual({
      status: "coordinates",
      lat: -36.8485,
      lng: 174.7633,
    });
  });
});

describe("formatCoordinateLabel", () => {
  /**
   * Six decimals, which is not a free choice: the read-only `Latitude: … · Longitude: …` line has shown
   * `toFixed(6)` on all four surfaces since the location field existed, and a stored label that
   * disagreed with the line above it would read as two different pins.
   */
  it("renders both numbers to six decimals, in the order they are read", () => {
    expect(formatCoordinateLabel(48.8584, 2.2945)).toBe("48.858400, 2.294500");
  });

  it("keeps a negative sign, which is where half the world's latitudes live", () => {
    expect(formatCoordinateLabel(-36.8485, 174.7633)).toBe("-36.848500, 174.763300");
  });

  // A pair has no `display_name`, and `location.label` is optional — but a nameless pin reads as a bug
  // on the trip overview, so an integer pair still gets a full label rather than "48, 2".
  it("pads an integer pair rather than leaving it bare", () => {
    expect(formatCoordinateLabel(48, 2)).toBe("48.000000, 2.000000");
  });
});
