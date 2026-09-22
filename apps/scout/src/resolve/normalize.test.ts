import { normalizeName } from "./normalize";

test("drops generic venue words and keeps the distinctive token", () => {
  expect(normalizeName("Ristorante Trattoria Sostanza!")).toBe("sostanza");
  expect(normalizeName("Sostanza Ristorante")).toBe("sostanza");
  expect(normalizeName("Santo Bar Spirito")).toBe("santo bar spirito");
});

test("generic prefixes are whole tokens, not character prefixes", () => {
  // Stripping the token "il" leaves the following token. "gelateria" is kept
  // when it is the remaining name. A character-prefix strip of "i" or "la"
  // would corrupt "Ilaria" and "Lanterna".
  expect(normalizeName("il gelateria")).toBe("gelateria");
  expect(normalizeName("Ilaria")).toBe("ilaria");
  expect(normalizeName("La Lanterna")).toBe("lanterna");
});

test("strips diacritics before matching caffè and collapses punctuation", () => {
  expect(normalizeName("Caffè Gilli")).toBe("gilli");
  expect(normalizeName("  Palazzo   Pitti! ")).toBe("pitti");
});
