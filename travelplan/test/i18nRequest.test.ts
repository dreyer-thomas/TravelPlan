import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import de from "@/i18n/de";
import en from "@/i18n/en";
import { dictionaries } from "@/i18n";
import { getRequestI18n, getRequestLanguage } from "@/i18n/request";

/**
 * `src/i18n/request.ts` is the only reader of the `lang` cookie on the server-route side, and until now it
 * had no test of its own - it was exercised only through the packet route, which is the slowest and least
 * specific place to find out that cookie parsing broke. Every branch it has is here instead: absent,
 * supported, unsupported, empty, and the prototype-member case that `isLanguage` guards.
 *
 * The `NextRequest` is built exactly the way `tripDayDocumentPacketRoute.test.ts` builds one - a real
 * `NextRequest` with a `cookie` header - rather than a hand-made `{ cookies: { get } }` stub. The whole
 * reason this module exists instead of `getServerT` is that route handlers read cookies *off the request*
 * (see its docblock), so a stub of the one thing under test would prove nothing about that.
 */
const requestWith = (cookie?: string) =>
  new NextRequest("http://localhost/api/trips/t/days/d/documents/packet", {
    method: "GET",
    headers: cookie === undefined ? {} : { cookie },
  });

describe("getRequestLanguage", () => {
  it("falls back to English when the request carries no lang cookie", () => {
    // The pre-DW-230 shape of every request in the app, and the reason the English packet is byte-identical.
    expect(getRequestLanguage(requestWith())).toBe("en");
  });

  it("reads a supported language off the cookie", () => {
    expect(getRequestLanguage(requestWith("lang=de"))).toBe("de");
  });

  it("reads the lang cookie beside the others the app sets", () => {
    // The real header is never `lang` alone: the session cookie is always there too, and on the packet
    // route it is what got the request past `requireSession` in the first place.
    expect(getRequestLanguage(requestWith("session=abc; lang=de"))).toBe("de");
  });

  it("falls back to English for a language the app does not have", () => {
    // `fr` is a plausible cookie value - a user editing it, or a locale the app drops later - and it must
    // not reach a dictionary lookup that would miss on every key.
    expect(getRequestLanguage(requestWith("lang=fr"))).toBe("en");
  });

  it("falls back to English for an empty lang cookie", () => {
    // `resolveLanguage` treats `""` as absent, which matters because a cleared cookie is written as an
    // empty value rather than removed.
    expect(getRequestLanguage(requestWith("lang="))).toBe("en");
  });

  /**
   * The route-side reach of `isLanguage`'s `hasOwnProperty` guard. The cookie is not `httpOnly`, so this is
   * a value any user can set from the browser console; under the old `value in dictionaries` check it
   * resolved as a *language*, and `dictionaries["valueOf"]` is a function whose lookups return the raw
   * dictionary key - which would then be drawn onto every label page of the packet.
   */
  it.each(["valueOf", "constructor", "toString"])(
    "falls back to English for the prototype member %s in the cookie",
    (value) => {
      expect(getRequestLanguage(requestWith(`lang=${value}`))).toBe("en");
    },
  );
});

describe("getRequestI18n", () => {
  it("returns English and the English dictionary when no cookie is present", () => {
    const { language, t } = getRequestI18n(requestWith());
    expect(language).toBe("en");
    expect(t("trips.documents.packetLabelHeading")).toBe(en["trips.documents.packetLabelHeading"]);
  });

  it("returns German and the German dictionary for lang=de", () => {
    const { language, t } = getRequestI18n(requestWith("lang=de"));
    expect(language).toBe("de");
    expect(t("trips.documents.packetLabelHeading")).toBe(de["trips.documents.packetLabelHeading"]);
    // Asserted against a literal as well as against the dictionary: a `t` that quietly returned its key
    // would satisfy neither, and this is the string a German traveller reads at a gate.
    expect(t("trips.dayPrint.planItemFallback")).toBe("Programmpunkt {position}");
  });

  it("hands back a translator that misses to the key, as translate() does everywhere else", () => {
    const { t } = getRequestI18n(requestWith("lang=de"));
    expect(t("no.such.key")).toBe("no.such.key");
  });

  /**
   * The property the pair exists for. `language` goes to `buildDocumentPacket` and `t` builds the plan-item
   * fallback, so if the two could ever disagree the packet's label pages and the labels *on* them would be
   * in different languages - the DW-230 defect, one level down. Asserted over every language in the
   * registry rather than over `de` alone, so a third locale inherits it.
   *
   * Driven off `dictionaries` itself rather than a hardcoded `["en", "de"]`, because that claim has to be
   * true and not merely written: a table listing the two languages by hand says "so a third locale inherits
   * it" while being the one thing that guarantees it does not.
   */
  it.each(Object.keys(dictionaries))("agrees between its language and its translator for %s", (language) => {
    const resolved = getRequestI18n(requestWith(`lang=${language}`));
    const dictionary = dictionaries[language as keyof typeof dictionaries];
    expect(resolved.language).toBe(language);
    for (const key of [
      "trips.documents.packetLabelHeading",
      "trips.documents.packetLabelHeadingFailed",
      "trips.dayPrint.planItemFallback",
    ]) {
      expect(resolved.t(key), key).toBe(dictionary[key]);
    }
  });

  it("resolves an unsupported cookie to English in both halves at once", () => {
    // Not two assertions of the same thing: the failure this guards is one half falling back while the
    // other does not, which is only visible when both are read from the same call.
    const { language, t } = getRequestI18n(requestWith("lang=fr"));
    expect(language).toBe("en");
    expect(t("trips.documents.packetLabelHeading")).toBe(en["trips.documents.packetLabelHeading"]);
  });
});
