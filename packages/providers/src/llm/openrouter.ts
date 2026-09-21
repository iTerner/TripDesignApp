import { z } from "zod";
import { classifyHttpError } from "./classify";
import {
  type FetchLike,
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
} from "./types";

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
  model: z.string().optional(),
});

export class OpenRouterProvider implements LlmProvider {
  readonly id = "openrouter" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly referer = "https://tripdesignapp.web.app",
  ) {}

  async complete(modelId: string, req: LlmRequest): Promise<LlmResult> {
    const messages: { role: "system" | "user"; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 2048,
      ...(req.jsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "response", strict: true, schema: req.jsonSchema },
            },
          }
        : {}),
    };
    const res = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "http-referer": this.referer,
        "x-title": "Wayfare",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw classifyHttpError(
        "openrouter",
        res.status,
        await res.text(),
        res.headers.get("retry-after"),
      );
    }
    const parsed = ChatResponse.safeParse(await res.json());
    const text = parsed.success ? parsed.data.choices[0]?.message.content : null;
    if (!text) throw new LlmError("other", "OpenRouter returned no content", res.status);
    return {
      text,
      modelId: parsed.success && parsed.data.model ? parsed.data.model : modelId,
      provider: "openrouter",
    };
  }
}
