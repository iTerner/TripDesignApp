import {
  type AccessTokenCache,
  FirestoreClient,
  getAccessTokenCached,
  parseServiceAccount,
  type ServiceAccount,
} from "@wayfare/firestore";
import type { FetchLike } from "@wayfare/providers";
import { ScoutError } from "./quota";

const fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Live Firestore client. Callers must not construct this on `--dry-run`. */
export function openScoutFirestore(env: NodeJS.ProcessEnv = process.env): FirestoreClient {
  const emulator = env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
  if (emulator.length > 0) {
    const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
    if (projectId.length === 0) {
      throw new ScoutError("refused: FIREBASE_PROJECT_ID is not set", 2);
    }
    const host =
      emulator.startsWith("http://") || emulator.startsWith("https://")
        ? emulator
        : `http://${emulator}`;
    return new FirestoreClient({
      projectId,
      host,
      fetchImpl,
      tokenProvider: async () => "owner",
    });
  }
  const raw = env.FIREBASE_SERVICE_ACCOUNT?.trim() ?? "";
  if (raw.length === 0) {
    throw new ScoutError("refused: FIREBASE_SERVICE_ACCOUNT is not set", 2);
  }
  const account = accountFrom(raw, env.FIREBASE_PROJECT_ID);
  const store = new Map<string, string>();
  const cache: AccessTokenCache = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
  return new FirestoreClient({
    projectId: account.projectId,
    fetchImpl,
    tokenProvider: () => getAccessTokenCached(account.sa, cache, fetchImpl, new Date()),
  });
}

function accountFrom(
  raw: string,
  projectFromEnv: string | undefined,
): { sa: ServiceAccount; projectId: string } {
  let sa: ServiceAccount;
  try {
    sa = parseServiceAccount(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("FIREBASE_SERVICE_ACCOUNT is missing")) {
      throw new ScoutError(`refused: ${message}`, 2);
    }
    throw new ScoutError("refused: FIREBASE_SERVICE_ACCOUNT is not valid JSON", 2);
  }
  let projectId = projectFromEnv?.trim() ?? "";
  if (projectId.length === 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && "project_id" in parsed) {
        const value = (parsed as { project_id?: unknown }).project_id;
        if (typeof value === "string") projectId = value.trim();
      }
    } catch {
      throw new ScoutError("refused: FIREBASE_SERVICE_ACCOUNT is not valid JSON", 2);
    }
  }
  if (projectId.length === 0) {
    throw new ScoutError("refused: FIREBASE_SERVICE_ACCOUNT is missing project_id", 2);
  }
  return { sa, projectId };
}
