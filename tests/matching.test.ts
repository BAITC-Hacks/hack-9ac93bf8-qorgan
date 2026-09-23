import assert from "node:assert/strict";
import test from "node:test";
import { loadContractors } from "../lib/catalog";
import { matchContractors } from "../lib/match";
import { createSearchSchema, type SearchInput } from "../lib/search";
import { demoPresets } from "../lib/demo-presets";

const contractors = loadContractors();
const searchSchema = createSearchSchema(new Set(contractors.flatMap((contractor) => contractor.categories)));
const demoA: SearchInput = {
  city: "Астана",
  date: "2026-09-23",
  eventType: "свадьба",
  category: "Ведущий",
  budgetKzt: 1_000_000,
  durationHours: 8,
  language: "казахский",
};

test("CSV parses all 66 real profiles", () => {
  assert.equal(contractors.length, 66);
  assert.equal(new Set(contractors.map((contractor) => contractor.id)).size, 66);
});

test("same request produces the same ordered ids and at most three sorted cards", () => {
  const first = matchContractors(contractors, demoA);
  const second = matchContractors(contractors, demoA);
  const ids = first.results.map((result) => result.id);
  assert.deepEqual(ids, second.results.map((result) => result.id));
  assert.deepEqual(ids, ["HK-26808", "HK-37181", "HK-80581"]);
  assert.equal(first.status, "matched");
  assert.equal(first.pipeline.catalog, 5);
  assert.equal(first.pipeline.eligible, 4);
  assert.equal(first.results.length, 3);
  assert.ok(first.results.length <= 3);
  assert.deepEqual(first.pipeline, {
    catalog: 5, available: 5, format: 4, budget: 4,
    language: 4, duration: 4, eligible: 4, returned: 3,
  });
  assert.deepEqual(first.results.map((result) => result.anon_name), ["Идзуку Мидория", "Нами", "Санджи Виндсмок"]);
  const krillin = first.rejected.find((item) => item.anon_name === "Крилин");
  assert.deepEqual(krillin?.reasons, ["format", "language", "duration"]);
});

test("changing only the date excludes busy profiles and produces shortfall", () => {
  const result = matchContractors(contractors, { ...demoA, date: "2026-09-24" });
  assert.equal(result.status, "matched");
  assert.deepEqual(result.results.map((item) => item.id), ["HK-80581"]);
  for (const id of ["HK-37181", "HK-26808", "HK-97041"]) {
    assert.deepEqual(result.rejected.find((item) => item.id === id)?.reasons, ["busy"]);
  }
  assert.deepEqual(result.rejected.find((item) => item.id === "HK-58385")?.reasons,
    ["format", "language", "duration"]);
  assert.equal(result.shortfall?.found, 1);
  assert.ok(result.shortfall?.explanation.includes("занят на дату"));
  for (const item of result.results) {
    assert.ok(!contractors.find((contractor) => contractor.id === item.id)?.busy_dates.includes("2026-09-24"));
  }
});

test("a null max_hours profile remains eligible with a requested duration", () => {
  const result = matchContractors(contractors, {
    city: "Астана",
    date: "2026-09-23",
    eventType: "корпоратив",
    category: "Флорист",
    budgetKzt: 500_000,
    durationHours: 8,
    language: "русский",
  });
  assert.equal(result.status, "matched");
  assert.equal(result.results[0]?.id, "HK-90002");
  assert.equal(result.results[0]?.price_from_kzt, 300_000);
  assert.equal(result.results[0]?.max_hours, null);
  assert.equal(result.results[0]?.synthetic, true);
});

test("no_category and no_eligible are different outcomes", () => {
  const absent = matchContractors(contractors, { ...demoA, category: "Декоратор" });
  assert.equal(absent.status, "no_category");
  assert.deepEqual(absent.availableElsewhere, [{ city: "Алматы", count: 3 }]);

  const unaffordable = matchContractors(contractors, {
    city: "Астана",
    date: "2026-09-23",
    eventType: "свадьба",
    category: "Ведущий",
    budgetKzt: 500_000,
  });
  assert.equal(unaffordable.status, "no_eligible");
  assert.equal(unaffordable.results.length, 0);
  assert.equal(unaffordable.reasonCounts.over_budget, 5);
  assert.ok(unaffordable.message.includes("600 000") || unaffordable.message.includes("600 000"));
});

test("date, enums, and budget are validated", () => {
  for (const date of ["2026-09-31", "2026-11-31", "2026-02-30", "2026-09-22", "2027-01-01", "2026-12-32"]) {
    assert.equal(searchSchema.safeParse({ ...demoA, date }).success, false, date);
  }
  for (const date of ["2026-09-23", "2026-12-31"]) {
    assert.equal(searchSchema.safeParse({ ...demoA, date }).success, true, date);
  }
  assert.equal(searchSchema.safeParse({ ...demoA, budgetKzt: 0 }).success, false);
  assert.equal(searchSchema.safeParse({ ...demoA, budgetKzt: -1 }).success, false);
  assert.equal(searchSchema.safeParse({ ...demoA, city: "Шымкент" }).success, false);
});

test("duration is optional or an integer from 1 to 24", () => {
  for (const durationHours of [0, 0.5, 25, 168, -1]) {
    assert.equal(searchSchema.safeParse({ ...demoA, durationHours }).success, false, String(durationHours));
  }
  for (const durationHours of [undefined, 1, 8, 24]) {
    assert.equal(searchSchema.safeParse({ ...demoA, durationHours }).success, true, String(durationHours));
  }
});

test("unknown categories fail validation while known categories absent in a city are valid", () => {
  const unknown = searchSchema.safeParse({ ...demoA, category: "Несуществующий подрядчик XYZ" });
  assert.equal(unknown.success, false);
  if (!unknown.success) assert.deepEqual(unknown.error.issues[0]?.path, ["category"]);
  const known = searchSchema.parse({ ...demoA, category: "Декоратор" });
  assert.equal(matchContractors(contractors, known).status, "no_category");
});

const demoD: SearchInput = {
  city: "Алматы", date: "2026-09-30", eventType: "корпоратив", category: "Ведущий", budgetKzt: 1_000_000,
};

test("D1 explains the busy-only top-three candidate and remaining eligible ranking", () => {
  const result = matchContractors(contractors, demoD);
  assert.equal(result.status, "matched");
  assert.equal(result.pipeline.eligible, 6);
  assert.deepEqual(result.results.map((card) => card.id), ["HK-88430", "HK-44923", "HK-35215"]);
  assert.match(result.availabilityNote!, /Аня Форджер \(700\s000 ₸\).*вошёл бы в тройку.*30 сентября/);
  assert.match(result.rankingNote!, /Подходят 6 из 10/);
  assert.match(result.rankingNote!, /Сон Гоку.*Буллма.*Хаул/);
  assert.deepEqual(result, matchContractors(contractors, demoD));
});

test("D2 distinguishes busy-only displacement from other busy and multi-reason profiles", () => {
  const result = matchContractors(contractors, { ...demoD, date: "2026-10-10" });
  assert.deepEqual(result.results.map((card) => card.id), ["HK-88430", "HK-29829", "HK-27222"]);
  assert.match(result.availabilityNote!, /Мицури Канроджи.*вошёл бы в тройку.*10 октября/);
  assert.match(result.availabilityNote!, /Ещё 2.*Кики.*Буллма/);
  assert.doesNotMatch(result.availabilityNote!, /Эмилия/);
  assert.deepEqual(result.rejected.find((item) => item.id === "HK-42352")?.reasons, ["busy", "format"]);
});

test("December distinguishes all busy profiles from those passing every other condition", () => {
  const result = matchContractors(contractors, {
    ...demoD, date: "2026-12-19", eventType: "свадьба", category: "Банкетный зал", budgetKzt: 3_000_000,
  });
  assert.equal(result.status, "no_eligible");
  assert.equal(result.reasonCounts.busy, 7);
  assert.match(result.availabilityNote!, /Все профили каталога заняты 19 декабря/);
  assert.match(result.availabilityNote!, /По остальным условиям подходят 3: Хината Хьюга.*Иноскэ Хашибира.*Шинобу Кочо/);
  assert.equal(result.rankingNote, null);
});

test("availability notes include busy-only candidates outside the hypothetical top three", () => {
  const result = matchContractors(contractors, { ...demoA, date: "2026-09-25" });
  const busyOnly = result.rejected.filter((item) => item.reasons.length === 1 && item.reasons[0] === "busy");
  for (const profile of busyOnly) assert.ok(result.availabilityNote?.includes(profile.anon_name));
  for (const profile of result.rejected.filter((item) => item.reasons.length > 1)) {
    assert.ok(!result.availabilityNote?.includes(profile.anon_name));
  }
});

test("all six live presets validate and produce the real CSV outcomes without optional fields", () => {
  const expected = [
    ["HK-88430", "HK-44923", "HK-35215"], ["HK-88430", "HK-29829", "HK-27222"],
    ["HK-39372", "HK-90001"], [], [], [],
  ];
  assert.equal(demoPresets.length, 6);
  for (const [index, { input }] of demoPresets.entries()) {
    assert.equal(searchSchema.safeParse(input).success, true);
    assert.ok(!("durationHours" in input) && !("language" in input));
    const result = matchContractors(contractors, input);
    assert.deepEqual(result.results.map((card) => card.id), expected[index]);
    assert.equal(result.status, index < 3 ? "matched" : index === 5 ? "no_category" : "no_eligible");
  }
  const rare = matchContractors(contractors, demoPresets[2].input);
  assert.equal(rare.results[0].price_imputed, true);
  assert.equal(rare.results[0].synthetic, false);
  assert.equal(rare.results[1].synthetic, true);
  assert.match(rare.shortfall!.explanation, /Алматы всего 2 профилей категории «Флорист»/);
});
