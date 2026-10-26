import { test } from "node:test";
import assert from "node:assert/strict";
import { createMercadoPagoClient, nextRange, pendingReports, REQUIRED_COLUMNS, MercadoPagoError } from "../src/lib/integrations/mercadopago-api.ts";

type Call = { url: string; method: string; body?: unknown; auth?: string };
function fakeFetch(responses: Record<string, () => Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
    const key = `${method} ${url.replace("https://api.mercadopago.com/v1/account/settlement_report", "")}`;
    const r = responses[key];
    return r ? r() : new Response("não esperado", { status: 500 });
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("próximo período: continua de onde parou, com 1 dia de folga", () => {
  const now = new Date("2026-10-26T12:00:30Z");
  const r = nextRange(now, new Date("2026-10-25T10:00:00Z"), "2026-01-01")!;
  assert.equal(r.begin.toISOString(), "2026-10-24T10:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-26T12:00:00.000Z");
});

test("próximo período: nunca antes do saldo inicial nem mais de 59 dias", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  assert.equal(nextRange(now, null, "2026-10-20")!.begin.toISOString(), "2026-10-20T03:00:00.000Z");
  assert.equal(nextRange(now, null, "2025-01-01")!.begin.toISOString(), "2026-08-28T12:00:00.000Z");
  assert.equal(nextRange(now, new Date("2026-10-26T11:30:00Z"), "2025-01-01"), null, "não pede de novo em menos de 1 hora");
});

test("relatórios pendentes: só CSV novos a partir do saldo inicial, do mais antigo para o mais novo", () => {
  const list = [
    { file_name: "b.csv", end_date: "2026-10-20T00:00:00Z", date_created: "2026-10-21T00:00:00Z" },
    { file_name: "a.csv", end_date: "2026-10-10T00:00:00Z", date_created: "2026-10-11T00:00:00Z" },
    { file_name: "velho.csv", end_date: "2025-12-01T00:00:00Z", date_created: "2025-12-02T00:00:00Z" },
    { file_name: "ja.csv", end_date: "2026-10-22T00:00:00Z" },
    { file_name: "planilha.xlsx", end_date: "2026-10-22T00:00:00Z" },
  ];
  assert.deepEqual(pendingReports(list, new Set(["ja.csv"]), "2026-01-01").map((r) => r.file_name), ["a.csv", "b.csv"]);
});

test("configuração: cria com as colunas quando não existe", async () => {
  const { f, calls } = fakeFetch({ "GET /config": () => new Response("", { status: 404 }), "POST /config": json({}, 201) });
  await createMercadoPagoClient("APP_USR-teste", f).ensureConfig();
  const post = calls.find((c) => c.method === "POST")!;
  assert.deepEqual((post.body as { columns: { key: string }[] }).columns.map((c) => c.key), REQUIRED_COLUMNS);
  assert.equal(calls[0].auth, "Bearer APP_USR-teste");
});

test("configuração: acrescenta colunas que faltam sem apagar as que existem", async () => {
  const { f, calls } = fakeFetch({
    "GET /config": json({ file_name_prefix: "minha", columns: [{ key: "SOURCE_ID" }, { key: "EXTERNAL_REFERENCE" }], scheduled: true }),
    "PUT /config": json({}),
  });
  const r = await createMercadoPagoClient("t", f).ensureConfig();
  assert.equal(r.prefix, "minha");
  const put = calls.find((c) => c.method === "PUT")!.body as { columns: { key: string }[]; file_name_prefix: string; scheduled?: boolean };
  const keys = put.columns.map((c) => c.key);
  assert.ok(keys.includes("EXTERNAL_REFERENCE"));
  assert.ok(REQUIRED_COLUMNS.every((k) => keys.includes(k)));
  assert.equal(keys.filter((k) => k === "SOURCE_ID").length, 1);
  assert.equal(put.scheduled, undefined, "campo só de leitura não vai no PUT");
});

test("configuração completa não é alterada", async () => {
  const { f, calls } = fakeFetch({ "GET /config": json({ columns: REQUIRED_COLUMNS.map((key) => ({ key })), separator: "," }) });
  await createMercadoPagoClient("t", f).ensureConfig();
  assert.equal(calls.length, 1);
});

test("erros do Mercado Pago viram mensagens claras", async () => {
  const { f } = fakeFetch({ "GET /list": () => new Response("", { status: 401 }), "POST ": () => new Response("", { status: 203 }) });
  const mp = createMercadoPagoClient("t", f);
  await assert.rejects(mp.list(), (e: unknown) => e instanceof MercadoPagoError && /token/.test(e.message));
  await assert.rejects(mp.request(new Date(), new Date()), /período/);
  await assert.rejects(mp.download("../segredo"), /inválido/);
});

test("pedido de relatório manda as datas sem milissegundos", async () => {
  const { f, calls } = fakeFetch({ "POST ": () => new Response("", { status: 202 }) });
  await createMercadoPagoClient("t", f).request(new Date("2026-10-01T03:00:00.123Z"), new Date("2026-10-26T12:00:00Z"));
  assert.deepEqual(calls[0].body, { begin_date: "2026-10-01T03:00:00Z", end_date: "2026-10-26T12:00:00Z" });
});
