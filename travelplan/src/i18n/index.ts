import en from "@/i18n/en";
import de from "@/i18n/de";

export type Dictionary = Record<string, string>;

export const dictionaries = { en, de } as const;
export type Language = keyof typeof dictionaries;

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_COOKIE_NAME = "lang";

export const isLanguage = (value: string): value is Language => value in dictionaries;

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
