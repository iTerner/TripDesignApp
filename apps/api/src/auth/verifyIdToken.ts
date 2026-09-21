import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify, UnsecuredJWT } from "jose";

export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  /** Seconds since epoch of the user's last sign-in (Firebase `auth_time`). */
  authTime: number;
}

export type AuthErrorCode = "invalid" | "email_unverified";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let cached: JWTVerifyGetKey | undefined;

export function firebaseJwks(): JWTVerifyGetKey {
  cached ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), {
    cooldownDuration: 30_000,
    cacheMaxAge: 6 * 60 * 60 * 1000,
  });
  return cached;
}

export interface VerifyOptions {
  /**
   * Dev only. When true, accept the Auth emulator's unsigned (`alg: "none"`) tokens
   * but still enforce iss/aud/exp/sub/email_verified. The Worker sets this solely
   * from `env.FIREBASE_AUTH_EMULATOR_HOST`, which dev.bat passes via `wrangler dev --var`
   * and which is never defined in production.
   */
  emulator?: boolean;
}

function headerAlg(token: string): string | undefined {
  const encoded = token.split(".")[0];
  if (!encoded) return undefined;
  try {
    const parsed: unknown = JSON.parse(atob(encoded));
    if (typeof parsed !== "object" || parsed === null || !("alg" in parsed)) return undefined;
    return typeof parsed.alg === "string" ? parsed.alg : undefined;
  } catch {
    return undefined;
  }
}

/** Spec §8: RS256, iss, aud, exp, sub non-empty, email_verified === true. */
export async function verifyIdToken(
  token: string,
  projectId: string,
  getKey: JWTVerifyGetKey,
  now: Date,
  opts: VerifyOptions = {},
): Promise<AuthUser> {
  let payload: Record<string, unknown>;
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  try {
    if (opts.emulator && headerAlg(token) === "none") {
      const { payload: p } = UnsecuredJWT.decode(token, {
        issuer: expectedIss,
        audience: projectId,
        currentDate: now,
      });
      payload = p as Record<string, unknown>;
    } else {
      const res = await jwtVerify(token, getKey, {
        algorithms: ["RS256"],
        issuer: expectedIss,
        audience: projectId,
        currentDate: now,
      });
      payload = res.payload as Record<string, unknown>;
    }
  } catch (e) {
    throw new AuthError("invalid", `Token verification failed: ${(e as Error).message}`);
  }
  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) throw new AuthError("invalid", "Token has no subject");
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : 0;
  if (!authTime || authTime > Math.floor(now.getTime() / 1000) + 60) {
    throw new AuthError("invalid", "Invalid auth_time");
  }
  if (payload.email_verified !== true)
    throw new AuthError("email_unverified", "Email not verified");
  const email = typeof payload.email === "string" ? payload.email : undefined;
  return { uid, ...(email ? { email } : {}), emailVerified: true, authTime };
}
