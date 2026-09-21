import { z } from "zod";
import { type ApiClientError, apiFetch } from "../lib/api";

const schema = z.object({ ok: z.literal(true), uid: z.string() });

test("attaches bearer token and parses with the schema", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ ok: true, uid: "u" }), { status: 200 });
  });
  const r = await apiFetch("/ping", schema, { token: "T" });
  expect(r.uid).toBe("u");
  expect(new Headers(calls[0]?.headers).get("authorization")).toBe("Bearer T");
});

test("non-2xx becomes ApiClientError with the server code", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "unauthorized", message: "Missing" }), { status: 401 }),
  );
  await expect(apiFetch("/ping", schema)).rejects.toMatchObject({
    code: "unauthorized",
    status: 401,
  } satisfies Partial<ApiClientError>);
});
