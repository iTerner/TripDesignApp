import { z } from "zod";
import { PACKET_SCHEMAS, type PacketType } from "./packets";

/** JSON Schema (draft 2020-12, `$schema` removed) of a packet's response, for prompts and packets. */
export function packetJsonSchema(type: PacketType): Record<string, unknown> {
  const schema = z.toJSONSchema(PACKET_SCHEMAS[type].response, { target: "draft-2020-12" });
  const { $schema: _omit, ...rest } = schema as Record<string, unknown>;
  return rest;
}
