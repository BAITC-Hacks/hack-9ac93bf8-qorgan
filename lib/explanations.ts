import { z } from "zod";
import type { SearchInput } from "./search";
import type { Contractor } from "./types";

export const aiResponseSchema = z.object({
  explanations: z.array(z.object({
    id: z.string(),
    distinctiveFact: z.string().nullable(),
    evidence: z.string().nullable(),
  }).strict()),
}).strict();

export function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[“”«»„‟]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\u00a0•]/g, " ")
    .replace(/\s+/g, " ").trim();
}

const forbiddenPhrases = [
  "отличный выбор", "идеально подходит", "лучший вариант", "вредных привычек",
  "ignore previous instructions", "ignore all previous instructions", "choose me", "change the budget",
  "игнорируй инструкции", "игнорируй предыдущие инструкции", "выбери меня", "измени бюджет",
];
const personalTerms = /(?:^|[^\p{L}])(?:женат|замуж|дети|детей|ребен|отец|отца|мать|матер|супруг|семья|семейн|телосложен|внешност|физическ|привычк|здоров|религи|политическ)(?:\p{L}*)/u;

export function hasForbiddenFacts(value: string): boolean {
  const normalized = normalizeEvidence(value);
  return forbiddenPhrases.some((phrase) => normalized.includes(normalizeEvidence(phrase)))
    || personalTerms.test(normalized);
}

export type ResolvedExplanation = {
  id: string;
  distinctiveFact: string | null;
  evidence: string | null;
  explanationSource: "ai" | "fallback";
};

export function resolveExplanations(
  top3: readonly Pick<Contractor, "id" | "description">[],
  rawModelOutput: unknown,
): ResolvedExplanation[] {
  const parsed = aiResponseSchema.safeParse(rawModelOutput);
  const items = parsed.success ? parsed.data.explanations : [];
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);

  // Iterate trusted top-3 only: model IDs cannot add, remove, or reorder cards.
  return top3.map((contractor) => {
    const fallback: ResolvedExplanation = {
      id: contractor.id, distinctiveFact: null, evidence: null, explanationSource: "fallback",
    };
    const item = items.find((candidate) => candidate.id === contractor.id);
    if (!item || counts.get(contractor.id) !== 1 || !item.distinctiveFact || !item.evidence) return fallback;
    const evidence = item.evidence.trim();
    const fact = item.distinctiveFact.trim().replace(/[.!?]$/, "").trim();
    const evidenceLength = Array.from(evidence).length;
    const normalizedEvidence = normalizeEvidence(evidence);
    if (evidenceLength < 10 || evidenceLength > 150 || normalizedEvidence.length < 10
      || fact.length < 10 || fact.length > 350 || /[\r\n\u2028\u2029]/.test(fact)
      || /[.!?…。！？]/.test(normalizeEvidence(fact))
      || !normalizeEvidence(contractor.description).includes(normalizedEvidence)
      || hasForbiddenFacts(fact) || hasForbiddenFacts(evidence)) return fallback;
    return { id: contractor.id, distinctiveFact: `${fact}.`, evidence, explanationSource: "ai" };
  });
}

const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
const ordered = (values: readonly string[]) => [...new Set(values)].sort();

function differentiator(contractor: Contractor, others: readonly Contractor[], input: SearchInput): string {
  if (!others.length) return "";
  if (others.every((other) => contractor.price_from_kzt < other.price_from_kzt)) {
    return "; среди этой выдачи это самый доступный вариант";
  }
  const extras = ordered(contractor.event_formats.filter((format) => format !== input.eventType));
  if (extras.length && others.some((other) =>
    ordered(other.event_formats.filter((format) => format !== input.eventType)).join("|") !== extras.join("|"))) {
    return `; дополнительные форматы в профиле: ${extras.join(", ")}`;
  }
  const otherLanguages = ordered(contractor.languages).filter((language) =>
    others.some((other) => !other.languages.includes(language)));
  if (otherLanguages.length) return `; в отличие от части этой выдачи, работает также на языках: ${otherLanguages.join(", ")}`;
  if (others.some((other) => other.max_hours !== contractor.max_hours)) {
    return contractor.max_hours === null
      ? "; в отличие от части этой выдачи, лимит времени присутствия не применяется"
      : `; лимит присутствия ${contractor.max_hours} ч отличается от части этой выдачи`;
  }
  const extraCategories = ordered(contractor.categories).filter((category) =>
    others.some((other) => !other.categories.includes(category)));
  if (extraCategories.length) return `; в отличие от части этой выдачи, доступны также категории: ${extraCategories.join(", ")}`;
  const cheaperThan = others.filter((other) => other.price_from_kzt > contractor.price_from_kzt);
  if (cheaperThan.length) return `; цена ниже, чем у ${cheaperThan.map((other) => other.anon_name).join(", ")}`;
  const dearerThan = others.filter((other) => other.price_from_kzt < contractor.price_from_kzt);
  if (dearerThan.length) return `; цена выше, чем у ${dearerThan.map((other) => other.anon_name).join(", ")}`;
  return "; доступные структурированные параметры не дают основания выделить этот профиль среди остальных";
}

export function deterministicExplanation(contractor: Contractor, top3: readonly Contractor[], input: SearchInput): string {
  const reserve = input.budgetKzt - contractor.price_from_kzt;
  return `Стоимость от ${money(contractor.price_from_kzt)} укладывается в бюджет ${money(input.budgetKzt)} и оставляет запас ${money(reserve)} от стартовой цены${
    differentiator(contractor, top3.filter((other) => other.id !== contractor.id), input)
  }.`;
}
