import { z } from "zod";

/** Parent spec §1.3 — the fixed activity tree. Order is stable; never reorder (ids are stored). */
export const CATEGORY_GROUPS = [
  "food",
  "culture",
  "history",
  "nature",
  "leisure",
  "shopping",
  "nightlife",
  "family",
  "adventure",
  "event",
  "experience",
  "logistics",
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];
export const CategoryGroupSchema = z.enum(CATEGORY_GROUPS);

export const CATEGORY_TREE: Record<CategoryGroup, readonly string[]> = {
  food: ["restaurant", "street", "dessert", "cafe", "market", "wine", "class"],
  culture: ["museum", "gallery", "show", "religious", "architecture"],
  history: ["landmark", "ruin", "castle", "old_town"],
  nature: ["park", "hike", "viewpoint", "beach", "lake", "garden"],
  leisure: ["spa", "pool", "relax"],
  shopping: ["district", "market", "outlet", "boutique"],
  nightlife: ["bar", "club", "live_music"],
  family: ["zoo", "theme_park", "playground", "interactive"],
  adventure: ["sport", "tour", "day_trip"],
  event: ["festival", "concert", "match"],
  experience: ["photo_spot", "local_life", "guided_tour"],
  logistics: ["transfer", "rest", "checkin"],
};

function flatten(): [string, ...string[]] {
  const out: string[] = [];
  for (const group of CATEGORY_GROUPS) {
    for (const leaf of CATEGORY_TREE[group]) out.push(`${group}.${leaf}`);
  }
  return out as [string, ...string[]];
}

export const PLACE_CATEGORIES: readonly string[] = flatten();
export const PlaceCategorySchema = z.enum(flatten());
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

/** Everything a model may pick. logistics.* is inserted by the scheduler only. */
export const SELECTABLE_CATEGORIES: readonly PlaceCategory[] = PlaceCategorySchema.options.filter(
  (c) => !c.startsWith("logistics."),
);

export function categoryGroup(cat: PlaceCategory): CategoryGroup {
  return cat.slice(0, cat.indexOf(".")) as CategoryGroup;
}

/** Dwell-minute sanity bands (spec §8.8). Key = group or full category; category wins. */
export type DwellBands = Record<string, readonly [number, number]>;

export const DEFAULT_DWELL_BANDS: DwellBands = {
  food: [30, 180],
  "food.dessert": [10, 40],
  "food.street": [10, 45],
  "food.cafe": [15, 90],
  "food.market": [20, 120],
  "food.class": [90, 300],
  culture: [30, 240],
  "culture.museum": [60, 240],
  "culture.show": [60, 240],
  history: [20, 180],
  "history.old_town": [60, 300],
  nature: [20, 480],
  "nature.viewpoint": [10, 60],
  leisure: [45, 360],
  shopping: [20, 240],
  nightlife: [45, 300],
  family: [45, 480],
  adventure: [60, 600],
  event: [60, 360],
  experience: [15, 300],
  "experience.photo_spot": [10, 45],
  logistics: [5, 120],
};

export function dwellBandFor(
  cat: PlaceCategory,
  bands: DwellBands = DEFAULT_DWELL_BANDS,
): readonly [number, number] {
  return (
    bands[cat] ?? bands[categoryGroup(cat)] ?? DEFAULT_DWELL_BANDS[categoryGroup(cat)] ?? [5, 600]
  );
}

/** Where a trend mention was seen (spec §2.2). Names are nominative use only. */
export const PlatformSchema = z.enum(["tiktok", "instagram", "reddit", "blog", "news"]);
export type Platform = z.infer<typeof PlatformSchema>;
