"use client";

import { useActionState } from "react";
import { actionConnexion, type EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

export function FormConnexion() {
  const [etat, action] = useActionState(actionConnexion, {} as EtatFormulaire);
  return (
    <form action={action} className="space-y-4">
      <Alerte>{etat.erreur}</Alerte>
      <Champ label="Numéro de téléphone" name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="07 07 12 34 56" defaultValue={etat.valeurs?.phone} />
      <Champ label="Mot de passe" name="password" type="password" autoComplete="current-password" required />
      <BoutonEnvoi enCours="Connexion…">Se connecter</BoutonEnvoi>
    </form>
  );
}
