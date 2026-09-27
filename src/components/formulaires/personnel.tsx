"use client";

import { useActionState } from "react";
import { actionEnregistrerPersonnel, type EtatPersonnel } from "@/app/actions/personnel";
import { formaterTelephone } from "@/lib/auth/telephone";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

function Identifiants({ i }: { i: NonNullable<EtatPersonnel["identifiants"]> }) {
  return (
    <div role="status" className="rounded-lg bg-succes-fond px-4 py-3 text-sm">
      <p className="font-semibold text-principal">Compte créé{i.nom ? ` pour ${i.nom}` : ""}. Identifiants envoyés par SMS :</p>
      <p className="mt-1">
        Identifiant : <b className="tabular-nums">{formaterTelephone(i.phone)}</b> · Mot de passe provisoire :{" "}
        <b className="font-mono text-base">{i.motDePasse}</b>
      </p>
      <p className="mt-1 text-xs text-attenue">Ce mot de passe ne sera plus affiché. L&apos;enseignant devra le changer à sa première connexion.</p>
    </div>
  );
}

export function FormPersonnel({ fonctions }: { fonctions: string[] }) {
  const [etat, action] = useActionState(actionEnregistrerPersonnel, {} as EtatPersonnel);
  const v = etat.valeurs ?? {};
  const err = (c: string) => etat.champ === c && etat.erreur;
  return (
    <form key={etat.n ?? 0} action={action} className="space-y-4">
      {etat.identifiants && <Identifiants i={etat.identifiants} />}
      {etat.info && <Alerte type="succes">{etat.info}</Alerte>}
      {etat.erreur && !etat.champ && <Alerte>{etat.erreur}</Alerte>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ label="Nom" name="lastName" required defaultValue={v.lastName} erreur={err("lastName")} />
        <Champ label="Prénoms" name="firstNames" required defaultValue={v.firstNames} erreur={err("firstNames")} />
        <Champ label="Matricule" name="matricule" required defaultValue={v.matricule} erreur={err("matricule")} />
        <Champ label="Téléphone" name="phone" type="tel" inputMode="tel" defaultValue={v.phone} erreur={err("phone")} aide="Obligatoire pour un enseignant (identifiant de connexion)." />
        <label className="block text-sm font-medium">
          Sexe
          <select name="sex" className="champ" defaultValue={v.sex ?? ""} required aria-invalid={err("sex") ? true : undefined}>
            <option value="" disabled>Choisir</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
          {err("sex") && <span className="mt-1 block text-sm font-normal text-erreur">{etat.erreur}</span>}
        </label>
        <label className="block text-sm font-medium">
          Fonction
          <select name="function" className="champ" defaultValue={v.function ?? ""} required aria-invalid={err("function") ? true : undefined}>
            <option value="" disabled>Choisir</option>
            {fonctions.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          {err("function") && <span className="mt-1 block text-sm font-normal text-erreur">{etat.erreur}</span>}
        </label>
      </div>
      <BoutonEnvoi className="btn-principal" enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
    </form>
  );
}

export function BoutonNouveauMotDePasse({ action, libelle }: { action: (e: EtatPersonnel) => Promise<EtatPersonnel>; libelle: string }) {
  const [etat, envoyer] = useActionState(action, {} as EtatPersonnel);
  return (
    <div className="space-y-2">
      <form action={envoyer}>
        <BoutonEnvoi className="lien text-sm" enCours="Envoi…">{libelle}</BoutonEnvoi>
      </form>
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      {etat.identifiants && <Identifiants i={etat.identifiants} />}
    </div>
  );
}
