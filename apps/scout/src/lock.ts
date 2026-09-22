import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface RunLock {
  runId: string;
  startedAt: string;
  forced?: boolean;
}

/** Refuse a second run while a lock younger than `staleHours` exists. `--force` replaces it. */
export function acquireLock(
  workRoot: string,
  runId: string,
  now: Date,
  staleHours: number,
  force: boolean,
): void {
  mkdirSync(workRoot, { recursive: true });
  const existing = readLock(join(workRoot, "lock.json"));
  if (existing !== undefined && !force && !isStale(existing, now, staleHours)) {
    throw new Error(`refused: fresh lock held by ${existing.runId}`);
  }
  const next: RunLock = {
    runId,
    startedAt: now.toISOString(),
    ...(force ? { forced: true } : {}),
  };
  writeFileSync(join(workRoot, "lock.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function releaseLock(workRoot: string): void {
  rmSync(join(workRoot, "lock.json"), { force: true });
}

function isStale(lock: RunLock, now: Date, staleHours: number): boolean {
  const started = Date.parse(lock.startedAt);
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > staleHours * 60 * 60 * 1000;
}

function readLock(file: string): RunLock | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
  try {
    return parseLock(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function parseLock(value: unknown): RunLock | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.runId !== "string" || row.runId.length === 0) return undefined;
  if (typeof row.startedAt !== "string" || row.startedAt.length === 0) return undefined;
  const lock: RunLock = { runId: row.runId, startedAt: row.startedAt };
  if (row.forced === true) lock.forced = true;
  return lock;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
