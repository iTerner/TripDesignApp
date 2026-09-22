import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BBox, ScoutConfig } from "@wayfare/domain";
import { createLimiter } from "../net/rateLimit";

const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QID = /^Q[1-9]\d*$/;

const TOURISM_ATTRACTIONS = new Set([
  "museum",
  "attraction",
  "viewpoint",
  "gallery",
  "artwork",
  "theme_park",
  "zoo",
  "aquarium",
]);

const HISTORIC_ATTRACTIONS = new Set([
  "monument",
  "memorial",
  "castle",
  "ruins",
  "archaeological_site",
  "city_gate",
  "citywalls",
  "fort",
  "manor",
  "palace",
  "tower",
  "aqueduct",
  "tomb",
  "monastery",
  "church",
  "wayside_shrine",
  "battlefield",
]);

export interface OsmCandidate {
  osmType: "node" | "way" | "relation";
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
  status?: "unenriched";
}

export interface WikidataFacts {
  qid: string;
  label: string;
  description?: string;
  sitelinks: number;
  website?: string;
  image?: { url: string; licence: string; author: string };
}

export interface HarvestOptions {
  fetchImpl: typeof fetch;
  cacheDir: string;
  cfg: ScoutConfig;
}

export interface HarvestResult {
  kept: OsmCandidate[];
  deferred: OsmCandidate[];
  wikidata: Record<string, WikidataFacts>;
}

type Limiter = ReturnType<typeof createLimiter>;

interface ParsedEntity {
  label: string;
  description?: string;
  sitelinks: number;
  website?: string;
  imageFile?: string;
}

export const OVERPASS_GROUPS: readonly { id: string; query: (bbox: string) => string }[] = [
  {
    id: "tourism",
    query: (bbox) =>
      overpassQuery(
        'tourism~"museum|attraction|viewpoint|gallery|artwork|theme_park|zoo|aquarium"',
        bbox,
      ),
  },
  { id: "historic", query: (bbox) => overpassQuery("historic", bbox) },
  {
    id: "food",
    query: (bbox) =>
      overpassQuery(
        'amenity~"restaurant|cafe|ice_cream|bar|pub|marketplace|theatre|arts_centre"',
        bbox,
      ),
  },
  {
    id: "shop",
    query: (bbox) =>
      overpassQuery(
        'shop~"bakery|pastry|confectionery|wine|deli|cheese|books|antiques|boutique|mall"',
        bbox,
      ),
  },
  {
    id: "leisure",
    query: (bbox) => overpassQuery('leisure~"park|garden|spa|beach_resort|nature_reserve"', bbox),
  },
  {
    id: "natural",
    query: (bbox) => overpassQuery('natural~"beach|peak|spring|cave_entrance"', bbox),
  },
  { id: "craft", query: (bbox) => overpassQuery('craft~"winery|distillery"', bbox) },
  {
    id: "stays",
    query: (bbox) => overpassQuery('tourism~"hotel|guest_house|apartment|hostel|chalet"', bbox),
  },
];

export function keepCandidate(el: OsmCandidate): boolean {
  if (isClosed(el.tags)) {
    return false;
  }
  const name = el.name.trim() || (el.tags.name ?? "").trim();
  if (name.length === 0) {
    return false;
  }
  return hasQuality(el.tags);
}

export function rankCandidates(list: OsmCandidate[]): OsmCandidate[] {
  return list
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => compareRank(a.candidate, b.candidate) || a.index - b.index)
    .map((item) => item.candidate);
}

export async function harvestAreas(
  areas: { name: string; bbox: BBox }[],
  opts: HarvestOptions,
): Promise<HarvestResult> {
  const limiter = createLimiter(opts.cfg.overpass.minIntervalMs);
  const collected: OsmCandidate[] = [];
  for (const area of areas) {
    const slug = areaSlug(area.name);
    const bbox = formatBBox(area.bbox);
    for (const group of OVERPASS_GROUPS) {
      const body = await loadOverpass(slug, group, bbox, limiter, opts);
      collected.push(...parseElements(body));
    }
  }

  const ranked = rankCandidates(dedupe(collected).filter(keepCandidate));
  const kept = ranked.slice(0, opts.cfg.maxCandidates);
  const deferred = ranked.slice(opts.cfg.maxCandidates).map(markUnenriched);
  const wikidata: Record<string, WikidataFacts> = {};
  for (const item of kept) {
    const qid = qidOf(item.tags.wikidata);
    if (qid === undefined || Object.hasOwn(wikidata, qid)) {
      continue;
    }
    wikidata[qid] = await loadWikidata(qid, limiter, opts);
  }
  return { kept, deferred, wikidata };
}

function overpassQuery(filter: string, bbox: string): string {
  const clause = (kind: "node" | "way" | "relation") => `${kind}[${filter}](${bbox});`;
  return `[out:json][timeout:60];(${clause("node")}${clause("way")}${clause("relation")});out center;`;
}

function formatBBox(bbox: BBox): string {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

function areaSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!SAFE_NAME.test(slug)) {
    throw new Error(`refused: unsafe area "${name}"`);
  }
  return slug;
}

function isClosed(tags: Record<string, string>): boolean {
  if (tags.shop === "vacant") {
    return true;
  }
  for (const key of Object.keys(tags)) {
    if (key.startsWith("disused:") || key.startsWith("abandoned:")) {
      return true;
    }
  }
  return false;
}

function hasQuality(tags: Record<string, string>): boolean {
  if (qidOf(tags.wikidata) !== undefined) {
    return true;
  }
  if (hasText(tags, "website") || hasText(tags, "opening_hours") || hasText(tags, "cuisine")) {
    return true;
  }
  if (hasText(tags, "wikipedia")) {
    return true;
  }
  const tourism = tags.tourism;
  if (tourism !== undefined && TOURISM_ATTRACTIONS.has(tourism)) {
    return true;
  }
  const historic = tags.historic;
  if (historic !== undefined && HISTORIC_ATTRACTIONS.has(historic)) {
    return true;
  }
  return false;
}

function hasText(tags: Record<string, string>, key: string): boolean {
  const value = tags[key];
  return value !== undefined && value.trim().length > 0;
}

function qidOf(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return QID.test(trimmed) ? trimmed : undefined;
}

function compareRank(a: OsmCandidate, b: OsmCandidate): number {
  const left = rankTuple(a);
  const right = rankTuple(b);
  for (let i = 0; i < left.length; i++) {
    const delta = (right[i] ?? 0) - (left[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function rankTuple(el: OsmCandidate): readonly [number, number, number, number] {
  return [
    qidOf(el.tags.wikidata) !== undefined ? 1 : 0,
    hasText(el.tags, "website") ? 1 : 0,
    hasText(el.tags, "opening_hours") ? 1 : 0,
    Object.keys(el.tags).length,
  ];
}

function markUnenriched(item: OsmCandidate): OsmCandidate {
  return { ...item, status: "unenriched" };
}

function dedupe(list: OsmCandidate[]): OsmCandidate[] {
  const seen = new Set<string>();
  const out: OsmCandidate[] = [];
  for (const item of list) {
    const key = `${item.osmType}:${item.osmId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function loadOverpass(
  slug: string,
  group: { id: string; query: (bbox: string) => string },
  bbox: string,
  limiter: Limiter,
  opts: HarvestOptions,
): Promise<unknown> {
  const file = cacheFile(opts.cacheDir, `${slug}-${group.id}`);
  const cached = readText(file);
  if (cached !== undefined) {
    return JSON.parse(cached) as unknown;
  }
  const text = await fetchOverpassText(group.query(bbox), limiter, opts);
  mkdirSync(opts.cacheDir, { recursive: true });
  writeFileSync(file, text, "utf8");
  return JSON.parse(text) as unknown;
}

async function fetchOverpassText(
  query: string,
  limiter: Limiter,
  opts: HarvestOptions,
): Promise<string> {
  let last = "no overpass endpoint accepted the query";
  for (const endpoint of opts.cfg.overpass.endpoints) {
    await limiter.wait();
    try {
      const response = await opts.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "user-agent": opts.cfg.fetch.userAgent,
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await response.text();
      if (response.status !== 200) {
        last = `${endpoint} status ${response.status}`;
        continue;
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || !Array.isArray(parsed.elements)) {
        last = `${endpoint} missing elements`;
        continue;
      }
      return text;
    } catch (error) {
      last = error instanceof Error ? error.message : "overpass fetch failed";
    }
  }
  throw new Error(`overpass failed: ${last}`);
}

async function loadWikidata(
  qid: string,
  limiter: Limiter,
  opts: HarvestOptions,
): Promise<WikidataFacts> {
  const file = cacheFile(opts.cacheDir, `wikidata-${qid.toLowerCase()}`);
  let text = readText(file);
  if (text === undefined) {
    text = await fetchJson(entityDataUrl(qid), limiter, opts);
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  const entity = parseEntity(JSON.parse(text) as unknown, qid);
  const facts: WikidataFacts = { qid, label: entity.label, sitelinks: entity.sitelinks };
  if (entity.description !== undefined) {
    facts.description = entity.description;
  }
  if (entity.website !== undefined) {
    facts.website = entity.website;
  }
  if (entity.imageFile !== undefined) {
    const image = await loadCommons(entity.imageFile, limiter, opts);
    if (image !== undefined) {
      facts.image = image;
    }
  }
  return facts;
}

function entityDataUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
}

async function loadCommons(
  fileName: string,
  limiter: Limiter,
  opts: HarvestOptions,
): Promise<WikidataFacts["image"]> {
  const file = cacheFile(opts.cacheDir, `commons-${sha1(fileName)}`);
  let text = readText(file);
  if (text === undefined) {
    text = await fetchJson(commonsUrl(fileName), limiter, opts);
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return parseCommons(JSON.parse(text) as unknown);
}

function commonsUrl(fileName: string): string {
  const title = fileName.startsWith("File:") ? fileName : `File:${fileName}`;
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("titles", title);
  return url.toString();
}

async function fetchJson(url: string, limiter: Limiter, opts: HarvestOptions): Promise<string> {
  await limiter.wait();
  const response = await opts.fetchImpl(url, {
    headers: {
      "user-agent": opts.cfg.fetch.userAgent,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`${url} status ${response.status}`);
  }
  return text;
}

function parseElements(body: unknown): OsmCandidate[] {
  if (!isRecord(body) || !Array.isArray(body.elements)) {
    return [];
  }
  const out: OsmCandidate[] = [];
  for (const raw of body.elements) {
    const candidate = toCandidate(raw);
    if (candidate !== undefined) {
      out.push(candidate);
    }
  }
  return out;
}

function toCandidate(raw: unknown): OsmCandidate | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const osmType = asOsmType(raw.type);
  const osmId = asOsmId(raw.id);
  const coords = asCoords(raw);
  if (osmType === undefined || osmId === undefined || coords === undefined) {
    return undefined;
  }
  const tags = stringTags(raw.tags);
  return { osmType, osmId, name: (tags.name ?? "").trim(), lat: coords.lat, lng: coords.lng, tags };
}

function asOsmType(value: unknown): OsmCandidate["osmType"] | undefined {
  if (value === "node" || value === "way" || value === "relation") {
    return value;
  }
  return undefined;
}

function asOsmId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return value;
  }
  return undefined;
}

function asCoords(raw: Record<string, unknown>): { lat: number; lng: number } | undefined {
  const lat = asNumber(raw.lat);
  const lng = asNumber(raw.lon);
  if (lat !== undefined && lng !== undefined) {
    return { lat, lng };
  }
  if (!isRecord(raw.center)) {
    return undefined;
  }
  const centerLat = asNumber(raw.center.lat);
  const centerLng = asNumber(raw.center.lon);
  if (centerLat === undefined || centerLng === undefined) {
    return undefined;
  }
  return { lat: centerLat, lng: centerLng };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringTags(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      tags[key] = entry;
    }
  }
  return tags;
}

function parseEntity(body: unknown, qid: string): ParsedEntity {
  if (!isRecord(body) || !isRecord(body.entities)) {
    throw new Error(`wikidata ${qid} missing entities`);
  }
  const entity = body.entities[qid];
  if (!isRecord(entity)) {
    throw new Error(`wikidata ${qid} missing entity`);
  }
  const label = englishText(entity.labels);
  if (label === undefined) {
    throw new Error(`wikidata ${qid} missing English label`);
  }
  const description = englishText(entity.descriptions);
  const sitelinks = isRecord(entity.sitelinks) ? Object.keys(entity.sitelinks).length : 0;
  const website = claimString(entity, "P856");
  const imageFile = claimString(entity, "P18");
  const parsed: ParsedEntity = { label, sitelinks };
  if (description !== undefined) {
    parsed.description = description;
  }
  if (website !== undefined) {
    parsed.website = website;
  }
  if (imageFile !== undefined) {
    parsed.imageFile = imageFile;
  }
  return parsed;
}

function englishText(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.en)) {
    return undefined;
  }
  const text = value.en.value;
  return typeof text === "string" && text.trim().length > 0 ? text : undefined;
}

function claimString(entity: Record<string, unknown>, property: string): string | undefined {
  if (!isRecord(entity.claims)) {
    return undefined;
  }
  const list = entity.claims[property];
  if (!Array.isArray(list)) {
    return undefined;
  }
  for (const statement of list) {
    const value = statementValue(statement);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function statementValue(statement: unknown): string | undefined {
  if (!isRecord(statement) || !isRecord(statement.mainsnak)) {
    return undefined;
  }
  const datavalue = statement.mainsnak.datavalue;
  if (!isRecord(datavalue) || typeof datavalue.value !== "string") {
    return undefined;
  }
  const value = datavalue.value.trim();
  return value.length > 0 ? value : undefined;
}

function parseCommons(body: unknown): WikidataFacts["image"] {
  if (!isRecord(body) || !isRecord(body.query) || !isRecord(body.query.pages)) {
    return undefined;
  }
  for (const page of Object.values(body.query.pages)) {
    const image = commonsPage(page);
    if (image !== undefined) {
      return image;
    }
  }
  return undefined;
}

function commonsPage(page: unknown): WikidataFacts["image"] {
  if (!isRecord(page) || !Array.isArray(page.imageinfo)) {
    return undefined;
  }
  const info = page.imageinfo[0];
  if (!isRecord(info) || typeof info.url !== "string" || !isRecord(info.extmetadata)) {
    return undefined;
  }
  const licence = metaValue(info.extmetadata.LicenseShortName);
  const author = metaValue(info.extmetadata.Artist);
  if (licence === undefined || author === undefined) {
    return undefined;
  }
  return { url: info.url, licence, author: plainText(author) };
}

function metaValue(entry: unknown): string | undefined {
  if (!isRecord(entry) || typeof entry.value !== "string") {
    return undefined;
  }
  const value = entry.value.trim();
  return value.length > 0 ? value : undefined;
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}

function cacheFile(dir: string, name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`refused: unsafe cache name "${name}"`);
  }
  return join(dir, `${name}.json`);
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
