import type { SearchInput } from "./search";

export const demoPresets: { label: string; input: SearchInput }[] = [
  {
    label: "Плотная категория",
    input: { city: "Алматы", date: "2026-09-30", eventType: "корпоратив", category: "Ведущий", budgetKzt: 1_000_000 },
  },
  {
    label: "Та же, другая дата",
    input: { city: "Алматы", date: "2026-10-10", eventType: "корпоратив", category: "Ведущий", budgetKzt: 1_000_000 },
  },
  {
    label: "Редкая категория",
    input: { city: "Алматы", date: "2026-09-23", eventType: "свадьба", category: "Флорист", budgetKzt: 300_000 },
  },
  {
    label: "Не тянет бюджет",
    input: { city: "Астана", date: "2026-09-23", eventType: "свадьба", category: "Ведущий", budgetKzt: 500_000 },
  },
  {
    label: "Декабрь: все заняты",
    input: { city: "Алматы", date: "2026-12-19", eventType: "свадьба", category: "Банкетный зал", budgetKzt: 3_000_000 },
  },
  {
    label: "Нет категории в городе",
    input: { city: "Астана", date: "2026-09-23", eventType: "свадьба", category: "Декоратор", budgetKzt: 1_000_000 },
  },
];
