import type { ResultCard } from "@/lib/types";

export default function ContractorCard({ card, position, formats, requestedFormat }: {
  card: ResultCard;
  position: number;
  formats: string[];
  requestedFormat: string;
}) {
  return (
    <article className="contractor">
      <div className="card-heading">
        <h3><span className="position">{position + 1}.</span> {card.anon_name}</h3>
        <p className="card-price">от {new Intl.NumberFormat("ru-RU").format(card.price_from_kzt)} ₸</p>
      </div>
      <p className="meta">{card.categories.join(", ")} · {card.city}</p>
      {(card.synthetic || card.city_imputed || card.price_imputed) && (
        <div className="badges">
          {card.synthetic && <span>Синтетический профиль</span>}
          {card.price_imputed && <span>Цена восстановлена в датасете</span>}
          {card.city_imputed && <span>Город восстановлен в датасете</span>}
        </div>
      )}
      <h4 className="explanation-heading">Почему в подборке</h4>
      <p className="explanation">{card.explanation}</p>
      {card.explanationSource === "ai" && card.explanationEvidence?.trim() && (
        <p className="evidence">Из описания: «{card.explanationEvidence}»</p>
      )}
      <div className="card-footer">
        <p className="meta">{card.languages.join(", ")} · {card.max_hours === null ? "без привязки к часам" : `до ${card.max_hours} ч`}</p>
        <ul className="format-chips" aria-label="Форматы мероприятия">
          {formats.map((format) => <li key={format} className={format === requestedFormat ? "requested-format" : undefined}>{format}</li>)}
        </ul>
      </div>
    </article>
  );
}
