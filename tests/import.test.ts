import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalToCents, decodeStatement, detectSource, parseStatement, StatementParseError } from "../src/lib/import/parse.ts";

// Arquivos de exemplo com dados fictícios, no mesmo formato dos exportados pelo Mercado Pago e pelos bancos.
const EXTRATO = `INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE
2.049,44;1.180,95;-1.621,00;1.609,39

RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE
01-05-2026;Pix recebido Pessoa Exemplo Um;900000000001;150,00;2.199,44
03-05-2026;Pagamento com Código QR Pix Pessoa Exemplo Dois;900000000002;9,95;2.209,39
04-05-2026;Pix recebido Pessoa Exemplo Um;900000000003;1.021,00;3.230,39
05-05-2026;Pix enviado Fornecedor Exemplo;900000000004;-1.621,00;1.609,39
`;

const LIBERACOES = `EXTERNAL_REFERENCE,SOURCE_ID,USER_ID,PAYMENT_METHOD_TYPE,PAYMENT_METHOD,SITE,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,SELLER_AMOUNT,TRANSACTION_DATE,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY,SETTLEMENT_DATE,REAL_AMOUNT,COUPON_AMOUNT,METADATA,MKP_FEE_AMOUNT,FINANCING_FEE_AMOUNT,SHIPPING_FEE_AMOUNT,TAXES_AMOUNT,INSTALLMENTS,TAX_DETAIL,POS_ID,STORE_ID,STORE_NAME,EXTERNAL_POS_ID,POS_NAME,EXTERNAL_STORE_ID,ORDER_ID,SHIPPING_ID,SHIPMENT_MODE,PACK_ID,TAXES_DISAGGREGATED,POI_ID,POI_WALLET_NAME,POI_BANK_NAME,DESCRIPTION,MONEY_RELEASE_DATE,INSTALLMENT_NUMBER,INSTALLMENT_NET_AMOUNT,CARD_INITIAL_NUMBER,OPERATION_TAGS,BUSINESS_UNIT,SUB_UNIT,PRODUCT_SKU,SALE_DETAIL,TRANSACTION_INTENT_ID
,900000000010,100,bank_transfer,pix,MLB,SETTLEMENT,30.00,BRL,0.00,2026-10-25T23:38:36.000-04:00,0.00,30.00,BRL,2026-10-25T23:38:36.000-04:00,30.00,0.00,"[{}]",0.00,0.00,0.00,0.00,1,,,,,,,,,,,,"[]",,,,,2026-10-25T23:38:36.000-04:00,,,,[{"TRACK":"PIX"}],,,,,
,900000000011,100,bank_transfer,pix,MLB,SETTLEMENT,10.00,BRL,0.00,2026-10-25T09:45:56.000-04:00,-0.05,9.95,BRL,2026-10-25T09:45:56.000-04:00,9.95,0.00,"[{""hide_payer_information"":true}]",-0.05,0.00,0.00,0.00,1,,,,,,,,123,,,,"[]",,,,,2026-10-25T09:45:56.000-04:00,,,,[{"TRACK":"PIX"}],Mercado Pago,QR,,"""Pago Bank Transfer Pix""",
`;

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260502100000[-3:BRT]<TRNAMT>250.00<FITID>abc-1<MEMO>Pix recebido Pessoa Exemplo</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260503<TRNAMT>-49.9<FITID>abc-2<NAME>Tarifa</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1200.10<DTASOF>20260531</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("valores em centavos sem ponto flutuante", () => {
  assert.equal(decimalToCents("1.621,00", ","), 162100);
  assert.equal(decimalToCents("-0,82", ","), -82);
  assert.equal(decimalToCents("0.10", "."), 10);
  assert.equal(decimalToCents("-0.05", "."), -5);
  assert.equal(decimalToCents("33.17", "."), 3317);
  assert.equal(decimalToCents("49.9", "."), 4990);
  assert.equal(decimalToCents("1.005", "."), 101);
  assert.throws(() => decimalToCents("abc", ","), StatementParseError);
});

test("detecta o formato do arquivo", () => {
  assert.equal(detectSource(EXTRATO), "mercado_pago_extrato");
  assert.equal(detectSource(LIBERACOES), "mercado_pago_liberacoes");
  assert.equal(detectSource(OFX), "ofx");
  assert.throws(() => detectSource("a;b;c\n1;2;3"), /Formato não reconhecido/);
});

test("extrato da conta do Mercado Pago", () => {
  const s = parseStatement(EXTRATO, "America/Recife");
  assert.equal(s.lines.length, 4);
  assert.equal(s.opening_balance_cents, 204944);
  assert.equal(s.closing_balance_cents, 160939);
  assert.deepEqual(s.warnings, []);
  assert.equal(s.lines[0].posted_date, "2026-05-01");
  assert.equal(s.lines[0].net_cents, 15000);
  assert.equal(s.lines[0].kind, "pix_recebido");
  assert.equal(s.lines[1].kind, "qr_recebido");
  assert.equal(s.lines[3].net_cents, -162100);
  assert.equal(s.lines[3].balance_after_cents, 160939);
  assert.equal(s.lines[0].external_id, "mp:900000000001:15000:1");
});

test("extrato que não fecha gera aviso", () => {
  const s = parseStatement(EXTRATO.replace("1.609,39\n\n", "1.609,40\n\n"), "America/Recife");
  assert.equal(s.warnings.length, 1);
});

test("relatório de liberações do Mercado Pago", () => {
  const s = parseStatement(LIBERACOES, "America/Recife");
  assert.equal(s.lines.length, 2);
  const [a, b] = s.lines;
  // 23:38 em -04:00 já é dia 26 no horário de Recife (-03:00).
  assert.equal(a.posted_date, "2026-10-26");
  assert.equal(a.gross_cents, 3000);
  assert.equal(a.fee_cents, 0);
  assert.equal(b.gross_cents, 1000);
  assert.equal(b.fee_cents, 5);
  assert.equal(b.net_cents, 995);
  assert.equal(b.description, "Recebimento · Pix (QR Code)");
  assert.equal(b.external_id, "mp:900000000011:995:1");
});

test("mesmo pagamento tem o mesmo id no extrato e no relatório de liberações", () => {
  const extrato = parseStatement(
    EXTRATO.replace("900000000002;9,95", "900000000011;9,95"),
    "America/Recife",
  );
  const lib = parseStatement(LIBERACOES, "America/Recife");
  assert.equal(extrato.lines[1].external_id, lib.lines[1].external_id);
});

test("OFX", () => {
  const s = parseStatement(OFX, "America/Recife");
  assert.equal(s.lines.length, 2);
  assert.equal(s.lines[0].posted_date, "2026-05-02");
  assert.equal(s.lines[0].net_cents, 25000);
  assert.equal(s.lines[0].external_id, "ofx:abc-1:1");
  assert.equal(s.lines[1].net_cents, -4990);
  assert.equal(s.lines[1].description, "Tarifa");
  assert.equal(s.closing_balance_cents, 120010);
});

test("arquivo em Windows-1252 é lido sem perder acentos", () => {
  const bytes = new Uint8Array([0x50, 0x69, 0x78, 0x20, 0x63, 0xe9, 0x75]); // "Pix céu" em 1252
  assert.equal(decodeStatement(bytes), "Pix céu");
  assert.equal(decodeStatement(new TextEncoder().encode("﻿olá")), "olá");
});
