import type { PingResponse } from "@wayfare/domain";
import { FirestoreClient, getAccessToken, parseServiceAccount } from "@wayfare/firestore";
import type { FetchLike } from "@wayfare/providers";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { firebaseAuth } from "../auth/middleware";
import type { Env } from "../env";

export function firestoreFor(env: Env, fetchImpl: FetchLike, now: () => Date): FirestoreClient {
  // Emulator mode (dev.bat only): plain http to the emulator, fixed "owner" bearer, no service account.
  if (env.FIRESTORE_EMULATOR_HOST) {
    return new FirestoreClient({
      projectId: env.FIREBASE_PROJECT_ID,
      fetchImpl,
      host: `http://${env.FIRESTORE_EMULATOR_HOST}`,
      tokenProvider: async () => "owner",
    });
  }
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  return new FirestoreClient({
    projectId: env.FIREBASE_PROJECT_ID,
    fetchImpl,
    tokenProvider: () => getAccessToken(sa, env.CONFIG_KV, fetchImpl, now()),
  });
}

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export const pingRoutes = new Hono<AppEnv>();

pingRoutes.get("/", firebaseAuth, async (c) => {
  const { fetchImpl, now } = c.get("deps");
  const user = c.get("user");
  const db = firestoreFor(c.env, fetchImpl, now);
  const today = utcDay(now());
  const userPath = `users/${user.uid}`;
  const existing = await db.getDocument(userPath);
  let firstSeen = false;
  if (!existing) {
    firstSeen = true;
    await db.patchDocument(userPath, {
      createdAt: now().toISOString(),
      lastActiveDate: today,
      tier: "free",
      tierSource: "none",
      freeGenerationUsed: false,
      plusRequested: false,
      locale: "en",
    });
    await db.incrementFields("metrics/global", { totalUsers: 1 });
    await db.incrementFields(`metricsDaily/${today}`, { newUsers: 1, activeUsers: 1 });
  } else if (existing.lastActiveDate !== today) {
    await db.patchDocument(
      userPath,
      { lastActiveDate: today },
      { updateMask: ["lastActiveDate"], mustExist: true },
    );
    await db.incrementFields(`metricsDaily/${today}`, { activeUsers: 1 });
  }
  const body: PingResponse = {
    ok: true,
    uid: user.uid,
    serverTime: now().toISOString(),
    firstSeen,
  };
  return c.json(body);
});
