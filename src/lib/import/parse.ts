// Leitura de extratos bancários. Funções puras: recebem o texto do arquivo e devolvem movimentos em centavos.
// Formatos suportados:
//  - Mercado Pago "Extrato da conta" (account_statement, CSV com ";"), com saldo inicial e final.
//  - Mercado Pago "Relatório de liberações" (settlement report, CSV com ","), com bruto, tarifa e líquido.
//  - OFX (padrão dos bancos brasileiros: Cora, PagBank e outros).

export type StatementSource = "mercado_pago_extrato" | "mercado_pago_liberacoes" | "ofx";

export type ParsedLine = {
  external_id: string;
  occurred_at: string | null;
  posted_date: string; // AAAA-MM-DD no fuso da igreja
  available_date: string | null;
  description: string | null;
  kind: string | null;
  payment_method: string | null;
  gross_cents: number | null;
  fee_cents: number;
  net_cents: number;
  balance_after_cents: number | null;
};

export type ParsedStatement = {
  source: StatementSource;
  lines: ParsedLine[];
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
  /** Avisos para mostrar a quem importa (ex.: saldo do arquivo não fecha). Não impedem a importação. */
  warnings: string[];
};

export class StatementParseError extends Error {}

// ---------------------------------------------------------------- utilitários

/** Converte "1.621,00", "-0,82", "30.00", "-0.02" em centavos, sem ponto flutuante. */
export function decimalToCents(raw: string, decimal: "," | "."): number {
  let s = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (s === "") throw new StatementParseError(`Valor vazio.`);
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  const thousands = decimal === "," ? "." : ",";
  s = s.split(thousands).join("");
  const [intPart, decPart = "", extra] = s.split(decimal);
  if (extra !== undefined || !/^\d+$/.test(intPart || "0") || !/^\d*$/.test(decPart)) {
    throw new StatementParseError(`Valor inválido: "${raw}".`);
  }
  // Mais de duas casas (OFX às vezes traz 3): arredonda meio para cima no último centavo.
  const two = (decPart + "00").slice(0, 2);
  let cents = Number(intPart || "0") * 100 + Number(two);
  if (decPart.length > 2 && Number(decPart[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new StatementParseError(`Valor grande demais: "${raw}".`);
  return negative ? -cents : cents;
}

/** Lê CSV com aspas (RFC 4180) e o separador informado. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Data (AAAA-MM-DD) de um instante no fuso da igreja. */
export function dateInZone(instant: string, timeZone: string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new StatementParseError(`Data inválida: "${instant}".`);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function validDate(y: string, m: string, d: string, raw: string): string {
  const iso = `${y}-${m}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) {
    throw new StatementParseError(`Data inválida: "${raw}".`);
  }
  return iso;
}

/** Remove BOM e decide a codificação (UTF-8; se não for, Windows-1252, comum em OFX). */
export function decodeStatement(bytes: Uint8Array): string {
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
  return text.replace(/^﻿/, "");
}

/** Numera repetições do mesmo id+valor dentro do arquivo, para gerar ids estáveis e únicos. */
function occurrenceKey() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${n}`;
  };
}

// ---------------------------------------------------------------- detecção

export function detectSource(text: string): StatementSource {
  const head = text.slice(0, 2000);
  if (/<OFX>|OFXHEADER/i.test(head)) return "ofx";
  if (/^INITIAL_BALANCE;/m.test(head) && /RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID/.test(head)) return "mercado_pago_extrato";
  if (/SOURCE_ID/.test(head) && /SETTLEMENT_NET_AMOUNT/.test(head)) return "mercado_pago_liberacoes";
  throw new StatementParseError(
    "Formato não reconhecido. Use o extrato da conta do Mercado Pago (CSV), o relatório de liberações do Mercado Pago (CSV) ou um arquivo OFX do banco.",
  );
}

export function parseStatement(text: string, timeZone: string): ParsedStatement {
  const source = detectSource(text);
  if (source === "mercado_pago_extrato") return parseMercadoPagoExtrato(text);
  if (source === "mercado_pago_liberacoes") return parseMercadoPagoLiberacoes(text, timeZone);
  return parseOfx(text, timeZone);
}

// ---------------------------------------------------------------- Mercado Pago: extrato da conta

export function parseMercadoPagoExtrato(text: string): ParsedStatement {
  const rows = parseCsv(text, ";").filter((r) => r.some((c) => c.trim() !== ""));
  const warnings: string[] = [];
  const summaryIdx = rows.findIndex((r) => r[0] === "INITIAL_BALANCE");
  const headerIdx = rows.findIndex((r) => r[0] === "RELEASE_DATE");
  if (headerIdx < 0) throw new StatementParseError("Extrato do Mercado Pago sem a tabela de movimentos.");

  let opening: number | null = null;
  let closing: number | null = null;
  if (summaryIdx >= 0 && rows[summaryIdx + 1]) {
    const h = rows[summaryIdx];
    const v = rows[summaryIdx + 1];
    opening = decimalToCents(v[h.indexOf("INITIAL_BALANCE")], ",");
    closing = decimalToCents(v[h.indexOf("FINAL_BALANCE")], ",");
  }

  const h = rows[headerIdx];
  const col = (name: string) => {
    const i = h.indexOf(name);
    if (i < 0) throw new StatementParseError(`Coluna ${name} não encontrada no extrato.`);
    return i;
  };
  const cDate = col("RELEASE_DATE"), cType = col("TRANSACTION_TYPE"), cRef = col("REFERENCE_ID");
  const cNet = col("TRANSACTION_NET_AMOUNT"), cBal = h.indexOf("PARTIAL_BALANCE");
  const key = occurrenceKey();
  const lines: ParsedLine[] = [];

  for (const r of rows.slice(headerIdx + 1)) {
    const rawDate = (r[cDate] ?? "").trim();
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(rawDate);
    if (!m) throw new StatementParseError(`Data inválida no extrato: "${rawDate}".`);
    const net = decimalToCents(r[cNet] ?? "", ",");
    const ref = (r[cRef] ?? "").trim();
    const description = (r[cType] ?? "").trim() || null;
    lines.push({
      external_id: key(`mp:${ref || "sem-id"}:${net}`),
      occurred_at: null,
      posted_date: validDate(m[3], m[2], m[1], rawDate),
      available_date: null,
      description,
      kind: description ? mpExtratoKind(description, net) : null,
      payment_method: description && /pix/i.test(description) ? "pix" : null,
      gross_cents: null,
      fee_cents: 0,
      net_cents: net,
      balance_after_cents: cBal >= 0 && r[cBal]?.trim() ? decimalToCents(r[cBal], ",") : null,
    });
  }

  if (opening !== null && closing !== null) {
    const sum = lines.reduce((s, l) => s + l.net_cents, 0);
    if (opening + sum !== closing) {
      warnings.push("O saldo inicial mais os movimentos não fecha com o saldo final do arquivo. Confira se o extrato está completo.");
    }
  }
  return { source: "mercado_pago_extrato", lines, opening_balance_cents: opening, closing_balance_cents: closing, warnings };
}

function mpExtratoKind(description: string, net: number): string {
  const d = description.toLowerCase();
  if (d.startsWith("pix recebido")) return "pix_recebido";
  if (d.startsWith("pix enviado")) return "pix_enviado";
  if (d.startsWith("pagamento com") && d.includes("qr")) return net > 0 ? "qr_recebido" : "qr_pago";
  if (d.startsWith("pagamento de conta")) return "boleto_pago";
  if (d.startsWith("transferência") || d.startsWith("transferencia")) return "transferencia";
  if (d.includes("tarifa")) return "tarifa";
  if (d.includes("rendimento")) return "rendimento";
  return "outro";
}

// ---------------------------------------------------------------- Mercado Pago: relatório de liberações

const MP_SETTLEMENT_LABEL: Record<string, string> = {
  SETTLEMENT: "Recebimento",
  REFUND: "Devolução",
  CHARGEBACK: "Contestação",
  DISPUTE: "Disputa",
  WITHDRAWAL: "Retirada",
  PAYOUTS: "Retirada",
  WITHDRAWAL_CANCEL: "Retirada cancelada",
};

export function parseMercadoPagoLiberacoes(text: string, timeZone: string): ParsedStatement {
  const rows = parseCsv(text, ",").filter((r) => r.some((c) => c.trim() !== ""));
  const h = rows[0] ?? [];
  const col = (name: string) => {
    const i = h.indexOf(name);
    if (i < 0) throw new StatementParseError(`Coluna ${name} não encontrada no relatório de liberações.`);
    return i;
  };
  const cId = col("SOURCE_ID"), cType = col("TRANSACTION_TYPE"), cGross = col("TRANSACTION_AMOUNT");
  const cNet = col("SETTLEMENT_NET_AMOUNT"), cDate = col("TRANSACTION_DATE");
  const cMethod = h.indexOf("PAYMENT_METHOD"), cRelease = h.indexOf("MONEY_RELEASE_DATE"), cSub = h.indexOf("SUB_UNIT");
  const key = occurrenceKey();
  const lines: ParsedLine[] = [];
  const warnings: string[] = [];

  for (const r of rows.slice(1)) {
    const type = (r[cType] ?? "").trim().toUpperCase();
    const net = decimalToCents(r[cNet] ?? "", ".");
    const gross = decimalToCents(r[cGross] ?? "", ".");
    const occurredAt = (r[cDate] ?? "").trim();
    const method = cMethod >= 0 ? (r[cMethod] ?? "").trim().toLowerCase() || null : null;
    const viaQr = cSub >= 0 && (r[cSub] ?? "").trim().toUpperCase() === "QR";
    const release = cRelease >= 0 ? (r[cRelease] ?? "").trim() : "";
    const label = MP_SETTLEMENT_LABEL[type] ?? type.toLowerCase();
    const positive = net > 0;
    // Tarifa = bruto − líquido (cobre tarifa do Mercado Pago, parcelamento e frete juntos).
    const fee = positive && gross >= net ? gross - net : 0;
    lines.push({
      external_id: key(`mp:${(r[cId] ?? "").trim() || "sem-id"}:${net}`),
      occurred_at: occurredAt || null,
      posted_date: dateInZone(occurredAt, timeZone),
      available_date: release ? dateInZone(release, timeZone) : null,
      description: [label, method === "pix" ? (viaQr ? "Pix (QR Code)" : "Pix") : method].filter(Boolean).join(" · "),
      kind: type.toLowerCase(),
      payment_method: method,
      gross_cents: positive ? (gross >= net ? gross : net) : null,
      fee_cents: fee,
      net_cents: net,
      balance_after_cents: null,
    });
  }
  if (lines.some((l) => l.kind !== "settlement")) {
    warnings.push("O arquivo tem devoluções, retiradas ou contestações. Confira essas linhas com atenção.");
  }
  return { source: "mercado_pago_liberacoes", lines, opening_balance_cents: null, closing_balance_cents: null, warnings };
}

// ---------------------------------------------------------------- OFX

function ofxTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1].trim() : null;
}

function ofxDate(raw: string, timeZone: string): string {
  // AAAAMMDD[HHMMSS[.XXX]][[-3:BRT]]
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?(?:\.\d+)?)?(?:\[([+-]?\d+(?:\.\d+)?)(?::[^\]]*)?\])?/.exec(raw);
  if (!m) throw new StatementParseError(`Data inválida no OFX: "${raw}".`);
  const date = validDate(m[1], m[2], m[3], raw);
  if (!m[4] || m[7] === undefined) return date; // sem hora ou sem fuso: a data é a do banco
  const offH = Number(m[7]);
  const sign = offH < 0 ? "-" : "+";
  const abs = Math.abs(offH);
  const off = `${sign}${String(Math.trunc(abs)).padStart(2, "0")}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")}`;
  return dateInZone(`${date}T${m[4]}:${m[5]}:${m[6] ?? "00"}${off}`, timeZone);
}

export function parseOfx(text: string, timeZone: string): ParsedStatement {
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  if (blocks.length === 0) throw new StatementParseError("O arquivo OFX não tem movimentos.");
  const key = occurrenceKey();
  const lines: ParsedLine[] = blocks.map((b) => {
    const amountRaw = ofxTag(b, "TRNAMT");
    const posted = ofxTag(b, "DTPOSTED");
    if (!amountRaw || !posted) throw new StatementParseError("Movimento do OFX sem valor ou sem data.");
    const net = decimalToCents(amountRaw, amountRaw.includes(",") && !amountRaw.includes(".") ? "," : ".");
    const postedDate = ofxDate(posted, timeZone);
    const fitid = ofxTag(b, "FITID");
    const memo = [ofxTag(b, "NAME"), ofxTag(b, "MEMO")].filter(Boolean).join(" · ") || null;
    return {
      external_id: fitid ? key(`ofx:${fitid}`) : key(`ofx:${postedDate}:${net}`),
      occurred_at: null,
      posted_date: postedDate,
      available_date: null,
      description: memo,
      kind: (ofxTag(b, "TRNTYPE") ?? "").toLowerCase() || null,
      payment_method: memo && /pix/i.test(memo) ? "pix" : null,
      gross_cents: null,
      fee_cents: 0,
      net_cents: net,
      balance_after_cents: null,
    };
  });
  const ledger = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i.exec(text)?.[1];
  const balRaw = ledger ? ofxTag(ledger, "BALAMT") : null;
  const closing = balRaw ? decimalToCents(balRaw, balRaw.includes(",") && !balRaw.includes(".") ? "," : ".") : null;
  return { source: "ofx", lines, opening_balance_cents: null, closing_balance_cents: closing, warnings: [] };
}
