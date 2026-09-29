"use client";

import { useState } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte } from "../ui";
import { ChampFiche, Choix, ErreursFiche, useErreur, useFiche } from "./fiche";

function Doublon() {
  const erreur = useErreur("confirmerDoublon");
  if (!erreur) return null;
  return (
    <div className="space-y-2 rounded-lg bg-info-fond px-3 py-2.5 text-sm sm:col-span-full">
      <p role="alert">{erreur}</p>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" name="confirmerDoublon" /> Il s&apos;agit bien d&apos;un autre événement
      </label>
    </div>
  );
}

/** Ajout d'une ligne au journal des retards et absences (élève ou agent). */
export function FormAbsence({
  action,
  personnes,
  motifs,
  libellePersonne,
  aujourdhui,
}: {
  action: (e: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;
  personnes: [string, string][];
  motifs: string[];
  libellePersonne: string;
  aujourdhui: string;
}) {
  const { etat, enCours, soumettre, erreurs } = useFiche(action);
  const [nature, setNature] = useState("ABSENCE");
  // Après chaque ajout réussi, le formulaire repart à vide.
  const [vu, setVu] = useState(etat);
  const [n, setN] = useState(0);
  if (vu !== etat) {
    setVu(etat);
    if (etat.info) setN(n + 1);
  }
  return (
    <ErreursFiche etat={erreurs}>
      <form key={n} onSubmit={soumettre} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate>
        <ChampFiche label="Date" name="date" type="date" defaultValue={aujourdhui} required />
        <div className="sm:col-span-1 lg:col-span-2">
          <Choix label={libellePersonne} name="personId" options={personnes} vide="Choisir" defaultValue="" required />
        </div>
        <Choix label="Nature" name="nature" options={[["ABSENCE", "Absence"], ["RETARD", "Retard"]]} value={nature} onChange={(e) => setNature(e.target.value)} />
        {nature === "ABSENCE" ? (
          <ChampFiche label="Jours d'absence" name="days" inputMode="decimal" placeholder="1 ou 0,5" />
        ) : (
          <ChampFiche label="Retard (minutes)" name="minutes" inputMode="numeric" placeholder="15" />
        )}
        <ChampFiche label="Motif" name="reason" list="motifs" autoComplete="off" />
        <datalist id="motifs">
          {motifs.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Choix label="Justifié ?" name="justified" options={["NON", "OUI"]} defaultValue="NON" />
        <ChampFiche label="Observation" name="notes" />
        <Doublon />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-full">
          <button type="submit" disabled={enCours} className="btn-principal">{enCours ? "Enregistrement…" : "Ajouter au journal"}</button>
          {!enCours && etat.info && <Alerte type="succes">{etat.info}</Alerte>}
          {!enCours && etat.erreur && etat.champ !== "confirmerDoublon" && <Alerte>{etat.erreur}</Alerte>}
        </div>
      </form>
    </ErreursFiche>
  );
}
