import { jaroWinkler } from "./jaro";

test("identical names score 1", () => {
  expect(jaroWinkler("sostanza", "sostanza")).toBe(1);
});

test("martha/marhta is the published Winkler example", () => {
  // Jaro 17/18, common prefix 3, prefix scale 0.1 → 0.96111…
  expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
});

test("dwayne/duane scores 0.84", () => {
  // Jaro 37/45, common prefix 1, prefix scale 0.1 → 0.84 exactly.
  expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 3);
});
