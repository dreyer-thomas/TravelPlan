"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { dictionaries, resolveLanguage, translate, type Language, LANGUAGE_COOKIE_NAME } from "@/i18n";

type I18nContextValue = {
  language: Language;
  t: (key: string) => string;
  setLanguage: (language: Language) => void;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

type I18nProviderProps = {
  initialLanguage?: Language;
  children: ReactNode;
  onLanguageChange?: (language: Language) => void;
};

export const I18nProvider = ({ initialLanguage, children, onLanguageChange }: I18nProviderProps) => {
  const [language, setLanguage] = useState<Language>(resolveLanguage(initialLanguage));

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = dictionaries[language];
    return {
      language,
      setLanguage: (next) => {
        setLanguage(next);
        onLanguageChange?.(next);
        if (typeof document !== "undefined") {
          document.cookie = `${LANGUAGE_COOKIE_NAME}=${next}; path=/; max-age=31536000`;
        }
      },
      t: (key) => translate(dictionary, key),
    };
  }, [language, onLanguageChange]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
