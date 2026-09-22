import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AreaRecord,
  EnrichedPlace,
  PlaceCategory,
  ScoutConfig,
  SourceRef,
  StayZone,
  TrendFinding,
} from "@wayfare/domain";
import type { IntelligenceBackend } from "./backend/types";
import {
  AwaitingPackets,
  BudgetExceeded,
  type FetchPageFn,
  RejectionsExceeded,
} from "./backend/types";
import { acquireLock, releaseLock } from "./lock";
import { fetchPage as fetchPageDefault, quoteVerified as quoteIsOnPage } from "./net/fetchPage";
import { createNominatim, FileGeocodeCache } from "./net/nominatim";
import { readDestination, verifyAreas } from "./stages/01-areas";
import { harvestAreas, type OsmCandidate, type WikidataFacts } from "./stages/02-harvest";
import { trendPacketsFor } from "./stages/03-trends";
import {
  categoryForTags,
  locateInput,
  type ResolveDecision,
  type ResolveInput,
  readPlacesFile,
  resolveDrafts,
} from "./stages/04-resolve";
import { enrichPackets, validateEnrichment } from "./stages/05-enrich";
import { type StayCandidate, staysPackets, validateStays } from "./stages/06-stays";
import { type EvidenceInput, writeDryRun } from "./stages/07-writeDry";
import { openWork } from "./workDir";

export interface PipelineOptions {
  repoRoot: string;
  slug: string;
  backend: IntelligenceBackend;
  cfg: ScoutConfig;
  dryRun: true;
  now: () => Date;
  budget: { llm: number; searches: number };
  force?: boolean;
  fetchImpl?: typeof fetch;
  fetchPage?: FetchPageFn;
}

const STAY_TOURISM = new Set(["hotel", "guest_house", "apartment", "hostel", "chalet"]);

export async function runPipeline(
  opts: PipelineOptions,
): Promise<{ exitCode: 0 | 3 | 4 | 5; outDir: string }> {
  const layout = openWork(opts.repoRoot, opts.slug);
  mkdirSync(layout.root, { recursive: true });
  mkdirSync(layout.packetsDir, { recursive: true });
  mkdirSync(layout.outDir, { recursive: true });
  const runId = `run-${opts.now().toISOString().replace(/[:.]/g, "-")}`;
  let locked = false;
  try {
    acquireLock(layout.root, runId, opts.now(), opts.cfg.lockStaleHours, opts.force === true);
    locked = true;
    await execute(opts, layout.root, layout.outDir, runId);
    return { exitCode: 0, outDir: layout.outDir };
  } catch (error) {
    if (error instanceof AwaitingPackets) return { exitCode: 3, outDir: layout.outDir };
    if (error instanceof BudgetExceeded) return { exitCode: 4, outDir: layout.outDir };
    if (error instanceof RejectionsExceeded) return { exitCode: 5, outDir: layout.outDir };
    throw error;
  } finally {
    if (locked) releaseLock(layout.root);
  }
}

async function execute(
  opts: PipelineOptions,
  workRoot: string,
  outDir: string,
  runId: string,
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const spent = { llm: 0, searches: 0 };
  const destination = readDestination(workRoot);
  const nominatim = createNominatim({
    fetchImpl,
    cache: new FileGeocodeCache(join(workRoot, "geocode-cache")),
    userAgent: opts.cfg.fetch.userAgent,
    minIntervalMs: opts.cfg.nominatim.minIntervalMs,
  });

  const areas = await verifyAreas({
    destination,
    backend: opts.backend,
    nominatim,
    cfg: opts.cfg,
  });
  spent.llm += 1;
  writeJson(join(workRoot, stageName(1, "areas")), areas);

  const harvest = await harvestAreas(
    areas.map((area) => ({ name: area.name, bbox: area.bbox })),
    { fetchImpl, cacheDir: join(workRoot, "02-overpass"), cfg: opts.cfg },
  );
  writeJson(join(workRoot, stageName(2, "harvest")), harvest);

  const findings = await mineTrends(opts, areas, harvest.kept, spent);
  writeJson(join(workRoot, stageName(3, "trends")), findings);

  const inputs = [
    ...harvest.kept.map((item) => fromOsm(item, areas, harvest.wikidata, "active")),
    ...harvest.deferred.map((item) => fromOsm(item, areas, harvest.wikidata, "unenriched")),
    ...findings.map((finding) => fromFinding(finding)),
  ];
  const located: ResolveInput[] = [];
  const decisions: ResolveDecision[] = [];
  for (const input of inputs) {
    const hit = await locateInput(input, nominatim, destination);
    if (!hit.ok) {
      decisions.push({ name: input.name, kind: "dropped", reason: hit.reason });
      continue;
    }
    located.push(hit.input);
  }
  const placesFile = join(outDir, "places.json");
  const existing = existsSync(placesFile) ? readPlacesFile(placesFile) : [];
  const resolved = resolveDrafts(located, existing, opts.cfg, opts.slug, opts.now().toISOString());
  decisions.push(...resolved.decisions);
  writeJson(join(workRoot, stageName(4, "resolve")), {
    decisions,
    pendingMerges: resolved.pendingMerges,
  });

  const enrichments = await enrich(opts, resolved.drafts, spent);
  writeJson(join(workRoot, stageName(5, "enrich")), [...enrichments.values()]);

  const zones = await stayZones(opts, areas, [...harvest.kept, ...harvest.deferred], spent);
  writeJson(join(workRoot, stageName(6, "stays")), { zones });

  const evidence = evidenceFor(findings, resolved.drafts);
  const written = writeDryRun({
    outDir,
    slug: opts.slug,
    runId,
    now: opts.now(),
    backendId: opts.backend.id,
    cfg: opts.cfg,
    drafts: resolved.drafts,
    enrichments,
    evidence,
    zones,
    pendingMerges: resolved.pendingMerges,
    rejected: 0,
    budget: { llmCalls: spent.llm, searches: spent.searches },
  });
  writeJson(join(workRoot, stageName(7, "write")), written);
}

interface VerifiedFinding {
  placeName: string;
  category: PlaceCategory;
  whyTrending: string;
  sourceUrl: string;
  platform: EvidenceInput["platform"];
  quote: string;
  approxDate?: string;
  packetId: string;
  areaName: string;
  quoteVerified: boolean;
  verifyReason?: string;
  storeQuote: boolean;
}

async function mineTrends(
  opts: PipelineOptions,
  areas: readonly AreaRecord[],
  kept: readonly OsmCandidate[],
  spent: { llm: number; searches: number },
): Promise<VerifiedFinding[]> {
  const fetchPage = opts.fetchPage ?? fetchPageDefault;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const packets = trendPacketsFor(
    areas.map((area) => ({
      name: area.name,
      lat: area.lat,
      lng: area.lng,
      kind: area.kind,
      sitelinks: area.sitelinks ?? 0,
      candidateCount: kept.filter((item) => inside(item.lat, item.lng, area)).length,
    })),
    opts.cfg,
    {
      llmLeft: Math.max(0, opts.budget.llm - spent.llm),
      searchesLeft: Math.max(0, opts.budget.searches - spent.searches),
    },
  );
  const findings: VerifiedFinding[] = [];
  for (let index = 0; index < packets.length; index += 1) {
    const request = packets[index];
    if (request === undefined) continue;
    if (spent.llm >= opts.budget.llm) throw new BudgetExceeded("llm");
    if (spent.searches + request.queries.length > opts.budget.searches) {
      throw new BudgetExceeded("searches");
    }
    const response = await opts.backend.extractTrends(request, []);
    spent.llm += 1;
    spent.searches += request.queries.length;
    const packetId = `trends-${index + 1}`;
    for (const finding of response.findings) {
      findings.push(
        await verifyFinding(finding, packetId, request.area.name, fetchPage, fetchImpl, opts.cfg),
      );
    }
  }
  return findings;
}

async function verifyFinding(
  finding: TrendFinding,
  packetId: string,
  areaName: string,
  fetchPage: FetchPageFn,
  fetchImpl: typeof fetch,
  cfg: ScoutConfig,
): Promise<VerifiedFinding> {
  const base = {
    placeName: finding.placeName,
    category: finding.category,
    whyTrending: finding.whyTrending,
    sourceUrl: finding.sourceUrl,
    platform: finding.platformMentioned,
    quote: finding.evidenceQuote,
    packetId,
    areaName,
    ...(finding.approxDate !== undefined ? { approxDate: finding.approxDate } : {}),
  };
  const fetched = await fetchPage(finding.sourceUrl, { fetchImpl, cfg });
  if ("skipped" in fetched) {
    return { ...base, quoteVerified: false, verifyReason: fetched.skipped, storeQuote: true };
  }
  if (!fetched.quoteAllowed) {
    return { ...base, quoteVerified: false, verifyReason: "quotes-disallowed", storeQuote: false };
  }
  const verified = quoteIsOnPage(finding.evidenceQuote, fetched.text);
  return {
    ...base,
    quoteVerified: verified,
    ...(verified ? {} : { verifyReason: "quote not on page" }),
    storeQuote: true,
  };
}

async function enrich(
  opts: PipelineOptions,
  drafts: readonly {
    placeId: string;
    name: string;
    lat: number;
    lng: number;
    tags: Record<string, string>;
    wikidataDesc?: string;
    seen: boolean;
    status: string;
    packetIds: string[];
  }[],
  spent: { llm: number; searches: number },
): Promise<Map<string, EnrichedPlace>> {
  const candidates = drafts
    .filter((draft) => draft.seen && draft.status !== "unenriched")
    .map((draft) => ({
      id: draft.placeId,
      name: draft.name,
      lat: draft.lat,
      lng: draft.lng,
      osmTags: draft.tags,
      ...(draft.wikidataDesc !== undefined && draft.wikidataDesc.length > 0
        ? { wikidataDesc: draft.wikidataDesc }
        : {}),
    }));
  const packets = enrichPackets(candidates, opts.cfg);
  const enrichments = new Map<string, EnrichedPlace>();
  for (const packet of packets) {
    if (spent.llm >= opts.budget.llm) throw new BudgetExceeded("llm");
    const response = await opts.backend.enrichBatch(packet.request);
    spent.llm += 1;
    const validated = validateEnrichment(packet.request, response.places, opts.cfg);
    if (!validated.ok) {
      const detail = validated.reasons
        .map((reason) => `${reason.path}: ${reason.reason}`)
        .join("; ");
      throw new Error(`invalid enrich response: ${detail}`);
    }
    for (const place of validated.data) {
      enrichments.set(place.id, place);
      const draft = drafts.find((item) => item.placeId === place.id);
      if (draft !== undefined && !draft.packetIds.includes(packet.packetId)) {
        draft.packetIds.push(packet.packetId);
      }
    }
  }
  return enrichments;
}

async function stayZones(
  opts: PipelineOptions,
  areas: readonly AreaRecord[],
  candidates: readonly OsmCandidate[],
  spent: { llm: number; searches: number },
): Promise<StayZone[]> {
  const accommodations: StayCandidate[] = [];
  for (const item of candidates) {
    const tourism = item.tags.tourism;
    if (tourism === undefined || !STAY_TOURISM.has(tourism)) continue;
    const stay: StayCandidate = { name: item.name, lat: item.lat, lng: item.lng, tourism };
    const website = item.tags.website;
    if (website !== undefined && website.length > 0) stay.website = website;
    accommodations.push(stay);
  }
  const packets = staysPackets(
    areas.map((area) => ({ name: area.name, lat: area.lat, lng: area.lng, kind: area.kind })),
    accommodations,
    opts.cfg,
  );
  const zones: StayZone[] = [];
  for (const packet of packets) {
    if (spent.llm >= opts.budget.llm) throw new BudgetExceeded("llm");
    const response = await opts.backend.suggestStays(packet.request);
    spent.llm += 1;
    const validated = validateStays(response);
    if (!validated.ok) {
      const detail = validated.reasons
        .map((reason) => `${reason.path}: ${reason.reason}`)
        .join("; ");
      throw new Error(`invalid stays response: ${detail}`);
    }
    zones.push(...validated.data.zones);
  }
  return zones;
}

function evidenceFor(
  findings: readonly VerifiedFinding[],
  drafts: readonly { findingKeys: readonly string[]; placeId: string }[],
): EvidenceInput[] {
  const placeByKey = new Map<string, string>();
  for (const draft of drafts) {
    for (const key of draft.findingKeys) placeByKey.set(key, draft.placeId);
  }
  const evidence: EvidenceInput[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    if (!finding.storeQuote) continue;
    const placeId = placeByKey.get(findingKey(finding));
    if (placeId === undefined) continue;
    const id = `${finding.sourceUrl}|${finding.quote}`;
    if (seen.has(id)) continue;
    seen.add(id);
    evidence.push({
      url: finding.sourceUrl,
      quote: finding.quote,
      quoteVerified: finding.quoteVerified,
      platform: finding.platform,
      placeId,
      packetId: finding.packetId,
      ...(finding.verifyReason !== undefined ? { verifyReason: finding.verifyReason } : {}),
      ...(finding.approxDate !== undefined ? { approxDate: finding.approxDate } : {}),
    });
  }
  return evidence;
}

function fromFinding(finding: VerifiedFinding): ResolveInput {
  return {
    name: finding.placeName,
    category: finding.category,
    areaName: finding.areaName,
    tags: {},
    packetIds: [finding.packetId],
    sources: [
      { kind: "web", ref: finding.sourceUrl },
      { kind: "llm", ref: finding.packetId },
    ],
    findingKey: findingKey(finding),
  };
}

function findingKey(finding: { sourceUrl: string; quote: string }): string {
  return `${finding.sourceUrl}|${finding.quote}`;
}

function fromOsm(
  item: OsmCandidate,
  areas: readonly AreaRecord[],
  wikidata: Record<string, WikidataFacts>,
  status: "active" | "unenriched",
): ResolveInput {
  const area = nearestArea(item.lat, item.lng, areas);
  const qid = qidOf(item.tags.wikidata);
  const facts = qid !== undefined ? wikidata[qid] : undefined;
  const website = textOrUndefined(item.tags.website) ?? facts?.website;
  const openingHours = textOrUndefined(item.tags.opening_hours);
  const cuisine = textOrUndefined(item.tags.cuisine);
  const sources: SourceRef[] = [{ kind: "osm", ref: `${item.osmType}/${item.osmId}` }];
  if (qid !== undefined) sources.push({ kind: "wikidata", ref: qid });
  return {
    name: item.name,
    lat: item.lat,
    lng: item.lng,
    category: categoryForTags(item.tags),
    areaName: area?.name ?? "unknown",
    tags: item.tags,
    osmId: `${item.osmType}/${item.osmId}`,
    packetIds: [],
    sources,
    status,
    ...(qid !== undefined ? { wikidataId: qid } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(facts?.description !== undefined ? { wikidataDesc: facts.description } : {}),
    ...(facts?.image !== undefined ? { image: facts.image } : {}),
    ...(facts !== undefined ? { sitelinks: facts.sitelinks } : {}),
    ...(openingHours !== undefined ? { openingHours } : {}),
    ...(cuisine !== undefined ? { cuisine } : {}),
  };
}

function nearestArea(
  lat: number,
  lng: number,
  areas: readonly AreaRecord[],
): AreaRecord | undefined {
  const containing = areas.filter((area) => inside(lat, lng, area));
  const pool = containing.length > 0 ? containing : [...areas];
  let best: AreaRecord | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of pool) {
    const distance = (area.lat - lat) ** 2 + (area.lng - lng) ** 2;
    if (distance < bestDistance) {
      best = area;
      bestDistance = distance;
    }
  }
  return best;
}

function inside(lat: number, lng: number, area: AreaRecord): boolean {
  return (
    lat >= area.bbox.south &&
    lat <= area.bbox.north &&
    lng >= area.bbox.west &&
    lng <= area.bbox.east
  );
}

function qidOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return /^Q[1-9]\d*$/.test(trimmed) ? trimmed : undefined;
}

function textOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stageName(n: number, name: string): string {
  return `${String(n).padStart(2, "0")}-${name}.json`;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
