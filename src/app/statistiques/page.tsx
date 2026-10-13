"use client";

import { useState } from "react";
import { api, age, dateFr, fmt, type LigneRapport } from "@/lib/api";
import { exporterExcel } from "@/lib/excel";
import { Bouton, Champ, classeInput, Entete, EnteteImpression, Tableau, useDonnees, Vide } from "@/components/ui";

const CRITERES = { moyenne: "Moyenne générale", fr: "Français", math: "Mathématiques" } as const;
type Critere = keyof typeof CRITERES;

export default function PageStatistiques() {
  const { donnees: compositions } = useDonnees(api.compositions);
  const { donnees: ecole } = useDonnees(api.ecole);
  const [compChoisie, setCompId] = useState<number | null>(null);
  const [vue, setVue] = useState<"rapport" | Critere>("rapport");
  const [nombre, setNombre] = useState(3);

  const compId = compositions?.some((c) => c.id === compChoisie) ? compChoisie : (compositions?.[0]?.id ?? null);

  if (compositions && !compositions.length) return (<div><Entete titre="Statistiques" /><Vide>Aucune composition enregistrée.</Vide></div>);
  const comp = compositions?.find((c) => c.id === compId);

  return (
    <div>
      <Entete titre="Statistiques" >
        <Bouton onClick={() => window.print()}>Imprimer</Bouton>
      </Entete>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <Champ label="Composition">
          <select className={classeInput} value={compId ?? ""} onChange={(e) => setCompId(Number(e.target.value))}>
            {compositions?.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </select>
        </Champ>
        <Champ label="Document">
          <select className={classeInput} value={vue} onChange={(e) => setVue(e.target.value as typeof vue)}>
            <option value="rapport">Rapport statistique par niveau</option>
            {Object.entries(CRITERES).map(([k, v]) => <option key={k} value={k}>Meilleurs élèves — {v}</option>)}
          </select>
        </Champ>
        {vue !== "rapport" && (
          <Champ label="Nombre par niveau">
            <input type="number" min={1} max={50} className={`${classeInput} w-24`} value={nombre} onChange={(e) => setNombre(Math.max(1, Number(e.target.value) || 1))} />
          </Champ>
        )}
      </div>
      {comp && (vue === "rapport"
        ? <Rapport compositionId={comp.id!} titre={`Rapport statistique de la ${comp.libelle}`} ecole={ecole} />
        : <Meilleurs compositionId={comp.id!} critere={vue} nombre={nombre} titre={`Les meilleurs élèves ${vue === "moyenne" ? "de la classe" : `en ${CRITERES[vue].toLowerCase()}`} par niveau — ${comp.libelle}`} ecole={ecole} />)}
    </div>
  );
}

type EcoleImpr = Parameters<typeof EnteteImpression>[0]["ecole"];

function Rapport({ compositionId, titre, ecole }: { compositionId: number; titre: string; ecole: EcoleImpr }) {
  const { donnees: r } = useDonnees(() => api.rapport(compositionId), [compositionId]);
  if (!r) return null;
  if (!r.niveaux.length) return <Vide>Aucun élève inscrit dans les classes.</Vide>;
  const lignes = [...r.niveaux, r.total];
  const cellules = (l: LigneRapport) =>
    (["inscrits", "presents", "admis"] as const).flatMap((k) => [l[k].G, l[k].F, l[k].T]).concat([l.taux.G, l.taux.F, l.taux.T]);

  return (
    <div>
      <div className="no-print mb-3">
        <Bouton
          onClick={() =>
            exporterExcel(titre, lignes.map((l) => {
              const c = cellules(l);
              return {
                Niveau: l.niveau, "Inscrits G": c[0], "Inscrits F": c[1], "Inscrits T": c[2],
                "Présents G": c[3], "Présents F": c[4], "Présents T": c[5],
                "Admis G": c[6], "Admis F": c[7], "Admis T": c[8],
                "Taux G (%)": c[9], "Taux F (%)": c[10], "Taux T (%)": c[11],
              };
            }), "Rapport")
          }
        >
          Exporter Excel
        </Bouton>
      </div>
      <EnteteImpression ecole={ecole} titre={titre} />
      <Tableau>
        <thead>
          <tr>
            <th rowSpan={2}>Niveau</th>
            <th colSpan={3} className="text-center">Inscrits</th>
            <th colSpan={3} className="text-center">Présents</th>
            <th colSpan={3} className="text-center">Admis</th>
            <th colSpan={3} className="text-center">Taux de réussite (%)</th>
          </tr>
          <tr>{Array.from({ length: 4 }).flatMap((_, i) => ["G", "F", "T"].map((x) => <th key={`${i}${x}`} className="text-center">{x}</th>))}</tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.niveau} className={l.niveau === "TOTAL" ? "bg-slate-50 font-semibold" : ""}>
              <td className="font-medium">{l.niveau}</td>
              {cellules(l).map((v, i) => <td key={i} className={`text-center ${i % 3 === 2 ? "font-semibold" : ""}`}>{fmt(v)}</td>)}
            </tr>
          ))}
        </tbody>
      </Tableau>
    </div>
  );
}

function Meilleurs({ compositionId, critere, nombre, titre, ecole }: { compositionId: number; critere: Critere; nombre: number; titre: string; ecole: EcoleImpr }) {
  const { donnees: niveaux } = useDonnees(() => api.meilleurs(compositionId, critere, nombre), [compositionId, critere, nombre]);
  if (!niveaux) return null;
  if (!niveaux.length) return <Vide>Aucun résultat pour cette composition.</Vide>;
  const lignes = niveaux.flatMap((n) => n.eleves);
  const libelleNote = critere === "moyenne" ? "Moyenne" : "Note /10";

  return (
    <div>
      <div className="no-print mb-3">
        <Bouton
          onClick={() =>
            exporterExcel(titre, lignes.map((l, i) => ({
              "N°": i + 1, Ecole: ecole?.nom ?? "", Matricule: l.matricule, Nom: l.nom, "Prénoms": l.prenoms, Sexe: l.sexe,
              "Date de Naiss": dateFr(l.date_naissance), Age: age(l.date_naissance), [libelleNote]: l.note, Rang: l.rang_niveau,
              Niveau: l.niveau, Classe: l.classe, "Appréciation": l.appreciation, "Contact du parent": l.contact_parent,
            })), "Meilleurs")
          }
        >
          Exporter Excel
        </Bouton>
      </div>
      <EnteteImpression ecole={ecole} titre={titre} />
      <Tableau>
        <thead>
          <tr><th>Niveau</th><th>Rang</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Âge</th><th>Classe</th><th>{libelleNote}</th><th>Appréciation</th><th>Contact du parent</th></tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={`${l.niveau}-${l.id}`}>
              <td className="font-medium">{l.niveau}</td>
              <td>{l.rang_niveau}</td>
              <td>{l.matricule}</td>
              <td className="font-medium">{l.nom} {l.prenoms}</td>
              <td>{l.sexe}</td>
              <td>{age(l.date_naissance)}</td>
              <td>{l.classe}</td>
              <td className="font-semibold">{fmt(l.note)}</td>
              <td>{l.appreciation}</td>
              <td>{l.contact_parent}</td>
            </tr>
          ))}
        </tbody>
      </Tableau>
    </div>
  );
}
