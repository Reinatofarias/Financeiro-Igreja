export const ENTRY_KIND_LABEL: Record<string, string> = {
  saldo_inicial: "Saldo inicial",
  receita: "Receita",
  despesa: "Despesa",
  transferencia: "Transferência",
  ajuste: "Ajuste",
  estorno: "Estorno",
  reclassificacao: "Reclassificação",
};

export const ORIGIN_LABEL: Record<string, string> = {
  manual: "Lançamento manual",
  caixa: "Caixa físico",
  importacao: "Importação de arquivo",
  integracao: "Integração bancária",
  sistema: "Gerado pelo sistema",
};

export function kindTone(kind: string): "good" | "bad" | "info" | "neutral" | "warn" {
  if (kind === "receita") return "good";
  if (kind === "despesa") return "bad";
  if (kind === "transferencia") return "info";
  if (kind === "estorno") return "warn";
  return "neutral";
}
