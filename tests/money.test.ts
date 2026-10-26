import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBRL, parseBRLToCents, splitCents, sumCents } from "../src/lib/money.ts";
import { formatDateBR, isIsoDate, monthEnd, addMonths, todayIn } from "../src/lib/dates.ts";

test("converte valores digitados em centavos sem ponto flutuante", () => {
  assert.equal(parseBRLToCents("1.234,56"), 123456);
  assert.equal(parseBRLToCents("1234,56"), 123456);
  assert.equal(parseBRLToCents("R$ 10,5"), 1050);
  assert.equal(parseBRLToCents("0,10"), 10);
  assert.equal(parseBRLToCents("1234.56"), 123456);
  assert.equal(parseBRLToCents("1.234"), 123400);
  assert.equal(parseBRLToCents("1.234.567,89"), 123456789);
  assert.equal(parseBRLToCents("50"), 5000);
  assert.equal(parseBRLToCents("-15,00"), -1500);
});

test("recusa valores malformados", () => {
  for (const bad of ["", "abc", "1,234,56", "1,234", "12.34.5", "1,2,3", "10,999", "1e5", "NaN"]) {
    assert.equal(parseBRLToCents(bad), null, bad);
  }
  assert.equal(parseBRLToCents("99999999999999"), null, "acima do limite");
});

test("0,10 + 0,20 = 0,30 exatos", () => {
  assert.equal(sumCents([parseBRLToCents("0,10"), parseBRLToCents("0,20")]), 30);
  assert.equal(formatBRL(30).replace(/\s/g, " "), "R$ 0,30");
});

test("formata em reais", () => {
  assert.equal(formatBRL(123456789).replace(/\s/g, " "), "R$ 1.234.567,89");
  assert.equal(formatBRL(-5).replace(/\s/g, " "), "-R$ 0,05");
  assert.equal(formatBRL(0).replace(/\s/g, " "), "R$ 0,00");
  assert.equal(formatBRL(null), "—");
});

test("rateio divide sem perder centavo", () => {
  assert.deepEqual(splitCents(1000, 3), [334, 333, 333]);
  assert.equal(splitCents(1001, 7).reduce((a, b) => a + b, 0), 1001);
});

test("datas no padrão brasileiro", () => {
  assert.equal(formatDateBR("2026-10-24"), "24/10/2026");
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(monthEnd("2024-02-10"), "2024-02-29");
  assert.equal(addMonths("2026-11-01", 2), "2027-01-01");
  assert.equal(todayIn("America/Recife", new Date("2026-10-25T02:30:00Z")), "2026-10-24");
});
