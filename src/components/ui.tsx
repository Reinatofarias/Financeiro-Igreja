import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatBRL } from "@/lib/money";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(31_26_28/0.04)] sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const buttonBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const buttonStyles = {
  primary: cx(buttonBase, "bg-brand text-brand-ink shadow-sm hover:bg-brand-deep"),
  secondary: cx(buttonBase, "border border-line bg-surface text-ink shadow-sm hover:border-brand/40 hover:bg-brand-soft"),
  danger: cx(buttonBase, "bg-expense text-white hover:brightness-110"),
  ghost: cx(buttonBase, "text-brand hover:bg-brand-soft"),
};

export function ButtonLink({ href, variant = "primary", children }: { href: string; variant?: keyof typeof buttonStyles; children: ReactNode }) {
  return (
    <Link href={href} className={buttonStyles[variant]}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-expense">{error}</p>}
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink sm:min-h-10 sm:text-sm transition placeholder:text-muted/70 hover:border-muted/40 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function MoneyInput(props: ComponentProps<"input">) {
  return <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...props} className={cx("text-right num", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "min-h-20 py-2", props.className)} />;
}

export function Money({ cents, colored = false, className }: { cents: number | null | undefined; colored?: boolean; className?: string }) {
  const color = colored && cents ? (cents > 0 ? "text-income" : "text-expense") : "";
  return <span className={cx("num", color, className)}>{formatBRL(cents ?? 0)}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "info" }) {
  const tones = {
    neutral: "bg-bg text-muted border-line",
    good: "bg-green-50 text-income border-green-200",
    bad: "bg-red-50 text-expense border-red-200",
    warn: "bg-warn-bg text-warn border-amber-200",
    info: "bg-brand-soft text-brand border-rose-200",
  };
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "bad"; children: ReactNode }) {
  const tones = {
    warn: "border-amber-300 bg-warn-bg text-warn",
    info: "border-rose-200 bg-brand-soft text-brand",
    bad: "border-red-200 bg-red-50 text-expense",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])} role="status">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(31_26_28/0.04)]">
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_th]:bg-[#faf8f6] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th:not(.text-right)]:text-left [&_th]:text-muted [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-[#fcfaf9] [&_tfoot_td]:bg-[#faf8f6]">
        {children}
      </table>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** Cartão de número-chave da visão geral. */
export function Stat({ label, value, help, tone, href, featured }: { label: string; value: ReactNode; help?: string; tone?: "income" | "expense"; href?: string; featured?: boolean }) {
  const color = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "";
  const body = (
    <>
      <p className={cx("text-xs font-medium uppercase tracking-wide", featured ? "text-white/70" : "text-muted")}>{label}</p>
      <p className={cx("mt-1.5 font-semibold tracking-tight", featured ? "text-3xl text-white" : cx("text-2xl", color))}>{value}</p>
      {help && <p className={cx("mt-1.5 text-xs leading-relaxed", featured ? "text-white/70" : "text-muted")}>{help}</p>}
    </>
  );
  const cls = cx(
    "block rounded-xl border p-4 transition sm:p-5",
    featured ? "border-transparent bg-gradient-to-br from-brand to-brand-deep shadow-md" : "border-line bg-surface shadow-[0_1px_2px_rgb(31_26_28/0.04)]",
    href && !featured && "hover:border-brand/40 hover:shadow-sm",
    href && featured && "hover:shadow-lg",
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
