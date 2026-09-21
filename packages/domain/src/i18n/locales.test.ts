import { DEFAULT_LOCALE, enabledLocales, getLocale, LOCALES } from "./locales";

test("en and he are enabled; he is rtl", () => {
  const codes = enabledLocales().map((l) => l.code);
  expect(codes).toEqual(expect.arrayContaining(["en", "he"]));
  expect(getLocale("he").dir).toBe("rtl");
  expect(getLocale("en").dir).toBe("ltr");
});

test("unknown code falls back to the default locale", () => {
  expect(getLocale("xx")).toEqual(DEFAULT_LOCALE);
  expect(getLocale(null)).toEqual(DEFAULT_LOCALE);
});

test("codes are unique", () => {
  const codes = LOCALES.map((l) => l.code);
  expect(new Set(codes).size).toBe(codes.length);
});
