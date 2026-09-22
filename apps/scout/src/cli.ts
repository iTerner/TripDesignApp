import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REGISTRY, DEFAULT_SCOUT_CONFIG } from "@wayfare/domain";
import { GeminiProvider, InMemoryQuotaStore, ModelRouter } from "@wayfare/providers";
import { Command, InvalidArgumentError } from "commander";
import { createAgentBackend } from "./backend/agent";
import { createGeminiBackend } from "./backend/gemini";
import type { IntelligenceBackend } from "./backend/types";
import { EXIT } from "./exitCodes";
import { fetchPage } from "./net/fetchPage";
import { runPipeline } from "./pipeline";
import { createTavilySearch } from "./search/tavily";
import { dedupePlaces, readPlacesFile } from "./stages/04-resolve";
import { formatStatus, type StatusBoard } from "./status";
import { assertSafeSlug, openWork, type WorkLayout } from "./workDir";

interface ScoutOptions {
  backend: string;
  stage?: number;
  from?: number;
  dryRun?: boolean;
  budget?: number;
  resume?: boolean;
  status?: boolean;
  report?: boolean;
  dedupe?: boolean;
  force?: boolean;
}

const STAGE_FILE = /^\d{2}-.+\.json$/;

// The root `pnpm scout` script ends in `--`, and pnpm forwards that separator.
function stripPnpmSeparator(argv: readonly string[]): string[] {
  const node = argv[0];
  const script = argv[1];
  if (node === undefined || script === undefined) {
    return [...argv];
  }
  const rest = argv.slice(2);
  const args = rest[0] === "--" ? rest.slice(1) : rest;
  return [node, script, ...args];
}

function parseNonNegativeInt(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("expected a non-negative integer");
  }
  return Number(value);
}

function findRepoRoot(startFile: string): string {
  let dir = dirname(startFile);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("repo root not found");
    }
    dir = parent;
  }
}

function hasGeminiKeys(): boolean {
  const gemini = process.env.GEMINI_API_KEY?.trim() ?? "";
  const tavily = process.env.TAVILY_API_KEY?.trim() ?? "";
  return gemini.length > 0 && tavily.length > 0;
}

function readStage(workRoot: string): string {
  if (!existsSync(workRoot)) {
    return "none";
  }
  const names = readdirSync(workRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && STAGE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latest = names.at(-1);
  if (latest === undefined) {
    return "none";
  }
  return latest.slice(0, -".json".length);
}

function readPackets(packetsDir: string): StatusBoard["packets"] {
  if (!existsSync(packetsDir)) {
    return { pending: 0, answered: 0, rejected: 0 };
  }
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
    if (name.endsWith(".response.json")) {
      answered += 1;
    } else if (name.endsWith(".rejected.json")) {
      rejected += 1;
    } else if (name.endsWith(".request.json")) {
      const id = name.slice(0, -".request.json".length);
      if (!answeredIds.has(id)) {
        pending += 1;
      }
    }
  }
  return { pending, answered, rejected };
}

function readPlaces(outDir: string): number {
  const file = join(outDir, "places.json");
  if (!existsSync(file)) {
    return 0;
  }
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

async function run(dest: string, opts: ScoutOptions): Promise<number> {
  let slug: string;
  try {
    slug = assertSafeSlug(dest);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "refused: slug";
    console.error(message);
    return EXIT.refused;
  }

  if (opts.backend !== "agent" && opts.backend !== "gemini") {
    console.error("refused: backend must be gemini or agent");
    return EXIT.refused;
  }

  if (opts.backend === "gemini" && !hasGeminiKeys()) {
    console.error("refused: --backend gemini requires GEMINI_API_KEY and TAVILY_API_KEY");
    return EXIT.refused;
  }

  const repoRoot = findRepoRoot(fileURLToPath(import.meta.url));
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

  if (opts.dryRun !== true) {
    console.log(formatStatus(readBoard(slug, layout)));
    return EXIT.done;
  }

  const backend = buildBackend(opts, layout, cfg);
  const result = await runPipeline({
    repoRoot,
    slug,
    backend,
    cfg,
    dryRun: true,
    now: () => new Date(),
    budget: { llm: opts.budget ?? cfg.budgetLlmCalls, searches: cfg.maxSearches },
    ...(opts.force === true ? { force: true } : {}),
  });
  console.log(formatStatus(readBoard(slug, layout)));
  return result.exitCode;
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

const program = new Command();
program
  .name("scout")
  .description("Scout a destination into work/<slug>/")
  .argument("<dest>", "destination slug")
  .option("--backend <backend>", "intelligence backend: gemini or agent", "agent")
  .option("--stage <n>", "run only stage n", parseNonNegativeInt)
  .option("--from <n>", "resume from stage n", parseNonNegativeInt)
  .option("--dry-run", "write work/<slug>/out instead of Firestore")
  .option("--budget <n>", "maximum LLM calls", parseNonNegativeInt, 80)
  .option("--resume", "continue an existing run")
  .option("--status", "print the status board and exit")
  .option("--report", "print the run report")
  .option("--dedupe", "re-run resolve and write pending merges")
  .option("--force", "replace a fresh run lock")
  .action(async (dest: string, opts: ScoutOptions) => {
    try {
      const code = await run(dest, opts);
      process.exit(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "scout failed";
      console.error(message);
      process.exit(message.startsWith("refused:") ? EXIT.refused : EXIT.error);
    }
  });

program.parseAsync(stripPnpmSeparator(process.argv)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "scout failed";
  console.error(message);
  process.exit(EXIT.error);
});
