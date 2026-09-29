"use client";

import { useActionState } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi } from "../ui";

/** Petit bouton qui déclenche une action serveur sans champ, avec confirmation facultative. */
export function BoutonAction({
  action,
  libelle,
  confirmation,
  className = "lien text-sm",
}: {
  action: (e: EtatFormulaire) => Promise<EtatFormulaire>;
  libelle: string;
  confirmation?: string;
  className?: string;
}) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  return (
    <form action={envoyer} onSubmit={(e) => { if (confirmation && !window.confirm(confirmation)) e.preventDefault(); }} className="inline-block">
      <BoutonEnvoi className={className} enCours="…">{libelle}</BoutonEnvoi>
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      {etat.info && <Alerte type="succes">{etat.info}</Alerte>}
    </form>
  );
}
