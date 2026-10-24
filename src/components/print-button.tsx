"use client";

import { buttonStyles } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={buttonStyles.primary} onClick={() => window.print()}>
      Imprimir / salvar PDF
    </button>
  );
}
