// Dinheiro sempre em centavos inteiros. Nada de ponto flutuante em cálculos.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MAX_CENTS = 999_999_999_999; // R$ 9.999.999.999,99

export function formatBRL(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const value = typeof cents === "bigint" ? cents : BigInt(Math.trunc(Number(cents)));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const reais = abs / 100n;
  const centavos = abs % 100n;
  // Intl só formata a parte inteira (sem decimais), evitando conversão de centavos para float.
  const inteiro = BRL.format(Number(reais)).replace(/,\d{2}$/, "");
  return `${negative ? "-" : ""}${inteiro},${centavos.toString().padStart(2, "0")}`;
}

/** Formata sem o símbolo, para tabelas e campos de formulário. */
export function formatAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return formatBRL(cents).replace(/^(-?)R\$\s?/, "$1");
}

/**
 * Converte o que a pessoa digitou em centavos.
 * Aceita "1.234,56", "1234,56", "1234", "R$ 10,5" e "1234.56" (ponto decimal com até 2 casas).
 * Retorna null se não for um valor válido.
 */
export function parseBRLToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length !== 2) return null;
    [intPart, decPart] = parts;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, decPart] = s.split(".");
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, "");
  } else {
    return null;
  }
  if (!/^\d*$/.test(decPart) || decPart.length > 2) return null;
  if (intPart === "") intPart = "0";
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/** Soma inteiros com verificação de limite seguro. */
export function sumCents(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (!Number.isSafeInteger(v)) throw new Error("Valor monetário inválido");
    total += v;
    if (!Number.isSafeInteger(total)) throw new Error("Soma fora do limite");
  }
  return total;
}

/** Divide um valor em n partes inteiras que somam exatamente o total (centavos de sobra nas primeiras). */
export function splitCents(total: number, parts: number): number[] {
  if (!Number.isSafeInteger(total) || !Number.isInteger(parts) || parts < 1) throw new Error("Divisão inválida");
  const base = Math.trunc(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < Math.abs(rest) ? Math.sign(rest) : 0));
}
