import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type Evidence,
  EvidenceSchema,
  effectivePlace,
  PacketRejectionSchema,
  type PendingMerge,
  PendingMergeSchema,
  type Place,
  PlaceSchema,
  type ScoutRun,
  type StageRun,
  StageRunSchema,
  type StayZone,
  StayZoneSchema,
} from "@wayfare/domain";
import type { FirestoreClient } from "@wayfare/firestore";
import { acquireLock, lockDocPath, readHeldRunId } from "../firestore/lock";
import { assertWriteBudget, estimateWrites, ScoutError, usageDocPath } from "../firestore/quota";
import { evidenceDocId } from "./07-writeDry";

const MAX_WRITES = 500;
const STAGE_FILES = [
  "01-areas",
  "02-harvest",
  "03-trends",
  "04-resolve",
  "05-enrich",
  "06-stays",
  "07-write",
] as const;

export interface WriteInput {
  slug: string;
  runId: string;
  backend: "gemini" | "agent";
  places: Place[];
  evidence: Evidence[];
  merges: PendingMerge[];
  stays: StayZone[];
  reportMarkdown: string;
  now: Date;
  budget: { llmCalls: number; searches: number };
  stages: Record<string, StageRun>;
  rejectedPackets: ScoutRun["rejectedPackets"];
  errors: string[];
  startedBy: "owner" | "actions" | "cursor";
  force: boolean;
}

export async function writeDestination(db: FirestoreClient, input: WriteInput): Promise<void> {
  assertIds(input);
  await assertWriteBudget(db, estimateWrites(input), input.now);
  const previousRunId = await readHeldRunId(db, input.slug);
  await acquireLock(db, input.slug, input.runId, input.now, input.force);
  const usagePath = usageDocPath(input.now);
  try {
    await db.incrementFields(usagePath, { writes: 1 });
    const existingById = await placesFor(db, input.slug);
    const counts = inventoryCounts(input.places, existingById);
    const batch = new MutationBatch(db, usagePath);
    const seenIds = new Set(
      input.places.filter((place) => place.lastSeenRunId === input.runId).map((place) => place.id),
    );
    const inputIds = new Set(input.places.map((place) => place.id));
    for (const place of input.places) {
      const write = placeWrite(place, existingById.get(place.id) ?? null, input.runId);
      await batch.add(`places/${place.id}`, write.fields, write.updateMask);
    }
    for (const [id, data] of existingById) {
      if (seenIds.has(id) || inputIds.has(id)) continue;
      if (data.lastSeenRunId === input.runId) continue;
      await batch.add(`places/${id}`, { notSeenSince: input.runId }, ["notSeenSince"]);
    }
    for (const item of input.evidence) {
      const id = evidenceDocId(item.url, item.quote);
      const fields = defined({
        ...item,
        id,
        fetchedAt: input.now.toISOString(),
        runId: input.runId,
        backend: input.backend,
      });
      await batch.add(`places/${item.placeId}/evidence/${id}`, fields, Object.keys(fields));
    }
    for (const merge of input.merges) {
      const existing = await db.getDocument(`pendingMerges/${merge.id}`);
      const status = existing?.status;
      if (status === "merged" || status === "kept_both") continue;
      if (status !== undefined && status !== "open") continue;
      const fields = defined({ ...merge });
      await batch.add(`pendingMerges/${merge.id}`, fields, Object.keys(fields));
    }
    await batch.add(`stayAreas/${input.slug}`, { slug: input.slug, zones: input.stays }, [
      "slug",
      "zones",
    ]);
    await batch.add(
      `packs/${input.slug}`,
      { slug: input.slug, places: packPlaces(input.places, existingById) },
      ["slug", "places"],
    );
    const runFields = runDocument(input, previousRunId);
    await batch.add(`scoutRuns/${input.runId}`, runFields, Object.keys(runFields));
    await batch.add(
      `destinations/${input.slug}`,
      { lastRunId: input.runId, counts, status: "ready" },
      ["lastRunId", "counts", "status", "lock"],
    );
    await batch.flush();
    await db.deleteDocument(lockDocPath(input.slug));
  } catch (error) {
    await markFailed(db, input, usagePath).catch(() => undefined);
    throw error;
  }
}

export function loadWriteInput(args: {
  workRoot: string;
  outDir: string;
  slug: string;
  backend: "gemini" | "agent";
  now: Date;
  force: boolean;
  startedBy: WriteInput["startedBy"];
}): WriteInput {
  const places = parseList(join(args.outDir, "places.json"), PlaceSchema, "places");
  const evidence = parseList(join(args.outDir, "evidence.json"), EvidenceSchema, "evidence", true);
  const merges = parseList(
    join(args.outDir, "pending-merges.json"),
    PendingMergeSchema,
    "merges",
    true,
  );
  const runId = places[0]?.runId ?? `run-${args.now.toISOString().replace(/[:.]/g, "-")}`;
  const reportMarkdown = loadReport(args.outDir);
  return {
    slug: args.slug,
    runId,
    backend: args.backend,
    places,
    evidence,
    merges,
    stays: loadStays(args.outDir),
    reportMarkdown,
    now: args.now,
    budget: budgetFromReport(reportMarkdown),
    stages: loadStages(args.workRoot),
    rejectedPackets: loadRejected(join(args.workRoot, "packets")),
    errors: loadErrors(args.workRoot),
    startedBy: args.startedBy,
    force: args.force,
  };
}

class MutationBatch {
  private pending: Array<{
    path: string;
    fields: Record<string, unknown>;
    updateMask: string[];
  }> = [];

  constructor(
    private readonly db: FirestoreClient,
    private readonly usagePath: string,
  ) {}

  async add(path: string, fields: Record<string, unknown>, updateMask: string[]): Promise<void> {
    this.pending.push({ path, fields, updateMask });
    if (this.pending.length >= MAX_WRITES) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const chunk = this.pending.slice(0, MAX_WRITES);
    await this.db.commitUpdates(chunk);
    this.pending = this.pending.slice(MAX_WRITES);
    await this.db.incrementFields(this.usagePath, { writes: chunk.length });
  }
}

function assertIds(input: WriteInput): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.runId.includes("/")) {
    throw new ScoutError("refused: unsafe slug or run id", 2);
  }
  for (const place of input.places) {
    if (place.id.includes("/")) throw new ScoutError("refused: unsafe place id", 2);
  }
}

async function placesFor(
  db: FirestoreClient,
  slug: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db.queryEquals("places", "destSlug", slug);
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = row.path.startsWith("places/") ? row.path.slice("places/".length) : "";
    if (id.length === 0 || id.includes("/")) continue;
    byId.set(id, row.data);
  }
  return byId;
}

function placeWrite(
  place: Place,
  existing: Record<string, unknown> | null,
  runId: string,
): { fields: Record<string, unknown>; updateMask: string[] } {
  const seen = place.lastSeenRunId === runId;
  const fields: Record<string, unknown> = { ...place };
  delete fields.adminOverrides;
  if (seen) {
    fields.lastSeenRunId = runId;
    fields.runId = runId;
    delete fields.notSeenSince;
  } else {
    fields.notSeenSince = runId;
  }
  if (existing === null) {
    fields.source = "scout";
    fields.status = place.status === "unenriched" ? "unenriched" : "active";
  } else {
    delete fields.status;
    delete fields.mergedInto;
    if (hasStoredAliases(existing.aliases)) delete fields.aliases;
    if (typeof existing.firstSeenAt === "string") delete fields.firstSeenAt;
    if (typeof existing.timesFlagged === "number") delete fields.timesFlagged;
  }
  const clean = defined(fields);
  const updateMask = Object.keys(clean);
  if (existing !== null && seen && !updateMask.includes("notSeenSince"))
    updateMask.push("notSeenSince");
  return { fields: clean, updateMask };
}

function packPlaces(
  places: readonly Place[],
  existingById: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  const packed: Record<string, unknown>[] = [];
  for (const place of places) {
    const effective = forPack(place, existingById.get(place.id) ?? null);
    if (effective.status !== "active") continue;
    packed.push({
      id: effective.id,
      name: effective.name,
      lat: effective.lat,
      lng: effective.lng,
      areaName: effective.areaName,
      ...(effective.primaryCategory !== undefined
        ? { primaryCategory: effective.primaryCategory }
        : {}),
      fameScore: effective.fameScore,
      trendScore: effective.trendScore,
    });
  }
  return packed;
}

function forPack(place: Place, existing: Record<string, unknown> | null): Place {
  if (existing === null) return effectivePlace(place);
  const next: Place = { ...place };
  if (isStatus(existing.status)) next.status = existing.status;
  const overrides = readOverrides(existing.adminOverrides);
  if (overrides !== undefined) next.adminOverrides = overrides;
  return effectivePlace(next);
}

function inventoryCounts(
  places: readonly Place[],
  existingById: ReadonlyMap<string, Record<string, unknown>>,
): { scouted: number; userFound: number; trending: number; hidden: number } {
  const counts = { scouted: 0, userFound: 0, trending: 0, hidden: 0 };
  const seen = new Set<string>();
  for (const place of places) {
    seen.add(place.id);
    const effective = forPack(place, existingById.get(place.id) ?? null);
    const source = existingById.has(place.id) ? effective.source : "scout";
    tally(counts, source, effective.trendScore, effective.status);
  }
  for (const [id, data] of existingById) {
    if (seen.has(id)) continue;
    const overrides = readOverrides(data.adminOverrides);
    const status = overrideOr(overrides, "status", data.status);
    const source = overrideOr(overrides, "source", data.source);
    const trend = overrideOr(overrides, "trendScore", data.trendScore);
    tally(counts, source, trend, status);
  }
  return counts;
}

function tally(
  counts: { scouted: number; userFound: number; trending: number; hidden: number },
  source: unknown,
  trend: unknown,
  status: unknown,
): void {
  if (source === "scout") counts.scouted += 1;
  if (source === "user_request") counts.userFound += 1;
  if (typeof trend === "number" && trend > 0) counts.trending += 1;
  if (status === "hidden") counts.hidden += 1;
}

function runDocument(
  input: WriteInput,
  previousRunId: string | undefined,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    runId: input.runId,
    destSlug: input.slug,
    backend: input.backend,
    startedBy: input.startedBy,
    startedAt: input.now.toISOString(),
    finishedAt: input.now.toISOString(),
    stages: input.stages,
    budget: input.budget,
    rejectedPackets: input.rejectedPackets,
    errors: input.errors,
    reportMarkdown: input.reportMarkdown,
  };
  if (input.force && previousRunId !== undefined) {
    fields.forced = true;
    fields.previousRunId = previousRunId;
  }
  return fields;
}

async function markFailed(
  db: FirestoreClient,
  input: WriteInput,
  usagePath: string,
): Promise<void> {
  await db.patchDocument(
    `destinations/${input.slug}`,
    { status: "failed", lastRunId: input.runId },
    { updateMask: ["status", "lastRunId", "lock"] },
  );
  await db.deleteDocument(lockDocPath(input.slug));
  await db.incrementFields(usagePath, { writes: 1 });
}

function loadStays(outDir: string): StayZone[] {
  const parsed = readOptional(join(outDir, "stayAreas.json"));
  if (parsed === undefined) return [];
  if (typeof parsed !== "object" || parsed === null || !("zones" in parsed)) {
    throw new ScoutError("refused: stay areas", 2);
  }
  const zones = (parsed as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) throw new ScoutError("refused: stay areas", 2);
  return zones.map((item) => StayZoneSchema.parse(item));
}

function loadReport(outDir: string): string {
  const file = join(outDir, "run-report.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function budgetFromReport(markdown: string): { llmCalls: number; searches: number } {
  const match = /Budget: llm (\d+) searches (\d+)/.exec(markdown);
  if (match === null) return { llmCalls: 0, searches: 0 };
  return { llmCalls: Number(match[1]), searches: Number(match[2]) };
}

function loadStages(workRoot: string): Record<string, StageRun> {
  const stages: Record<string, StageRun> = {};
  for (const name of STAGE_FILES) {
    const file = join(workRoot, `${name}.json`);
    if (!existsSync(file)) continue;
    const parsed = readOptional(file);
    const direct = StageRunSchema.safeParse(parsed);
    if (direct.success) {
      stages[name] = direct.data;
      continue;
    }
    const stage = StageRunSchema.safeParse({
      startedAt: statSync(file).mtime.toISOString(),
      counts: countsOf(parsed),
    });
    if (stage.success) stages[name] = stage.data;
  }
  return stages;
}

function countsOf(value: unknown): Record<string, number> {
  if (Array.isArray(value)) return { rows: value.length };
  if (typeof value === "object" && value !== null) {
    const counts: Record<string, number> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item)) counts[key] = item.length;
      else if (typeof item === "number") counts[key] = item;
    }
    if (Object.keys(counts).length === 0) counts.keys = Object.keys(value).length;
    return counts;
  }
  return { rows: 0 };
}

function loadRejected(packetsDir: string): ScoutRun["rejectedPackets"] {
  if (!existsSync(packetsDir)) return [];
  const out: ScoutRun["rejectedPackets"] = [];
  for (const name of readdirSync(packetsDir)) {
    if (!name.endsWith(".rejected.json")) continue;
    const parsed = PacketRejectionSchema.safeParse(readOptional(join(packetsDir, name)));
    if (!parsed.success) continue;
    for (const attempt of parsed.data.attempts) {
      out.push({
        packetId: parsed.data.packetId,
        attempt: attempt.attempt,
        reasons: attempt.reasons,
      });
    }
  }
  return out;
}

function loadErrors(workRoot: string): string[] {
  const parsed = readOptional(join(workRoot, "errors.json"));
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  return [];
}

function parseList<T>(
  file: string,
  schema: { parse(value: unknown): T },
  label: string,
  optional = false,
): T[] {
  const parsed = readOptional(file);
  if (parsed === undefined && optional) return [];
  if (!Array.isArray(parsed)) throw new ScoutError(`refused: no ${label} to write`, 2);
  return parsed.map((item) => schema.parse(item));
}

function readOptional(file: string): unknown {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function defined(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function hasStoredAliases(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isStatus(value: unknown): value is Place["status"] {
  return (
    value === "active" || value === "hidden" || value === "tombstoned" || value === "unenriched"
  );
}

function readOverrides(value: unknown): Place["adminOverrides"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Place["adminOverrides"] = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "object" || item === null) return undefined;
    const row = item as Record<string, unknown>;
    if (typeof row.by !== "string" || typeof row.at !== "string" || !("value" in row)) {
      return undefined;
    }
    out[key] = { value: row.value, by: row.by, at: row.at };
  }
  return out;
}

function overrideOr(
  overrides: Place["adminOverrides"] | undefined,
  field: string,
  fallback: unknown,
): unknown {
  const override = overrides?.[field];
  return override !== undefined ? override.value : fallback;
}
