import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            FIREBASE_PROJECT_ID: "test-project",
            ALLOWED_ORIGIN: "https://app.test",
            ADMIN_UIDS: "admin-uid-1,admin-uid-2",
            GEMINI_API_KEY: "g",
            OPENROUTER_API_KEY: "o",
            TAVILY_API_KEY: "t",
            FIREBASE_SERVICE_ACCOUNT: "{}",
            GITHUB_DISPATCH_TOKEN: "dispatch-test-token",
          },
          kvNamespaces: ["CONFIG_KV"],
        },
      },
    },
  },
});
