import type { FirestoreClient } from "@wayfare/firestore";
import { ScoutError } from "./quota";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Admin-read lock document. The parent destination stays readable by any signed-in user. */
export function lockDocPath(slug: string): string {
  return `destinations/${slug}/lock/current`;
}

export async function readHeldRunId(
  db: FirestoreClient,
  slug: string,
): Promise<string | undefined> {
  const current = readLockDoc(await db.getDocument(lockDocPath(slug)));
  if (current !== undefined) return current.runId;
  return readLegacyLock(await db.getDocument(`destinations/${slug}`))?.runId;
}

/** Refuse a second run while the lock is 2 hours old or newer. `--force` replaces it. */
export async function acquireLock(
  db: FirestoreClient,
  slug: string,
  runId: string,
  now: Date,
  force: boolean,
): Promise<void> {
  await moveLegacyLock(db, slug);
  const path = lockDocPath(slug);
  const existing = readLockDoc(await db.getDocument(path));
  if (existing !== undefined && !force && !olderThan(existing.startedAt, now)) {
    throw new ScoutError(`refused: fresh lock held by ${existing.runId}`, 2);
  }
  await db.patchDocument(
    path,
    { runId, startedAt: now.toISOString() },
    { updateMask: ["runId", "startedAt"] },
  );
}

async function moveLegacyLock(db: FirestoreClient, slug: string): Promise<void> {
  const parentPath = `destinations/${slug}`;
  const parent = await db.getDocument(parentPath);
  const legacy = readLegacyLock(parent);
  if (legacy === undefined) return;
  const path = lockDocPath(slug);
  if ((await db.getDocument(path)) === null) {
    await db.patchDocument(path, legacy, { updateMask: ["runId", "startedAt"] });
  }
  await db.patchDocument(parentPath, {}, { updateMask: ["lock"], mustExist: true });
}

function olderThan(startedAt: string, now: Date): boolean {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > TWO_HOURS_MS;
}

function readLegacyLock(
  dest: Record<string, unknown> | null,
): { runId: string; startedAt: string } | undefined {
  if (dest === null) return undefined;
  const lock = dest.lock;
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) return undefined;
  return readLockDoc(lock as Record<string, unknown>);
}

function readLockDoc(
  doc: Record<string, unknown> | null,
): { runId: string; startedAt: string } | undefined {
  if (doc === null) return undefined;
  const runId = doc.runId;
  const startedAt = doc.startedAt;
  if (typeof runId !== "string" || runId.length === 0) return undefined;
  if (typeof startedAt !== "string" || startedAt.length === 0) return undefined;
  return { runId, startedAt };
}
