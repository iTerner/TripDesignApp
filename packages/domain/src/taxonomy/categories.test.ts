import {
  CATEGORY_GROUPS,
  categoryGroup,
  DEFAULT_DWELL_BANDS,
  dwellBandFor,
  PLACE_CATEGORIES,
  PlaceCategorySchema,
  PlatformSchema,
  SELECTABLE_CATEGORIES,
} from "./categories";

test("the tree from parent spec §1.3 is flattened to group.leaf", () => {
  expect(PLACE_CATEGORIES).toContain("food.dessert");
  expect(PLACE_CATEGORIES).toContain("culture.museum");
  expect(PLACE_CATEGORIES).toContain("logistics.checkin");
  expect(PLACE_CATEGORIES).toHaveLength(48);
  expect(CATEGORY_GROUPS).toHaveLength(12);
});

test("schema accepts leaves and rejects invented categories", () => {
  expect(PlaceCategorySchema.parse("nature.viewpoint")).toBe("nature.viewpoint");
  expect(() => PlaceCategorySchema.parse("food.gelato")).toThrow();
  expect(() => PlaceCategorySchema.parse("food")).toThrow();
});

test("logistics.* is scheduler-inserted and not selectable", () => {
  expect(SELECTABLE_CATEGORIES.some((c) => c.startsWith("logistics."))).toBe(false);
  expect(SELECTABLE_CATEGORIES).toHaveLength(45);
});

test("categoryGroup returns the prefix", () => {
  expect(categoryGroup("history.castle")).toBe("history");
});

test("dwell bands: category override beats the group band (spec §8.8 examples)", () => {
  expect(dwellBandFor("food.dessert")).toEqual([10, 40]);
  expect(dwellBandFor("culture.museum")).toEqual([60, 240]);
  expect(dwellBandFor("food.restaurant")).toEqual(DEFAULT_DWELL_BANDS.food);
  expect(dwellBandFor("nature.hike", { nature: [30, 60] })).toEqual([30, 60]);
});

test("platforms are the five from spec §2.2", () => {
  expect(PlatformSchema.options).toEqual(["tiktok", "instagram", "reddit", "blog", "news"]);
});
