import { applyLocale, initI18n } from "../i18n";

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
