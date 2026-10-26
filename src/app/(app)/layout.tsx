import Link from "next/link";
import { requireContext, ROLE_LABEL } from "@/lib/auth/context";
import { signOut } from "@/app/auth-actions";
import { Notice } from "@/components/ui";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const items = [
    { href: "/", label: "Visão geral" },
    { href: "/contas", label: "Contas e saldos" },
    { href: "/lancamentos", label: "Lançamentos" },
    { href: "/caixa", label: "Caixa físico" },
    ...(ctx.can.seeStatements ? [{ href: "/conciliacao", label: "Conciliação" }] : []),
    { href: "/relatorios", label: "Relatórios" },
    { href: "/cadastros", label: "Cadastros" },
    ...(ctx.can.seeDonors ? [{ href: "/doadores", label: "Doadores" }] : []),
    ...(ctx.role === "admin" || ctx.role === "tesoureiro" ? [{ href: "/configuracoes", label: "Configurações" }] : []),
    ...(ctx.can.seeAudit ? [{ href: "/auditoria", label: "Auditoria" }] : []),
  ];
  const upcoming = ["Integrações bancárias (Fase 3)", "Orçamento e aprovações (Fase 4)", "Prestação de contas pública (Fase 5)"];

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">Financeiro</p>
            <p className="font-semibold leading-tight">{ctx.org.name}</p>
          </div>
          <form action={signOut} className="lg:hidden">
            <button className="text-sm text-brand underline">Sair</button>
          </form>
        </div>
        <nav className="px-2 pb-2 lg:pb-4" aria-label="Principal">
          <NavLinks items={items} />
          <div className="hidden lg:block">
            <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-muted">Próximas fases</p>
            <ul className="mt-1">
              {upcoming.map((u) => (
                <li key={u} className="px-3 py-1.5 text-sm text-muted/70">
                  {u}
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-line px-3 pt-4 text-sm">
              <p className="font-medium">{ctx.name}</p>
              <p className="text-muted">{ROLE_LABEL[ctx.role]}</p>
              <form action={signOut} className="mt-2">
                <button className="text-brand underline">Sair</button>
              </form>
            </div>
          </div>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          {ctx.org.is_demo && <Notice tone="info">Ambiente com dados demonstrativos. Nada aqui representa movimentação real.</Notice>}
          {ctx.needsMfa && (
            <Notice>
              Seu perfil precisa da verificação em duas etapas para lançar, alterar ou ver dados restritos.{" "}
              <Link href="/mfa" className="font-medium underline">
                Ativar agora
              </Link>
            </Notice>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
