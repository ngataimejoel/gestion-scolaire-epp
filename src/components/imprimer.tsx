"use client";

/** Ouvre la fenêtre d'impression du navigateur (impression papier ou « Enregistrer en PDF »). */
export function BoutonImprimer({ libelle = "Imprimer", className = "btn-secondaire" }: { libelle?: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${className} print:hidden`}>
      {libelle}
    </button>
  );
}
