"use client";

import { useEffect, useState } from "react";
import { api, fmt, type Composition, type Grille } from "@/lib/api";
import { exporterExcel } from "@/lib/excel";
import {
  Alerte, Bouton, Champ, classeInput, confirmer, Entete, EnteteImpression, Modal, Tableau, useDonnees, Vide,
} from "@/components/ui";

export default function PageCompositions() {
  const { donnees: compositions, recharger } = useDonnees(api.compositions);
  const { donnees: classes } = useDonnees(api.classes);
  const { donnees: ecole } = useDonnees(api.ecole);
  const [compChoisie, setCompId] = useState<number | null>(null);
  const [classeChoisie, setClasseId] = useState<number | null>(null);
  const [onglet, setOnglet] = useState<"saisie" | "resultats">("saisie");
  const [edition, setEdition] = useState<Composition | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Par défaut : la composition la plus récente et la première classe.
  const compId = compositions?.some((c) => c.id === compChoisie) ? compChoisie : (compositions?.[0]?.id ?? null);
  const classeId = classes?.some((c) => c.id === classeChoisie) ? classeChoisie : (classes?.[0]?.id ?? null);

  const comp = compositions?.find((c) => c.id === compId);

  async function enregistrer() {
    if (!edition) return;
    try {
      const id = await api.enregistrerComposition(edition);
      setEdition(null);
      setMessage(null);
      setCompId(id);
      recharger();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function supprimer() {
    if (!comp || !confirmer(`Supprimer « ${comp.libelle} » et toutes ses notes ?`)) return;
    await api.supprimerComposition(comp.id!);
    setCompId(null);
    recharger();
  }

  return (
    <div>
      <Entete titre="Compositions">
        <Bouton variante="principal" onClick={() => setEdition({ libelle: `Composition N°${(compositions?.length ?? 0) + 1}`, date: new Date().toISOString().slice(0, 10) })}>
          + Nouvelle composition
        </Bouton>
      </Entete>

      {compositions && compositions.length === 0 ? (
        <Vide>Aucune composition. Créez-en une pour saisir les notes.</Vide>
      ) : !classes?.length ? (
        <Vide>Créez d&apos;abord les classes et ajoutez les élèves.</Vide>
      ) : (
        <>
          <div className="no-print mb-4 flex flex-wrap items-end gap-3">
            <Champ label="Composition">
              <select className={classeInput} value={compId ?? ""} onChange={(e) => setCompId(Number(e.target.value))}>
                {compositions?.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </Champ>
            <Champ label="Classe">
              <select className={classeInput} value={classeId ?? ""} onChange={(e) => setClasseId(Number(e.target.value))}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </Champ>
            {comp && (
              <>
                <Bouton onClick={() => setEdition(comp)}>Renommer</Bouton>
                <Bouton variante="danger" onClick={supprimer}>Supprimer</Bouton>
              </>
            )}
          </div>
          <div className="no-print mb-4 flex gap-1 border-b border-slate-200">
            {(["saisie", "resultats"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOnglet(o)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${onglet === o ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                {o === "saisie" ? "Saisie des notes" : "Résultats et classement"}
              </button>
            ))}
          </div>
          {comp && classeId && (onglet === "saisie" ? (
            <Saisie key={`${comp.id}-${classeId}`} compositionId={comp.id!} classeId={classeId} />
          ) : (
            <ResultatsClasse key={`${comp.id}-${classeId}`} composition={comp} classeId={classeId} ecole={ecole} />
          ))}
        </>
      )}

      <Modal titre={edition?.id ? "Modifier la composition" : "Nouvelle composition"} ouvert={!!edition} fermer={() => { setEdition(null); setMessage(null); }}>
        {edition && (
          <form onSubmit={(e) => { e.preventDefault(); enregistrer(); }}>
            <Alerte message={message} />
            <div className="grid grid-cols-2 gap-3">
              <Champ label="Libellé *"><input className={classeInput} value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} required autoFocus /></Champ>
              <Champ label="Date"><input type="date" className={classeInput} value={edition.date} onChange={(e) => setEdition({ ...edition, date: e.target.value })} /></Champ>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Bouton type="button" onClick={() => setEdition(null)}>Annuler</Bouton>
              <Bouton type="submit" variante="principal">Enregistrer</Bouton>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function Saisie({ compositionId, classeId }: { compositionId: number; classeId: number }) {
  const [grille, setGrille] = useState<Grille | null>(null);
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [absents, setAbsents] = useState<Record<number, boolean>>({});
  const [modifie, setModifie] = useState(false);
  const [message, setMessage] = useState<{ texte: string; type: "erreur" | "succes" } | null>(null);

  useEffect(() => {
    api.grille(compositionId, classeId).then(
      (g) => {
        setGrille(g);
        setValeurs(Object.fromEntries(Object.entries(g.notes).map(([k, v]) => [k, String(v)])));
        setAbsents(Object.fromEntries(g.absents.map((id) => [id, true])));
      },
      (e: Error) => setMessage({ texte: e.message, type: "erreur" })
    );
  }, [compositionId, classeId]);

  if (!grille) return <Alerte message={message?.texte ?? null} />;
  if (!grille.eleves.length) return <Vide>Aucun élève dans cette classe.</Vide>;
  if (!grille.matieres.length) return <Vide>Aucune matière pour le niveau {grille.classe.niveau}. Ajoutez-les dans Paramètres.</Vide>;

  const totalBareme = grille.matieres.reduce((s, m) => s + m.bareme, 0);
  const lire = (k: string) => {
    const v = valeurs[k];
    return v === undefined || v.trim() === "" ? null : Number(v.replace(",", "."));
  };

  async function enregistrer() {
    if (!grille) return;
    const notes = grille.eleves.flatMap((e) =>
      grille.matieres.map((m) => ({ eleve_id: e.id!, matiere_id: m.id!, note: lire(`${e.id}:${m.id}`) }))
    );
    const nonValide = notes.find((n) => n.note !== null && Number.isNaN(n.note));
    if (nonValide) return setMessage({ texte: "Une note n'est pas un nombre valide.", type: "erreur" });
    const abs = Object.fromEntries(grille.eleves.map((e) => [e.id!, !!absents[e.id!]]));
    try {
      await api.enregistrerNotes(compositionId, { notes, absences: abs });
      setModifie(false);
      setMessage({ texte: "Notes enregistrées.", type: "succes" });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  // Entrée : passe à la même matière pour l'élève suivant.
  function clavier(e: React.KeyboardEvent<HTMLInputElement>, ligne: number, col: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-cellule="${ligne + 1}-${col}"]`)?.focus();
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Bouton variante="principal" onClick={enregistrer} disabled={!modifie}>Enregistrer les notes</Bouton>
        {modifie && <span className="text-sm text-amber-700">Modifications non enregistrées</span>}
        <span className="ml-auto text-sm text-slate-500">Entrée = élève suivant · Tab = matière suivante</span>
      </div>
      <Alerte message={message?.texte ?? null} type={message?.type} />
      <Tableau>
        <thead>
          <tr>
            <th>N°</th>
            <th>Nom et prénoms</th>
            <th>Abs.</th>
            {grille.matieres.map((m) => (
              <th key={m.id} className="text-center" title={m.nom}>
                <div className="max-w-24 truncate">{m.nom}</div>
                <div className="text-xs font-normal">/{m.bareme}</div>
              </th>
            ))}
            <th className="text-center">Total<div className="text-xs font-normal">/{totalBareme}</div></th>
            <th className="text-center">Moy.<div className="text-xs font-normal">/10</div></th>
          </tr>
        </thead>
        <tbody>
          {grille.eleves.map((e, i) => {
            const absent = !!absents[e.id!];
            const total = grille.matieres.reduce((s, m) => s + (lire(`${e.id}:${m.id}`) || 0), 0);
            return (
              <tr key={e.id} className={absent ? "bg-slate-100 text-slate-400" : ""}>
                <td>{i + 1}</td>
                <td className="whitespace-nowrap font-medium">{e.nom} {e.prenoms}</td>
                <td className="text-center">
                  <input type="checkbox" checked={absent} onChange={(ev) => { setAbsents({ ...absents, [e.id!]: ev.target.checked }); setModifie(true); }} />
                </td>
                {grille.matieres.map((m, j) => {
                  const k = `${e.id}:${m.id}`;
                  const v = lire(k);
                  const faux = v !== null && (Number.isNaN(v) || v < 0 || v > m.bareme);
                  return (
                    <td key={m.id} className="p-1 text-center">
                      <input
                        data-cellule={`${i}-${j}`}
                        disabled={absent}
                        inputMode="decimal"
                        className={`w-14 rounded border px-1 py-0.5 text-center ${faux ? "border-red-500 bg-red-50" : "border-slate-300"}`}
                        value={valeurs[k] ?? ""}
                        onChange={(ev) => { setValeurs({ ...valeurs, [k]: ev.target.value }); setModifie(true); }}
                        onKeyDown={(ev) => clavier(ev, i, j)}
                      />
                    </td>
                  );
                })}
                <td className="text-center font-medium">{absent ? "—" : fmt(total)}</td>
                <td className="text-center font-semibold">{absent ? "—" : fmt(Math.round((total / totalBareme) * 1000) / 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </Tableau>
    </div>
  );
}

function ResultatsClasse({
  composition, classeId, ecole,
}: { composition: Composition; classeId: number; ecole: Parameters<typeof EnteteImpression>[0]["ecole"] }) {
  const { donnees: r, erreur } = useDonnees(() => api.resultats(composition.id!, classeId), [composition.id, classeId]);
  if (erreur) return <Alerte message={erreur} />;
  if (!r) return null;
  if (!r.lignes.length) return <Vide>Aucun élève dans cette classe.</Vide>;
  const presents = r.lignes.filter((l) => l.rang);
  const admis = presents.filter((l) => l.admis);
  const moyClasse = presents.length ? presents.reduce((s, l) => s + l.moyenne, 0) / presents.length : 0;

  function exporter() {
    if (!r) return;
    exporterExcel(
      `${composition.libelle} ${r.classe.nom}`,
      r.lignes.map((l) => ({
        Rang: l.rang ?? "", Matricule: l.matricule, Nom: l.nom, "Prénoms": l.prenoms, Sexe: l.sexe,
        ...Object.fromEntries(r.matieres.map((m) => [`${m.nom}/${m.bareme}`, l.notes[m.id!] ?? ""])),
        [`Total/${r.total_bareme}`]: !l.rang ? "" : l.total,
        "Moyenne/10": !l.rang ? "" : l.moyenne,
        "Appréciation": l.appreciation,
        Décision: !l.rang ? l.appreciation : l.admis ? "Admis" : "Non admis",
      })),
      "Résultats"
    );
  }

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Bouton onClick={exporter}>Exporter Excel</Bouton>
        <Bouton onClick={() => window.print()}>Imprimer</Bouton>
      </div>
      <EnteteImpression ecole={ecole} titre={`Résultats ${composition.libelle} — ${r.classe.nom}`} />
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>Inscrits : <b>{r.lignes.length}</b></span>
        <span>Présents : <b>{presents.length}</b></span>
        <span>Admis (moyenne ≥ {fmt(r.seuil)}) : <b>{admis.length}</b></span>
        <span>Taux de réussite : <b>{presents.length ? fmt(Math.round((admis.length / presents.length) * 10000) / 100) : 0} %</b></span>
        <span>Moyenne de la classe : <b>{fmt(Math.round(moyClasse * 100) / 100)}</b></span>
      </div>
      <Tableau>
        <thead>
          <tr>
            <th>Rang</th><th>Nom et prénoms</th><th>Sexe</th>
            {r.matieres.map((m) => <th key={m.id} className="text-center" title={m.nom}><div className="max-w-20 truncate">{m.nom}</div><div className="text-xs font-normal">/{m.bareme}</div></th>)}
            <th className="text-center">Total</th><th className="text-center">Moy.</th><th>Appréciation</th><th>Décision</th>
          </tr>
        </thead>
        <tbody>
          {r.lignes.map((l) => (
            <tr key={l.id} className={!l.rang ? "text-slate-400" : ""}>
              <td className="font-semibold">{l.rang ? `${l.rang}${l.rang === 1 ? (l.sexe === "F" ? "re" : "er") : "e"}` : "—"}</td>
              <td className="whitespace-nowrap font-medium">{l.nom} {l.prenoms}</td>
              <td>{l.sexe}</td>
              {r.matieres.map((m) => <td key={m.id} className="text-center">{l.notes[m.id!] ?? ""}</td>)}
              <td className="text-center">{!l.rang ? "—" : fmt(l.total)}</td>
              <td className="text-center font-semibold">{!l.rang ? "—" : fmt(l.moyenne)}</td>
              <td>{l.appreciation}</td>
              <td className={l.admis ? "text-emerald-700" : "text-red-700"}>{!l.rang ? "" : l.admis ? "Admis" : "Non admis"}</td>
            </tr>
          ))}
        </tbody>
      </Tableau>
    </div>
  );
}
