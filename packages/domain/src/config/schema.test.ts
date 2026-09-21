import { AppConfigSchema, DEFAULT_CONFIG } from "./schema";

test("default config validates", () => {
  expect(AppConfigSchema.parse(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
});

test("free tier has one lifetime generation and 2 refine iterations; plus has 3", () => {
  expect(DEFAULT_CONFIG.tiers.free.lifetimeGenerations).toBe(1);
  expect(DEFAULT_CONFIG.tiers.free.refineIterations).toBe(2);
  expect(DEFAULT_CONFIG.tiers.plus.refineIterations).toBe(3);
});

test("negative caps are rejected", () => {
  const bad = {
    ...DEFAULT_CONFIG,
    pace: { ...DEFAULT_CONFIG.pace, chill: { ...DEFAULT_CONFIG.pace.chill, activeHours: -1 } },
  };
  expect(() => AppConfigSchema.parse(bad)).toThrow();
});

test("admin fresh-auth window is 15 minutes", () => {
  expect(DEFAULT_CONFIG.admin.freshAuthMaxAgeSec).toBe(15 * 60);
});
