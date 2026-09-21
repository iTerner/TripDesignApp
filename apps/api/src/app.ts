import type { PingResponse } from "@wayfare/domain";
import type { FetchLike } from "@wayfare/providers";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { firebaseAuth } from "./auth/middleware";
import type { AuthUser } from "./auth/verifyIdToken";
import type { Env } from "./env";
import { apiError } from "./http/errors";
import { lockedCors } from "./middleware/cors";
import { rateLimit } from "./middleware/rateLimit";
import { securityHeaders } from "./middleware/securityHeaders";
import { adminRoutes } from "./routes/admin";

export interface AppDeps {
  /** Injected in tests; defaults to Google's Firebase JWKS. */
  jwks?: JWTVerifyGetKey;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface AppVariables {
  deps: { fetchImpl: FetchLike; now: () => Date; jwks?: JWTVerifyGetKey };
  /** Populated by firebaseAuth; only read behind that middleware. */
  user: AuthUser;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const resolved: AppVariables["deps"] = {
    fetchImpl: deps.fetchImpl ?? ((i, init) => fetch(i, init)),
    now: deps.now ?? (() => new Date()),
    ...(deps.jwks ? { jwks: deps.jwks } : {}),
  };

  app.use("*", async (c, next) => {
    c.set("deps", resolved);
    await next();
  });
  app.use("*", securityHeaders);
  app.use("*", lockedCors);
  app.use("*", rateLimit());

  app.get("/health", (c) => c.json({ ok: true, service: "api" }));

  app.get("/ping", firebaseAuth, (c) => {
    const user = c.get("user");
    const body: PingResponse = {
      ok: true,
      uid: user.uid,
      serverTime: c.get("deps").now().toISOString(),
      firstSeen: false,
    };
    return c.json(body);
  });

  app.route("/admin", adminRoutes);

  app.notFound((c) => apiError(c, 404, "not_found", "Not found"));
  app.onError((err, c) => {
    console.error(JSON.stringify({ level: "error", path: c.req.path, message: err.message }));
    return apiError(c, 500, "internal", "Internal error");
  });
  return app;
}
