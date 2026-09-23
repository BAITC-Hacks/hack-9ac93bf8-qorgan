import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import type { Contractor } from "./types";

const columns = [
  "id",
  "anon_name",
  "categories",
  "city",
  "city_imputed",
  "synthetic",
  "price_from_kzt",
  "price_imputed",
  "event_formats",
  "languages",
  "max_hours",
  "busy_dates",
  "description",
] as const;

type CsvRow = Record<(typeof columns)[number], string>;

function list(value: string): string[] {
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function boolean(value: string, row: number, field: string): boolean {
  if (value === "True") return true;
  if (value === "False") return false;
  throw new Error(`Строка ${row}: неверное значение ${field}.`);
}

function positiveNumber(value: string, row: number, field: string): number {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number <= 0) {
    throw new Error(`Строка ${row}: неверное значение ${field}.`);
  }
  return number;
}

export function parseContractorsCsv(csv: string): Contractor[] {
  const parsed = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0 || !parsed.data.length || columns.some((field) => !parsed.meta.fields?.includes(field))) {
    throw new Error("Неверный формат CSV каталога.");
  }

  const ids = new Set<string>();
  return parsed.data.map((row, index) => {
    const line = index + 2;
    const id = row.id?.trim();
    if (!id || ids.has(id)) {
      throw new Error(`Строка ${line}: пустой или повторяющийся id.`);
    }
    ids.add(id);
    if (!row.anon_name?.trim() || !row.description?.trim()) {
      throw new Error(`Строка ${line}: отсутствует имя или описание.`);
    }
    if (row.city !== "Алматы" && row.city !== "Астана" && row.city !== "Зарубежье") {
      throw new Error(`Строка ${line}: неизвестный город.`);
    }

    const categories = list(row.categories);
    const event_formats = list(row.event_formats);
    const languages = list(row.languages);
    if (!categories.length || !event_formats.length || !languages.length) {
      throw new Error(`Строка ${line}: пустой список категорий, форматов или языков.`);
    }

    return {
      id,
      anon_name: row.anon_name.trim(),
      categories,
      city: row.city,
      city_imputed: boolean(row.city_imputed, line, "city_imputed"),
      synthetic: boolean(row.synthetic, line, "synthetic"),
      price_from_kzt: positiveNumber(row.price_from_kzt, line, "price_from_kzt"),
      price_imputed: boolean(row.price_imputed, line, "price_imputed"),
      event_formats,
      languages,
      max_hours: row.max_hours.trim() === "" ? null : positiveNumber(row.max_hours, line, "max_hours"),
      busy_dates: list(row.busy_dates),
      description: row.description.trim(),
    };
  });
}

export function loadContractors(): Contractor[] {
  const csv = readFileSync(path.join(process.cwd(), "data", "contractors.csv"), "utf8");
  return parseContractorsCsv(csv);
}
