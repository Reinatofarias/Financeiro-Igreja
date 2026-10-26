import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { categoryOptions, loadLookups } from "@/lib/finance/lookups";
import { todayIn } from "@/lib/dates";
import { Badge, Card, Field, Input, PageHeader, Select, Table, cx } from "@/components/ui";
import { CreateForm, FundOpeningForm, RowActions } from "./forms";

export const metadata: Metadata = { title: "Cadastros" };

const TABS = [
  ["categorias", "Categorias"],
  ["fundos", "Fundos"],
  ["ministerios", "Ministérios"],
  ["projetos", "Projetos e campanhas"],
  ["centros", "Centros de custo"],
  ["fornecedores", "Fornecedores e favorecidos"],
  ["formas", "Formas de pagamento"],
] as const;

export default async function RegistryPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const ctx = await requireContext();
  const { aba = "categorias" } = await searchParams;
  const tab = TABS.some(([k]) => k === aba) ? aba : "categorias";
  const lookups = await loadLookups(ctx.org.id);
  const edit = ctx.can.manage;
  const today = todayIn(ctx.org.timezone);

  let contacts: { id: string; name: string; kind: string; is_active: boolean; document: string | null }[] = [];
  if (tab === "fornecedores") {
    const supabase = await createClient();
    const { data } = await supabase.from("contacts").select("id, name, kind, is_active, document").eq("organization_id", ctx.org.id).order("name");
    contacts = data ?? [];
  }

  const simpleList = (table: string, rows: { id: string; name: string; is_active: boolean }[], extra?: (id: string) => React.ReactNode) => (
    <Table>
      <thead><tr><th>Nome</th><th>Situação</th>{edit && <th>Ações</th>}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.name}{extra?.(r.id)}</td>
            <td>{r.is_active ? <Badge tone="good">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
            {edit && <td><RowActions table={table} id={r.id} name={r.name} active={r.is_active} /></td>}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={3} className="text-muted">Nenhum item cadastrado.</td></tr>}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Cadastros" description={edit ? "Itens não são apagados: desative o que não usa mais, e o histórico continua consistente." : "Somente administrador e tesoureiro alteram cadastros."} />
      <nav className="flex flex-wrap gap-2" aria-label="Cadastros">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/cadastros?aba=${k}`} aria-current={k === tab ? "page" : undefined}
            className={cx("rounded-md border px-3 py-1.5 text-sm", k === tab ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface")}>{label}</Link>
        ))}
      </nav>

      {tab === "categorias" && (
        <>
          {edit && (
            <Card title="Nova categoria">
              <CreateForm table="categories">
                <Field label="Nome" htmlFor="c-name"><Input id="c-name" name="name" required /></Field>
                <Field label="Tipo" htmlFor="c-kind"><Select id="c-kind" name="kind"><option value="receita">Receita</option><option value="despesa">Despesa</option></Select></Field>
                <Field label="Dentro de (opcional)" htmlFor="c-parent" hint="Precisa ser do mesmo tipo.">
                  <Select id="c-parent" name="parent_id"><option value="">— categoria principal —</option>
                    {lookups.categories.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.kind === "receita" ? "Receita" : "Despesa"} › {c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Código (opcional)" htmlFor="c-code"><Input id="c-code" name="code" maxLength={20} /></Field>
              </CreateForm>
            </Card>
          )}
          {(["receita", "despesa"] as const).map((k) => (
            <Card key={k} title={k === "receita" ? "Receitas" : "Despesas"}>
              {simpleList("categories", categoryOptions(lookups.categories, k, false).map((o) => {
                const c = lookups.categories.find((x) => x.id === o.id)!;
                return { id: c.id, name: c.name, is_active: c.is_active, label: o.label };
              }).map((c) => ({ ...c, name: c.name })), (id) => {
                const c = lookups.categories.find((x) => x.id === id)!;
                const parent = c.parent_id ? lookups.categories.find((x) => x.id === c.parent_id)?.name : null;
                return <>{parent && <span className="ml-1 text-xs text-muted">em {parent}</span>}{c.system_code && <span className="ml-2"><Badge tone="info">Usada pelo sistema</Badge></span>}</>;
              })}
            </Card>
          ))}
        </>
      )}

      {tab === "fundos" && (
        <>
          <Card>
            <p className="text-sm text-muted">Fundos <strong>vinculados</strong> guardam dinheiro com destino certo (construção, missões, ação social, manutenção) e aparecem separados dos recursos livres. Dízimos e ofertas gerais são recursos livres: não precisam de fundo.</p>
          </Card>
          {edit && (
            <Card title="Novo fundo">
              <CreateForm table="funds">
                <Field label="Nome" htmlFor="f-name"><Input id="f-name" name="name" required /></Field>
                <Field label="Descrição" htmlFor="f-desc"><Input id="f-desc" name="description" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_restricted" defaultChecked /> Recurso vinculado</label>
              </CreateForm>
            </Card>
          )}
          <Card title="Fundos">
            {simpleList("funds", lookups.funds, (id) => {
              const f = lookups.funds.find((x) => x.id === id)!;
              return (
                <div className="mt-1 space-y-2">
                  <Badge tone={f.is_restricted ? "warn" : "neutral"}>{f.is_restricted ? "Vinculado" : "Livre"}</Badge>
                  {edit && f.is_restricted && <FundOpeningForm fundId={f.id} today={today} />}
                </div>
              );
            })}
          </Card>
        </>
      )}

      {tab === "ministerios" && (
        <>
          {edit && (
            <Card title="Novo ministério ou departamento">
              <CreateForm table="ministries">
                <Field label="Nome" htmlFor="m-name"><Input id="m-name" name="name" required /></Field>
                <Field label="Tipo" htmlFor="m-kind"><Select id="m-kind" name="kind"><option value="ministerio">Ministério</option><option value="departamento">Departamento</option></Select></Field>
              </CreateForm>
            </Card>
          )}
          <Card title="Ministérios e departamentos">{simpleList("ministries", lookups.ministries)}</Card>
        </>
      )}

      {tab === "projetos" && (
        <>
          {edit && (
            <Card title="Novo projeto, campanha ou evento">
              <CreateForm table="projects">
                <Field label="Nome" htmlFor="p-name"><Input id="p-name" name="name" required /></Field>
                <Field label="Tipo" htmlFor="p-kind"><Select id="p-kind" name="kind"><option value="projeto">Projeto</option><option value="campanha">Campanha</option><option value="evento">Evento</option></Select></Field>
                <Field label="Início" htmlFor="p-start"><Input id="p-start" name="starts_on" type="date" /></Field>
                <Field label="Fim" htmlFor="p-end"><Input id="p-end" name="ends_on" type="date" /></Field>
              </CreateForm>
            </Card>
          )}
          <Card title="Projetos e campanhas">{simpleList("projects", lookups.projects)}</Card>
        </>
      )}

      {tab === "centros" && (
        <>
          {edit && (
            <Card title="Novo centro de custo">
              <CreateForm table="cost_centers">
                <Field label="Nome" htmlFor="cc-name"><Input id="cc-name" name="name" required /></Field>
                <Field label="Código" htmlFor="cc-code"><Input id="cc-code" name="code" /></Field>
              </CreateForm>
            </Card>
          )}
          <Card title="Centros de custo">{simpleList("cost_centers", lookups.costCenters)}</Card>
        </>
      )}

      {tab === "fornecedores" && (
        <>
          {ctx.can.operate && (
            <Card title="Novo fornecedor ou favorecido">
              <CreateForm table="contacts">
                <Field label="Nome" htmlFor="ct-name"><Input id="ct-name" name="name" required /></Field>
                <Field label="Tipo" htmlFor="ct-kind"><Select id="ct-kind" name="kind"><option value="fornecedor">Fornecedor</option><option value="favorecido">Favorecido</option><option value="outro">Outro</option></Select></Field>
                <Field label="CPF/CNPJ (opcional)" htmlFor="ct-doc"><Input id="ct-doc" name="document" inputMode="numeric" /></Field>
                <Field label="Chave Pix (opcional)" htmlFor="ct-pix"><Input id="ct-pix" name="pix_key" /></Field>
              </CreateForm>
            </Card>
          )}
          <Card title="Fornecedores e favorecidos">
            <Table>
              <thead><tr><th>Nome</th><th>Tipo</th><th>Situação</th>{ctx.can.operate && <th>Ações</th>}</tr></thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td>{c.kind}</td><td>{c.is_active ? <Badge tone="good">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                    {ctx.can.operate && <td><RowActions table="contacts" id={c.id} name={c.name} active={c.is_active} /></td>}</tr>
                ))}
                {contacts.length === 0 && <tr><td colSpan={4} className="text-muted">Nenhum cadastro.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "formas" && (
        <>
          {edit && (
            <Card title="Nova forma de pagamento">
              <CreateForm table="payment_methods"><Field label="Nome" htmlFor="pm-name"><Input id="pm-name" name="name" required /></Field></CreateForm>
            </Card>
          )}
          <Card title="Formas de pagamento">{simpleList("payment_methods", lookups.paymentMethods)}</Card>
        </>
      )}
    </>
  );
}
