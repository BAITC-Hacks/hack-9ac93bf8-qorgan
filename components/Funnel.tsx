import type { PipelineStats } from "@/lib/types";

const steps = [
  ["catalog", "Каталог города и категории"],
  ["available", "Свободны на дату"],
  ["format", "Берут формат"],
  ["budget", "В бюджете"],
  ["language", "Подходят по языку"],
  ["duration", "Подходят по длительности"],
  ["returned", "Показано"],
] as const;

export default function Funnel({ pipeline }: { pipeline: PipelineStats }) {
  return (
    <section className="funnel" aria-label="Этапы отбора">
      <h3>Этапы отбора</h3>
      <ol>
        {steps.map(([key, label], index) => (
          <li key={key}>
            {index > 0 && <span className="funnel-arrow" aria-hidden="true">→</span>}
            <span><strong>{pipeline[key]}</strong> {label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
