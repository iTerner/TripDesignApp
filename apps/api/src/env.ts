export interface Env {
  CONFIG_KV: KVNamespace;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  /** Comma-separated Firebase UIDs. Worker secret. */
  ADMIN_UIDS: string;
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
  TAVILY_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  /** Set ONLY by dev.bat via `wrangler dev --var`; when present, tokens from the Auth emulator are accepted (Task 7). Never set in production. */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Set ONLY by dev.bat; Firestore REST calls go to the emulator (Task 9). */
  FIRESTORE_EMULATOR_HOST?: string;
}
