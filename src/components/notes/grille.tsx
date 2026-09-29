"use client";

import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { moyenneEvaluation, totalEvaluation, type FeuilleNotes } from "@/lib/regles";
import { Alerte } from "../ui";

export interface LigneGrille {
  enrollmentId: string;
  matricule: string;
  nom: string;
  sexe: string;
  statut: string;
  present: boolean | null;
  notes: (number | null)[];
}
export interface MatiereGrille {
  id: string;
  nom: string;
  max: number;
  poids: number;
}

const texte = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
const f2 = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ","));
const lire = (v: string) => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Feuille de notes : les moyennes se recalculent pendant la saisie avec le même moteur que le serveur.
 * Entrée passe à l'élève suivant dans la même matière. Une note hors barème est signalée avant l'envoi.
 */
export function GrilleNotes({
  action,
  lignes,
  matieres,
  feuille,
  echelle,
  modifiable,
  empreinte,
}: {
  action: (e: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;
  lignes: LigneGrille[];
  matieres: MatiereGrille[];
  feuille: FeuilleNotes;
  echelle: number;
  modifiable: boolean;
  empreinte: string;
}) {
  const initial = useMemo(
    () => Object.fromEntries(lignes.flatMap((l) => matieres.map((m, i) => [`${l.enrollmentId}:${m.id}`, texte(l.notes[i])]))),
    [lignes, matieres],
  );
  const presenceInitiale = useMemo(() => Object.fromEntries(lignes.map((l) => [l.enrollmentId, l.present !== false])), [lignes]);
  const [valeurs, setValeurs] = useState<Record<string, string>>(initial);
  const [presence, setPresence] = useState<Record<string, boolean>>(presenceInitiale);
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  const [enCours, demarrer] = useTransition();

  // Après un enregistrement, la page renvoie la version à jour : on repart d'elle.
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setValeurs(initial);
    setPresence(presenceInitiale);
  }

  const modifie = lignes.some((l) => presence[l.enrollmentId] !== presenceInitiale[l.enrollmentId]) || Object.keys(initial).some((k) => initial[k] !== valeurs[k]);
  useEffect(() => {
    if (!modifie) return;
    const f = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [modifie]);

  const cfg = matieres.map((m) => ({ nom: m.nom, poids: m.poids }));
  const invalide = (m: MatiereGrille, v: string) => {
    const n = lire(v);
    return n != null && (Number.isNaN(n) || n < 0 || n > m.max);
  };
  const erreurs = lignes.flatMap((l) => (presence[l.enrollmentId] ? matieres.filter((m) => invalide(m, valeurs[`${l.enrollmentId}:${m.id}`] ?? "")).map((m) => `${l.nom} (${m.nom})`) : []));

  function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (erreurs.length) return;
    const fd = new FormData();
    fd.set("empreinte", empreinte);
    for (const l of lignes) {
      fd.set(`p:${l.enrollmentId}`, presence[l.enrollmentId] ? "OUI" : "NON");
      if (presence[l.enrollmentId]) for (const m of matieres) fd.set(`n:${l.enrollmentId}:${m.id}`, valeurs[`${l.enrollmentId}:${m.id}`] ?? "");
    }
    demarrer(() => envoyer(fd));
  }

  function clavier(e: KeyboardEvent<HTMLInputElement>, ligne: number, col: number) {
    const cible = e.key === "Enter" || e.key === "ArrowDown" ? [ligne + 1, col] : e.key === "ArrowUp" ? [ligne - 1, col] : null;
    if (!cible) return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-cell="${cible[0]}:${cible[1]}"]`)?.focus();
  }

  const totalBareme = matieres.reduce((s, m) => s + m.max, 0);
  return (
    <form onSubmit={soumettre} className="space-y-3">
      <div className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-bordure text-attenue">
            <tr>
              <th className="px-2 py-2 text-left font-medium">N°</th>
              <th className="px-2 py-2 text-left font-medium">Matricule</th>
              <th className="px-2 py-2 text-left font-medium">Nom et prénoms</th>
              <th className="px-2 py-2 font-medium">Présent ?</th>
              {matieres.map((m) => (
                <th key={m.id} className="px-1 py-2 text-center text-xs font-medium">
                  {m.nom}
                  <span className="block tabular-nums">{feuille === "CP" ? `coef. ${String(m.poids).replace(".", ",")}` : `/${m.max}`}</span>
                </th>
              ))}
              {feuille !== "CP" && (
                <th className="px-2 py-2 text-right font-medium">
                  Total<span className="block tabular-nums">/{totalBareme}</span>
                </th>
              )}
              <th className="px-2 py-2 text-right font-medium">
                Moyenne<span className="block tabular-nums">/{feuille === "CP" ? 10 : echelle}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const present = presence[l.enrollmentId];
              const notes = matieres.map((m) => {
                const n = lire(valeurs[`${l.enrollmentId}:${m.id}`] ?? "");
                return n == null || Number.isNaN(n) ? null : n;
              });
              const rien = presence[l.enrollmentId] && l.present === null && notes.every((n) => n == null);
              const s = rien ? null : { present, notes };
              const moyenne = moyenneEvaluation(feuille, cfg, s, feuille === "CP" ? 10 : echelle);
              const horsEffectif = l.statut !== "PRESENT";
              return (
                <tr key={l.enrollmentId} className={`border-b border-bordure last:border-0 ${!present ? "bg-zinc-100 dark:bg-zinc-800/40" : horsEffectif ? "bg-rose-50 dark:bg-rose-950/30" : ""}`}>
                  <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.matricule}</td>
                  <td className="px-2 py-1.5 font-medium">
                    {l.nom}
                    {horsEffectif && <span className="ml-1 text-xs font-normal text-attenue">({l.statut === "ABANDON" ? "abandon" : "transféré"})</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <select
                      aria-label={`Présent ? ${l.nom}`}
                      disabled={!modifiable}
                      value={present ? "OUI" : "NON"}
                      onChange={(e) => setPresence({ ...presence, [l.enrollmentId]: e.target.value === "OUI" })}
                      className="rounded border border-bordure bg-surface px-1 py-1"
                    >
                      <option>OUI</option>
                      <option>NON</option>
                    </select>
                  </td>
                  {matieres.map((m, j) => {
                    const k = `${l.enrollmentId}:${m.id}`;
                    const mauvais = present && invalide(m, valeurs[k] ?? "");
                    const enErreur = etat.champ === `n:${k}`;
                    return (
                      <td key={m.id} className="px-1 py-1 text-center">
                        <input
                          data-cell={`${i}:${j}`}
                          aria-label={`${m.nom}, ${l.nom}`}
                          aria-invalid={mauvais || enErreur ? true : undefined}
                          inputMode="decimal"
                          autoComplete="off"
                          disabled={!modifiable || !present}
                          value={valeurs[k] ?? ""}
                          onChange={(e) => setValeurs({ ...valeurs, [k]: e.target.value })}
                          onKeyDown={(e) => clavier(e, i, j)}
                          className="w-14 rounded border border-bordure bg-surface px-1 py-1 text-center tabular-nums outline-none focus:border-principal aria-[invalid=true]:border-erreur aria-[invalid=true]:bg-erreur-fond disabled:opacity-50"
                        />
                      </td>
                    );
                  })}
                  {feuille !== "CP" && <td className="px-2 py-1.5 text-right tabular-nums text-attenue">{s ? texte(totalEvaluation(s)) : ""}</td>}
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${moyenne === 0 ? "text-erreur" : ""}`}>{f2(moyenne)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {erreurs.length > 0 && <Alerte>Note hors barème : {erreurs.slice(0, 3).join(", ")}{erreurs.length > 3 ? "…" : ""}</Alerte>}
      {!enCours && etat.erreur && <Alerte>{etat.erreur}</Alerte>}
      {modifiable && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-bordure bg-fond/95 py-3">
          <button type="submit" disabled={enCours || !!erreurs.length} className="btn-principal">
            {enCours ? "Enregistrement…" : "Enregistrer les notes"}
          </button>
          {modifie && !enCours && <span className="text-sm text-attenue">Modifications non enregistrées</span>}
          {!modifie && !enCours && etat.info && <Alerte type="succes">{etat.info}</Alerte>}
        </div>
      )}
    </form>
  );
}
