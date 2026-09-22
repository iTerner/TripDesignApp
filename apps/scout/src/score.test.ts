import { DEFAULT_SCOUT_CONFIG, type ScoutConfig } from "@wayfare/domain";
import { completenessOf, fameScore, trendScore } from "./score";

const cfg: ScoutConfig = DEFAULT_SCOUT_CONFIG;

test("fameScore is 0 when sitelinks, sources and completeness are 0", () => {
  expect(fameScore({ sitelinks: 0, sourcesCount: 0, completeness: 0 }, cfg)).toBe(0);
});

test("fameScore matches spec §8.8 for 9 sitelinks, 5 sources and full completeness", () => {
  // clamp(25*log10(1+9) + 8*min(5, 5) + 20*1) = 25*log10(10) + 40 + 20 = 85
  expect(fameScore({ sitelinks: 9, sourcesCount: 5, completeness: 1 }, cfg)).toBeCloseTo(85, 5);
});

test("fameScore caps distinct sources at sourcesCap", () => {
  // 8 * min(9, 5) = 40. Sources past the cap do not raise the score.
  expect(fameScore({ sitelinks: 0, sourcesCount: 9, completeness: 0 }, cfg)).toBe(40);
  expect(fameScore({ sitelinks: 0, sourcesCount: 5, completeness: 0 }, cfg)).toBe(40);
});

test("fameScore clamps to 100", () => {
  // 25 * log10(1_000_000) = 150, then clamped.
  expect(fameScore({ sitelinks: 999_999, sourcesCount: 0, completeness: 0 }, cfg)).toBe(100);
});

test("trendScore of three fresh verified TikTok mentions is 90", () => {
  const mentions = [
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
  ];
  // 3 * 1.5 * 1 * 20 = 90
  expect(trendScore(mentions, cfg)).toBeCloseTo(90, 5);
});

test("an unverified quote adds 0 to trendScore", () => {
  expect(trendScore([{ platform: "tiktok", monthsOld: 0, quoteVerified: false }], cfg)).toBe(0);
  const withExtraUnverified = [
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: true },
    { platform: "tiktok" as const, monthsOld: 0, quoteVerified: false },
  ];
  expect(trendScore(withExtraUnverified, cfg)).toBeCloseTo(90, 5);
});

test("a mention 24 months old adds 0 to trendScore", () => {
  expect(trendScore([{ platform: "tiktok", monthsOld: 24, quoteVerified: true }], cfg)).toBe(0);
});

test("monthsOld null uses unknownDateRecency 0.5", () => {
  // 1.5 * 0.5 * 20 = 15
  expect(
    trendScore([{ platform: "tiktok", monthsOld: null, quoteVerified: true }], cfg),
  ).toBeCloseTo(15, 5);
});

test("trendScore uses the platform weight and clamps to 100", () => {
  // instagram 1.2 * 1 * 20 = 24
  expect(
    trendScore([{ platform: "instagram", monthsOld: 0, quoteVerified: true }], cfg),
  ).toBeCloseTo(24, 5);
  const tenFreshTikTok = Array.from({ length: 10 }, () => ({
    platform: "tiktok" as const,
    monthsOld: 0,
    quoteVerified: true,
  }));
  // 10 * 1.5 * 20 = 300, clamped to 100
  expect(trendScore(tenFreshTikTok, cfg)).toBe(100);
});

test("completeness is the fraction of the five spec fields that are present", () => {
  expect(completenessOf({})).toBe(0);
  expect(
    completenessOf({
      openingHours: "   ",
      website: "",
      wikidataId: "",
      description: "",
    }),
  ).toBe(0);
  expect(
    completenessOf({
      openingHours: "Mo-Su 09:00-18:00",
      website: "https://example.com",
      wikidataId: "Q123",
    }),
  ).toBeCloseTo(0.6, 5);
  expect(
    completenessOf({
      openingHours: "Mo-Su 09:00-18:00",
      website: "https://example.com",
      wikidataId: "Q123",
      image: { url: "https://example.com/a.jpg" },
      description: "A room of Botticelli.",
    }),
  ).toBe(1);
});
