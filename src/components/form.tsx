"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { buttonStyles } from "@/components/ui";
import type { ActionState } from "@/lib/errors";

export function SubmitButton({ children, variant = "primary", confirm }: { children: ReactNode; variant?: keyof typeof buttonStyles; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonStyles[variant]}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          Salvando…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-income" : "text-sm text-expense"}>
      {state.message}
    </p>
  );
}
