import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Evidence,
  EvidenceSchema,
  type Place,
  PlaceSchema,
  type StayZone,
} from "@wayfare/domain";
import { acquireLock } from "../firestore/lock";
import { createMemoryFirestore } from "../firestore/memoryFirestore";
import { assertWriteBudget, estimateWrites, ScoutError } from "../firestore/quota";
import { openWork } from "../workDir";
import { loadWriteInput, type WriteInput, writeDestination } from "./07-write";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const RUN = "run-1";
const EVIDENCE_ID = "23ffe15e38bf8afd6cf275ce528c1ef079b5c74d";
const QUOTE = "  Gelato\u2019s   best ";

const zone: StayZone = {
  name: "Centro Storico",
  rationale: "Museums sit in the old centre.",
  exampleProperties: [{ name: "Hotel Davanzati", priceLevel: 3 }],
};

function place(overrides: Partial<Place> = {}): Place {
  return PlaceSchema.parse({
    id: "p1",
    destSlug: "tuscany",
    name: "Scout Name",
    normalizedName: "scout name",
    geohash7: "spz7x8k",
    lat: 43.77,
    lng: 11.26,
    areaName: "Florence",
    secondary: [],
    bestTimeOfDay: [],
    hoursStatus: "unknown",
    fameScore: 55,
    trendScore: 12,
    sources: [{ kind: "osm", ref: "node/1" }],
    source: "scout",
    runId: RUN,
    packetIds: [],
    aliases: ["Scout Alias"],
    externalIds: {},
    verification: { geocoded: true, sourcesCount: 1, quoteVerified: false },
    adminOverrides: {},
    status: "active",
    firstSeenAt: "2026-09-21T10:00:00.000Z",
    lastSeenRunId: RUN,
    timesFlagged: 0,
    primaryCategory: "culture.museum",
    ...overrides,
  });
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return EvidenceSchema.parse({
    id: "placeholder",
    placeId: "p1",
    url: "https://example.com/a",
    platform: "blog",
    quote: QUOTE,
    quoteVerified: true,
    fetchedAt: "2026-09-01T00:00:00.000Z",
    backend: "agent",
    runId: "run-old",
    ...overrides,
  });
}

function input(overrides: Partial<WriteInput> = {}): WriteInput {
  return {
    slug: "tuscany",
    runId: RUN,
    backend: "agent",
    places: [place()],
    evidence: [],
    merges: [],
    stays: [zone],
    reportMarkdown: "# Scout run\n",
    now: NOW,
    budget: { llmCalls: 4, searches: 2 },
    stages: {
      "01-areas": {
        startedAt: "2026-09-22T11:00:00.000Z",
        finishedAt: "2026-09-22T11:05:00.000Z",
        counts: { areas: 1 },
      },
    },
    rejectedPackets: [
      { packetId: "areas-1", attempt: 1, reasons: [{ path: "areas", reason: "short" }] },
    ],
    errors: ["overpass timeout"],
    startedBy: "cursor",
    force: false,
    ...overrides,
  };
}

test("estimateWrites is candidates times 2 plus evidence", () => {
  expect(estimateWrites({ places: ["a", "b"], evidence: [1, 2, 3] })).toBe(7);
});

test("assertWriteBudget aborts over the 60% line and allows a small estimate", async () => {
  const db = createMemoryFirestore();
  const path = "usageDaily/firestore_2026-09-22";
  db.seed(path, { writes: 19000 });
  await expect(assertWriteBudget(db.client, 700, NOW)).rejects.toMatchObject({
    name: "ScoutError",
    exitCode: 2,
  });
  await expect(assertWriteBudget(db.client, 600, NOW)).resolves.toBeUndefined();
  db.seed(path, { writes: 0 });
  await expect(assertWriteBudget(db.client, 10, NOW)).resolves.toBeUndefined();
});

test("a fresh Firestore lock is refused and an older lock can be replaced", async () => {
  const db = createMemoryFirestore();
  db.seed("destinations/tuscany", {
    name: "Tuscany",
    lock: { runId: "run-old", startedAt: "2026-09-22T11:00:00.000Z" },
  });
  await expect(acquireLock(db.client, "tuscany", RUN, NOW, false)).rejects.toBeInstanceOf(
    ScoutError,
  );
  const parent = await db.client.getDocument("destinations/tuscany");
  expect(parent?.lock).toBeUndefined();
  expect(parent?.name).toBe("Tuscany");
  expect(await db.client.getDocument("destinations/tuscany/lock/current")).toEqual({
    runId: "run-old",
    startedAt: "2026-09-22T11:00:00.000Z",
  });

  const exact = createMemoryFirestore();
  exact.seed("destinations/tuscany/lock/current", {
    runId: "run-old",
    startedAt: "2026-09-22T10:00:00.000Z",
  });
  await expect(acquireLock(exact.client, "tuscany", RUN, NOW, false)).rejects.toMatchObject({
    exitCode: 2,
  });

  const stale = createMemoryFirestore();
  stale.seed("destinations/tuscany", {
    name: "Tuscany",
    lock: { runId: "run-old", startedAt: "2026-09-22T09:59:59.999Z" },
  });
  await acquireLock(stale.client, "tuscany", RUN, NOW, false);
  const replaced = await stale.client.getDocument("destinations/tuscany");
  expect(replaced?.lock).toBeUndefined();
  expect(replaced?.name).toBe("Tuscany");
  expect(await stale.client.getDocument("destinations/tuscany/lock/current")).toEqual({
    runId: RUN,
    startedAt: NOW.toISOString(),
  });
});

test("a finished run upserts base fields, the pack, and the run, then releases the lock", async () => {
  const db = createMemoryFirestore();
  await writeDestination(db.client, input());
  const stored = await db.client.getDocument("places/p1");
  expect(stored).toMatchObject({
    name: "Scout Name",
    status: "active",
    source: "scout",
    lastSeenRunId: RUN,
    trendScore: 12,
  });
  expect(stored?.adminOverrides).toBeUndefined();
  expect(stored?.notSeenSince).toBeUndefined();

  expect(await db.client.getDocument("packs/tuscany")).toMatchObject({
    slug: "tuscany",
    places: [
      {
        id: "p1",
        name: "Scout Name",
        lat: 43.77,
        lng: 11.26,
        areaName: "Florence",
        primaryCategory: "culture.museum",
        fameScore: 55,
        trendScore: 12,
      },
    ],
  });
  expect(await db.client.getDocument("stayAreas/tuscany")).toMatchObject({
    slug: "tuscany",
    zones: [zone],
  });
  expect(await db.client.getDocument(`scoutRuns/${RUN}`)).toMatchObject({
    runId: RUN,
    destSlug: "tuscany",
    backend: "agent",
    startedBy: "cursor",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    budget: { llmCalls: 4, searches: 2 },
    errors: ["overpass timeout"],
    reportMarkdown: "# Scout run\n",
    rejectedPackets: [
      { packetId: "areas-1", attempt: 1, reasons: [{ path: "areas", reason: "short" }] },
    ],
    stages: {
      "01-areas": {
        startedAt: "2026-09-22T11:00:00.000Z",
        finishedAt: "2026-09-22T11:05:00.000Z",
        counts: { areas: 1 },
      },
    },
  });
  const dest = await db.client.getDocument("destinations/tuscany");
  expect(dest).toMatchObject({
    lastRunId: RUN,
    status: "ready",
    counts: { scouted: 1, userFound: 0, trending: 1, hidden: 0 },
  });
  expect(dest?.lock).toBeUndefined();
  expect(await db.client.getDocument("destinations/tuscany/lock/current")).toBeNull();
  expect((await db.client.getDocument("usageDaily/firestore_2026-09-22"))?.writes).toBe(
    db.updateBatches.reduce((sum, size) => sum + size, 0) + db.patchCount,
  );
});

test("an existing place keeps admin fields and the pack uses the override", async () => {
  const db = createMemoryFirestore();
  const overrides = {
    name: { value: "Admin Name", by: "admin", at: "2026-09-21T11:00:00.000Z" },
  };
  db.seed("places/p1", {
    destSlug: "tuscany",
    name: "Old",
    status: "hidden",
    mergedInto: "p9",
    aliases: ["Admin Alias"],
    adminOverrides: overrides,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    timesFlagged: 4,
    lastSeenRunId: "run-old",
    source: "scout",
  });
  await writeDestination(db.client, input());
  const stored = await db.client.getDocument("places/p1");
  expect(stored).toMatchObject({
    name: "Scout Name",
    status: "hidden",
    mergedInto: "p9",
    aliases: ["Admin Alias"],
    adminOverrides: overrides,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    timesFlagged: 4,
    lastSeenRunId: RUN,
  });
  expect(stored?.notSeenSince).toBeUndefined();
  expect((await db.client.getDocument("packs/tuscany"))?.places).toEqual([]);

  const active = createMemoryFirestore();
  active.seed("places/p1", {
    destSlug: "tuscany",
    status: "active",
    adminOverrides: overrides,
    aliases: [],
    lastSeenRunId: "run-old",
  });
  await writeDestination(active.client, input());
  expect((await active.client.getDocument("places/p1"))?.aliases).toEqual(["Scout Alias"]);
  expect((await active.client.getDocument("packs/tuscany"))?.places).toEqual([
    expect.objectContaining({ id: "p1", name: "Admin Name" }),
  ]);
});

test("evidence id is sha1 of url and the normalised quote, and fetchedAt is refreshed", async () => {
  const db = createMemoryFirestore();
  db.seed(`places/p1/evidence/${EVIDENCE_ID}`, {
    fetchedAt: "2026-09-01T00:00:00.000Z",
    runId: "run-old",
    quote: "stale",
  });
  await writeDestination(db.client, input({ evidence: [evidence()] }));
  const stored = await db.client.getDocument(`places/p1/evidence/${EVIDENCE_ID}`);
  expect(stored).toMatchObject({
    id: EVIDENCE_ID,
    quote: QUOTE,
    quoteVerified: true,
    fetchedAt: NOW.toISOString(),
    runId: RUN,
    backend: "agent",
  });
});

test("seen places record lastSeenRunId and missing places record notSeenSince without deletion", async () => {
  const db = createMemoryFirestore();
  db.seed("places/old", {
    destSlug: "tuscany",
    name: "Old Chapel",
    lastSeenRunId: "run-old",
    status: "active",
  });
  db.seed("places/rome", { destSlug: "rome", name: "Other", lastSeenRunId: "run-old" });
  db.seed("places/p1", {
    destSlug: "tuscany",
    name: "Scout Name",
    lastSeenRunId: "run-old",
    notSeenSince: "run-old",
    status: "active",
  });
  await writeDestination(db.client, input());
  const seen = await db.client.getDocument("places/p1");
  expect(seen?.lastSeenRunId).toBe(RUN);
  expect(seen?.notSeenSince).toBeUndefined();
  const missing = await db.client.getDocument("places/old");
  expect(missing?.name).toBe("Old Chapel");
  expect(missing?.lastSeenRunId).toBe("run-old");
  expect(missing?.notSeenSince).toBe(RUN);
  expect((await db.client.getDocument("places/rome"))?.notSeenSince).toBeUndefined();
});

test("resolved merges stay resolved", async () => {
  const db = createMemoryFirestore();
  db.seed("pendingMerges/kept", {
    destSlug: "tuscany",
    placeIdA: "a",
    placeIdB: "b",
    score: 0.5,
    reasons: ["kept"],
    status: "kept_both",
    resolvedBy: "admin",
  });
  db.seed("pendingMerges/done", {
    destSlug: "tuscany",
    placeIdA: "a",
    placeIdB: "c",
    score: 0.4,
    reasons: ["merged"],
    status: "merged",
    resolvedBy: "admin",
  });
  db.seed("pendingMerges/open", {
    destSlug: "tuscany",
    placeIdA: "p1",
    placeIdB: "p2",
    score: 0.2,
    reasons: ["old"],
    status: "open",
  });
  await writeDestination(
    db.client,
    input({
      merges: [
        {
          id: "kept",
          destSlug: "tuscany",
          placeIdA: "a",
          placeIdB: "b",
          score: 0.9,
          reasons: ["reopen"],
          status: "open",
        },
        {
          id: "done",
          destSlug: "tuscany",
          placeIdA: "a",
          placeIdB: "c",
          score: 0.9,
          reasons: ["reopen"],
          status: "open",
        },
        {
          id: "open",
          destSlug: "tuscany",
          placeIdA: "p1",
          placeIdB: "p2",
          score: 0.84,
          reasons: ["jw 0.84"],
          status: "open",
        },
        {
          id: "fresh",
          destSlug: "tuscany",
          placeIdA: "p1",
          placeIdB: "p3",
          score: 0.81,
          reasons: ["new"],
          status: "open",
        },
      ],
    }),
  );
  expect(await db.client.getDocument("pendingMerges/kept")).toMatchObject({
    status: "kept_both",
    score: 0.5,
    resolvedBy: "admin",
  });
  expect(await db.client.getDocument("pendingMerges/done")).toMatchObject({
    status: "merged",
    resolvedBy: "admin",
  });
  expect(await db.client.getDocument("pendingMerges/open")).toMatchObject({
    status: "open",
    score: 0.84,
    reasons: ["jw 0.84"],
  });
  expect(await db.client.getDocument("pendingMerges/fresh")).toMatchObject({ status: "open" });
});

test("--force records the previous run and still releases the lock", async () => {
  const db = createMemoryFirestore();
  db.seed("destinations/tuscany", {
    name: "Tuscany",
    status: "queued",
    lock: { runId: "run-old", startedAt: "2026-09-22T11:30:00.000Z" },
  });
  await writeDestination(db.client, input({ force: true }));
  expect(await db.client.getDocument(`scoutRuns/${RUN}`)).toMatchObject({
    forced: true,
    previousRunId: "run-old",
  });
  const dest = await db.client.getDocument("destinations/tuscany");
  expect(dest?.lock).toBeUndefined();
  expect(await db.client.getDocument("destinations/tuscany/lock/current")).toBeNull();
  expect(dest?.status).toBe("ready");
  expect(dest?.name).toBe("Tuscany");
});

test("a write failure after the lock marks the destination failed and clears the lock", async () => {
  const db = createMemoryFirestore();
  db.failOn("packs/tuscany");
  await expect(writeDestination(db.client, input())).rejects.toThrow(/Firestore HTTP 500/);
  const dest = await db.client.getDocument("destinations/tuscany");
  expect(dest?.status).toBe("failed");
  expect(dest?.lock).toBeUndefined();
  expect(await db.client.getDocument("destinations/tuscany/lock/current")).toBeNull();
});

test("the writer aborts before locking when the daily budget is spent", async () => {
  const db = createMemoryFirestore();
  db.seed("usageDaily/firestore_2026-09-22", { writes: 19000 });
  const places = Array.from({ length: 350 }, (_, index) =>
    place({ id: `p${index}`, name: `Place ${index}`, normalizedName: `place ${index}` }),
  );
  await expect(writeDestination(db.client, input({ places, stays: [] }))).rejects.toMatchObject({
    exitCode: 2,
  });
  expect(await db.client.getDocument("destinations/tuscany")).toBeNull();
  expect(await db.client.getDocument("places/p0")).toBeNull();
});

test("commits stay within 500 writes and the usage counter matches", async () => {
  const db = createMemoryFirestore();
  const places = Array.from({ length: 501 }, (_, index) =>
    place({ id: `p${index}`, name: `Place ${index}`, normalizedName: `place ${index}` }),
  );
  await writeDestination(db.client, input({ places, evidence: [], merges: [], stays: [] }));
  expect(db.updateBatches.every((size) => size <= 500)).toBe(true);
  expect(db.updateBatches).toContain(500);
  const usage = await db.client.getDocument("usageDaily/firestore_2026-09-22");
  expect(usage?.writes).toBe(db.updateBatches.reduce((sum, size) => sum + size, 0) + db.patchCount);
  expect((await db.client.getDocument("places/p0"))?.name).toBe("Place 0");
  expect((await db.client.getDocument("places/p500"))?.name).toBe("Place 500");
});

test("loadWriteInput reads stage timings, rejected packets, and the budget line", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "scout-load-"));
  const layout = openWork(repoRoot, "tuscany");
  mkdirSync(layout.outDir, { recursive: true });
  mkdirSync(layout.packetsDir, { recursive: true });
  writeFileSync(join(layout.outDir, "places.json"), `${JSON.stringify([place()])}\n`);
  writeFileSync(join(layout.outDir, "evidence.json"), "[]\n");
  writeFileSync(join(layout.outDir, "pending-merges.json"), "[]\n");
  writeFileSync(
    join(layout.outDir, "stayAreas.json"),
    `${JSON.stringify({ slug: "tuscany", zones: [zone] })}\n`,
  );
  writeFileSync(join(layout.outDir, "run-report.md"), "# Scout run\n\nBudget: llm 4 searches 2\n");
  writeFileSync(
    join(layout.root, "01-areas.json"),
    `${JSON.stringify({
      startedAt: "2026-09-22T11:00:00.000Z",
      finishedAt: "2026-09-22T11:05:00.000Z",
      counts: { areas: 3 },
    })}\n`,
  );
  writeFileSync(join(layout.root, "02-harvest.json"), `${JSON.stringify([1, 2, 3])}\n`);
  writeFileSync(
    join(layout.packetsDir, "areas-1.rejected.json"),
    `${JSON.stringify({
      packetId: "areas-1",
      attempts: [
        {
          attempt: 2,
          at: "2026-09-22T11:01:00.000Z",
          responseSha1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          reasons: [{ path: "areas", reason: "short" }],
        },
      ],
    })}\n`,
  );
  const loaded = loadWriteInput({
    workRoot: layout.root,
    outDir: layout.outDir,
    slug: "tuscany",
    backend: "gemini",
    now: NOW,
    force: false,
    startedBy: "owner",
  });
  expect(loaded.runId).toBe(RUN);
  expect(loaded.budget).toEqual({ llmCalls: 4, searches: 2 });
  expect(loaded.stages["01-areas"]?.counts).toEqual({ areas: 3 });
  expect(loaded.stages["02-harvest"]?.counts).toEqual({ rows: 3 });
  expect(loaded.rejectedPackets).toEqual([
    { packetId: "areas-1", attempt: 2, reasons: [{ path: "areas", reason: "short" }] },
  ]);
  expect(loaded.stays).toEqual([zone]);
  expect(loaded.reportMarkdown).toContain("Budget: llm 4 searches 2");
});
