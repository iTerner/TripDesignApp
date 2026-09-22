import { Command, InvalidArgumentError } from "commander";
import { run, type ScoutOptions } from "./command";
import { EXIT } from "./exitCodes";
import { ScoutError } from "./firestore/quota";

function stripPnpmSeparator(argv: readonly string[]): string[] {
  const node = argv[0];
  const script = argv[1];
  if (node === undefined || script === undefined) return [...argv];
  const rest = argv.slice(2);
  const args = rest[0] === "--" ? rest.slice(1) : rest;
  return [node, script, ...args];
}

function parseNonNegativeInt(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("expected a non-negative integer");
  return Number(value);
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
  .option("--write", "upsert the finished run into Firestore")
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
      if (err instanceof ScoutError) {
        console.error(err.message);
        process.exit(err.exitCode);
      }
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
