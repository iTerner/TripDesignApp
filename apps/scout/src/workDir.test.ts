import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSlug, openWork } from "./workDir";

test("slug rejects traversal", () => {
  expect(() => assertSafeSlug("..")).toThrow(/slug/);
  expect(() => assertSafeSlug("a/b")).toThrow(/slug/);
  expect(assertSafeSlug("tuscany")).toBe("tuscany");
});

test("openWork stays inside work/<slug>", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-"));
  const w = openWork(root, "tuscany");
  expect(w.stageFile(2, "harvest")).toBe(join(root, "work", "tuscany", "02-harvest.json"));
  expect(w.packetsDir.endsWith(join("work", "tuscany", "packets"))).toBe(true);
});
