"use client";

import { useActionState } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi } from "../ui";

type Action = (e: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;

/** Envoi du classeur pour analyse (rien n'est enregistré dans l'école à cette étape). */
export function FormImport({ action }: { action: Action }) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  return (
    <form action={envoyer} className="space-y-3">
      <label className="block text-sm font-medium">
        Fichier du classeur (.xlsm ou .xlsx, 8 Mo au plus)
        <input type="file" name="fichier" accept=".xlsm,.xlsx" required className="champ" aria-invalid={etat.champ === "fichier" ? true : undefined} />
      </label>
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      <BoutonEnvoi className="btn-principal" enCours="Analyse du fichier…">Analyser le fichier</BoutonEnvoi>
    </form>
  );
}

/** Confirmation de l'import, avec les deux options désactivées par défaut. */
export function FormConfirmerImport({ action, ecarts, enseignants }: { action: Action; ecarts: number; enseignants: number }) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  return (
    <form action={envoyer} className="space-y-3">
      {ecarts > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="parametres" value="oui" className="mt-1" />
          <span>Remplacer les {ecarts} réglage{ecarts > 1 ? "s" : ""} de l&apos;école par ceux du fichier (voir la liste ci-dessus). Sinon, les réglages actuels sont gardés.</span>
        </label>
      )}
      {enseignants > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="comptes" value="oui" className="mt-1" />
          <span>Créer le compte des {enseignants} enseignant{enseignants > 1 ? "s" : ""} importé{enseignants > 1 ? "s" : ""} qui ont un téléphone et leur envoyer leurs identifiants par SMS.</span>
        </label>
      )}
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      <BoutonEnvoi className="btn-principal" enCours="Import en cours…">Confirmer l&apos;import</BoutonEnvoi>
    </form>
  );
}
