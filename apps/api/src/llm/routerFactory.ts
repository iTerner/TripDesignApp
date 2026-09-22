import { DEFAULT_REGISTRY } from "@wayfare/domain";
import type { FirestoreClient } from "@wayfare/firestore";
import { GeminiProvider, ModelRouter, OpenRouterProvider } from "@wayfare/providers";
import type { AppVariables } from "../app";
import type { Env } from "../env";
import { FirestoreQuotaStore } from "../firestore/quotaStore";

export function createRouter(
  env: Env,
  deps: AppVariables["deps"],
  db: FirestoreClient,
): ModelRouter {
  return new ModelRouter({
    registry: DEFAULT_REGISTRY,
    providers: {
      google: new GeminiProvider(env.GEMINI_API_KEY, deps.fetchImpl),
      openrouter: new OpenRouterProvider(
        env.OPENROUTER_API_KEY,
        deps.fetchImpl,
        env.ALLOWED_ORIGIN,
      ),
    },
    quota: new FirestoreQuotaStore({ db, kv: env.CONFIG_KV }),
    now: deps.now,
  });
}
