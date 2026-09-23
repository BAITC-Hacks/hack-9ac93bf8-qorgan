import type { SearchInput } from "./search";
import { deterministicExplanation } from "./explanations";
import type {
  Contractor,
  PipelineStats,
  RejectedCandidate,
  RejectionReason,
  ResultCard,
  SearchResponse,
} from "./types";

const reasonLabels: Record<RejectionReason, string> = {
  busy: "занят на дату",
  over_budget: "дороже бюджета",
  format: "не берёт формат",
  language: "не работает на языке",
  duration: "не хватает часов",
};

const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;

function reasonsFor(contractor: Contractor, input: SearchInput): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (contractor.busy_dates.includes(input.date)) reasons.push("busy");
  if (contractor.price_from_kzt > input.budgetKzt) reasons.push("over_budget");
  if (!contractor.event_formats.includes(input.eventType)) reasons.push("format");
  if (input.language && !contractor.languages.includes(input.language)) reasons.push("language");
  if (input.durationHours && contractor.max_hours !== null && contractor.max_hours < input.durationHours) {
    reasons.push("duration");
  }
  return reasons;
}

function pipelineFor(catalog: Contractor[], input: SearchInput): PipelineStats {
  const available = catalog.filter((c) => !c.busy_dates.includes(input.date));
  const format = available.filter((c) => c.event_formats.includes(input.eventType));
  const budget = format.filter((c) => c.price_from_kzt <= input.budgetKzt);
  const language = input.language
    ? budget.filter((c) => c.languages.includes(input.language!))
    : budget;
  const duration = input.durationHours
    ? language.filter((c) => c.max_hours === null || c.max_hours >= input.durationHours!)
    : language;
  return {
    catalog: catalog.length,
    available: available.length,
    format: format.length,
    budget: budget.length,
    language: language.length,
    duration: duration.length,
    eligible: duration.length,
    returned: Math.min(duration.length, 3),
  };
}

function cardFor(contractor: Contractor, top3: readonly Contractor[], input: SearchInput): ResultCard {
  return {
    id: contractor.id,
    anon_name: contractor.anon_name,
    categories: contractor.categories,
    city: contractor.city,
    price_from_kzt: contractor.price_from_kzt,
    languages: contractor.languages,
    max_hours: contractor.max_hours,
    synthetic: contractor.synthetic,
    city_imputed: contractor.city_imputed,
    price_imputed: contractor.price_imputed,
    explanation: deterministicExplanation(contractor, top3, input),
    explanationSource: "fallback",
    explanationEvidence: null,
  };
}

function reasonSummary(rejected: RejectedCandidate[]): string {
  if (!rejected.length) return "В этом каталоге других профилей нет.";
  if (rejected.length <= 5) {
    return rejected
      .map((item) => `${item.anon_name}: ${item.reasons.map((reason) => reasonLabels[reason]).join(", ")}`)
      .join("; ") + ".";
  }
  const counts = countReasons(rejected);
  return `Причины отсева могут сочетаться: ${
    (Object.keys(counts) as RejectionReason[])
      .filter((reason) => counts[reason] > 0)
      .map((reason) => `${reasonLabels[reason]} — ${counts[reason]}`)
      .join("; ")
  }.`;
}

function countReasons(rejected: RejectedCandidate[]): Record<RejectionReason, number> {
  const counts = { busy: 0, over_budget: 0, format: 0, language: 0, duration: 0 };
  for (const item of rejected) {
    for (const reason of item.reasons) counts[reason]++;
  }
  return counts;
}

function availabilityNoteFor(
  busyOnly: Contractor[], hypotheticalTop3: Contractor[], input: SearchInput, allBusy: boolean,
): string | null {
  if (!busyOnly.length) return null;
  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${input.date}T00:00:00Z`));
  const label = (profile: Contractor) => `${profile.anon_name} (${money(profile.price_from_kzt)})`;
  if (allBusy) {
    return `Все профили каталога заняты ${date}. По остальным условиям подходят ${busyOnly.length}: ${busyOnly.map(label).join(", ")}.`;
  }
  const displaced = hypotheticalTop3.filter((profile) => busyOnly.some((busy) => busy.id === profile.id));
  const others = busyOnly.filter((profile) => !displaced.some((busy) => busy.id === profile.id));
  const notes = displaced.map((profile) =>
    `Профиль ${label(profile)} прошёл бы по всем условиям и вошёл бы в тройку, но занят ${date}.`);
  if (others.length) {
    notes.push(`Ещё ${others.length} подходят по остальным условиям, но заняты ${date}: ${others.map(label).join(", ")}.`);
  }
  return notes.join(" ");
}

export function matchContractors(contractors: Contractor[], input: SearchInput): SearchResponse {
  const catalog = contractors.filter(
    (contractor) => contractor.city === input.city && contractor.categories.includes(input.category),
  );
  const pipeline = pipelineFor(catalog, input);
  const rejected: RejectedCandidate[] = [];
  const eligible: Contractor[] = [];

  for (const contractor of catalog) {
    const reasons = reasonsFor(contractor, input);
    if (reasons.length === 0) eligible.push(contractor);
    else rejected.push({ id: contractor.id, anon_name: contractor.anon_name, reasons });
  }

  const reasonCounts = countReasons(rejected);
  const compare = (a: Contractor, b: Contractor) => {
    if (a.price_from_kzt !== b.price_from_kzt) return a.price_from_kzt - b.price_from_kzt;
    if (input.durationHours && a.max_hours !== b.max_hours) {
      return (b.max_hours ?? Number.MAX_SAFE_INTEGER) - (a.max_hours ?? Number.MAX_SAFE_INTEGER);
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  eligible.sort(compare);
  const busyIds = new Set(rejected.filter((item) => item.reasons.length === 1 && item.reasons[0] === "busy")
    .map((item) => item.id));
  const busyOnly = catalog.filter((profile) => busyIds.has(profile.id)).sort(compare);
  // Counterfactual ranking explains availability without adding busy profiles to results.
  const hypotheticalTop3 = [...eligible, ...busyOnly].sort(compare).slice(0, 3);
  const base = {
    rejected,
    pipeline,
    reasonCounts,
    results: [] as ResultCard[],
    shortfall: null as SearchResponse["shortfall"],
    availableElsewhere: [] as SearchResponse["availableElsewhere"],
    availabilityNote: availabilityNoteFor(busyOnly, hypotheticalTop3, input, reasonCounts.busy === catalog.length),
    rankingNote: null as string | null,
  };

  if (catalog.length === 0) {
    const cityCounts = new Map<Contractor["city"], number>();
    for (const contractor of contractors) {
      if (contractor.categories.includes(input.category)) {
        cityCounts.set(contractor.city, (cityCounts.get(contractor.city) ?? 0) + 1);
      }
    }
    const availableElsewhere = [...cityCounts]
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => a.city.localeCompare(b.city, "ru"));
    return {
      ...base,
      status: "no_category",
      message: `В городе ${input.city} категории «${input.category}» нет.`,
      availableElsewhere,
    };
  }

  if (eligible.length === 0) {
    const minPrice = Math.min(...catalog.map((contractor) => contractor.price_from_kzt));
    const priceNote = reasonCounts.over_budget === catalog.length
      ? ` Минимальная цена в категории — ${money(minPrice)}.`
      : "";
    return {
      ...base,
      status: "no_eligible",
      message: `В городе ${input.city} есть ${catalog.length} профилей категории «${input.category}», но ни один не проходит условия. ${reasonSummary(rejected)}${priceNote}`,
    };
  }

  const top3 = eligible.slice(0, 3);
  const rankingNote = eligible.length > 3
    ? `Подходят ${eligible.length} из ${catalog.length}. Показаны 3 с наименьшей ценой; при равной цене ${input.durationHours ? "сначала больший запас часов, затем " : ""}порядок по ID. Также подходят: ${eligible.slice(3).map((profile) => `${profile.anon_name} (${money(profile.price_from_kzt)})`).join(", ")}.`
    : null;
  const results = top3.map((contractor) => cardFor(contractor, top3, input));
  const shortfall = results.length < 3
    ? {
        requested: 3 as const,
        found: results.length,
        explanation: `Найдено ${results.length} из 3 вариантов. В городе ${input.city} всего ${catalog.length} профилей категории «${input.category}». ${reasonSummary(rejected)}`,
      }
    : null;
  return {
    ...base,
    status: "matched",
    results,
    rankingNote,
    shortfall,
    message: `Найдено: ${results.length}.`,
  };
}
