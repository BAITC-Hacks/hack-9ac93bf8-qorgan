import { NextResponse } from "next/server";
import { loadContractors } from "@/lib/catalog";
import { matchContractors } from "@/lib/match";
import { createSearchSchema } from "@/lib/search";
import { resolveExplanations } from "@/lib/explanations";
import { requestExplanations } from "@/lib/openai";

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
    if (result.status !== "matched") {
      return NextResponse.json(result, { headers: { "X-AI-Attempts": "0", "X-AI-Retry": "false", "X-AI-Verified": "0" } });
    }
    const profiles = new Map(contractors.map((contractor) => [contractor.id, contractor]));
    const top3 = result.results.map((card) => profiles.get(card.id)!);
    const ai = await requestExplanations(top3, parsed.data);
    const verified = new Map(resolveExplanations(top3, ai.rawOutput).map((item) => [item.id, item]));
    const results = result.results.map((card) => {
      const addition = verified.get(card.id);
      if (addition?.explanationSource !== "ai") return card;
      return {
        ...card,
        explanation: `${card.explanation} ${addition.distinctiveFact}`,
        explanationSource: "ai" as const,
        explanationEvidence: addition.evidence,
      };
    });
    return NextResponse.json({ ...result, results }, {
      headers: {
        "X-AI-Attempts": String(ai.attempts),
        "X-AI-Retry": String(ai.retried),
        "X-AI-Verified": String(results.filter((card) => card.explanationSource === "ai").length),
        "Server-Timing": `ai;dur=${ai.elapsedMs}`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать каталог. Повторите запрос позже." },
      { status: 500 },
    );
  }
}
