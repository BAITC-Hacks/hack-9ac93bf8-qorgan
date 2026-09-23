"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RejectionReason, SearchResponse } from "@/lib/types";
import type { SearchInput } from "@/lib/search";
import Presets from "./Presets";
import StatusBanner, { reasonLabels } from "./StatusBanner";
import Funnel from "./Funnel";
import ContractorCard from "./ContractorCard";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "server-error"; message: string }
  | { kind: "result"; data: SearchResponse; input: { city: string; category: string; eventType: string } };

export default function SearchForm({ categories, formatsById }: { categories: string[]; formatsById: Record<string, string[]> }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const scrollAfterPreset = useRef(false);

  useEffect(() => {
    if (state.kind !== "idle" && state.kind !== "loading" && scrollAfterPreset.current) {
      resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      scrollAfterPreset.current = false;
    }
  }, [state]);

  function runPreset(input: SearchInput, label: string) {
    const form = formRef.current;
    if (!form || inFlight.current) return;
    for (const name of ["city", "date", "eventType", "category", "budgetKzt", "durationHours", "language"] as const) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
        field.value = String(input[name] ?? "");
      }
    }
    setActivePreset(label);
    scrollAfterPreset.current = true;
    form.requestSubmit();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
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

    inFlight.current = true;
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
      setState({ kind: "result", data: data as SearchResponse, input: payload });
    } catch {
      setState({ kind: "server-error", message: "Нет связи с сервером. Повторите запрос." });
    } finally {
      inFlight.current = false;
    }
  }

  const result = state.kind === "result" ? state.data : null;
  const activeReasons = result
    ? (Object.keys(result.reasonCounts) as RejectionReason[]).filter((reason) => result.reasonCounts[reason] > 0)
    : [];
  // Split presentation-only text at its existing label; facts stay server-owned.
  const alsoIndex = result?.rankingNote?.indexOf("Также подходят:") ?? -1;
  const rankingText = alsoIndex >= 0 ? result!.rankingNote!.slice(0, alsoIndex).trim() : result?.rankingNote;
  const alsoText = alsoIndex >= 0 ? result!.rankingNote!.slice(alsoIndex) : null;

  return (
    <>
      <Presets active={activePreset} loading={state.kind === "loading"} onSelect={runPreset} />
      <form ref={formRef} className="search-form" onSubmit={submit} onChange={() => setActivePreset(null)} noValidate>
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
        <label>Длительность, ч (необязательно)
          <input name="durationHours" type="number" min="1" max="24" step="1" />
        </label>
        <label>Язык (необязательно)
          <select name="language" defaultValue="">
            <option value="">Любой</option>
            <option>русский</option>
            <option>казахский</option>
            <option>английский</option>
          </select>
        </label>
        <button className="submit" type="submit" disabled={state.kind === "loading"}>
          {state.kind === "loading" && <span className="spinner" aria-hidden="true" />}
          {state.kind === "loading" ? "Подбираем… (до 10 секунд)" : "Подобрать"}
        </button>
      </form>

      <div ref={resultRef} className="result-anchor">
        {state.kind === "idle" && <section className="empty-start"><h2>Параметры вашего мероприятия</h2><p>Подбор ещё не выполнен.</p></section>}
        {(state.kind === "invalid" || state.kind === "server-error") && (
          <div className="error-panel" role="alert">
            <h2>{state.kind === "invalid" ? "Проверьте параметры" : "Не удалось получить результат"}</h2>
            <p>{state.message}</p>
            <button type="button" className="retry" onClick={() => formRef.current?.requestSubmit()}>Повторить</button>
          </div>
        )}
        {state.kind === "loading" && (
          <section className="loading-results" role="status" aria-busy="true">
            <p>Проверяем каталог…</p>
            <div className="cards" aria-hidden="true">
              {[0, 1, 2].map((index) => <div className="skeleton-card" key={index}><span /><span /><span /></div>)}
            </div>
          </section>
        )}
        {result && state.kind === "result" && (
          <section className="results">
            <StatusBanner result={result} city={state.input.city} category={state.input.category} />
            {result.availabilityNote && (
              <aside className="availability-note">
                <h3><span aria-hidden="true">📅</span> Влияние даты</h3>
                <p>{result.availabilityNote}</p>
              </aside>
            )}
            {rankingText && <p className="ranking-note"><span aria-hidden="true">ⓘ</span> {rankingText}</p>}
            <Funnel pipeline={result.pipeline} />
            {result.results.length > 0 && (
              <div className="cards">
                {result.results.map((card, position) => (
                  <ContractorCard key={card.id} card={card} position={position} formats={formatsById[card.id] ?? []} requestedFormat={state.input.eventType} />
                ))}
              </div>
            )}
            {alsoText && <p className="also-matches">{alsoText}</p>}
            {result.rejected.length > 0 && (
              <details className="result-details rejected">
                <summary>Отсеяно: {result.rejected.length}</summary>
                {activeReasons.length > 0 && <p className="reason-summary">Причины отсева могут сочетаться: {activeReasons.map((reason) => `${reasonLabels[reason]} — ${result.reasonCounts[reason]}`).join("; ")}.</p>}
                <ul className="rejected-list">
                  {result.rejected.map((candidate) => (
                    <li key={candidate.id}>
                      <strong>{candidate.anon_name}</strong>
                      <ul className="reason-chips">{candidate.reasons.map((reason) => <li key={reason}>{reasonLabels[reason]}</li>)}</ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
    </>
  );
}
