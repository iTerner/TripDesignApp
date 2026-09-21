import type { AdminPingResponse } from "@wayfare/domain";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAdmin } from "../auth/admin";
import { firebaseAuth } from "../auth/middleware";

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
