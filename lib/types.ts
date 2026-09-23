export type Contractor = {
  id: string;
  anon_name: string;
  categories: string[];
  city: "Алматы" | "Астана" | "Зарубежье";
  city_imputed: boolean;
  synthetic: boolean;
  price_from_kzt: number;
  price_imputed: boolean;
  event_formats: string[];
  languages: string[];
  max_hours: number | null;
  busy_dates: string[];
  description: string;
};

export type RejectionReason =
  | "busy"
  | "over_budget"
  | "format"
  | "language"
  | "duration";

export type RejectedCandidate = {
  id: string;
  anon_name: string;
  reasons: RejectionReason[];
};

export type PipelineStats = {
  catalog: number;
  available: number;
  format: number;
  budget: number;
  language: number;
  duration: number;
  eligible: number;
  returned: number;
};

export type ResultCard = Pick<
  Contractor,
  | "id"
  | "anon_name"
  | "categories"
  | "city"
  | "price_from_kzt"
  | "languages"
  | "max_hours"
  | "synthetic"
  | "city_imputed"
  | "price_imputed"
> & {
  explanation: string;
  explanationSource: "ai" | "fallback";
  explanationEvidence: string | null;
};

export type SearchResponse = {
  status: "matched" | "no_category" | "no_eligible";
  results: ResultCard[];
  rejected: RejectedCandidate[];
  pipeline: PipelineStats;
  reasonCounts: Record<RejectionReason, number>;
  message: string;
  availabilityNote: string | null;
  rankingNote: string | null;
  shortfall: { requested: 3; found: number; explanation: string } | null;
  availableElsewhere: { city: Contractor["city"]; count: number }[];
};
