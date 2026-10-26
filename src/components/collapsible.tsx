"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Bloco recolhível: fechado no celular (economiza tela), aberto no computador. */
export function Collapsible({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 1024px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className={className}>
      {summary}
      {children}
    </details>
  );
}
