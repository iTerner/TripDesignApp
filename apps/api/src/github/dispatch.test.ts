import type { FetchLike } from "@wayfare/providers";
import { dispatchScout, GithubDispatchError } from "./dispatch";

const TOKEN = "dispatch-test-token";
const BODY_MARKER = "upstream-body-marker";
const URL =
  "https://api.github.com/repos/iTerner/TripDesignApp/actions/workflows/scout.yml/dispatches";

function captureErrors(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    lines,
    restore() {
      console.error = previous;
    },
  };
}

test("dispatch posts workflow_dispatch for one slug on gemini", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const logs = captureErrors();
  try {
    await dispatchScout({
      token: TOKEN,
      repo: "iTerner/TripDesignApp",
      slug: "tuscany",
      fetchImpl,
    });
  } finally {
    logs.restore();
  }

  expect(calls).toHaveLength(1);
  const call = calls[0];
  expect(call?.url).toBe(URL);
  expect(call?.init?.method).toBe("POST");
  const headers = call?.init?.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(headers.Accept).toBe("application/vnd.github+json");
  expect(JSON.parse(String(call?.init?.body))).toEqual({
    ref: "master",
    inputs: { destinations: "tuscany", backend: "gemini" },
  });
  expect(logs.lines.join("\n")).not.toContain(TOKEN);
});

test("non-204 throws upstream_exhausted without the body or the token", async () => {
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify({ token: TOKEN, detail: BODY_MARKER }), { status: 422 });
  const logs = captureErrors();
  let caught: unknown;
  try {
    await dispatchScout({
      token: TOKEN,
      repo: "iTerner/TripDesignApp",
      slug: "tuscany",
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  } finally {
    logs.restore();
  }

  expect(caught).toBeInstanceOf(GithubDispatchError);
  expect(caught).toMatchObject({ code: "upstream_exhausted", message: "GitHub HTTP 422" });
  const text = `${(caught as Error).message}\n${logs.lines.join("\n")}`;
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(BODY_MARKER);
  expect(logs.lines).toEqual([
    JSON.stringify({ level: "error", message: "GitHub dispatch failed", status: 422 }),
  ]);
});

test("a thrown fetch error is replaced so the token cannot leak", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error(`connect failed for ${TOKEN} ${BODY_MARKER}`);
  };
  const logs = captureErrors();
  let caught: unknown;
  try {
    await dispatchScout({
      token: TOKEN,
      repo: "iTerner/TripDesignApp",
      slug: "tuscany",
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  } finally {
    logs.restore();
  }

  expect(caught).toBeInstanceOf(GithubDispatchError);
  expect(caught).toMatchObject({ code: "upstream_exhausted", message: "GitHub dispatch failed" });
  const text = `${(caught as Error).message}\n${logs.lines.join("\n")}`;
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(BODY_MARKER);
});
