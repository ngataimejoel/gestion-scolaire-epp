"use client";

import { useActionState } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi } from "../ui";

/** Petit bouton qui déclenche une action serveur sans champ, avec confirmation facultative. */
export function BoutonAction({ action, libelle, confirmation }: { action: (e: EtatFormulaire) => Promise<EtatFormulaire>; libelle: string; confirmation?: string }) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  return (
    <form action={envoyer} onSubmit={(e) => { if (confirmation && !window.confirm(confirmation)) e.preventDefault(); }} className="inline-block">
      <BoutonEnvoi className="lien text-sm" enCours="…">{libelle}</BoutonEnvoi>
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
    </form>
  );
}
