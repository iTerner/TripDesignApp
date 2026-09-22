import { createHash } from "node:crypto";
import type { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AreasRequest,
  type AreasResponse,
  DEFAULT_SCOUT_CONFIG,
  type EnrichRequest,
  type EnrichResponse,
  type PacketRejection,
  PacketRejectionSchema,
  PacketRequestFileSchema,
  type PacketType,
  packetJsonSchema,
  type RejectionReason,
  type StaysRequest,
  type StaysResponse,
  type TrendsRequest,
  type TrendsResponse,
  validatePacketResponse,
} from "@wayfare/domain";
import {
  AwaitingPackets,
  type IntelligenceBackend,
  PacketValidationError,
  PathRefused,
  RejectionsExceeded,
  readScoutPrompt,
} from "./types";

export interface AgentBackendOpts {
  packetsDir: string;
  readFile: typeof readFileSync;
  writeFile: typeof writeFileSync;
}

export function agentProvenance(packetId: string): {
  backend: "agent";
  model: "cursor-agent";
  packetIds: string[];
} {
  return { backend: "agent", model: "cursor-agent", packetIds: [packetId] };
}

export function createAgentBackend(opts: AgentBackendOpts): IntelligenceBackend {
  async function exchange<T>(type: PacketType, request: unknown): Promise<T> {
    if (opts.packetsDir.split(/[/\\]/).includes("..")) {
      throw new PathRefused(join(opts.packetsDir, `${type}-1.response.json`));
    }
    const packetId = locate(opts, type, request);
    const responsePath = join(opts.packetsDir, `${packetId}.response.json`);
    if (responsePath.split(/[/\\]/).includes("..")) throw new PathRefused(responsePath);
    const text = readOptional(opts, responsePath);
    if (text === undefined) throw new AwaitingPackets(packetId);
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      reject(opts, packetId, text, [{ path: "", reason: "invalid JSON" }]);
    }
    const validated = validatePacketResponse(type, request, raw);
    if (!validated.ok) reject(opts, packetId, text, validated.reasons);
    return validated.data as T;
  }

  return {
    id: "agent",
    listAreas: (req: AreasRequest) => exchange<AreasResponse>("areas", req),
    extractTrends: (req: TrendsRequest) => exchange<TrendsResponse>("trends", req),
    enrichBatch: (req: EnrichRequest) => exchange<EnrichResponse>("enrich", req),
    suggestStays: (req: StaysRequest) => exchange<StaysResponse>("stays", req),
  };
}

function locate(opts: AgentBackendOpts, type: PacketType, request: unknown): string {
  for (let n = 1; n <= 9999; n += 1) {
    const packetId = `${type}-${n}`;
    const requestPath = join(opts.packetsDir, `${packetId}.request.json`);
    const existing = readOptional(opts, requestPath);
    if (existing === undefined) {
      writeRequest(opts, packetId, type, request, requestPath);
      return packetId;
    }
    const parsed = PacketRequestFileSchema.parse(JSON.parse(existing));
    if (JSON.stringify(parsed.payload) === JSON.stringify(request)) return packetId;
  }
  throw new Error(`no free ${type} packet id`);
}

function writeRequest(
  opts: AgentBackendOpts,
  packetId: string,
  type: PacketType,
  request: unknown,
  requestPath: string,
): void {
  const rejectedRaw = readOptional(opts, join(opts.packetsDir, `${packetId}.rejected.json`));
  const prior =
    rejectedRaw === undefined
      ? 0
      : PacketRejectionSchema.parse(JSON.parse(rejectedRaw)).attempts.length;
  const file = PacketRequestFileSchema.parse({
    packetId,
    type,
    attempt: prior + 1,
    instructions: readScoutPrompt(type),
    schema: packetJsonSchema(type),
    payload: request,
  });
  opts.writeFile(requestPath, `${JSON.stringify(file, null, 2)}\n`);
}

function reject(
  opts: AgentBackendOpts,
  packetId: string,
  responseText: string,
  reasons: RejectionReason[],
): never {
  const path = join(opts.packetsDir, `${packetId}.rejected.json`);
  const sha = createHash("sha1").update(responseText, "utf8").digest("hex");
  const existing = readOptional(opts, path);
  const rejection: PacketRejection =
    existing === undefined
      ? { packetId, attempts: [] }
      : PacketRejectionSchema.parse(JSON.parse(existing));
  if (!rejection.attempts.some((a) => a.responseSha1 === sha)) {
    rejection.attempts.push({
      attempt: rejection.attempts.length + 1,
      at: new Date().toISOString(),
      responseSha1: sha,
      reasons,
    });
    opts.writeFile(path, `${JSON.stringify(rejection, null, 2)}\n`);
  }
  if (rejection.attempts.length >= DEFAULT_SCOUT_CONFIG.maxRejectionsPerPacket) {
    throw new RejectionsExceeded(packetId, reasons);
  }
  throw new PacketValidationError(packetId, reasons);
}

function readOptional(opts: AgentBackendOpts, path: string): string | undefined {
  try {
    return opts.readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
