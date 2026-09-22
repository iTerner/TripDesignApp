import type { FirestoreClient } from "@wayfare/firestore";
import { ScoutError } from "./quota";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Refuse a second run while `destinations/{slug}.lock` is 2 hours old or newer. `--force` replaces it. */
export async function acquireLock(
  db: FirestoreClient,
  slug: string,
  runId: string,
  now: Date,
  force: boolean,
): Promise<void> {
  const path = `destinations/${slug}`;
  const existing = readLock(await db.getDocument(path));
  if (existing !== undefined && !force && !olderThan(existing.startedAt, now)) {
    throw new ScoutError(`refused: fresh lock held by ${existing.runId}`, 2);
  }
  await db.patchDocument(
    path,
    { lock: { runId, startedAt: now.toISOString() } },
    { updateMask: ["lock"] },
  );
}

function olderThan(startedAt: string, now: Date): boolean {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > TWO_HOURS_MS;
}

function readLock(
  dest: Record<string, unknown> | null,
): { runId: string; startedAt: string } | undefined {
  if (dest === null) return undefined;
  const lock = dest.lock;
  if (typeof lock !== "object" || lock === null) return undefined;
  const row = lock as Record<string, unknown>;
  if (typeof row.runId !== "string" || row.runId.length === 0) return undefined;
  if (typeof row.startedAt !== "string" || row.startedAt.length === 0) return undefined;
  return { runId: row.runId, startedAt: row.startedAt };
}
