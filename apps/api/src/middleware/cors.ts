import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../env";

/** Exactly one allowed origin (spec §8). Other origins get no CORS headers at all. */
export const lockedCors: MiddlewareHandler<{ Bindings: Env }> = (c, next) =>
  cors({
    origin: (origin) => (origin === c.env.ALLOWED_ORIGIN ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["authorization", "content-type"],
    maxAge: 600,
  })(c, next);
