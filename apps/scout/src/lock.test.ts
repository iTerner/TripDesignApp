import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "./lock";

const STALE_HOURS = 2;
const HOUR_MS = 60 * 60 * 1000;

function workRoot(): string {
  return mkdtempSync(join(tmpdir(), "scout-lock-"));
}

function lockRunId(root: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(root, "lock.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("runId" in parsed)) {
    throw new Error("lock file missing runId");
  }
  const runId = parsed.runId;
  if (typeof runId !== "string") throw new Error("lock runId is not a string");
  return runId;
}

test("a fresh lock makes a second acquire throw", () => {
  const root = workRoot();
  const now = new Date("2026-09-22T12:00:00.000Z");
  acquireLock(root, "run-a", now, STALE_HOURS, false);
  expect(() => acquireLock(root, "run-b", now, STALE_HOURS, false)).toThrow(/lock/);
  expect(lockRunId(root)).toBe("run-a");
});

test("a lock older than lockStaleHours is replaced and an exact-age lock is kept", () => {
  const root = workRoot();
  const now = new Date("2026-09-22T12:00:00.000Z");
  acquireLock(root, "run-a", now, STALE_HOURS, false);

  const exact = new Date(now.getTime() + STALE_HOURS * HOUR_MS);
  expect(() => acquireLock(root, "run-exact", exact, STALE_HOURS, false)).toThrow(/lock/);
  expect(lockRunId(root)).toBe("run-a");

  const older = new Date(now.getTime() + STALE_HOURS * HOUR_MS + 1);
  acquireLock(root, "run-c", older, STALE_HOURS, false);
  expect(lockRunId(root)).toBe("run-c");
});

test("force replaces a fresh lock", () => {
  const root = workRoot();
  const now = new Date("2026-09-22T12:00:00.000Z");
  acquireLock(root, "run-a", now, STALE_HOURS, false);
  acquireLock(root, "run-forced", now, STALE_HOURS, true);
  expect(lockRunId(root)).toBe("run-forced");
});
