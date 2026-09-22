import { applyLocale, initI18n } from "../i18n";
import en from "../i18n/en.json";
import he from "../i18n/he.json";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leafKeys(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

test("English and Hebrew have the same message keys", () => {
  expect(leafKeys(he).sort()).toEqual(leafKeys(en).sort());
});

test("applyLocale sets html lang and dir from the registry", () => {
  initI18n("en");
  applyLocale("he");
  expect(document.documentElement.getAttribute("lang")).toBe("he");
  expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  applyLocale("en");
  expect(document.documentElement.getAttribute("dir")).toBe("ltr");
});

test("unknown locale falls back to the default (en, ltr)", () => {
  initI18n("en");
  applyLocale("xx");
  expect(document.documentElement.getAttribute("lang")).toBe("en");
  expect(document.documentElement.getAttribute("dir")).toBe("ltr");
});
