import { DEFAULT_LOCALE, getLocale, LOCALES } from "@wayfare/domain";
import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import he from "./he.json";

const resources = { en: { translation: en }, he: { translation: he } } as const;
const STORAGE_KEY = "wayfare.locale";

export function initI18n(initialCode?: string): i18n {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const code = getLocale(initialCode ?? stored ?? navigator.language.slice(0, 2)).code;
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: code,
      fallbackLng: DEFAULT_LOCALE.code,
      supportedLngs: LOCALES.map((l) => l.code),
      interpolation: { escapeValue: false },
      initImmediate: false,
    });
  }
  applyLocale(code);
  return i18next;
}

/** Direction comes from the registry row, never from the code (spec §2.5). */
export function applyLocale(code: string): void {
  const locale = getLocale(code);
  if (i18next.isInitialized && i18next.language !== locale.code)
    void i18next.changeLanguage(locale.code);
  document.documentElement.setAttribute("lang", locale.code);
  document.documentElement.setAttribute("dir", locale.dir);
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, locale.code);
}
