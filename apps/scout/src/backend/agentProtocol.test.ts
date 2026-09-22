import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AreasRequest,
  type AreasResponse,
  PacketRejectionSchema,
  PacketRequestFileSchema,
  packetJsonSchema,
} from "@wayfare/domain";
import { createAgentBackend } from "./agent";
import { PacketValidationError } from "./types";

const areasReq: AreasRequest = {
  destination: { slug: "tuscany", name: "Tuscany", kind: "region" },
  bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
  hints: [],
  minAreas: 1,
  maxAreas: 16,
};

const corrected: AreasResponse = {
  areas: [
    {
      name: "Florence",
      lat: 43.77,
      lng: 11.25,
      why: "Renaissance capital",
      kind: "town",
    },
  ],
};

test("agent protocol rejects a response missing why, then accepts the correction", async () => {
  const packetsDir = mkdtempSync(join(tmpdir(), "scout-packets-"));
  try {
    const requestFile = PacketRequestFileSchema.parse({
      packetId: "areas-1",
      type: "areas",
      attempt: 1,
      instructions: "Name areas inside the bbox. Every area needs a why.",
      schema: packetJsonSchema("areas"),
      payload: areasReq,
    });
    const requestPath = join(packetsDir, "areas-1.request.json");
    writeFileSync(requestPath, `${JSON.stringify(requestFile, null, 2)}\n`);

    const missingWhy = {
      areas: [{ name: "Florence", lat: 43.77, lng: 11.25, kind: "town" as const }],
    };
    const responsePath = join(packetsDir, "areas-1.response.json");
    writeFileSync(responsePath, `${JSON.stringify(missingWhy)}\n`);

    const backend = createAgentBackend({
      packetsDir,
      readFile: readFileSync,
      writeFile: writeFileSync,
    });

    await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(PacketValidationError);

    const rejectedPath = join(packetsDir, "areas-1.rejected.json");
    const rejection = PacketRejectionSchema.parse(JSON.parse(readFileSync(rejectedPath, "utf8")));
    expect(rejection.packetId).toBe("areas-1");
    expect(rejection.attempts).toHaveLength(1);
    expect(rejection.attempts[0]?.reasons.some((reason) => reason.path.includes("why"))).toBe(true);

    writeFileSync(responsePath, `${JSON.stringify(corrected)}\n`);
    await expect(backend.listAreas(areasReq)).resolves.toEqual(corrected);

    const requestRaw = readFileSync(requestPath, "utf8");
    expect(requestRaw).not.toContain("GEMINI_API_KEY");
    expect(requestRaw).not.toContain("AIza");
  } finally {
    rmSync(packetsDir, { recursive: true, force: true });
  }
});
