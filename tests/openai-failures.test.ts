import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/recommend/route";
import { loadContractors } from "../lib/catalog";
import { matchContractors } from "../lib/match";
import type { SearchInput } from "../lib/search";

const input: SearchInput = {
  city: "Астана", date: "2026-09-23", eventType: "свадьба", category: "Ведущий",
  budgetKzt: 1_000_000, durationHours: 8, language: "казахский",
};
const baseline = matchContractors(loadContractors(), input);

function credentials(t: TestContext, key?: string, model?: string) {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;
  if (key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = key;
  if (model === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = model;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  });
}

async function fallbackResponse() {
  const response = await POST(new Request("http://localhost/api/recommend", {
    method: "POST", body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), baseline);
  assert.equal(response.headers.get("X-AI-Verified"), "0");
  return response;
}

test("missing API key or model uses fallback without any network request", async (t) => {
  credentials(t);
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network"); });
  for (const [key, model] of [[undefined, "test-model"], ["test-only-not-a-real-key", undefined]]) {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
    assert.equal((await fallbackResponse()).headers.get("X-AI-Attempts"), "0");
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("offline SDK transport failures and API errors preserve endpoint result with at most one retry", async (t) => {
  credentials(t, "test-only-not-a-real-key", "test-model");
  for (const mode of ["network", "api", "malformed", "invalid-schema"] as const) {
    // Intercept transport only inside this test: no external service or network connection.
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      if (mode === "network") throw new Error("Controlled transport failure");
      if (mode === "api") return Response.json({ error: { message: "Controlled failure" } }, { status: 500 });
      const text = mode === "malformed" ? "{broken" : JSON.stringify({ explanations: [{ id: 42 }] });
      return Response.json({ id: "offline", object: "response", status: "completed", output: [{
        type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }],
      }] });
    });
    const response = await fallbackResponse();
    assert.equal(response.headers.get("X-AI-Attempts"), "2", mode);
    assert.equal(response.headers.get("X-AI-Retry"), "true", mode);
    assert.equal(fetch.mock.callCount(), 2, mode);
    fetch.mock.restore();
  }
});

test("shared seven-second deadline aborts a stalled transport and returns unchanged fallback", { timeout: 10000 }, async (t) => {
  credentials(t, "test-only-not-a-real-key", "test-model");
  let aborted = false;
  const fetch = t.mock.method(globalThis, "fetch", (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal;
    assert.ok(signal);
    const abort = () => { aborted = true; reject(new DOMException("Controlled abort", "AbortError")); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }));
  const start = performance.now();
  const response = await fallbackResponse();
  const elapsed = performance.now() - start;
  assert.equal(aborted, true);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(response.headers.get("X-AI-Attempts"), "1");
  assert.equal(response.headers.get("X-AI-Retry"), "false");
  assert.ok(elapsed >= 6900 && elapsed < 8500, `Deadline elapsed: ${elapsed}`);
});
