import { DEFAULT_SCOUT_CONFIG, type ScoutConfig } from "@wayfare/domain";
import { trendPacketsFor } from "./03-trends";

const year = new Date().getUTCFullYear();

function withTier1Sitelinks(minSitelinks: number, searchesPerPacket = 2): ScoutConfig {
  return {
    ...DEFAULT_SCOUT_CONFIG,
    searchesPerPacket,
    tierRules: {
      tier1: { minSitelinks, minCandidates: 10_000 },
      tier2: DEFAULT_SCOUT_CONFIG.tierRules.tier2,
    },
  };
}

function area(name: string, sitelinks: number, candidateCount = 0) {
  return {
    name,
    lat: 43.77,
    lng: 11.25,
    kind: "town" as const,
    sitelinks,
    candidateCount,
  };
}

const openBudget = { llmLeft: 20, searchesLeft: 40 };

test("a tier-1 area with sitelinks 50 yields one packet per theme", () => {
  const packets = trendPacketsFor([area("Florence", 50)], withTier1Sitelinks(50), openBudget);
  expect(DEFAULT_SCOUT_CONFIG.themes).toHaveLength(11);
  expect(packets).toHaveLength(11);
  expect(packets.map((packet) => packet.theme)).toEqual(
    DEFAULT_SCOUT_CONFIG.themes.map((theme) => theme.id),
  );
  expect(packets.every((packet) => packet.queries.length <= 2 && packet.queries.length >= 1)).toBe(
    true,
  );
  expect(packets[0]).toMatchObject({
    area: { name: "Florence", lat: 43.77, lng: 11.25, kind: "town", tier: 1 },
    theme: "food",
    queries: [`best restaurants Florence ${year}`, `Florence restaurant TikTok viral`],
    maxFindings: DEFAULT_SCOUT_CONFIG.maxFindingsPerPacket,
    year,
  });
});

test("a tier-3 area yields only food and hidden_gems", () => {
  const packets = trendPacketsFor([area("Village", 1)], DEFAULT_SCOUT_CONFIG, openBudget);
  expect(packets.map((packet) => packet.theme)).toEqual(["food", "hidden_gems"]);
  expect(packets.every((packet) => packet.area.tier === 3)).toBe(true);
  expect(packets[0]?.queries[0]).toBe(`best restaurants Village ${year}`);
});

test("a tier-2 area uses tierThemes.tier2", () => {
  const packets = trendPacketsFor([area("Lucca", 80)], DEFAULT_SCOUT_CONFIG, openBudget);
  expect(packets.map((packet) => packet.theme)).toEqual([...DEFAULT_SCOUT_CONFIG.tierThemes.tier2]);
  expect(packets.every((packet) => packet.area.tier === 2)).toBe(true);
});

test("candidate count can promote an area to tier 1", () => {
  const packets = trendPacketsFor(
    [area("Florence", 0, DEFAULT_SCOUT_CONFIG.tierRules.tier1.minCandidates)],
    DEFAULT_SCOUT_CONFIG,
    openBudget,
  );
  expect(packets).toHaveLength(11);
  expect(packets[0]?.area.tier).toBe(1);
});

test("search budget keeps the highest tier and caps queries at searchesPerPacket", () => {
  const cfg = withTier1Sitelinks(50, 2);
  const packets = trendPacketsFor([area("Village", 1), area("Florence", 50)], cfg, {
    llmLeft: 20,
    searchesLeft: 4,
  });
  expect(packets).toHaveLength(2);
  expect(packets.map((packet) => packet.area.name)).toEqual(["Florence", "Florence"]);
  expect(packets.map((packet) => packet.area.tier)).toEqual([1, 1]);
  expect(packets.map((packet) => packet.theme)).toEqual(["food", "dessert"]);
  expect(packets.every((packet) => packet.queries.length <= cfg.searchesPerPacket)).toBe(true);
});

test("llm budget truncates packets before the search budget does", () => {
  const cfg = withTier1Sitelinks(50);
  expect(trendPacketsFor([area("Florence", 50)], cfg, { llmLeft: 0, searchesLeft: 40 })).toEqual(
    [],
  );
  const packets = trendPacketsFor([area("Florence", 50)], cfg, { llmLeft: 1, searchesLeft: 40 });
  expect(packets).toHaveLength(1);
  expect(packets[0]?.theme).toBe("food");
});

test("areas of the same tier keep input order", () => {
  const packets = trendPacketsFor(
    [area("Florence", 50), area("Lucca", 50)],
    withTier1Sitelinks(50),
    { llmLeft: 2, searchesLeft: 4 },
  );
  expect(packets.map((packet) => packet.area.name)).toEqual(["Florence", "Florence"]);
});
