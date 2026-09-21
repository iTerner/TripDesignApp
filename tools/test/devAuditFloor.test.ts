import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * These dev-tool versions failed `pnpm audit --audit-level high`
 * (firebase-tools → tar, vitest-pool-workers → miniflare → undici/ws/sharp).
 * They are not in the Worker or web bundle. The root pnpm overrides must keep
 * them out of the lockfile.
 */
const BANNED = ["tar@6.2.1", "undici@7.18.2", "ws@8.18.0", "sharp@0.34.5"];

test("lockfile does not retain the dev-tool versions rejected by a high audit", () => {
  const lock = readFileSync(resolve(import.meta.dirname, "../../pnpm-lock.yaml"), "utf8");
  for (const spec of BANNED) expect(lock, spec).not.toContain(spec);
});
