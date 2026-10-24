import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { parseFilters } from "@/lib/finance/filters";
import { loadFinancialReport } from "@/lib/finance/reports";
import { centsToCsv, toCsv } from "@/lib/csv";
import { monthLabel, todayIn } from "@/lib/dates";

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Não autorizado", { status: 401 });
  const f = parseFilters(Object.fromEntries(request.nextUrl.searchParams), ctx.org.timezone);
  const report = await loadFinancialReport(ctx.org.id, f, todayIn(ctx.org.timezone));
  const csv = toCsv(
    ["Mês", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"],
    report.monthly.filter((m) => m.month >= f.start.slice(0, 7) + "-01").map((m) => [monthLabel(m.month, true), centsToCsv(m.income_cents), centsToCsv(m.expense_cents), centsToCsv(m.result_cents)]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="resumo-${f.start}-a-${f.end}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
