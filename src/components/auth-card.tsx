import Image from "next/image";
import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#f3dfe2,transparent_60%)] px-4 py-10">
      <div className="w-full max-w-md">
        <Image src="/brand/logo.png" alt="Financeiro Proclamai" width={900} height={300} priority className="mx-auto mb-7 h-auto w-64" />
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_8px_30px_rgb(69_7_15/0.08)] sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
