import type { AreaKind, ScoutConfig, TrendsRequest } from "@wayfare/domain";

export interface TrendArea {
  name: string;
  lat: number;
  lng: number;
  kind: AreaKind;
  sitelinks: number;
  candidateCount: number;
}

/** One trends packet per area × theme, truncated to the LLM and search budget, highest tier first. */
export function trendPacketsFor(
  areas: TrendArea[],
  cfg: ScoutConfig,
  budget: { llmLeft: number; searchesLeft: number },
): TrendsRequest[] {
  const year = new Date().getUTCFullYear();
  const themesById = new Map(cfg.themes.map((theme) => [theme.id, theme]));
  const ranked = areas
    .map((area, index) => ({ area, index, tier: tierFor(area, cfg) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index);

  let llmLeft = budget.llmLeft;
  let searchesLeft = budget.searchesLeft;
  const packets: TrendsRequest[] = [];

  for (const item of ranked) {
    for (const themeId of themeIds(item.tier, cfg)) {
      const theme = themesById.get(themeId);
      if (!theme) continue;
      const queries = theme.queries
        .slice(0, cfg.searchesPerPacket)
        .map((query) => fillQuery(query, item.area.name, year));
      if (queries.length === 0) continue;
      if (llmLeft < 1 || searchesLeft < queries.length) return packets;
      packets.push({
        area: {
          name: item.area.name,
          lat: item.area.lat,
          lng: item.area.lng,
          kind: item.area.kind,
          tier: item.tier,
        },
        theme: theme.id,
        queries,
        maxFindings: cfg.maxFindingsPerPacket,
        year,
      });
      llmLeft -= 1;
      searchesLeft -= queries.length;
    }
  }
  return packets;
}

function tierFor(area: { sitelinks: number; candidateCount: number }, cfg: ScoutConfig): 1 | 2 | 3 {
  const { tier1, tier2 } = cfg.tierRules;
  if (area.sitelinks >= tier1.minSitelinks || area.candidateCount >= tier1.minCandidates) return 1;
  if (area.sitelinks >= tier2.minSitelinks || area.candidateCount >= tier2.minCandidates) return 2;
  return 3;
}

function themeIds(tier: 1 | 2 | 3, cfg: ScoutConfig): readonly string[] {
  if (tier === 1) return cfg.themes.map((theme) => theme.id);
  if (tier === 2) return cfg.tierThemes.tier2;
  return cfg.tierThemes.tier3;
}

function fillQuery(template: string, area: string, year: number): string {
  return template.replaceAll("{area}", area).replaceAll("{year}", String(year));
}
