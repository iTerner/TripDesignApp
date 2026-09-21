import { z } from "zod";
import { classifyHttpError } from "./classify";
import {
  type FetchLike,
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
} from "./types";

const GeminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
      }),
    )
    .optional(),
});

export class GeminiProvider implements LlmProvider {
  readonly id = "google" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async complete(modelId: string, req: LlmRequest): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        ...(req.jsonSchema
          ? { responseMimeType: "application/json", responseSchema: req.jsonSchema }
          : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

    const res = await this.fetchImpl(`${this.baseUrl}/models/${modelId}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw classifyHttpError(
        "google",
        res.status,
        await res.text(),
        res.headers.get("retry-after"),
      );
    }
    const parsed = GeminiResponse.safeParse(await res.json());
    const text = parsed.success
      ? parsed.data.candidates?.[0]?.content?.parts.map((p) => p.text ?? "").join("")
      : undefined;
    if (!text) throw new LlmError("other", "Gemini returned no text candidate", res.status);
    return { text, modelId, provider: "google" };
  }
}
