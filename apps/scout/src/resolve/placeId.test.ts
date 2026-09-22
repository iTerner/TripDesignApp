import { placeIdFor } from "./placeId";

test("placeId is pl_ plus the first 16 hex chars of sha1(name|geohash7)", () => {
  // (42.6, -5.6) is the Wikipedia geohash example: precision 5 is "ezs42",
  // precision 7 is "ezs42e4". sha1("sostanza|ezs42e4") begins 1280d70e37d08c10.
  expect(placeIdFor("sostanza", 42.6, -5.6)).toBe("pl_1280d70e37d08c10");
});

test("a different name or a different cell is a different id", () => {
  const id = placeIdFor("sostanza", 42.6, -5.6);
  expect(placeIdFor("gilli", 42.6, -5.6)).not.toBe(id);
  expect(placeIdFor("sostanza", 43.77, 11.25)).not.toBe(id);
  expect(placeIdFor("sostanza", 42.6, -5.6)).toBe(id);
});
