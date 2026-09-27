"use client";

import { useActionState } from "react";
import type { EtatPersonnel } from "@/app/actions/personnel";
import { formaterTelephone } from "@/lib/auth/telephone";
import { Alerte, BoutonEnvoi } from "../ui";
import { ChampFiche, Choix, ErreursFiche, Texte, useFiche } from "./fiche";

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

export interface ValeursPersonnel {
  matricule?: string;
  lastName?: string;
  firstNames?: string;
  sex?: string;
  birthDate?: string;
  function?: string;
  grade?: string | null;
  diploma?: string | null;
  serviceStartDate?: string;
  arrivalDate?: string;
  phone?: string | null;
  maritalStatus?: string | null;
  notes?: string | null;
  classroomId?: string;
}

/** Fiche du personnel : colonnes de la feuille PERSONNEL, plus la classe tenue. */
export function FormPersonnel({
  action,
  fonctions,
  situations,
  classes,
  valeurs,
}: {
  action: (e: EtatPersonnel, fd: FormData) => Promise<EtatPersonnel>;
  fonctions: string[];
  situations: string[];
  classes: [string, string][];
  valeurs?: ValeursPersonnel;
}) {
  const { etat, enCours, soumettre, erreurs } = useFiche(action);
  const v = valeurs ?? {};
  const nouveau = !valeurs;
  // Après un enregistrement réussi d'un nouveau membre, le formulaire repart à vide (clé changée).
  const cle = nouveau && (etat.identifiants || etat.info) ? JSON.stringify(etat) : "fiche";
  return (
    <ErreursFiche etat={erreurs}>
      {!enCours && etat.identifiants && <Identifiants i={etat.identifiants} />}
      <form key={cle} onSubmit={soumettre} className="mt-4 space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          <ChampFiche label="Matricule" name="matricule" required defaultValue={v.matricule ?? ""} />
          <ChampFiche label="Nom" name="lastName" required defaultValue={v.lastName ?? ""} />
          <ChampFiche label="Prénoms" name="firstNames" required defaultValue={v.firstNames ?? ""} />
          <Choix label="Sexe" name="sex" options={["M", "F"]} vide={v.sex ? undefined : "Choisir"} defaultValue={v.sex ?? ""} required />
          <ChampFiche label="Date de naissance" name="birthDate" type="date" defaultValue={v.birthDate ?? ""} />
          <Choix label="Fonction" name="function" options={fonctions} vide={v.function ? undefined : "Choisir"} defaultValue={v.function ?? ""} required />
          <ChampFiche label="Grade / emploi" name="grade" defaultValue={v.grade ?? ""} />
          <ChampFiche label="Diplôme" name="diploma" defaultValue={v.diploma ?? ""} />
          <Choix label="Classe tenue (année en cours)" name="classroomId" options={classes} vide="Aucune" defaultValue={v.classroomId ?? ""} />
          <ChampFiche label="Date de prise de service" name="serviceStartDate" type="date" defaultValue={v.serviceStartDate ?? ""} />
          <ChampFiche label="Date d'arrivée dans l'école" name="arrivalDate" type="date" defaultValue={v.arrivalDate ?? ""} />
          <ChampFiche label="Contact" name="phone" type="tel" inputMode="tel" defaultValue={v.phone ?? ""} aide="Obligatoire pour un enseignant : c'est son identifiant." />
          <Choix label="Situation matrimoniale" name="maritalStatus" options={situations} vide="—" defaultValue={v.maritalStatus ?? ""} />
        </div>
        <Texte label="Observations" name="notes" defaultValue={v.notes ?? ""} />
        {!enCours && etat.erreur && <Alerte>{etat.champ ? `Vérifiez le champ signalé : ${etat.erreur}` : etat.erreur}</Alerte>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={enCours} className="btn-principal">
            {enCours ? "Enregistrement…" : nouveau ? "Enregistrer" : "Enregistrer les modifications"}
          </button>
          {!enCours && etat.info && <Alerte type="succes">{etat.info}</Alerte>}
        </div>
      </form>
    </ErreursFiche>
  );
}

/** Crée le compte ou génère un nouveau mot de passe provisoire (envoyé par SMS). */
export function BoutonNouveauMotDePasse({ action, libelle }: { action: (e: EtatPersonnel) => Promise<EtatPersonnel>; libelle: string }) {
  const [etat, envoyer] = useActionState(action, {} as EtatPersonnel);
  return (
    <div className="space-y-2">
      <form action={envoyer}>
        <BoutonEnvoi className="btn-secondaire" enCours="Envoi…">{libelle}</BoutonEnvoi>
      </form>
      {etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      {etat.identifiants && <Identifiants i={etat.identifiants} />}
    </div>
  );
}
