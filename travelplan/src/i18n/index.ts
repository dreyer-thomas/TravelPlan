import en from "@/i18n/en";
import de from "@/i18n/de";

export type Dictionary = Record<string, string>;

export const dictionaries = { en, de } as const;
export type Language = keyof typeof dictionaries;

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_COOKIE_NAME = "lang";

/**
 * The BCP-47 tag each of the app's `Language` codes means to `Intl`.
 *
 * The two alphabets are not the same one: `Language` is the two-letter code the `lang` cookie carries and
 * the dictionaries are keyed by, while `Intl.DateTimeFormat` wants a full locale tag.
 *
 * `en-US` because it is *exactly* what the day print sheet has always passed to `Intl.DateTimeFormat`
 * (Story 9.2). Keeping the tag is what keeps the English half of the printed output byte-identical, which
 * is the regression gate DW-230 had to clear; it is a preserved behaviour, not a preference about which
 * English to use. The region half is load-bearing against `en-GB`, which renders the sheet's date as
 * `10 August 2026` rather than `August 10, 2026` - but *not* against a bare `"en"`, which measures
 * identical to `en-US` for these options. An earlier version of this note claimed otherwise; it was wrong,
 * and the tag is pinned by Story 9.2's literal rather than by a difference `"en"` does not have.
 */
export const INTL_LOCALES: Record<Language, string> = {
  en: "en-US",
  de: "de-DE",
};

/**
 * Membership by *own* property, never by `in`.
 *
 * `in` walks the prototype chain, so `"valueOf" in dictionaries` is `true` and `resolveLanguage("valueOf")`
 * used to hand back `"valueOf"` as if it were a language. Nothing downstream re-checks it: the `lang`
 * cookie is not `httpOnly` (`provider.tsx` writes it from the browser), so anyone can set it, and
 * `dictionaries["valueOf"]` then resolves to `Object.prototype.valueOf` - a function. `translate` reads
 * `dictionary[key] ?? key` off it and returns the raw dictionary key, which is what would then be drawn onto
 * every packet label page; `INTL_LOCALES["valueOf"]` is a function too, and `Intl.DateTimeFormat` given one
 * silently falls back to the OS locale instead of throwing. Both failures are silent and both are reachable
 * from a cookie, which is why the check is `hasOwnProperty` and not the shorter operator.
 */
export const isLanguage = (value: string): value is Language =>
  Object.prototype.hasOwnProperty.call(dictionaries, value);

export const resolveLanguage = (value?: string | null): Language => {
  if (value && isLanguage(value)) {
    return value;
  }
  return DEFAULT_LANGUAGE;
};

export const translate = (dictionary: Dictionary, key: string) => dictionary[key] ?? key;

export const formatMessage = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
