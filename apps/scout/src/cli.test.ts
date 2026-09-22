import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Place, PlaceSchema } from "@wayfare/domain";
import { run } from "./command";
import { openScoutFirestore } from "./firestore/client";
import { createMemoryFirestore } from "./firestore/memoryFirestore";
import { ScoutError } from "./firestore/quota";
import { openWork } from "./workDir";

const NOW = new Date("2026-09-22T12:00:00.000Z");

function place(): Place {
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
    runId: "run-1",
    packetIds: [],
    aliases: [],
    externalIds: {},
    verification: { geocoded: true, sourcesCount: 1, quoteVerified: false },
    adminOverrides: {},
    status: "active",
    firstSeenAt: "2026-09-21T10:00:00.000Z",
    lastSeenRunId: "run-1",
    timesFlagged: 0,
    primaryCategory: "culture.museum",
  });
}

function repo(): { repoRoot: string; outDir: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "scout-cli-"));
  const layout = openWork(repoRoot, "tuscany");
  mkdirSync(layout.outDir, { recursive: true });
  writeFileSync(join(layout.outDir, "places.json"), `${JSON.stringify([place()])}\n`);
  writeFileSync(join(layout.outDir, "evidence.json"), "[]\n");
  writeFileSync(join(layout.outDir, "pending-merges.json"), "[]\n");
  writeFileSync(
    join(layout.outDir, "stayAreas.json"),
    `${JSON.stringify({ slug: "tuscany", zones: [] })}\n`,
  );
  writeFileSync(join(layout.outDir, "run-report.md"), "Budget: llm 1 searches 0\n");
  return { repoRoot, outDir: layout.outDir };
}

test("--dry-run does not open a Firestore client", async () => {
  const layout = repo();
  let opened = false;
  const code = await run(
    "tuscany",
    { backend: "agent", dryRun: true, write: true },
    {
      repoRoot: layout.repoRoot,
      now: () => NOW,
      openDb: async () => {
        opened = true;
        throw new Error("network client");
      },
      runPipeline: async () => ({ exitCode: 0, outDir: layout.outDir }),
    },
  );
  expect(code).toBe(0);
  expect(opened).toBe(false);
});

test("a paused pipeline does not open a Firestore client", async () => {
  const layout = repo();
  let opened = false;
  const code = await run(
    "tuscany",
    { backend: "agent", write: true },
    {
      repoRoot: layout.repoRoot,
      now: () => NOW,
      openDb: async () => {
        opened = true;
        throw new Error("network client");
      },
      runPipeline: async () => ({ exitCode: 3, outDir: layout.outDir }),
    },
  );
  expect(code).toBe(3);
  expect(opened).toBe(false);
});

test("--write upserts the place and releases the lock", async () => {
  const layout = repo();
  const db = createMemoryFirestore();
  const code = await run(
    "tuscany",
    { backend: "agent", write: true },
    {
      repoRoot: layout.repoRoot,
      now: () => NOW,
      openDb: async () => db.client,
      runPipeline: async () => ({ exitCode: 0, outDir: layout.outDir }),
    },
  );
  expect(code).toBe(0);
  expect(await db.client.getDocument("places/p1")).toMatchObject({
    name: "Scout Name",
    source: "scout",
    status: "active",
  });
  const dest = await db.client.getDocument("destinations/tuscany");
  expect(dest?.status).toBe("ready");
  expect(dest?.lock).toBeUndefined();
});

test("opening a live client without credentials is refused before fetch", () => {
  expect(() => openScoutFirestore({} as NodeJS.ProcessEnv)).toThrow(ScoutError);
});
