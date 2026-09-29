import type { ReactNode } from "react";

const TONS = {
  neutre: "bg-fond text-attenue border-bordure",
  ok: "bg-succes-fond text-principal border-transparent",
  alerte: "bg-info-fond text-texte border-transparent",
  erreur: "bg-erreur-fond text-erreur border-transparent",
} as const;

/** Petite étiquette d'état (feuille validée, alerte…). */
export function Pastille({ ton = "neutre", children }: { ton?: keyof typeof TONS; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONS[ton]}`}>{children}</span>;
}

export const TON_ETAT = { OPEN: "neutre", VALIDATED: "alerte", LOCKED: "ok" } as const;
