import { describe, expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/(routes)/trips/[id]/days/[dayId]/print/page";

/**
 * `generateMetadata` for the day print sheet, which had no test at all (DW-230 review).
 *
 * It is not ordinary tab chrome: browsers stamp the document title into the **printed page header**, so
 * this string is ink on the same sheet as the itinerary. Until now the only thing standing behind it was
 * `i18nDictionaries.test.ts` asserting that `trips.dayPrint.metaTitle` exists in both dictionaries - which
 * is equally satisfied by a `generateMetadata` that never reads it, reads the wrong key, or drops the
 * `id / dayId` suffix that tells two printed sheets apart in a print history.
 *
 * **The `@/i18n/server` mock is the real translator, not an identity function.** The precedent for mocking
 * that module is `tripCostOverviewPage.test.tsx`, which stubs `getServerT` as `(key) => key` because what it
 * pins is *which key* a label comes from. That would be the wrong stub here: the assertion is the printed
 * string itself, and against an identity translator `"trips.dayPrint.metaTitle — trip-1 / day-1"` would pass
 * while proving nothing about either dictionary. So the stub resolves through the real dictionaries, and the
 * language under test is switched between cases - `next/headers` cannot be read from here, which is the only
 * reason the module is mocked at all.
 */
const state = vi.hoisted(() => ({ language: "en" as "en" | "de" }));

// `getServerT` only: `page.tsx` never calls `getServerLanguage`, and stubbing it would imply this suite
// covers a resolution path it does not touch.
vi.mock("@/i18n/server", async () => {
  const { dictionaries, translate } = await import("@/i18n");
  return {
    getServerT: async () => (key: string) => translate(dictionaries[state.language], key),
  };
});

const titleFor = async (language: "en" | "de") => {
  state.language = language;
  const metadata = await generateMetadata({ params: Promise.resolve({ id: "trip-1", dayId: "day-1" }) });
  return metadata.title;
};

describe("day print page metadata", () => {
  it("titles the printed page in English by default", async () => {
    // The literal `generateMetadata` returned before DW-230, character for character - the English half of
    // this change is a regression gate, and the em dash and the spacing around the ids are part of it.
    expect(await titleFor("en")).toBe("Day itinerary — trip-1 / day-1");
  });

  it("titles the printed page in German for a German request", async () => {
    expect(await titleFor("de")).toBe("Tagesplan — trip-1 / day-1");
  });

  it("keeps the ids out of the translation", async () => {
    // The suffix is not a label and must not move or be translated: it is what distinguishes two sheets in
    // a browser's print history, and both languages have to end in the same identifiers.
    const [english, german] = [await titleFor("en"), await titleFor("de")];
    for (const title of [english, german]) {
      expect(title).toContain("trip-1 / day-1");
    }
    expect(english).not.toBe(german);
  });
});
