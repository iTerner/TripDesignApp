export type TextDirection = "ltr" | "rtl";

export interface Locale {
  /** BCP-47 language code used in storage and i18next. */
  readonly code: string;
  /** Name in its own language, shown in the language dropdown. */
  readonly native: string;
  readonly dir: TextDirection;
  /** Whether users can pick it today. Disabled rows render as "soon". */
  readonly enabled: boolean;
  /** Locale passed to Intl.DateTimeFormat / NumberFormat. */
  readonly intl: string;
}

/**
 * Single source of truth for languages (spec §2.5).
 * Adding a language = one row here + one strings file in apps/web/src/i18n.
 */
export const LOCALES: readonly Locale[] = [
  { code: "en", native: "English", dir: "ltr", enabled: true, intl: "en-GB" },
  { code: "he", native: "עברית", dir: "rtl", enabled: true, intl: "he-IL" },
];

export const DEFAULT_LOCALE: Locale = LOCALES[0] as Locale;

export function getLocale(code: string | null | undefined): Locale {
  return LOCALES.find((l) => l.code === code) ?? DEFAULT_LOCALE;
}

export function enabledLocales(): Locale[] {
  return LOCALES.filter((l) => l.enabled);
}
