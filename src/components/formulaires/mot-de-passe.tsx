"use client";

import { useActionState } from "react";
import { actionChangerMotDePasse, actionMotDePasseOublie, actionReinitialiser, type EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

const AIDE = "8 caractères au moins, avec une lettre et un chiffre.";

export function FormMotDePasseOublie() {
  const [etat, action] = useActionState(actionMotDePasseOublie, {} as EtatFormulaire);
  return (
    <form action={action} className="space-y-4">
      <Alerte>{etat.erreur}</Alerte>
      <Champ label="Numéro de téléphone du compte" name="phone" type="tel" inputMode="tel" autoComplete="username" required defaultValue={etat.valeurs?.phone} />
      <BoutonEnvoi enCours="Envoi…">Recevoir un code par SMS</BoutonEnvoi>
    </form>
  );
}

export function FormReinitialiser({ renvoi }: { renvoi: (e: EtatFormulaire) => Promise<EtatFormulaire> }) {
  const [etat, action] = useActionState(actionReinitialiser, {} as EtatFormulaire);
  const [etatRenvoi, renvoyer] = useActionState(renvoi, {} as EtatFormulaire);
  const err = (c: string) => etat.champ === c && etat.erreur;
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {!etat.champ && <Alerte>{etat.erreur}</Alerte>}
        <Champ label="Code reçu par SMS" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
        <Champ label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required aide={AIDE} erreur={err("password")} />
        <Champ label="Confirmer le nouveau mot de passe" name="confirm" type="password" autoComplete="new-password" required erreur={err("confirm")} />
        <BoutonEnvoi enCours="Enregistrement…">Enregistrer le nouveau mot de passe</BoutonEnvoi>
      </form>
      <form action={renvoyer} className="text-center">
        {etatRenvoi.erreur && <Alerte>{etatRenvoi.erreur}</Alerte>}
        {etatRenvoi.info && <Alerte type="succes">{etatRenvoi.info}</Alerte>}
        <BoutonEnvoi className="lien mt-2 text-sm" enCours="Envoi…">Renvoyer le code</BoutonEnvoi>
      </form>
    </div>
  );
}

export function FormChangerMotDePasse() {
  const [etat, action] = useActionState(actionChangerMotDePasse, {} as EtatFormulaire);
  const err = (c: string) => etat.champ === c && etat.erreur;
  return (
    <form action={action} className="space-y-4">
      {!etat.champ && <Alerte>{etat.erreur}</Alerte>}
      <Champ label="Mot de passe actuel (ou provisoire)" name="current" type="password" autoComplete="current-password" required erreur={err("current")} />
      <Champ label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required aide={AIDE} erreur={err("password")} />
      <Champ label="Confirmer le nouveau mot de passe" name="confirm" type="password" autoComplete="new-password" required erreur={err("confirm")} />
      <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
    </form>
  );
}
