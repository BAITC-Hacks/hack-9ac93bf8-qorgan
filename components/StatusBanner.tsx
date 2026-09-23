import type { RejectionReason, SearchResponse } from "@/lib/types";

export const reasonLabels: Record<RejectionReason, string> = {
  busy: "занят на дату",
  over_budget: "дороже бюджета",
  format: "не берёт формат",
  language: "не работает на языке",
  duration: "не хватает часов",
};

export default function StatusBanner({ result, city, category }: {
  result: SearchResponse;
  city: string;
  category: string;
}) {
  const matched = result.status === "matched";
  const short = matched && result.results.length < 3;
  const variant = matched ? (short ? "shortfall" : "matched") : result.status;
  const heading = matched
    ? short ? `Найдено ${result.results.length} из 3` : `Подобрано ${result.results.length} из ${result.pipeline.eligible} подходящих`
    : result.status === "no_category" ? `В городе ${city} нет категории «${category}»` : "Кандидаты есть, но никто не подходит";
  return (
    <div className={`status-banner status-${variant}`} role="status" aria-live="polite">
      <h2><span aria-hidden="true">{matched ? (short ? "◐" : "✓") : result.status === "no_category" ? "○" : "!"}</span> {heading}</h2>
      <p>{result.shortfall?.explanation ?? result.message}</p>
      {result.status === "no_eligible" && (
        <ul className="reason-chips" aria-label="Причины отсева">
          {(Object.keys(result.reasonCounts) as RejectionReason[]).filter((reason) => result.reasonCounts[reason] > 0).map((reason) => (
            <li key={reason}>{reasonLabels[reason]}: {result.reasonCounts[reason]}</li>
          ))}
        </ul>
      )}
      {result.status === "no_category" && result.availableElsewhere.length > 0 && (
        <p>Категория есть в других городах: {result.availableElsewhere.map((item) => `${item.city}: ${item.count}`).join("; ")}.</p>
      )}
    </div>
  );
}
