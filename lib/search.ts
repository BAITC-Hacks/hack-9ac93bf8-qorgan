import { z } from "zod";

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const searchSchema = z
  .object({
    city: z.enum(["Алматы", "Астана", "Зарубежье"]),
    date: z
      .string()
      .refine(validDate, "Укажите действительную дату в формате ГГГГ-ММ-ДД.")
      .refine(
        (value) => value >= "2026-09-23" && value <= "2026-12-31",
        "Дата должна быть с 23.09.2026 по 31.12.2026.",
      ),
    eventType: z.enum([
      "свадьба",
      "той",
      "корпоратив",
      "конференция",
      "юбилей",
      "день рождения",
    ]),
    category: z.string().trim().min(1).max(100),
    budgetKzt: z.number().int().positive().safe(),
    durationHours: z.number().int().min(1).max(24).optional(),
    language: z.enum(["русский", "казахский", "английский"]).optional(),
  })
  .strict();

export function createSearchSchema(categories: ReadonlySet<string>) {
  return searchSchema.extend({
    category: searchSchema.shape.category.refine(
      (category) => categories.has(category),
      "Выберите категорию из каталога.",
    ),
  });
}

export type SearchInput = z.infer<typeof searchSchema>;
