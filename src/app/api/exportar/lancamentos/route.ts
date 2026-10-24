import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/finance/filters";
import { ENTRY_KIND_LABEL, ORIGIN_LABEL } from "@/lib/finance/labels";
import { centsToCsv, toCsv } from "@/lib/csv";
import { formatDateBR } from "@/lib/dates";

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Não autorizado", { status: 401 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const f = parseFilters(sp, ctx.org.timezone);
  const dateCol = f.basis === "competencia" ? "competence_date" : "cash_date";
  const supabase = await createClient();
  let query = supabase
    .from("entry_index")
    .select("number, kind, status, description, cash_date, competence_date, origin, document_ref, amount_cents, cash_effect_cents, account_names, category_names")
    .eq("organization_id", ctx.org.id)
    .gte(dateCol, f.start)
    .lte(dateCol, f.end)
    .order(dateCol)
    .order("number")
    .limit(20000);
  if (sp.tipo) query = query.eq("kind", sp.tipo);
  if (f.account) query = query.contains("account_ids", [f.account]);
  if (f.fund) query = query.contains("fund_ids", [f.fund]);
  if (f.ministry) query = query.contains("ministry_ids", [f.ministry]);
  if (f.project) query = query.contains("project_ids", [f.project]);
  const { data, error } = await query;
  if (error) return new NextResponse("Falha ao exportar", { status: 500 });
  const csv = toCsv(
    ["Número", "Data pagamento", "Competência", "Tipo", "Situação", "Descrição", "Conta", "Categoria", "Valor (R$)", "Efeito no caixa (R$)", "Comprovante", "Origem"],
    (data ?? []).map((r) => [
      r.number, formatDateBR(r.cash_date), formatDateBR(r.competence_date), ENTRY_KIND_LABEL[r.kind], r.status, r.description,
      r.account_names, r.category_names, centsToCsv(r.amount_cents), centsToCsv(r.cash_effect_cents), r.document_ref, ORIGIN_LABEL[r.origin],
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lancamentos-${f.start}-a-${f.end}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
