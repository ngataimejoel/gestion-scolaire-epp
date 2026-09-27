"use client";

import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte } from "../ui";
import { ChampFiche, Choix, ErreursFiche, Texte, useErreur, useFiche } from "./fiche";

export interface ValeursEleve {
  classroomId?: string;
  despsId?: string | null;
  fullName?: string;
  sex?: string;
  birthDate?: string;
  nationality?: string | null;
  locality?: string | null;
  subPrefecture?: string | null;
  hasBirthCertificate?: boolean;
  certificateNumber?: string | null;
  certificateDate?: string;
  civilRegistryCenter?: string | null;
  isOrphan?: boolean;
  orphanOf?: string | null;
  isRepeating?: boolean;
  status?: string;
  statusDate?: string;
  notes?: string | null;
  parents?: Partial<Record<"pere" | "mere" | "tuteur", { fullName?: string | null; profession?: string | null; residence?: string | null; phone?: string | null }>>;
}

const OUI_NON = ["OUI", "NON"];
const ouiNon = (b?: boolean, defaut = "NON") => (b === undefined ? defaut : b ? "OUI" : "NON");

function Doublon() {
  const erreur = useErreur("confirmerDoublon");
  if (!erreur) return null;
  return (
    <div className="space-y-2 rounded-lg bg-info-fond px-3 py-2.5 text-sm">
      <p role="alert">{erreur}</p>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" name="confirmerDoublon" /> Il s&apos;agit bien d&apos;un autre enfant
      </label>
    </div>
  );
}

function Parent({ prefixe, titre, v = {} }: { prefixe: string; titre: string; v?: NonNullable<ValeursEleve["parents"]>["pere"] }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-semibold">{titre}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChampFiche label="Nom et prénoms" name={`${prefixe}.fullName`} defaultValue={v.fullName ?? ""} />
        <ChampFiche label="Profession" name={`${prefixe}.profession`} defaultValue={v.profession ?? ""} />
        <ChampFiche label="Domicile" name={`${prefixe}.residence`} defaultValue={v.residence ?? ""} />
        <ChampFiche label="Contact" name={`${prefixe}.phone`} type="tel" inputMode="tel" defaultValue={v.phone ?? ""} />
      </div>
    </fieldset>
  );
}

/** Fiche élève : mêmes colonnes que la feuille REGISTRE ELEVES. */
export function FormEleve({
  action,
  classes,
  nationalites,
  orphelins,
  valeurs = {},
  matricule,
}: {
  action: (e: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;
  classes: [string, string][];
  nationalites: string[];
  orphelins: string[];
  valeurs?: ValeursEleve;
  matricule?: string;
}) {
  const { etat, enCours, soumettre, erreurs } = useFiche(action);
  const v = valeurs;
  const erreurGlobale = erreurs.erreur && !erreurs.champ;
  return (
    <ErreursFiche etat={erreurs}>
      <form onSubmit={soumettre} className="space-y-6" noValidate>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Scolarité</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Choix label="Classe" name="classroomId" options={classes} vide={v.classroomId ? undefined : "Choisir"} defaultValue={v.classroomId ?? ""} required />
            <ChampFiche label="Matricule école" name="_matricule" disabled value={matricule ?? "Attribué à l'enregistrement"} aide="Figé après l'inscription." />
            <ChampFiche label="Matricule DESPS / identifiant" name="despsId" defaultValue={v.despsId ?? ""} maxLength={9} aide="9 caractères, majuscule en tête ou en fin." />
            <Choix label="Redoublant" name="isRepeating" options={OUI_NON} defaultValue={ouiNon(v.isRepeating)} />
            <Choix label="Statut" name="status" options={[["PRESENT", "Présent"], ["ABANDON", "Abandon"], ["TRANSFERE", "Transféré"]]} defaultValue={v.status ?? "PRESENT"} />
            <ChampFiche label="Date d'abandon ou de transfert" name="statusDate" type="date" defaultValue={v.statusDate ?? ""} />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">Identité</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <ChampFiche label="Nom et prénoms" name="fullName" defaultValue={v.fullName ?? ""} required autoComplete="off" />
            </div>
            <Choix label="Sexe" name="sex" options={[["M", "M"], ["F", "F"]]} vide={v.sex ? undefined : "Choisir"} defaultValue={v.sex ?? ""} required />
            <ChampFiche label="Date de naissance" name="birthDate" type="date" defaultValue={v.birthDate ?? ""} />
            <Choix label="Nationalité" name="nationality" options={nationalites} vide="—" defaultValue={v.nationality ?? "IVOIRIENNE"} />
            <ChampFiche label="Localité (lieu de naissance)" name="locality" defaultValue={v.locality ?? ""} />
            <ChampFiche label="Sous-préfecture" name="subPrefecture" defaultValue={v.subPrefecture ?? ""} />
          </div>
          <Doublon />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">Extrait de naissance</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            <Choix label="Extrait ?" name="hasBirthCertificate" options={OUI_NON} defaultValue={ouiNon(v.hasBirthCertificate, "OUI")} />
            <ChampFiche label="Acte N°" name="certificateNumber" defaultValue={v.certificateNumber ?? ""} />
            <ChampFiche label="Du" name="certificateDate" type="date" defaultValue={v.certificateDate ?? ""} />
            <ChampFiche label="Centre d'état civil" name="civilRegistryCenter" defaultValue={v.civilRegistryCenter ?? ""} />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Choix label="Orphelin ?" name="isOrphan" options={OUI_NON} defaultValue={ouiNon(v.isOrphan)} />
            <Choix label="Orphelin de" name="orphanOf" options={orphelins.filter((o) => o !== "-")} vide="—" defaultValue={v.orphanOf ?? ""} />
          </div>
        </fieldset>

        <Parent prefixe="pere" titre="Père" v={v.parents?.pere} />
        <Parent prefixe="mere" titre="Mère" v={v.parents?.mere} />
        <Parent prefixe="tuteur" titre="Tuteur" v={v.parents?.tuteur} />
        <Texte label="Observations" name="notes" defaultValue={v.notes ?? ""} />

        {erreurGlobale && <Alerte>{erreurs.erreur}</Alerte>}
        {erreurs.champ && erreurs.champ !== "confirmerDoublon" && <Alerte>Vérifiez le champ signalé : {erreurs.erreur}</Alerte>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={enCours} className="btn-principal">
            {enCours ? "Enregistrement…" : matricule ? "Enregistrer les modifications" : "Inscrire l'élève"}
          </button>
          {!enCours && etat.info && <Alerte type="succes">{etat.info}</Alerte>}
        </div>
      </form>
    </ErreursFiche>
  );
}
