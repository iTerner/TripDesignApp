import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REGISTRY, DEFAULT_SCOUT_CONFIG } from "@wayfare/domain";
import type { FirestoreClient } from "@wayfare/firestore";
import { GeminiProvider, InMemoryQuotaStore, ModelRouter } from "@wayfare/providers";
import { createAgentBackend } from "./backend/agent";
import { createGeminiBackend } from "./backend/gemini";
import type { IntelligenceBackend } from "./backend/types";
import { EXIT } from "./exitCodes";
import { openScoutFirestore } from "./firestore/client";
import { fetchPage } from "./net/fetchPage";
import { type PipelineOptions, runPipeline } from "./pipeline";
import { createTavilySearch } from "./search/tavily";
import { dedupePlaces, readPlacesFile } from "./stages/04-resolve";
import { loadWriteInput, writeDestination } from "./stages/07-write";
import { formatStatus, type StatusBoard } from "./status";
import { assertSafeSlug, openWork, type WorkLayout } from "./workDir";

export interface ScoutOptions {
  backend: string;
  stage?: number;
  from?: number;
  dryRun?: boolean;
  write?: boolean;
  budget?: number;
  resume?: boolean;
  status?: boolean;
  report?: boolean;
  dedupe?: boolean;
  force?: boolean;
}

export interface ScoutDeps {
  repoRoot?: string;
  now?: () => Date;
  openDb?: () => Promise<FirestoreClient>;
  runPipeline?: (opts: PipelineOptions) => Promise<{ exitCode: 0 | 3 | 4 | 5; outDir: string }>;
}

const STAGE_FILE = /^\d{2}-.+\.json$/;

/** `--dry-run` stays on local files. Omitting it writes the finished run to Firestore. */
export function writesFirestore(opts: { dryRun?: boolean }): boolean {
  return opts.dryRun !== true;
}

function findRepoRoot(startFile: string): string {
  let dir = dirname(startFile);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found");
    dir = parent;
  }
}

function hasGeminiKeys(): boolean {
  const gemini = process.env.GEMINI_API_KEY?.trim() ?? "";
  const tavily = process.env.TAVILY_API_KEY?.trim() ?? "";
  return gemini.length > 0 && tavily.length > 0;
}

function readStage(workRoot: string): string {
  if (!existsSync(workRoot)) return "none";
  const names = readdirSync(workRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && STAGE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latest = names.at(-1);
  if (latest === undefined) return "none";
  return latest.slice(0, -".json".length);
}

function readPackets(packetsDir: string): StatusBoard["packets"] {
  if (!existsSync(packetsDir)) return { pending: 0, answered: 0, rejected: 0 };
  const names = readdirSync(packetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const answeredIds = new Set(
    names
      .filter((name) => name.endsWith(".response.json"))
      .map((name) => name.slice(0, -".response.json".length)),
  );
  let pending = 0;
  let answered = 0;
  let rejected = 0;
  for (const name of names) {
    if (name.endsWith(".response.json")) answered += 1;
    else if (name.endsWith(".rejected.json")) rejected += 1;
    else if (name.endsWith(".request.json")) {
      const id = name.slice(0, -".request.json".length);
      if (!answeredIds.has(id)) pending += 1;
    }
  }
  return { pending, answered, rejected };
}

function readPlaces(outDir: string): number {
  const file = join(outDir, "places.json");
  if (!existsSync(file)) return 0;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function readBoard(slug: string, layout: WorkLayout): StatusBoard {
  return {
    slug,
    stage: readStage(layout.root),
    packets: readPackets(layout.packetsDir),
    places: readPlaces(layout.outDir),
    budget: { llmCalls: 0, searches: 0 },
    elapsedSec: 0,
  };
}

function startedBy(backend: "gemini" | "agent"): WriteStartedBy {
  if (process.env.GITHUB_ACTIONS === "true") return "actions";
  return backend === "agent" ? "cursor" : "owner";
}

type WriteStartedBy = "owner" | "actions" | "cursor";

export async function run(dest: string, opts: ScoutOptions, deps: ScoutDeps = {}): Promise<number> {
  let slug: string;
  try {
    slug = assertSafeSlug(dest);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "refused: slug";
    console.error(message);
    return EXIT.refused;
  }

  const backendId = opts.backend;
  if (backendId !== "agent" && backendId !== "gemini") {
    console.error("refused: backend must be gemini or agent");
    return EXIT.refused;
  }

  if (backendId === "gemini" && !hasGeminiKeys()) {
    console.error("refused: --backend gemini requires GEMINI_API_KEY and TAVILY_API_KEY");
    return EXIT.refused;
  }

  const repoRoot = deps.repoRoot ?? findRepoRoot(fileURLToPath(import.meta.url));
  const layout = openWork(repoRoot, slug);
  const cfg = DEFAULT_SCOUT_CONFIG;

  if (opts.status === true) {
    console.log(formatStatus(readBoard(slug, layout)));
    return EXIT.done;
  }

  if (opts.report === true) {
    const reportFile = join(layout.outDir, "run-report.md");
    if (!existsSync(reportFile)) {
      console.error("refused: no run report");
      return EXIT.refused;
    }
    console.log(readFileSync(reportFile, "utf8"));
    return EXIT.done;
  }

  if (opts.dedupe === true) {
    const placesFile = join(layout.outDir, "places.json");
    if (!existsSync(placesFile)) {
      console.error("refused: no places to dedupe");
      return EXIT.refused;
    }
    const merges = dedupePlaces(readPlacesFile(placesFile), cfg, slug);
    mkdirSync(layout.outDir, { recursive: true });
    writeFileSync(
      join(layout.outDir, "pending-merges.json"),
      `${JSON.stringify(merges, null, 2)}\n`,
    );
    console.log(`pending merges: ${merges.length}`);
    return EXIT.done;
  }

  const now = deps.now ?? (() => new Date());
  const pipeline = deps.runPipeline ?? runPipeline;
  const result = await pipeline({
    repoRoot,
    slug,
    backend: buildBackend(opts, layout, cfg),
    cfg,
    dryRun: true,
    now,
    budget: { llm: opts.budget ?? cfg.budgetLlmCalls, searches: cfg.maxSearches },
    ...(opts.force === true ? { force: true } : {}),
  });
  if (!writesFirestore(opts) || result.exitCode !== 0) {
    console.log(formatStatus(readBoard(slug, layout)));
    return result.exitCode;
  }

  const db = await (deps.openDb ?? (() => Promise.resolve(openScoutFirestore())))();
  await writeDestination(
    db,
    loadWriteInput({
      workRoot: layout.root,
      outDir: result.outDir,
      slug,
      backend: backendId,
      now: now(),
      force: opts.force === true,
      startedBy: startedBy(backendId),
    }),
  );
  console.log(formatStatus(readBoard(slug, layout)));
  return EXIT.done;
}

function buildBackend(
  opts: ScoutOptions,
  layout: WorkLayout,
  cfg: typeof DEFAULT_SCOUT_CONFIG,
): IntelligenceBackend {
  if (opts.backend === "gemini") {
    const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
    const tavilyKey = process.env.TAVILY_API_KEY?.trim() ?? "";
    const budget = { llmCalls: 0, searches: 0 };
    return createGeminiBackend({
      router: new ModelRouter({
        registry: DEFAULT_REGISTRY,
        providers: { google: new GeminiProvider(geminiKey) },
        quota: new InMemoryQuotaStore(),
      }),
      search: createTavilySearch(tavilyKey, fetch, cfg),
      fetchPage,
      budget,
      limits: { llm: opts.budget ?? cfg.budgetLlmCalls, searches: cfg.maxSearches },
    });
  }
  return createAgentBackend({
    packetsDir: layout.packetsDir,
    readFile: readFileSync,
    writeFile: writeFileSync,
  });
}
