import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../scripts/secret-scan.mjs");
// Assembled at runtime so this test file itself does not trip the pre-commit scanner.
const PEM_HEADER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

function scan(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  const file = join(dir, "leak.ts");
  writeFileSync(file, content);
  return spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
}

test("flags a Google API key and a service-account private key", () => {
  expect(scan(`const k = "AIza${"A".repeat(35)}";`).status).toBe(1);
  expect(scan(`{"private_key": "${PEM_HEADER}\\nabc"}`).status).toBe(1);
});

test("passes clean code", () => {
  expect(scan(`export const x = 1;`).status).toBe(0);
});

test("staged mode flags a leak even when run from a subdirectory (pre-commit hook cwd)", () => {
  const repo = mkdtempSync(join(tmpdir(), "scan-repo-"));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(repo, "leak.ts"), `const k = "AIza${"A".repeat(35)}";`);
  git("add", "leak.ts");
  const sub = join(repo, "sub");
  mkdirSync(sub);
  const r = spawnSync("node", [SCRIPT], { cwd: sub, encoding: "utf8" });
  expect(r.status).toBe(1);
});
