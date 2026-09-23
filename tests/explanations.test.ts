import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { loadContractors } from "../lib/catalog";
import { aiResponseSchema, hasForbiddenFacts, normalizeEvidence, resolveExplanations } from "../lib/explanations";
import { matchContractors } from "../lib/match";
import type { SearchInput } from "../lib/search";

const contractors = loadContractors();
const demoA: SearchInput = {
  city: "Астана", date: "2026-09-23", eventType: "свадьба", category: "Ведущий",
  budgetKzt: 1_000_000, durationHours: 8, language: "казахский",
};
const expectedIds = ["HK-26808", "HK-37181", "HK-80581"];
const top3 = expectedIds.map((id) => contractors.find((contractor) => contractor.id === id)!);
const validItem = {
  id: "HK-80581",
  distinctiveFact: "Опыт в клубе импровизаторов полезен для живого общения с гостями свадьбы",
  evidence: "Резидент клуба импровизаторов Improv Konoha",
};
const sourceFor = (raw: unknown, id = validItem.id) =>
  resolveExplanations(top3, raw).find((item) => item.id === id)!.explanationSource;
const sentences = (text: string) => [...new Intl.Segmenter("ru", { granularity: "sentence" }).segment(text)].length;

test("Zod helper generates strict required nullable Structured Outputs without optional properties", () => {
  const format = zodTextFormat(aiResponseSchema, "contractor_explanations");
  const schema = format.schema as {
    required: string[]; additionalProperties: boolean;
    properties: { explanations: { items: { required: string[]; additionalProperties: boolean } } };
  };
  assert.equal(format.strict, true);
  assert.deepEqual(schema.required, ["explanations"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.explanations.items.required, ["id", "distinctiveFact", "evidence"]);
  assert.equal(schema.properties.explanations.items.additionalProperties, false);
  assert.equal(aiResponseSchema.safeParse({ explanations: [{ id: "HK-80581", distinctiveFact: null, evidence: null }] }).success, true);
  assert.equal(aiResponseSchema.safeParse({ explanations: [{ id: "HK-80581" }] }).success, false);
});

test("evidence normalization handles case, yo, quotes, dashes, NBSP, spaces, bullets and Unicode", () => {
  const variants = [
    ["ВЕДУ МЕРОПРИЯТИЯ УЖЕ БОЛЕЕ 15 ЛЕТ", "веду мероприятия уже более 15 лет"],
    ["Ведёт мероприятие", "ведет мероприятие"],
    ['Резидент группы «SakuraLab»', 'Резидент группы "SakuraLab"'],
    ["Импровизация — интерактивы", "импровизация - интерактивы"],
    ["Опыт\u00a0  ведения\nмероприятий", "опыт ведения мероприятий"],
    ["•Ведение мероприятий", "ведение мероприятий"],
    ["Ведущий… импровизация", "ведущий... импровизация"],
    ["Ведущии\u0306 мероприятий", "ведущий мероприятий"],
  ];
  for (const [description, evidence] of variants) {
    assert.equal(normalizeEvidence(description), normalizeEvidence(evidence));
    const result = resolveExplanations([{ id: validItem.id, description }], {
      explanations: [{ ...validItem, evidence }],
    });
    assert.equal(result[0].explanationSource, "ai", description);
    assert.equal(result[0].evidence, evidence);
  }
});

test("fabricated, too short, too long and whitespace-only evidence falls back", () => {
  for (const evidence of ["Лауреат выдуманной премии 2099", "Резидент", "а".repeat(151), " ".repeat(20)]) {
    assert.equal(sourceFor({ explanations: [{ ...validItem, evidence }] }), "fallback", evidence);
  }
  for (const length of [10, 150]) {
    const evidence = "а".repeat(length);
    assert.equal(resolveExplanations([{ id: validItem.id, description: evidence }], {
      explanations: [{ ...validItem, evidence: `  ${evidence}  ` }],
    })[0].explanationSource, "ai");
  }
});

test("malformed output, invalid schema, null and missing contractors preserve fallback and ordered IDs", () => {
  for (const raw of [null, undefined, "{bad json", {}, { explanations: "bad" },
    { explanations: [null] }, { explanations: [{ id: validItem.id, evidence: 123 }] },
    { explanations: [], ranking: ["unknown"] }, { explanations: [] }]) {
    const result = resolveExplanations(top3, raw);
    assert.deepEqual(result.map((item) => item.id), expectedIds);
    assert.ok(result.every((item) => item.explanationSource === "fallback" && item.evidence === null));
  }
});

test("unknown IDs cannot create cards and duplicate IDs invalidate only that contractor", () => {
  const nami = { id: "HK-37181", distinctiveFact: "Опыт ведения более 15 лет полезен для организации свадебной программы", evidence: "ВЕДУ МЕРОПРИЯТИЯ УЖЕ БОЛЕЕ 15 ЛЕТ" };
  const result = resolveExplanations(top3, {
    explanations: [validItem, { ...validItem, id: "UNKNOWN" }, nami, { ...validItem }],
  });
  assert.deepEqual(result.map((item) => item.id), expectedIds);
  assert.deepEqual(result.map((item) => item.explanationSource), ["fallback", "ai", "fallback"]);
  assert.equal(sourceFor({ explanations: [{ ...validItem, id: "UNKNOWN" }] }), "fallback");
  assert.equal(sourceFor({ explanations: [{ ...validItem, id: "HK-58385" }] }), "fallback");
});

test("null or empty fact or evidence uses fallback", () => {
  for (const fields of [
    { distinctiveFact: null, evidence: null }, { distinctiveFact: null }, { evidence: null },
    { distinctiveFact: "   " }, { evidence: "   " },
  ]) assert.equal(sourceFor({ explanations: [{ ...validItem, ...fields }] }), "fallback");
});

test("marketing and personal facts are blocked in either fact or evidence, including real CSV text", () => {
  for (const phrase of ["отличный выбор", "идеально подходит", "лучший вариант",
    "Женат. Есть двое детей", "Отец самой красивой девочки", "телосложение спортивное",
    "без вредных привычек", "замужем", "ребёнок", "мать", "супруга", "семейное положение",
    "внешность", "здоровье", "религия", "политические взгляды"] ) {
    assert.equal(hasForbiddenFacts(phrase.toUpperCase()), true, phrase);
    assert.equal(sourceFor({ explanations: [{ ...validItem, distinctiveFact: `${phrase}; опыт полезен на свадьбе` }] }), "fallback");
    const evidence = `${phrase}; ведение мероприятия`;
    const result = resolveExplanations([{ id: validItem.id, description: evidence }], {
      explanations: [{ ...validItem, evidence }],
    });
    assert.equal(result[0].explanationSource, "fallback", phrase);
  }
  assert.equal(sourceFor({ explanations: [{ ...validItem, evidence: "телосложение спортивное" }] }), "fallback");
  assert.equal(sourceFor({ explanations: [{ ...validItem, id: "HK-26808", evidence: "Отец самой красивой девочки" }] }, "HK-26808"), "fallback");
});

test("valid output is verified per contractor without mutating inputs or following model order", () => {
  const before = structuredClone(top3);
  const raw = { explanations: [validItem] };
  const rawBefore = structuredClone(raw);
  const result = resolveExplanations(top3, raw);
  assert.deepEqual(result.map((item) => item.id), expectedIds);
  assert.deepEqual(result.map((item) => item.explanationSource), ["fallback", "fallback", "ai"]);
  assert.equal(result[2].distinctiveFact, `${validItem.distinctiveFact}.`);
  assert.equal(result[2].evidence, validItem.evidence);
  assert.deepEqual(top3, before);
  assert.deepEqual(raw, rawBefore);
});

test("AI addition is at most one sentence; multi-sentence output falls back", () => {
  for (const distinctiveFact of ["Первое предложение. Второе предложение", "Первая мысль! Вторая мысль", "Несколько... мыслей", "Первая строка\nВторая строка"]) {
    assert.equal(sourceFor({ explanations: [{ ...validItem, distinctiveFact }] }), "fallback");
  }
  const cards = matchContractors(contractors, demoA).results;
  const resolved = resolveExplanations(top3, { explanations: [validItem] });
  for (const card of cards) {
    const fact = resolved.find((item) => item.id === card.id)?.distinctiveFact;
    assert.ok(sentences(`${card.explanation}${fact ? ` ${fact}` : ""}`) <= 2);
  }
});

test("Demo A stays offline with P0 IDs and distinct factual fallback explanations", () => {
  const result = matchContractors(contractors, demoA);
  assert.deepEqual(result.results.map((card) => card.id), expectedIds);
  assert.equal(new Set(result.results.map((card) => card.explanation)).size, 3);
  assert.ok(result.results.every((card) => card.explanationSource === "fallback" && card.explanationEvidence === null));
  assert.match(result.results[0].explanation, /400\s000/);
  assert.match(result.results[0].explanation, /самый доступный/);
  assert.match(result.results[1].explanation, /конференция, корпоратив, юбилей/);
  assert.match(result.results[2].explanation, /корпоратив, той, юбилей/);
  assert.notEqual(result.results[1].explanation, result.results[2].explanation);
  for (const card of result.results) {
    assert.equal(sentences(card.explanation), 1);
    assert.equal(hasForbiddenFacts(card.explanation), false);
    assert.ok(!card.explanation.includes(card.id));
  }
});

test("single-result A2 and B contain price, budget and reserve without comparisons", () => {
  const inputs: SearchInput[] = [
    { ...demoA, date: "2026-09-24" },
    { city: "Астана", date: "2026-09-23", eventType: "корпоратив", category: "Флорист", budgetKzt: 500_000, language: "русский" },
  ];
  for (const input of inputs) {
    const result = matchContractors(contractors, input);
    assert.equal(result.results.length, 1);
    const text = result.results[0].explanation;
    assert.equal(sentences(text), 1);
    assert.match(text, /запас 200\s000/);
    assert.doesNotMatch(text, /самый|лучший|остальных|среди|отличие|выдач/);
  }
});
