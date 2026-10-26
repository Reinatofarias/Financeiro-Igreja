import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatBRL } from "@/lib/money";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const buttonBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
export const buttonStyles = {
  primary: cx(buttonBase, "bg-brand text-brand-ink hover:brightness-110"),
  secondary: cx(buttonBase, "border border-line bg-surface text-ink hover:bg-bg"),
  danger: cx(buttonBase, "bg-expense text-white hover:brightness-110"),
  ghost: cx(buttonBase, "text-brand hover:bg-bg"),
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

const inputCls = "min-h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70";

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
    info: "bg-rose-50 text-brand border-rose-200",
  };
  return <span className={cx("inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "bad"; children: ReactNode }) {
  const tones = {
    warn: "border-amber-300 bg-warn-bg text-warn",
    info: "border-rose-200 bg-rose-50 text-brand",
    bad: "border-red-200 bg-red-50 text-expense",
  };
  return <div className={cx("rounded-md border px-4 py-3 text-sm", tones[tone])} role="status">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:bg-bg [&_th]:px-3 [&_th]:py-2 [&_th:not(.text-right)]:text-left [&_th]:font-medium [&_th]:text-muted">
        {children}
      </table>
    </div>
  );
}
