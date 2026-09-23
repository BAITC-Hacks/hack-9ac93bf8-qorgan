import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/recommend/route";
import { loadContractors } from "../lib/catalog";
import { matchContractors } from "../lib/match";
import type { SearchInput } from "../lib/search";
import { requestExplanations } from "../lib/openai";

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
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
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

test("successful responses are cached by normalized request, model and profile data, with evidence rechecked", async (t) => {
  credentials(t, "test-only-not-a-real-key", "cache-test-model");
  const output = { explanations: [{
    id: "HK-26808", distinctiveFact: "Резидент авторской группы", evidence: "Резидент авторской группы",
  }] };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "offline-cache", object: "response", status: "completed", output: [{
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }],
    }],
  }));
  const call = (body: unknown) => POST(new Request("http://localhost/api/recommend", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const first = await call(input);
  const firstBody = await first.json();
  assert.equal(first.headers.get("X-AI-Cache"), "miss");
  assert.equal(first.headers.get("X-AI-Verified"), "1");
  assert.equal(firstBody.results[0].explanationSource, "ai");
  assert.ok(firstBody.results.slice(1).every((card: { explanationSource: string }) => card.explanationSource === "fallback"));
  const repeat = await call({ ...Object.fromEntries(Object.entries(input).reverse()), category: " Ведущий " });
  assert.deepEqual(await repeat.json(), firstBody);
  assert.equal(repeat.headers.get("X-AI-Cache"), "hit");
  assert.equal(repeat.headers.get("X-AI-Attempts"), "0");
  assert.equal(repeat.headers.get("X-AI-Retry"), "false");
  assert.equal(repeat.headers.get("X-AI-Verified"), "1");
  assert.equal(fetch.mock.callCount(), 1);

  const profiles = baseline.results.map((card) => loadContractors().find((profile) => profile.id === card.id)!);
  const cached = await requestExplanations(profiles, input);
  (cached.rawOutput as typeof output).explanations[0].distinctiveFact = "changed";
  assert.deepEqual((await requestExplanations(profiles, input)).rawOutput, output);
  assert.equal((await requestExplanations(profiles, { ...input, date: "2026-09-24" })).cacheHit, false);
  assert.equal((await requestExplanations(profiles.map((profile) => ({ ...profile, description: profile.description + " " })), input)).cacheHit, false);
  process.env.OPENAI_MODEL = "another-cache-test-model";
  assert.equal((await requestExplanations(profiles, input)).cacheHit, false);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await requestExplanations(profiles, input)).rawOutput, null);
  assert.equal(fetch.mock.callCount(), 4);
});

test("AI cache evicts the oldest entry at the 200-entry limit", async (t) => {
  credentials(t, "test-only-not-a-real-key", "bounded-cache-test-model");
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "offline-bounded-cache", object: "response", status: "completed", output: [{
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify({ explanations: [] }), annotations: [] }],
    }],
  }));
  const profiles = [loadContractors()[0]];
  for (let index = 0; index < 201; index++) {
    assert.equal((await requestExplanations(profiles, { ...input, budgetKzt: 2_000_000 + index })).cacheHit, false);
  }
  assert.equal(fetch.mock.callCount(), 201);
  assert.equal((await requestExplanations(profiles, { ...input, budgetKzt: 2_000_200 })).cacheHit, true);
  assert.equal((await requestExplanations(profiles, { ...input, budgetKzt: 2_000_000 })).cacheHit, false);
  assert.equal(fetch.mock.callCount(), 202);
});
