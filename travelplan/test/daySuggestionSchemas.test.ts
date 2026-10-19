import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isWikimediaThumbnailUrl,
  isWikimediaUploadUrl,
  modelSuggestionsSchema,
  suggestionsRequestSchema,
  suggestionsResponseSchema,
  truncateOnWordBoundary,
} from "@/lib/validation/daySuggestionSchemas";
import { suggestionApplyRequestSchema } from "@/lib/validation/daySuggestionApplySchemas";

// Each call is a distinct stop by default: the response schema drops repeats of the same title and label.
let stopNumber = 0;
const suggestion = (overrides: Record<string, unknown> = {}) => ({
  title: `Neues Museum ${++stopNumber}`,
  description: "Egyptian collection with the bust of Nefertiti.",
  locationLabel: "Neues Museum, Bodestraße 1, Berlin",
  lat: 52.5206,
  lng: 13.3978,
  durationMinutes: 120,
  wikiTitle: "Neues Museum",
  ...overrides,
});

describe("suggestionsRequestSchema", () => {
  it("trims the prompt and accepts the three modes", () => {
    for (const mode of ["car", "walking", "cycling"]) {
      expect(suggestionsRequestSchema.parse({ prompt: "  museums  ", mode })).toEqual({ prompt: "museums", mode });
    }
  });

  it("rejects an empty or over-long prompt and an unknown mode", () => {
    expect(suggestionsRequestSchema.safeParse({ prompt: "   ", mode: "car" }).success).toBe(false);
    expect(suggestionsRequestSchema.safeParse({ prompt: "x".repeat(501), mode: "car" }).success).toBe(false);
    expect(suggestionsRequestSchema.safeParse({ prompt: "x".repeat(500), mode: "car" }).success).toBe(true);
    expect(suggestionsRequestSchema.safeParse({ prompt: "museums", mode: "train" }).success).toBe(false);
  });
});

describe("suggestionsResponseSchema", () => {
  it("accepts 3 to 8 suggestions", () => {
    expect(suggestionsResponseSchema.safeParse({ suggestions: Array.from({ length: 3 }, () => suggestion()) }).success).toBe(true);
    expect(suggestionsResponseSchema.safeParse({ suggestions: Array.from({ length: 8 }, () => suggestion()) }).success).toBe(true);
  });

  it("rejects 2 suggestions and keeps the first 8 of 9", () => {
    expect(suggestionsResponseSchema.safeParse({ suggestions: Array.from({ length: 2 }, () => suggestion()) }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => suggestion({ title: `Stop ${i + 1}` }));
    const result = suggestionsResponseSchema.parse({ suggestions: nine });
    expect(result.suggestions.map((s) => s.title)).toEqual(nine.slice(0, 8).map((s) => s.title));
  });

  it.each([
    ["an empty title", { title: "  " }],
    ["a title over 120 characters", { title: "x".repeat(121) }],
    ["an empty location label", { locationLabel: "" }],
    ["a location label over 200 characters", { locationLabel: "x".repeat(201) }],
    ["a latitude out of range", { lat: 91 }],
    ["a longitude out of range", { lng: -181 }],
    ["a duration under 10 minutes", { durationMinutes: 9 }],
    ["a duration over 600 minutes", { durationMinutes: 601 }],
    ["a fractional duration", { durationMinutes: 90.5 }],
    ["an empty description", { description: "   " }],
    ["a missing field", { lat: undefined }],
  ])("drops an entry with %s and keeps the valid rest", (_label, overrides) => {
    const valid = [suggestion({ title: "A" }), suggestion({ title: "B" }), suggestion({ title: "C" })];

    const kept = suggestionsResponseSchema.parse({ suggestions: [suggestion(overrides), ...valid] });
    expect(kept.suggestions.map((s) => s.title)).toEqual(["A", "B", "C"]);

    // With the bad entry dropped, fewer than three valid ones fail the whole answer.
    const tooFew = suggestionsResponseSchema.safeParse({ suggestions: [suggestion(overrides), ...valid.slice(0, 2)] });
    expect(tooFew.success).toBe(false);
  });

  it("drops bad entries before counting, so 9 with 2 bad keeps the 7 good ones", () => {
    const rows = Array.from({ length: 9 }, (_, i) => suggestion({ title: `Stop ${i + 1}` }));
    rows[2] = suggestion({ durationMinutes: 601 });
    rows[5] = suggestion({ title: "x".repeat(121) });

    const result = suggestionsResponseSchema.parse({ suggestions: rows });

    expect(result.suggestions).toHaveLength(7);
  });

  it("drops a repeated stop (same title and label, ignoring case and spacing) before counting", () => {
    const rows = [
      suggestion({ title: "A" }),
      suggestion({ title: "Tunnel Beach Track", locationLabel: "Tunnel Beach Road, Dunedin" }),
      suggestion({ title: "tunnel beach  track", locationLabel: "Tunnel Beach Road,  Dunedin", description: "Other words." }),
      suggestion({ title: "B" }),
    ];

    const result = suggestionsResponseSchema.parse({ suggestions: rows });
    expect(result.suggestions.map((s) => s.title)).toEqual(["A", "Tunnel Beach Track", "B"]);

    // Three rows, but only two distinct stops: not enough.
    expect(suggestionsResponseSchema.safeParse({ suggestions: rows.slice(0, 3) }).success).toBe(false);
  });

  it("treats a null wikiTitle like a missing one", () => {
    const result = suggestionsResponseSchema.parse({
      suggestions: [suggestion({ wikiTitle: null }), suggestion(), suggestion()],
    });
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).not.toHaveProperty("wikiTitle");
  });

  it("turns an empty wikiTitle into undefined and trims the rest", () => {
    const result = suggestionsResponseSchema.parse({
      suggestions: [suggestion({ wikiTitle: "  " }), suggestion({ wikiTitle: undefined }), suggestion({ title: " Museum " })],
    });
    expect(result.suggestions[0].wikiTitle).toBeUndefined();
    expect(result.suggestions[1].wikiTitle).toBeUndefined();
    expect(result.suggestions[2].title).toBe("Museum");
  });

  it("truncates a long description instead of rejecting it", () => {
    const result = suggestionsResponseSchema.parse({
      suggestions: [suggestion({ description: "word ".repeat(200) }), suggestion(), suggestion()],
    });
    expect(result.suggestions[0].description.length).toBeLessThanOrEqual(600);
    expect(result.suggestions[0].description.endsWith("word…")).toBe(true);
  });
});

describe("truncateOnWordBoundary", () => {
  it("leaves short text alone", () => {
    expect(truncateOnWordBoundary("short text", 600)).toBe("short text");
  });

  it("cuts on the last whole word and never exceeds the cap", () => {
    expect(truncateOnWordBoundary("alpha beta gamma", 12)).toBe("alpha beta…");
  });

  it("hard-cuts a single word with no boundary", () => {
    expect(truncateOnWordBoundary("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("modelSuggestionsSchema", () => {
  it("carries no numeric bounds into the output schema", () => {
    const json = JSON.stringify(z.toJSONSchema(modelSuggestionsSchema));
    expect(json).not.toContain("minimum");
    expect(json).not.toContain("maximum");
  });

  // Story 12.2, AC3: image URLs come only from Wikimedia, so the model has nowhere to put one.
  it("has no URL or image field for the model to fill", () => {
    const keys = Object.keys(modelSuggestionsSchema.shape.suggestions.element.shape);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("url");
      expect(key.toLowerCase()).not.toContain("image");
    }
  });
});

describe("isWikimediaUploadUrl", () => {
  it("accepts a real Wikimedia original, as the APIs return it", () => {
    expect(isWikimediaUploadUrl("https://upload.wikimedia.org/wikipedia/commons/a/a1/Neues_Museum.jpg")).toBe(true);
    expect(
      isWikimediaUploadUrl(
        "https://upload.wikimedia.org/wikipedia/commons/a/a1/Neues_Museum.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original",
      ),
    ).toBe(true);
  });

  it("rejects another scheme, a look-alike host, credentials, a port, another Wikimedia host and a non-URL", () => {
    for (const url of [
      "http://upload.wikimedia.org/wikipedia/commons/a/a1/X.jpg",
      "https://upload.wikimedia.org.evil.com/wikipedia/commons/a/a1/X.jpg",
      "https://user:pw@upload.wikimedia.org/wikipedia/commons/a/a1/X.jpg",
      "https://user@upload.wikimedia.org/wikipedia/commons/a/a1/X.jpg",
      "https://upload.wikimedia.org:8443/wikipedia/commons/a/a1/X.jpg",
      "https://commons.wikimedia.org/wiki/File:X.jpg",
      "not a url",
      "",
    ]) {
      expect(isWikimediaUploadUrl(url), url).toBe(false);
    }
  });
});

// Since 2026 the API hands thumbnails out on thumb.wikimedia.org; a narrow source's thumbnail is its original.
describe("isWikimediaThumbnailUrl", () => {
  it("accepts the thumb host and the upload host", () => {
    expect(
      isWikimediaThumbnailUrl(
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/X.JPG/250px-X.JPG?utm_source=en.wikipedia.org",
      ),
    ).toBe(true);
    expect(isWikimediaThumbnailUrl("https://upload.wikimedia.org/wikipedia/commons/d/dd/X.JPG")).toBe(true);
  });

  it("rejects the same things the upload check does", () => {
    for (const url of [
      "http://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/X.JPG/250px-X.JPG",
      "https://thumb.wikimedia.org.evil.com/X.JPG",
      "https://user:pw@thumb.wikimedia.org/X.JPG",
      "https://user@thumb.wikimedia.org/X.JPG",
      "https://thumb.wikimedia.org:8443/X.JPG",
      "https://commons.wikimedia.org/wiki/File:X.jpg",
      "not a url",
      "",
    ]) {
      expect(isWikimediaThumbnailUrl(url), url).toBe(false);
    }
  });

  it("keeps the upload check to the upload host", () => {
    expect(isWikimediaUploadUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/X.JPG/250px-X.JPG")).toBe(false);
  });
});

describe("suggestionApplyRequestSchema (Story 14.3)", () => {
  const applied = () => ({ ...suggestion(), verified: true, images: [] });
  const basis = { afterItemId: null, fingerprint: "f" };
  const leg = { durationMinutes: 10, distanceKm: 1.2 };

  it("accepts a 13.4 body without parked and defaults parked to []", () => {
    const parsed = suggestionApplyRequestSchema.parse({ mode: "walking", suggestions: [applied()], legs: [leg], basis });
    expect(parsed.parked).toEqual([]);
  });

  it("accepts a mixed body and an all-parked body without a basis", () => {
    expect(
      suggestionApplyRequestSchema.safeParse({ mode: "walking", suggestions: [applied()], legs: [leg], basis, parked: [applied()] }).success,
    ).toBe(true);
    expect(
      suggestionApplyRequestSchema.safeParse({ mode: "walking", suggestions: [], legs: [], basis: null, parked: [applied(), applied()] })
        .success,
    ).toBe(true);
  });

  it("refuses nothing at all, more than 8 together, a missing basis and a basis with nothing scheduled", () => {
    const cases = [
      { mode: "walking", suggestions: [], legs: [], basis: null, parked: [] },
      {
        mode: "walking",
        suggestions: Array.from({ length: 5 }, applied),
        legs: Array.from({ length: 5 }, () => leg),
        basis,
        parked: Array.from({ length: 4 }, applied),
      },
      { mode: "walking", suggestions: [applied()], legs: [leg], basis: null, parked: [] },
      { mode: "walking", suggestions: [], legs: [], basis, parked: [applied()] },
      { mode: "walking", suggestions: [], legs: [], parked: [applied()] },
    ];
    for (const body of cases) {
      expect(suggestionApplyRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});
