import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Papa from "papaparse";
import { loadContractors } from "../lib/catalog";
import { hasForbiddenFacts } from "../lib/explanations";
import { matchContractors } from "../lib/match";
import type { SearchInput } from "../lib/search";

type Raw = Record<string, string>;
const parsed = Papa.parse<Raw>(readFileSync("data/contractors.csv", "utf8"), { header: true, skipEmptyLines: true });
assert.equal(parsed.errors.length, 0);
const raw = parsed.data;
const contractors = loadContractors();
const rawLists = new Map(raw.map((row) => [row, new Map(
  ["categories", "busy_dates", "event_formats", "languages"].map((field) =>
    [field, row[field].split("|").map((value) => value.trim()).filter(Boolean)]),
)]));
const list = (row: Raw, field: string) => rawLists.get(row)!.get(field)!;
const cities = ["Алматы", "Астана", "Зарубежье"] as const;
const categories = [...new Set(raw.flatMap((row) => list(row, "categories")))].sort();
const formats = ["свадьба", "той", "корпоратив", "конференция", "юбилей", "день рождения"] as const;
const languages = [undefined, "русский", "казахский", "английский"] as const;
const durations = [undefined, 4, 8, 12] as const;
const reasonNames = ["busy", "over_budget", "format", "language", "duration"] as const;
const numberFormat = new Intl.NumberFormat("ru-RU");

// This oracle reads raw CSV cells and does not reuse any matcher/parser business rules.
function oracleReasons(row: Raw, input: SearchInput) {
  const checks = {
    busy: list(row, "busy_dates").includes(input.date),
    over_budget: Number(row.price_from_kzt) > input.budgetKzt,
    format: !list(row, "event_formats").includes(input.eventType),
    language: input.language !== undefined && !list(row, "languages").includes(input.language),
    duration: input.durationHours !== undefined && row.max_hours.trim() !== "" && Number(row.max_hours) < input.durationHours,
  };
  return reasonNames.filter((reason) => checks[reason]);
}

function oracleOrder(rows: Raw[], input: SearchInput) {
  return [...rows].sort((a, b) => {
    const priceA = Number(a.price_from_kzt), priceB = Number(b.price_from_kzt);
    if (priceA !== priceB) return priceA < priceB ? -1 : 1;
    if (input.durationHours !== undefined) {
      const hoursA = a.max_hours.trim() === "" ? Infinity : Number(a.max_hours);
      const hoursB = b.max_hours.trim() === "" ? Infinity : Number(b.max_hours);
      if (hoursA !== hoursB) return hoursA > hoursB ? -1 : 1;
    }
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
  });
}

test("dataset grid: I1-I13 and E1-E5 against an independent raw CSV oracle", () => {
  assert.equal(categories.length, 17);
  assert.equal(raw.length, 66);
  const dateStep = Number(process.env.INVARIANT_DATE_STEP ?? "2");
  assert.ok(dateStep === 1 || dateStep === 2);
  const dates = Array.from({ length: 100 }, (_, index) =>
    new Date(Date.UTC(2026, 8, 23 + index)).toISOString().slice(0, 10)).filter((_, index) => index % dateStep === 0);
  const collisions: unknown[] = [];
  let checked = 0, collisionCount = 0;
  const started = performance.now();
  for (const city of cities) for (const category of categories) {
    const catalog = raw.filter((row) => row.city === city && list(row, "categories").includes(category));
    const elsewhere = cities.filter((other) => other !== city).map((other) => ({
      city: other, count: raw.filter((row) => row.city === other && list(row, "categories").includes(category)).length,
    })).filter((item) => item.count > 0).sort((a, b) => a.city.localeCompare(b.city, "ru"));
    const dense = ["Ведущий", "Фотограф", "Банкетный зал"].includes(category);
    for (const eventType of formats) for (const date of dates) for (const budgetKzt of [300_000, 1_000_000, 3_000_000]) {
      for (const language of dense ? languages : [undefined]) for (const durationHours of dense ? durations : [undefined]) {
        const input: SearchInput = { city, category, date, eventType, budgetKzt,
          ...(language ? { language } : {}), ...(durationHours ? { durationHours } : {}) };
        const check = (ok: unknown, invariant: string) => {
          if (!ok) throw new Error(`${invariant}: ${JSON.stringify(input)}`);
        };
        const expectedReasons = new Map(catalog.map((row) => [row.id, oracleReasons(row, input)]));
        const eligible = oracleOrder(catalog.filter((row) => expectedReasons.get(row.id)!.length === 0), input);
        const result = matchContractors(contractors, input);
        check(["matched", "no_category", "no_eligible"].includes(result.status), "I1 status");
        check((result.status === "no_category") === (catalog.length === 0), "I2 catalog");
        check((result.status === "no_eligible") === (catalog.length > 0 && eligible.length === 0), "I3 no eligible");
        check((result.status === "matched") === (eligible.length > 0), "I3 matched");
        check(result.results.length === Math.min(3, eligible.length), "I4 maximum three");
        for (const card of result.results) {
          const source = catalog.find((row) => row.id === card.id);
          check(source && oracleReasons(source, input).length === 0, "I5 all hard filters");
          check(card.city === city && card.categories.includes(category), "I5 card location");
        }
        check(result.results.map((card) => card.id).join("|") === eligible.slice(0, 3).map((row) => row.id).join("|"), "I6 oracle order");
        const rejectedIds = result.rejected.map((item) => item.id);
        check(new Set(rejectedIds).size === rejectedIds.length, "I7 unique rejected");
        check(result.rejected.length + eligible.length === catalog.length, "I7 partition");
        for (const item of result.rejected) {
          check(expectedReasons.has(item.id) && expectedReasons.get(item.id)!.length > 0, "I7 rejected member");
          check([...item.reasons].sort().join("|") === [...expectedReasons.get(item.id)!].sort().join("|"), "I7 all reasons");
        }
        const stages = ["catalog", "available", "format", "budget", "language", "duration", "eligible"] as const;
        check(result.pipeline.catalog === catalog.length && result.pipeline.eligible === eligible.length, "I8 endpoints");
        check(stages.every((key, index) => index === 0 || result.pipeline[key] <= result.pipeline[stages[index - 1]]), "I8 monotonic");
        check(result.pipeline.returned === result.results.length, "I8 returned");
        const short = result.status === "matched" && result.results.length < 3;
        check(Boolean(result.shortfall) === short, "I9 shortfall");
        if (short) check(result.shortfall!.found === result.results.length && !!result.shortfall!.explanation, "I9 found");
        for (const reason of reasonNames) {
          check(result.reasonCounts[reason] === [...expectedReasons.values()].filter((reasons) => reasons.includes(reason)).length, "I10 reason counts");
        }
        if (!catalog.length) assert.deepEqual(result.availableElsewhere, elsewhere, "I11 other cities");
        const busyOnly = catalog.filter((row) => expectedReasons.get(row.id)!.join("|") === "busy");
        const hypothetical = oracleOrder([...eligible, ...busyOnly], input).slice(0, 3);
        check(Boolean(result.availabilityNote) === (busyOnly.length > 0), "I12 availability presence");
        if (result.availabilityNote) {
          for (const row of raw) {
            if (result.availabilityNote.includes(`${row.anon_name} (`)) {
              check(expectedReasons.get(row.id)?.join("|") === "busy", "I12 named candidate busy-only");
            }
          }
          for (const row of busyOnly) {
            check(result.availabilityNote.includes(`${row.anon_name} (`), "I12 all busy-only visible");
            const displaced = result.availabilityNote.includes(`Профиль ${row.anon_name} (`);
            check(!displaced || hypothetical.some((candidate) => candidate.id === row.id), "I12 claimed top three");
          }
        }
        assert.deepEqual(matchContractors(contractors, input), result, `I13 ${checked}`);
        const withoutNames = result.results.map((card) => {
          let text = card.explanation;
          for (const item of result.results) text = text.split(item.anon_name).join("");
          return text;
        });
        if (new Set(withoutNames).size !== withoutNames.length) {
          collisionCount++;
          if (collisions.length < 5) collisions.push({ input, ids: result.results.map((card) => card.id), texts: withoutNames });
        }
        for (const card of result.results) {
          const sentences = card.explanation.match(/[.!?](?:\s|$)/g) ?? [];
          check(sentences.length >= 1 && sentences.length <= 2, "E1 sentences");
          check(!hasForbiddenFacts(card.explanation), "E2 forbidden facts");
          check(card.explanationSource === "fallback" && card.explanationEvidence === null, "E2 pure fallback");
          const reserve = card.explanation.match(/запас ([\d\s]+) ₸/);
          check(reserve && Number(reserve[1].replace(/\s/g, "")) === budgetKzt - card.price_from_kzt, "E4 reserve");
          check(card.explanation.includes(numberFormat.format(card.price_from_kzt)), "E4 price");
          if (result.results.length === 1) check(!/самый|среди этой выдачи|в отличие|цена (?:выше|ниже)/.test(card.explanation), "E5 single result comparisons");
        }
        checked++;
      }
    }
  }
  console.log(JSON.stringify({ gridQueries: checked, dateStep, dates: dates.length, invariants: 13, explanationChecks: 5,
    elapsedMs: Math.round(performance.now() - started), collisionCount, firstCollisions: collisions }));
  assert.equal(collisionCount, 0, "E3 explanations must remain distinct after removing names");
});
