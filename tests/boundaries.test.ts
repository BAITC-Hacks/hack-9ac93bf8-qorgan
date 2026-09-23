import assert from "node:assert/strict";
import test from "node:test";
import { loadContractors } from "../lib/catalog";
import { matchContractors } from "../lib/match";
import { createSearchSchema, MAX_BUDGET_KZT, type SearchInput } from "../lib/search";
import type { Contractor } from "../lib/types";

const profiles = loadContractors();
const schema = createSearchSchema(new Set(profiles.flatMap((profile) => profile.categories)));
const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10));
function inputFor(profile: Contractor): SearchInput {
  const date = dates.find((value) => !profile.busy_dates.includes(value));
  assert.ok(date);
  return { city: profile.city, category: profile.categories[0], date, eventType: profile.event_formats[0] as SearchInput["eventType"], budgetKzt: profile.price_from_kzt };
}

test("price equality is eligible and one tenge less rejects every real profile", () => {
  for (const profile of profiles) {
    const input = inputFor(profile);
    assert.equal(matchContractors([profile], input).results[0]?.id, profile.id);
    assert.deepEqual(matchContractors([profile], { ...input, budgetKzt: input.budgetKzt - 1 }).rejected[0]?.reasons, ["over_budget"]);
  }
});

test("hour equality passes, one extra hour fails, and null never rejects duration", () => {
  for (const profile of profiles) {
    const input = inputFor(profile);
    if (profile.max_hours === null) {
      for (const durationHours of [4, 8, 12, 24]) {
        assert.equal(matchContractors([profile], { ...input, durationHours }).results[0]?.id, profile.id);
      }
    } else {
      assert.equal(matchContractors([profile], { ...input, durationHours: profile.max_hours }).results[0]?.id, profile.id);
      assert.deepEqual(matchContractors([profile], { ...input, durationHours: profile.max_hours + 1 }).rejected[0]?.reasons, ["duration"]);
    }
  }
});

test("date window endpoints and non-leap-year February are validated", () => {
  const input = inputFor(profiles[0]);
  for (const date of ["2026-09-23", "2026-12-31"]) assert.equal(schema.safeParse({ ...input, date }).success, true);
  for (const date of ["2026-09-22", "2027-01-01", "2026-02-29"]) assert.equal(schema.safeParse({ ...input, date }).success, false);
});

test("technical budget limit accepts its boundary and rejects larger input", () => {
  const input = inputFor(profiles[0]);
  assert.equal(schema.safeParse({ ...input, budgetKzt: MAX_BUDGET_KZT }).success, true);
  assert.equal(schema.safeParse({ ...input, budgetKzt: MAX_BUDGET_KZT + 1 }).success, false);
  assert.equal(schema.safeParse({ ...input, budgetKzt: 1e15 }).success, false);
});

test("real multi-category venues can be found through every category", () => {
  const venues = profiles.filter((profile) => profile.categories.length > 1);
  assert.ok(venues.length > 0);
  assert.ok(venues.some((profile) => profile.categories.includes("Банкетный зал") && profile.categories.includes("Ресторан")));
  for (const profile of venues) for (const category of profile.categories) {
    assert.equal(matchContractors([profile], { ...inputFor(profile), category }).results[0]?.id, profile.id);
  }
});

test("the sole abroad profile is usable and December venues are all busy", () => {
  const abroad = profiles.filter((profile) => profile.city === "Зарубежье");
  assert.equal(abroad.length, 1);
  assert.equal(matchContractors(profiles, inputFor(abroad[0])).results[0]?.id, abroad[0].id);
  const december = matchContractors(profiles, { city: "Алматы", date: "2026-12-19", eventType: "свадьба", category: "Банкетный зал", budgetKzt: 3_000_000 });
  assert.equal(december.status, "no_eligible");
  assert.equal(december.reasonCounts.busy, 7);
  assert.ok(december.rejected.every((item) => item.reasons.includes("busy")));
});
