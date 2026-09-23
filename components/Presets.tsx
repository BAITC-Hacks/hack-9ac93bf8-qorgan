import { demoPresets } from "@/lib/demo-presets";
import type { SearchInput } from "@/lib/search";

export default function Presets({ active, loading, onSelect }: {
  active: string | null;
  loading: boolean;
  onSelect: (input: SearchInput, label: string) => void;
}) {
  return (
    <div className="presets">
      <p className="preset-heading">Примеры для проверки</p>
      <div className="demo-presets" role="group" aria-label="Примеры для проверки">
        {demoPresets.map(({ label, input }) => (
          <button key={label} type="button" disabled={loading} aria-pressed={active === label}
            title={`${input.category} · ${input.city} · ${input.date.split("-").reverse().join(".")} · ${input.eventType} · ${new Intl.NumberFormat("ru-RU").format(input.budgetKzt)} ₸${input.durationHours ? ` · ${input.durationHours} ч` : ""}${input.language ? ` · ${input.language}` : ""}`}
            onClick={() => onSelect(input, label)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
