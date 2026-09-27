"use client";

import { useActionState } from "react";
import { actionInscription, type EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

export function FormInscription() {
  const [etat, action] = useActionState(actionInscription, {} as EtatFormulaire);
  const v = etat.valeurs ?? {};
  const err = (c: string) => etat.champ === c && etat.erreur;
  return (
    <form action={action} className="space-y-4" noValidate>
      {!etat.champ && <Alerte>{etat.erreur}</Alerte>}
      <Champ label="Nom et prénoms du directeur" name="fullName" autoComplete="name" required defaultValue={v.fullName} erreur={err("fullName")} />
      <Champ label="Numéro de téléphone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="07 07 12 34 56" defaultValue={v.phone} erreur={err("phone")} aide="C'est votre identifiant. Un code de validation y sera envoyé par SMS." />
      <Champ label="Nom de l'établissement" name="schoolName" required placeholder="EPP LIGUIYO" defaultValue={v.schoolName} erreur={err("schoolName")} />
      <Champ label="Code établissement (facultatif)" name="schoolCode" placeholder="EPP-GAG-0123" defaultValue={v.schoolCode} erreur={err("schoolCode")} />
      <Champ label="Mot de passe" name="password" type="password" autoComplete="new-password" required erreur={err("password")} aide="8 caractères au moins, avec une lettre et un chiffre." />
      <Champ label="Confirmer le mot de passe" name="confirm" type="password" autoComplete="new-password" required erreur={err("confirm")} />
      <BoutonEnvoi enCours="Envoi du code…">Recevoir le code par SMS</BoutonEnvoi>
    </form>
  );
}
