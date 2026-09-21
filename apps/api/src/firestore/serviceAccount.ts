import type { FetchLike } from "@wayfare/providers";
import { importPKCS8, SignJWT } from "jose";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const KV_KEY = "sa_access_token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

export function parseServiceAccount(raw: string): ServiceAccount {
  const obj = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!obj.client_email || !obj.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key");
  }
  return { client_email: obj.client_email, private_key: obj.private_key };
}

/** Mints (and KV-caches) an OAuth2 access token for the Firestore REST API. One KV write per ~55 minutes. */
export async function getAccessToken(
  sa: ServiceAccount,
  kv: KVNamespace,
  fetchImpl: FetchLike,
  now: Date,
): Promise<string> {
  const cached = await kv.get(KV_KEY);
  if (cached) return cached;
  const key = await importPKCS8(sa.private_key, "RS256");
  const iat = Math.floor(now.getTime() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Service account token exchange failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await kv.put(KV_KEY, json.access_token, {
    expirationTtl: Math.min(3300, Math.max(60, json.expires_in - 300)),
  });
  return json.access_token;
}
