import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../../apps/web/dist");
const out = join(here, "public");
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });
console.log("copied apps/web/dist -> infra/firebase/public");
