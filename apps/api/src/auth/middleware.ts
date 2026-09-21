import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";
import { AuthError, firebaseJwks, verifyIdToken } from "./verifyIdToken";

export const firebaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(c, 401, "unauthorized", "Missing bearer token");
  const deps = c.get("deps");
  try {
    const emulator = Boolean(c.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (emulator) {
      console.warn(
        JSON.stringify({ level: "warn", message: "AUTH EMULATOR MODE: accepting unsigned tokens" }),
      );
    }
    const user = await verifyIdToken(
      token,
      c.env.FIREBASE_PROJECT_ID,
      deps.jwks ?? firebaseJwks(),
      deps.now(),
      { emulator },
    );
    c.set("user", user);
  } catch (e) {
    return apiError(c, 401, "unauthorized", e instanceof AuthError ? e.message : "Invalid token");
  }
  await next();
};
