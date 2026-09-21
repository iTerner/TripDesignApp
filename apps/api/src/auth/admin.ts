import { ApiErrorCode, DEFAULT_CONFIG } from "@wayfare/domain";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";

export function parseAdminUids(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Spec §8 locks #2/#3: UID must be in the ADMIN_UIDS secret; state-changing
 * requests need a sign-in newer than freshAuthMaxAgeSec (default 15 min).
 */
export function requireAdmin(
  opts: { freshAuthMaxAgeSec?: number } = {},
): MiddlewareHandler<AppEnv> {
  const maxAge = opts.freshAuthMaxAgeSec ?? DEFAULT_CONFIG.admin.freshAuthMaxAgeSec;
  return async (c, next) => {
    const user = c.get("user");
    if (!parseAdminUids(c.env.ADMIN_UIDS).has(user.uid)) {
      return apiError(c, 403, "forbidden", "Admin only");
    }
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const ageSec = Math.floor(c.get("deps").now().getTime() / 1000) - user.authTime;
      if (ageSec > maxAge) {
        return apiError(
          c,
          401,
          ApiErrorCode.enum.reauth_required,
          "Please sign in again to perform admin changes",
        );
      }
    }
    await next();
  };
}
