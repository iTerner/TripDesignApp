import { join } from "node:path";

const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WorkLayout {
  root: string;
  stageFile(n: number, name: string): string;
  packetsDir: string;
  outDir: string;
}

export function assertSafeSlug(slug: string): string {
  if (!SAFE_NAME.test(slug)) {
    throw new Error(`refused: unsafe slug "${slug}"`);
  }
  return slug;
}

export function openWork(repoRoot: string, slug: string): WorkLayout {
  const safe = assertSafeSlug(slug);
  const root = join(repoRoot, "work", safe);
  return {
    root,
    stageFile(n: number, name: string): string {
      return join(root, stageFileName(n, name));
    },
    packetsDir: join(root, "packets"),
    outDir: join(root, "out"),
  };
}

function stageFileName(n: number, name: string): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`refused: stage ${n}`);
  }
  if (!SAFE_NAME.test(name)) {
    throw new Error(`refused: stage name "${name}"`);
  }
  return `${String(n).padStart(2, "0")}-${name}.json`;
}
