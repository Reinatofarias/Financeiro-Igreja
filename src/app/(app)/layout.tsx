import Image from "next/image";
import Link from "next/link";
import { requireContext, ROLE_LABEL } from "@/lib/auth/context";
import { signOut } from "@/app/auth-actions";
import { Notice } from "@/components/ui";
import { MobileNav, NavLinks, type NavGroup } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const groups: NavGroup[] = [
    {
      label: "Dia a dia",
      items: [
        { href: "/", label: "Visão geral", icon: "home" },
        { href: "/lancamentos", label: "Lançamentos", icon: "list" },
        { href: "/contas", label: "Contas e saldos", icon: "wallet" },
        { href: "/caixa", label: "Caixa físico", icon: "cash" },
        { href: "/contas-a-pagar", label: "Contas a pagar", icon: "calendar" },
        ...(ctx.can.seeStatements ? [{ href: "/conciliacao", label: "Conciliação", icon: "check" as const }] : []),
      ],
    },
    {
      label: "Análise",
      items: [
        { href: "/relatorios", label: "Relatórios", icon: "chart" },
        { href: "/orcamento", label: "Orçamento", icon: "target" },
      ],
    },
    {
      label: "Gestão",
      items: [
        { href: "/fechamento", label: "Fechamento", icon: "lock" },
        { href: "/cadastros", label: "Cadastros", icon: "tags" },
        ...(ctx.can.seeDonors ? [{ href: "/doadores", label: "Doadores", icon: "heart" as const }] : []),
        ...(ctx.role === "admin" || ctx.role === "tesoureiro" ? [{ href: "/configuracoes", label: "Configurações", icon: "gear" as const }] : []),
        ...(ctx.can.seeAudit ? [{ href: "/auditoria", label: "Auditoria", icon: "shield" as const }] : []),
      ],
    },
  ];
  const initials = ctx.name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen lg:flex">
      {/* Celular: barra de cima só com a marca; telas na barra de baixo */}
      <header className="no-print sticky top-0 z-30 flex items-center gap-3 bg-gradient-to-r from-brand to-brand-deep px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white lg:hidden">
        <Image src="/brand/simbolo-claro.png" alt="" width={32} height={32} priority className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Financeiro Proclamai</p>
          <p className="truncate text-sm font-semibold leading-tight">{ctx.org.name}</p>
        </div>
      </header>

      <aside className="no-print hidden bg-gradient-to-b from-brand to-brand-deep text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
        <div className="flex items-center gap-3 px-5 py-6">
          <Image src="/brand/simbolo-claro.png" alt="" width={40} height={40} priority className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Financeiro Proclamai</p>
            <p className="line-clamp-2 font-semibold leading-tight">{ctx.org.name}</p>
          </div>
        </div>
        <nav className="px-3 pb-4" aria-label="Principal">
          <NavLinks groups={groups} />
        </nav>
        <div className="mx-3 mb-4 mt-auto flex items-center gap-3 rounded-lg bg-black/15 p-3 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-xs font-semibold">{initials || "?"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ctx.name}</p>
            <p className="truncate text-xs text-white/60">{ROLE_LABEL[ctx.role]}</p>
          </div>
          <form action={signOut}>
            <button className="rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10">Sair</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl space-y-5">
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

      <MobileNav groups={groups} signOut={signOut} />
    </div>
  );
}
