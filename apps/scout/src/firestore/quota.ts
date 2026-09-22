import type { FirestoreClient } from "@wayfare/firestore";

const DAILY_WRITES = 20_000;
const BUDGET_FRACTION = 0.6;

export class ScoutError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "ScoutError";
    this.exitCode = exitCode;
  }
}

export function usageDocPath(now: Date): string {
  return `usageDaily/firestore_${now.toISOString().slice(0, 10)}`;
}

/** Pre-run estimate: candidates × 2 + evidence. */
export function estimateWrites(input: {
  places: readonly unknown[];
  evidence: readonly unknown[];
}): number {
  return input.places.length * 2 + input.evidence.length;
}

export async function assertWriteBudget(
  db: FirestoreClient,
  estimate: number,
  now: Date,
): Promise<void> {
  const doc = await db.getDocument(usageDocPath(now));
  const raw = doc?.writes;
  const writes = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  const remaining = DAILY_WRITES - writes;
  if (estimate > remaining * BUDGET_FRACTION) {
    throw new ScoutError(
      `refused: write estimate ${estimate} exceeds 60% of remaining daily writes (${remaining})`,
      2,
    );
  }
}
