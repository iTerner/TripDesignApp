import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const yaml = readFileSync(
  resolve(import.meta.dirname, "../../.github/workflows/scout.yml"),
  "utf8",
);

/** Lines that become the shell script, including `run: <inline>` and `run: |` blocks. */
function shellScript(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  let blockIndent = 0;
  for (const line of lines) {
    const inline = /^(\s*)run:\s*(.*)$/.exec(line);
    if (inline) {
      const body = inline[2] ?? "";
      if (body === "|" || body === ">") {
        inBlock = true;
        blockIndent = (inline[1] ?? "").length;
        continue;
      }
      inBlock = false;
      out.push(body);
      continue;
    }
    if (!inBlock) continue;
    if (line.trim().length === 0) {
      out.push(line);
      continue;
    }
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (indent <= blockIndent) {
      inBlock = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

test("scout workflow is dispatch-only and does not interpolate inputs into the shell", () => {
  expect(yaml).not.toMatch(/^\s*schedule\s*:/m);
  expect(yaml).toMatch(/^permissions:\s*\n\s*contents:\s*read\s*$/m);
  const shell = shellScript(yaml);
  expect(shell).not.toMatch(/\$\{\{/);
  expect(shell).toContain('pnpm scout "$DESTINATIONS" --backend gemini');
  expect(yaml).toMatch(/DESTINATIONS:\s*\$\{\{\s*inputs\.destinations\s*\}\}/);
});
