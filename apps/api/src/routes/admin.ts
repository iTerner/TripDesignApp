import type { AdminPingResponse, LlmPingResponse } from "@wayfare/domain";
import { LlmError } from "@wayfare/providers";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAdmin } from "../auth/admin";
import { firebaseAuth } from "../auth/middleware";
import { apiError } from "../http/errors";
import { createRouter } from "../llm/routerFactory";
import { firestoreFor } from "./ping";

export const adminRoutes = new Hono<AppEnv>();
// Guard first, for every method and path under /admin — unknown admin paths return 403 to non-admins, not 404.
adminRoutes.use("*", firebaseAuth, requireAdmin());

adminRoutes.get("/ping", (c) => {
  const user = c.get("user");
  const authAgeSec = Math.max(0, Math.floor(c.get("deps").now().getTime() / 1000) - user.authTime);
  const body: AdminPingResponse = { ok: true, uid: user.uid, authAgeSec };
  return c.json(body);
});

adminRoutes.post("/echo", (c) => c.json({ ok: true }));

adminRoutes.post("/llm/ping", async (c) => {
  const deps = c.get("deps");
  const db = firestoreFor(c.env, deps.fetchImpl, deps.now);
  const router = createRouter(c.env, deps, db);
  try {
    const r = await router.run("best", {
      prompt: 'Return exactly this JSON: {"ok":true}',
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      maxOutputTokens: 32,
    });
    const body: LlmPingResponse = {
      ok: true,
      modelUsed: r.modelId,
      provider: r.provider,
      attempts: r.attempts.map((a) => ({ modelId: a.modelId, outcome: a.outcome })),
      text: r.text,
    };
    return c.json(body);
  } catch (e) {
    if (e instanceof LlmError) return apiError(c, 503, "upstream_exhausted", e.message);
    throw e;
  }
});
