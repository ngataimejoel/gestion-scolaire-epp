"use client";

import { useEffect, useState } from "react";
import { api, type Ecole, type Matiere } from "@/lib/api";
import { Alerte, Bouton, Champ, classeInput, confirmer, Entete, Tableau, useDonnees } from "@/components/ui";

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-700">{titre}</h2>
      {children}
    </section>
  );
}

export default function PageParametres() {
  return (
    <div className="max-w-5xl">
      <Entete titre="Paramètres" />
      <InfosEcole />
      <Matieres />
      <Sauvegardes />
    </div>
  );
}

function InfosEcole() {
  const [ecole, setEcole] = useState<Ecole | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: "erreur" | "succes" } | null>(null);
  useEffect(() => { api.ecole().then(setEcole); }, []);
  if (!ecole) return null;
  const ch = (k: keyof Ecole) => (e: React.ChangeEvent<HTMLInputElement>) => setEcole({ ...ecole, [k]: e.target.value });

  async function enregistrer() {
    try {
      setEcole(await api.enregistrerEcole(ecole!));
      setMessage({ texte: "Informations enregistrées.", type: "succes" });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  return (
    <Section titre="École">
      <Alerte message={message?.texte ?? null} type={message?.type} />
      <form onSubmit={(e) => { e.preventDefault(); enregistrer(); }}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Champ label="Nom de l'école"><input className={classeInput} value={ecole.nom} onChange={ch("nom")} placeholder="ex. EPP BABADOUGOU" /></Champ>
          <Champ label="Code de l'école"><input className={classeInput} value={ecole.code} onChange={ch("code")} /></Champ>
          <Champ label="Année scolaire"><input className={classeInput} value={ecole.annee_scolaire} onChange={ch("annee_scolaire")} placeholder="ex. 2026-2027" /></Champ>
          <Champ label="IEPP"><input className={classeInput} value={ecole.iepp} onChange={ch("iepp")} /></Champ>
          <Champ label="DREN"><input className={classeInput} value={ecole.dren} onChange={ch("dren")} /></Champ>
          <Champ label="Directeur / Directrice"><input className={classeInput} value={ecole.directeur} onChange={ch("directeur")} /></Champ>
          <Champ label="Contact"><input className={classeInput} value={ecole.contact} onChange={ch("contact")} /></Champ>
          <Champ label="Moyenne d'admission (sur 10)">
            <input type="number" step="0.25" min={0} max={10} className={classeInput} value={ecole.moyenne_admission} onChange={ch("moyenne_admission")} />
          </Champ>
        </div>
        <div className="mt-4"><Bouton type="submit" variante="principal">Enregistrer</Bouton></div>
      </form>
    </Section>
  );
}

const GROUPES = { FR: "Français", MATH: "Mathématiques", AUTRE: "Autre" } as const;

function Matieres() {
  const { donnees: niveaux } = useDonnees(api.niveaux);
  const [niveau, setNiveau] = useState("CM2");
  const [lignes, setLignes] = useState<Matiere[]>([]);
  const [message, setMessage] = useState<{ texte: string; type: "erreur" | "succes" } | null>(null);
  const recharger = () => api.matieres(niveau).then(setLignes);
  useEffect(() => { api.matieres(niveau).then(setLignes); }, [niveau]);

  const maj = (i: number, m: Partial<Matiere>) => setLignes(lignes.map((l, j) => (j === i ? { ...l, ...m } : l)));
  const total = lignes.reduce((s, m) => s + (Number(m.bareme) || 0), 0);

  async function enregistrer() {
    try {
      for (const [i, m] of lignes.entries()) await api.enregistrerMatiere({ ...m, niveau, ordre: i });
      setMessage({ texte: `Matières du ${niveau} enregistrées.`, type: "succes" });
      recharger();
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  async function supprimer(i: number) {
    const m = lignes[i];
    if (m.id) {
      if (!confirmer(`Supprimer la matière « ${m.nom} » ? Les notes déjà saisies dans cette matière seront effacées.`)) return;
      await api.supprimerMatiere(m.id);
    }
    setLignes(lignes.filter((_, j) => j !== i));
  }

  return (
    <Section titre="Matières et barèmes">
      <p className="mb-3 text-sm text-slate-500">
        La moyenne sur 10 = total des notes ÷ total des barèmes × 10. Le groupe sert aux classements « meilleurs en français / mathématiques ».
      </p>
      <div className="mb-3 flex gap-1">
        {niveaux?.map((n) => (
          <button key={n} onClick={() => { setNiveau(n); setMessage(null); }}
            className={`rounded-md px-3 py-1 text-sm ${n === niveau ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {n}
          </button>
        ))}
      </div>
      <Alerte message={message?.texte ?? null} type={message?.type} />
      <Tableau>
        <thead><tr><th>Matière</th><th>Barème</th><th>Groupe</th><th></th></tr></thead>
        <tbody>
          {lignes.map((m, i) => (
            <tr key={m.id ?? `n${i}`}>
              <td><input className={`${classeInput} w-full`} value={m.nom} onChange={(e) => maj(i, { nom: e.target.value })} /></td>
              <td><input type="number" min={1} className={`${classeInput} w-24`} value={m.bareme} onChange={(e) => maj(i, { bareme: Number(e.target.value) })} /></td>
              <td>
                <select className={classeInput} value={m.groupe} onChange={(e) => maj(i, { groupe: e.target.value as Matiere["groupe"] })}>
                  {Object.entries(GROUPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="text-right"><button className="text-red-700 hover:underline" onClick={() => supprimer(i)}>Supprimer</button></td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold"><td>Total</td><td>{total}</td><td colSpan={2}></td></tr>
        </tbody>
      </Tableau>
      <div className="mt-3 flex gap-2">
        <Bouton onClick={() => setLignes([...lignes, { niveau, nom: "", bareme: 10, groupe: "AUTRE", ordre: lignes.length }])}>+ Ajouter une matière</Bouton>
        <Bouton variante="principal" onClick={enregistrer}>Enregistrer les matières</Bouton>
      </div>
    </Section>
  );
}

function Sauvegardes() {
  const { donnees: infos } = useDonnees(api.infos);
  const [message, setMessage] = useState<{ texte: string; type: "erreur" | "succes" } | null>(null);

  async function sauvegarder() {
    try {
      const f = await api.sauvegarder();
      if (f) setMessage({ texte: `Sauvegarde enregistrée : ${f}`, type: "succes" });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  async function restaurer() {
    if (!confirmer("Restaurer une sauvegarde remplacera toutes les données actuelles (une copie de sécurité est faite avant). Continuer ?")) return;
    try {
      const f = await api.restaurer();
      if (f) {
        alert("Sauvegarde restaurée. L'application va se recharger.");
        window.location.reload();
      }
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  return (
    <Section titre="Sauvegarde des données">
      <p className="mb-3 text-sm text-slate-600">
        Une sauvegarde automatique est faite chaque jour à l&apos;ouverture (les 15 dernières sont gardées). Pensez aussi à copier
        régulièrement une sauvegarde sur une clé USB.
      </p>
      <Alerte message={message?.texte ?? null} type={message?.type} />
      <div className="mb-4 flex gap-2">
        <Bouton variante="principal" onClick={sauvegarder}>Sauvegarder vers…</Bouton>
        <Bouton variante="danger" onClick={restaurer}>Restaurer une sauvegarde…</Bouton>
      </div>
      {infos && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-slate-500">
          <dt>Version</dt><dd>{infos.version}</dd>
          <dt>Base de données</dt><dd className="break-all">{infos.base}</dd>
          <dt>Sauvegardes automatiques</dt><dd className="break-all">{infos.sauvegardes}</dd>
        </dl>
      )}
    </Section>
  );
}
