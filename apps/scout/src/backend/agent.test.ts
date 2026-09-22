import { createHash } from "node:crypto";
import { type readFileSync as ReadFile, readFileSync, type writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AreasRequest,
  PacketRejectionSchema,
  PacketRequestFileSchema,
  packetJsonSchema,
} from "@wayfare/domain";
import { agentProvenance, createAgentBackend } from "./agent";
import { AwaitingPackets, PacketValidationError, PathRefused, RejectionsExceeded } from "./types";

const areasReq: AreasRequest = {
  destination: { slug: "tuscany", name: "Tuscany", kind: "region" },
  bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
  hints: [],
  minAreas: 2,
  maxAreas: 16,
};

const areasBody = {
  areas: [
    { name: "Florence", lat: 43.77, lng: 11.25, why: "Renaissance capital", kind: "town" as const },
    { name: "Siena", lat: 43.32, lng: 11.33, why: "Medieval hill town", kind: "town" as const },
  ],
};

const promptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/domain/prompts/scout",
);

const SECRET = /AIza|sk-or-|tvly-|private_key|GEMINI_API_KEY/;

function memoryFs() {
  const files = new Map<string, string>();
  const readFile = ((path: string) => {
    const hit = files.get(String(path));
    if (hit === undefined) {
      const err = new Error(`ENOENT: ${String(path)}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return hit;
  }) as typeof ReadFile;
  const writeFile = ((path: string, data: string) => {
    files.set(String(path), String(data));
  }) as typeof writeFileSync;
  return { files, readFile, writeFile };
}

function backendAt(dir: string) {
  const fs = memoryFs();
  const backend = createAgentBackend({
    packetsDir: dir,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
  });
  return { ...fs, backend, dir };
}

test("prompt files state the packet rules", () => {
  const areas = readFileSync(join(promptsDir, "areas.md"), "utf8");
  const trends = readFileSync(join(promptsDir, "trends.md"), "utf8");
  const enrich = readFileSync(join(promptsDir, "enrich.md"), "utf8");
  const stays = readFileSync(join(promptsDir, "stays.md"), "utf8");
  expect(areas).toMatch(/8/);
  expect(areas).toMatch(/16/);
  expect(areas.toLowerCase()).toContain("bbox");
  expect(trends.toLowerCase()).toContain("verbatim");
  expect(trends).toContain("sourceUrl");
  expect(trends.toLowerCase()).toContain("empty");
  expect(trends.toLowerCase()).toContain("findings");
  expect(trends.toLowerCase()).toContain("coordinates");
  expect(enrich.toLowerCase()).toContain("echo");
  expect(enrich.toLowerCase()).toContain("taxonomy");
  expect(enrich.toLowerCase()).toContain("dwell");
  expect(enrich.toLowerCase()).toContain("local");
  expect(stays).toMatch(/1[–-]4/);
  expect(stays).toMatch(/1[–-]5/);
  for (const text of [areas, trends, enrich, stays]) {
    expect(text.length).toBeGreaterThan(400);
    expect(text).not.toMatch(SECRET);
  }
});

test("agent listAreas returns the parsed response body", async () => {
  const dir = "work/tuscany/packets";
  const { files, backend } = backendAt(dir);
  files.set(join(dir, "areas-1.response.json"), JSON.stringify(areasBody));
  await expect(backend.listAreas(areasReq)).resolves.toEqual(areasBody);
  expect(backend.id).toBe("agent");
  const requestRaw = files.get(join(dir, "areas-1.request.json"));
  expect(requestRaw).toBeDefined();
  const request = PacketRequestFileSchema.parse(JSON.parse(requestRaw ?? ""));
  expect(request).toMatchObject({
    packetId: "areas-1",
    type: "areas",
    attempt: 1,
    payload: areasReq,
  });
  expect(request.instructions).toBe(readFileSync(join(promptsDir, "areas.md"), "utf8"));
  expect(request.schema).toEqual(packetJsonSchema("areas"));
});

test("a schema failure lists reasons and writes rejected.json with one attempt", async () => {
  const dir = "work/tuscany/packets";
  const { files, backend } = backendAt(dir);
  const responsePath = join(dir, "areas-1.response.json");
  const rejectedPath = join(dir, "areas-1.rejected.json");
  const bad = JSON.stringify({ areas: "nope" });
  files.set(responsePath, bad);
  try {
    await backend.listAreas(areasReq);
    expect.fail("expected a validation error");
  } catch (err) {
    expect(err).toBeInstanceOf(PacketValidationError);
    if (err instanceof PacketValidationError) {
      expect(err.reasons.length).toBeGreaterThan(0);
      expect(err.reasons.some((r) => r.path === "areas")).toBe(true);
      expect(err.message).toContain(err.reasons[0]?.reason);
    }
  }
  const rejected = PacketRejectionSchema.parse(JSON.parse(files.get(rejectedPath) ?? ""));
  expect(rejected.packetId).toBe("areas-1");
  expect(rejected.attempts).toHaveLength(1);
  expect(rejected.attempts[0]?.responseSha1).toBe(
    createHash("sha1").update(bad, "utf8").digest("hex"),
  );
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(PacketValidationError);
  const again = PacketRejectionSchema.parse(JSON.parse(files.get(rejectedPath) ?? ""));
  expect(again.attempts).toHaveLength(1);
});

test("three failed attempts throw RejectionsExceeded", async () => {
  const dir = "work/tuscany/packets";
  const { files, backend } = backendAt(dir);
  const responsePath = join(dir, "areas-1.response.json");
  const rejectedPath = join(dir, "areas-1.rejected.json");
  const bads = [{ areas: "nope" }, { areas: [] }, { areas: [{ bad: true }] }];
  files.set(responsePath, JSON.stringify(bads[0]));
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(PacketValidationError);
  files.set(responsePath, JSON.stringify(bads[1]));
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(PacketValidationError);
  files.set(responsePath, JSON.stringify(bads[2]));
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(RejectionsExceeded);
  const rejected = PacketRejectionSchema.parse(JSON.parse(files.get(rejectedPath) ?? ""));
  expect(rejected.attempts).toHaveLength(3);
});

test("a missing response throws AwaitingPackets and the request file has no secrets", async () => {
  const dir = "work/tuscany/packets";
  const { files, backend } = backendAt(dir);
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(AwaitingPackets);
  const raw = files.get(join(dir, "areas-1.request.json"));
  expect(raw).toBeDefined();
  const parsed = PacketRequestFileSchema.parse(JSON.parse(raw ?? ""));
  expect(JSON.stringify(parsed)).not.toMatch(SECRET);
  expect(raw ?? "").not.toMatch(SECRET);
});

test("a response path containing .. is refused before read", async () => {
  const readFile = vi.fn(() => {
    throw new Error("readFile should not be called");
  });
  const writeFile = vi.fn();
  const backend = createAgentBackend({
    packetsDir: "work/../secrets",
    readFile: readFile as typeof ReadFile,
    writeFile: writeFile as typeof writeFileSync,
  });
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(PathRefused);
  expect(readFile).not.toHaveBeenCalled();
});

test("agentProvenance records the cursor agent and the packet id", () => {
  expect(agentProvenance("trends-7")).toEqual({
    backend: "agent",
    model: "cursor-agent",
    packetIds: ["trends-7"],
  });
});
