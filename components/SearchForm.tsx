"use client";

import { useState, type FormEvent } from "react";
import type { RejectionReason, SearchResponse } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "server-error"; message: string }
  | { kind: "result"; data: SearchResponse };

const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;

const reasonLabels: Record<RejectionReason, string> = {
  busy: "занят на дату",
  over_budget: "дороже бюджета",
  format: "не берёт формат",
  language: "не работает на языке",
  duration: "не хватает часов",
};

const pipelineLabels = [
  ["catalog", "Каталог города и категории"],
  ["available", "Свободны на дату"],
  ["format", "Берут формат"],
  ["budget", "В бюджете"],
  ["language", "Подходят по языку"],
  ["duration", "Подходят по длительности"],
  ["returned", "Показано"],
] as const;

export default function SearchForm({ categories }: { categories: string[] }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const duration = String(fields.get("durationHours") ?? "").trim();
    const language = String(fields.get("language") ?? "").trim();
    const payload = {
      city: String(fields.get("city") ?? ""),
      date: String(fields.get("date") ?? ""),
      eventType: String(fields.get("eventType") ?? ""),
      category: String(fields.get("category") ?? ""),
      budgetKzt: Number(fields.get("budgetKzt")),
      ...(duration ? { durationHours: Number(duration) } : {}),
      ...(language ? { language } : {}),
    };

    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Не удалось обработать запрос.";
        setState({ kind: response.status === 400 ? "invalid" : "server-error", message });
        return;
      }
      if (!data || typeof data !== "object" || !("status" in data)) {
        throw new Error("Unexpected response");
      }
      setState({ kind: "result", data: data as SearchResponse });
    } catch {
      setState({ kind: "server-error", message: "Нет связи с сервером. Повторите запрос." });
    }
  }

  const result = state.kind === "result" ? state.data : null;
  const activeReasons = result
    ? (Object.keys(result.reasonCounts) as RejectionReason[]).filter((reason) => result.reasonCounts[reason] > 0)
    : [];

  return (
    <>
      <form className="search-form" onSubmit={submit} noValidate>
        <label>Город
          <select name="city" defaultValue="" required>
            <option value="">Выберите город</option>
            <option>Астана</option>
            <option>Алматы</option>
            <option>Зарубежье</option>
          </select>
        </label>
        <label>Дата
          <input name="date" type="date" min="2026-09-23" max="2026-12-31" required />
        </label>
        <label>Тип мероприятия
          <select name="eventType" defaultValue="" required>
            <option value="">Выберите тип</option>
            {["свадьба", "той", "корпоратив", "конференция", "юбилей", "день рождения"].map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>Категория
          <select name="category" defaultValue="" required>
            <option value="">Выберите категорию</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label>Бюджет, ₸
          <input name="budgetKzt" type="number" min="1" step="1" required />
        </label>
        <label>Длительность, ч
          <input name="durationHours" type="number" min="1" max="24" step="1" />
        </label>
        <label>Язык
          <select name="language" defaultValue="">
            <option value="">Любой</option>
            <option>русский</option>
            <option>казахский</option>
            <option>английский</option>
          </select>
        </label>
        <button className="submit" type="submit" disabled={state.kind === "loading"}>
          {state.kind === "loading" ? "Подбираем…" : "Подобрать"}
        </button>
      </form>

      {state.kind === "invalid" && <p className="notice error" role="alert">Некорректный ввод: {state.message}</p>}
      {state.kind === "server-error" && <p className="notice error" role="alert">Ошибка сервера: {state.message}</p>}
      {state.kind === "loading" && <p className="notice" role="status">Проверяем каталог…</p>}

      {result && (
        <section className="results" aria-live="polite">
          <h2>{result.status === "matched" ? result.message : result.status === "no_category" ? "Категории нет" : "Подходящих нет"}</h2>
          {result.status !== "matched" && <p className="notice">{result.message}</p>}
          {result.shortfall && <p className="notice">{result.shortfall.explanation}</p>}
          {result.status === "no_category" && result.availableElsewhere.length > 0 && (
            <p className="notice">Категория есть в других городах: {result.availableElsewhere.map((item) => `${item.city} — ${item.count}`).join("; ")}.</p>
          )}

          <div className="pipeline">
            <h3>Этапы отбора</h3>
            <dl>
              {pipelineLabels.map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{result.pipeline[key]}</dd></div>
              ))}
            </dl>
          </div>

          {result.results.length > 0 && (
            <div className="cards">
              {result.results.map((card) => (
                <article className="contractor" key={card.id}>
                  <div className="card-top"><h3>{card.anon_name}</h3><strong>{money(card.price_from_kzt)}</strong></div>
                  <p className="meta">{card.categories.join(", ")} · {card.city}</p>
                  <p className="explanation">{card.explanation}</p>
                  <p className="meta">Языки: {card.languages.join(", ")} · Максимум часов: {card.max_hours === null ? "не применимо" : card.max_hours}</p>
                  {(card.synthetic || card.city_imputed || card.price_imputed) && (
                    <div className="badges">
                      {card.synthetic && <span>Синтетический профиль</span>}
                      {card.city_imputed && <span>Город восстановлен в датасете</span>}
                      {card.price_imputed && <span>Цена восстановлена в датасете</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {activeReasons.length > 0 && (
            <p className="reason-summary">Причины отсева могут сочетаться: {activeReasons.map((reason) => `${reasonLabels[reason]} — ${result.reasonCounts[reason]}`).join("; ")}.</p>
          )}
          {result.rejected.length > 0 && (
            <details className="rejected">
              <summary>Отсеяно: {result.rejected.length}</summary>
              <ul>
                {result.rejected.map((candidate) => (
                  <li key={candidate.id}>{candidate.anon_name}: {candidate.reasons.map((reason) => reasonLabels[reason]).join(", ")}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
