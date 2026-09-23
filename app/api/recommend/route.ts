import { NextResponse } from "next/server";
import { loadContractors } from "@/lib/catalog";
import { matchContractors } from "@/lib/match";
import { createSearchSchema } from "@/lib/search";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Ожидается корректный JSON-запрос." }, { status: 400 });
    }

    const contractors = loadContractors();
    const categories = new Set(contractors.flatMap((contractor) => contractor.categories));
    const parsed = createSearchSchema(categories).safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "запрос");
      const detail = field === "date" || field === "category"
        ? issue.message
        : field === "durationHours"
          ? "Длительность должна быть целым числом от 1 до 24 часов."
          : `Проверьте значение поля «${field}».`;
      return NextResponse.json({ error: detail }, { status: 400 });
    }

    const result = matchContractors(contractors, parsed.data);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать каталог. Повторите запрос позже." },
      { status: 500 },
    );
  }
}
