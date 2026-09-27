"use client";

import { useActionState } from "react";
import { actionAccesParent, type EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

export function FormParent() {
  const [etat, action] = useActionState(actionAccesParent, {} as EtatFormulaire);
  const v = etat.valeurs ?? {};
  return (
    <form action={action} className="space-y-4">
      <Alerte>{etat.erreur}</Alerte>
      <Champ label="Matricule école ou matricule DESPS de l'élève" name="identifiant" required autoCapitalize="characters" placeholder="CP1-001-26 ou A12345678" defaultValue={v.identifiant} />
      <Champ label="Date de naissance de l'élève" name="naissance" type="date" required defaultValue={v.naissance} />
      {etat.choixEcoles && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">École de votre enfant</legend>
          {etat.choixEcoles.map((e) => (
            <label key={e.schoolId} className="flex items-center gap-2 rounded-lg border border-bordure px-3 py-2">
              <input type="radio" name="schoolId" value={e.schoolId} required /> {e.nom}
            </label>
          ))}
        </fieldset>
      )}
      <BoutonEnvoi enCours="Recherche…">Consulter</BoutonEnvoi>
    </form>
  );
}
