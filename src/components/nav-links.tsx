"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavIcon =
  | "home"
  | "wallet"
  | "list"
  | "cash"
  | "check"
  | "chart"
  | "tags"
  | "heart"
  | "gear"
  | "shield"
  | "calendar"
  | "target"
  | "lock"
  | "grid"
  | "close"
  | "logout";

export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavGroup = { label: string; items: NavItem[] };

// Ícones de traço simples (24x24), desenhados aqui para não carregar biblioteca de ícones.
const PATHS: Record<NavIcon, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  wallet: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0V6a2 2 0 0 1 2-2h11M16 13.5h2",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  cash: "M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v4M18 10v4",
  check: "M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  tags: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9ZM7.5 7.5h.01",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  shield: "M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3ZM9 12l2 2 4-4",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  close: "M6 6l12 12M18 6 6 18",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};

export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: NavIcon; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-progress" aria-hidden /> : null;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Menu lateral no computador. */
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/15 font-medium text-white shadow-[inset_3px_0_0_var(--gold)]" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    <Pending />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// No celular, os 4 do dia a dia ficam na barra de baixo; o resto abre no botão "Mais".
const BOTTOM = ["/", "/lancamentos", "/contas", "/caixa"];
const SHORT: Record<string, string> = { "/": "Início", "/contas": "Contas", "/caixa": "Caixa" };

/** Barra de baixo no celular (como app), com o painel "Mais" para as outras telas. */
export function MobileNav({ groups, signOut }: { groups: NavGroup[]; signOut: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.items);
  const bottom = all.filter((i) => BOTTOM.includes(i.href));
  const more = all.filter((i) => !BOTTOM.includes(i.href));
  const moreActive = more.some((i) => isActive(pathname, i.href));
  const tab = "relative flex min-w-0 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium text-muted transition aria-[current=page]:text-brand";

  return (
    <div className="no-print lg:hidden">
      {open && (
        <div className="fixed inset-0 z-40 bg-[rgb(31_10_14/0.35)] backdrop-blur-[3px]" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-subir absolute inset-x-3 bottom-[calc(68px+env(safe-area-inset-bottom))] rounded-2xl border border-line/70 bg-surface/90 p-2 shadow-2xl backdrop-blur-xl"
          >
            <div className="grid grid-cols-3 gap-1">
              {more.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-center text-xs font-medium text-ink transition hover:bg-bg aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand"
                >
                  <Icon name={item.icon} className="h-5 w-5" />
                  {item.label}
                </Link>
              ))}
              <form action={signOut}>
                <button className="flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-xs font-medium text-expense transition hover:bg-bg">
                  <Icon name="logout" className="h-5 w-5" />
                  Sair
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line/70 bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        {bottom.map((item) => {
          const active = isActive(pathname, item.href) && !open;
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={tab}>
              <span className={`absolute top-0 h-0.5 w-8 rounded-full bg-gold transition ${active ? "opacity-100" : "opacity-0"}`} />
              <Icon name={item.icon} className="h-[22px] w-[22px]" />
              {SHORT[item.href] ?? item.label}
              <Pending />
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-current={moreActive || open ? "page" : undefined} className={tab}>
          <span className={`absolute top-0 h-0.5 w-8 rounded-full bg-gold transition ${moreActive || open ? "opacity-100" : "opacity-0"}`} />
          <Icon name={open ? "close" : "grid"} className="h-[22px] w-[22px]" />
          Mais
        </button>
      </nav>
    </div>
  );
}
