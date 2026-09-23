import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { aiResponseSchema } from "./explanations";
import { explanationSystemPrompt } from "./prompts";
import type { SearchInput } from "./search";
import type { Contractor } from "./types";

type AIRequestResult = {
  rawOutput: unknown;
  attempts: number;
  retried: boolean;
  elapsedMs: number;
};

export async function requestExplanations(
  top3: readonly Contractor[],
  input: SearchInput,
): Promise<AIRequestResult> {
  const start = performance.now();
  const deadline = start + 7000;
  let attempts = 0;
  const result = (rawOutput: unknown = null): AIRequestResult => ({
    rawOutput, attempts, retried: attempts > 1, elapsedMs: Math.round(performance.now() - start),
  });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model || !top3.length || top3.length > 3) return result();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 7000 });
    const payload = {
      request: {
        eventType: input.eventType, category: input.category, budgetKzt: input.budgetKzt,
        durationHours: input.durationHours ?? null, language: input.language ?? null,
      },
      contractors: top3.map(({ id, anon_name, price_from_kzt, event_formats, languages, max_hours, description }) => ({
        id, anon_name, price_from_kzt, event_formats, languages, max_hours, description,
      })),
    };
    const format = zodTextFormat(aiResponseSchema, "contractor_explanations");
    while (attempts < 2 && !controller.signal.aborted) {
      const remaining = deadline - performance.now();
      if (remaining <= 0 || (attempts > 0 && remaining <= 3000)) break;
      attempts++;
      try {
        const response = await client.responses.parse({
          model,
          store: false,
          input: [
            { role: "system", content: explanationSystemPrompt },
            { role: "user", content: JSON.stringify(payload) },
          ],
          text: { format },
          max_output_tokens: 1800,
        }, { signal: controller.signal, timeout: Math.ceil(remaining), maxRetries: 0 });
        if (controller.signal.aborted || performance.now() >= deadline) break;
        if (response.status === "completed" && response.output_parsed !== null) {
          return result(response.output_parsed);
        }
      } catch {
        // Never expose SDK errors or credentials; retry uses the same deadline and signal.
        if (controller.signal.aborted) break;
      }
    }
    return result();
  } catch {
    return result();
  } finally {
    clearTimeout(timer);
  }
}
