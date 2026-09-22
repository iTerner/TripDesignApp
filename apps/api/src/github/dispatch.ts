import type { FetchLike } from "@wayfare/providers";

const WORKFLOW = "scout.yml";

/** GitHub dispatch failed. `message` is a status line only — never the response body or the token. */
export class GithubDispatchError extends Error {
  readonly code = "upstream_exhausted" as const;

  constructor(message: string) {
    super(message);
    this.name = "GithubDispatchError";
  }
}

function logDispatchFailure(status?: number): void {
  const payload: { level: "error"; message: string; status?: number } = {
    level: "error",
    message: "GitHub dispatch failed",
  };
  if (status !== undefined) payload.status = status;
  console.error(JSON.stringify(payload));
}

export async function dispatchScout(opts: {
  token: string;
  repo: "iTerner/TripDesignApp";
  slug: string;
  fetchImpl: FetchLike;
}): Promise<void> {
  const token = opts.token.trim();
  if (token === "") {
    logDispatchFailure();
    throw new GithubDispatchError("GitHub dispatch is not configured");
  }

  const url = `https://api.github.com/repos/${opts.repo}/actions/workflows/${WORKFLOW}/dispatches`;
  let res: Response;
  try {
    res = await opts.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "wayfare-api",
      },
      body: JSON.stringify({
        ref: "master",
        inputs: { destinations: opts.slug, backend: "gemini" },
      }),
    });
  } catch {
    logDispatchFailure();
    throw new GithubDispatchError("GitHub dispatch failed");
  }

  if (res.status !== 204) {
    const status = res.status;
    try {
      await res.body?.cancel();
    } catch {
      // The body is discarded. It must not be copied into the error or the log.
    }
    logDispatchFailure(status);
    throw new GithubDispatchError(`GitHub HTTP ${status}`);
  }
}
