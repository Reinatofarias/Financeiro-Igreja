// Traduz erros do banco para mensagens claras, sem vazar detalhes técnicos.
type PgError = { message?: string; code?: string; details?: string } | null | undefined;

export function friendlyError(error: PgError): string {
  if (!error) return "Erro desconhecido.";
  const msg = error.message ?? "";
  switch (error.code) {
    case "23505":
      return "Já existe um registro com esses dados (nome ou identificador repetido).";
    case "23503":
      return "Um dos itens escolhidos não existe ou pertence a outra organização.";
    case "42501":
      // As nossas funções já devolvem mensagens em português com este código.
      return /[áéíóúãõç]/i.test(msg) || msg.includes("permiss") ? msg : "Seu perfil não tem permissão para esta ação.";
    case "PGRST301":
    case "28000":
      return "Sessão expirada. Entre novamente.";
  }
  if (msg.includes("row-level security")) return "Seu perfil não tem permissão para esta ação.";
  // Mensagens das regras financeiras (raise exception) já são escritas para quem usa o sistema.
  if (error.code === "P0001" || error.code === "23514" || error.code === "22023") return msg;
  console.error(JSON.stringify({ level: "error", event: "db_error", code: error.code }));
  return "Não foi possível concluir a operação. Tente novamente.";
}

export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;
