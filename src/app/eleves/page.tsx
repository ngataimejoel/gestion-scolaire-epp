"use client";

import { useRef, useState } from "react";
import { api, age, dateFr, type Eleve } from "@/lib/api";
import { exporterExcel, lireElevesExcel } from "@/lib/excel";
import {
  Alerte, Bouton, Champ, classeInput, confirmer, Entete, EnteteImpression, Modal, Tableau, useDonnees, Vide,
} from "@/components/ui";

const VIDE: Eleve = {
  matricule: "", nom: "", prenoms: "", sexe: "M", date_naissance: "", lieu_naissance: "",
  classe_id: null, redoublant: 0, nom_parent: "", contact_parent: "",
};

export default function PageEleves() {
  const [classeId, setClasseId] = useState<number | null>(null);
  const [recherche, setRecherche] = useState("");
  const [edition, setEdition] = useState<Eleve | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: "erreur" | "succes" } | null>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const { donnees: classes } = useDonnees(api.classes);
  const { donnees: ecole } = useDonnees(api.ecole);
  const { donnees: eleves, erreur, recharger } = useDonnees(() => api.eleves(classeId), [classeId]);

  const r = recherche.trim().toUpperCase();
  const liste = (eleves ?? []).filter(
    (e) => !r || `${e.nom} ${e.prenoms} ${e.matricule}`.toUpperCase().includes(r)
  );
  const classeChoisie = classes?.find((c) => c.id === classeId);

  async function enregistrer() {
    if (!edition) return;
    try {
      await api.enregistrerEleve(edition);
      setEdition(null);
      setMessage(null);
      recharger();
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    }
  }

  async function supprimer(e: Eleve) {
    if (!confirmer(`Supprimer l'élève ${e.nom} ${e.prenoms} et toutes ses notes ?`)) return;
    await api.supprimerEleve(e.id!);
    recharger();
  }

  async function importer(f: File) {
    try {
      const lignes = await lireElevesExcel(f);
      if (!lignes.length) throw new Error("Aucun élève trouvé dans le fichier.");
      const cible = classeChoisie ? `dans la classe ${classeChoisie.nom}` : "sans classe";
      if (!confirmer(`Importer ${lignes.length} élève(s) ${cible} ?`)) return;
      const res = await api.importerEleves(classeId, lignes);
      setMessage({
        texte: `${res.ajoutes} élève(s) importé(s)${res.ignores ? `, ${res.ignores} ignoré(s) (matricule déjà présent)` : ""}.`,
        type: "succes",
      });
      recharger();
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: "erreur" });
    } finally {
      if (fichier.current) fichier.current.value = "";
    }
  }

  function exporter() {
    exporterExcel(
      `Liste des élèves ${classeChoisie?.nom ?? "école"}`,
      liste.map((e, i) => ({
        "N°": i + 1, Matricule: e.matricule, Nom: e.nom, "Prénoms": e.prenoms, Sexe: e.sexe,
        "Date de naissance": dateFr(e.date_naissance), "Lieu de naissance": e.lieu_naissance, Age: age(e.date_naissance),
        Classe: e.classe ?? "", Redoublant: e.redoublant ? "Oui" : "Non", Parent: e.nom_parent, "Contact du parent": e.contact_parent,
      })),
      "Élèves"
    );
  }

  const ch = (k: keyof Eleve, v: string | number | null) => setEdition((e) => (e ? { ...e, [k]: v } : e));

  return (
    <div>
      <Entete titre="Élèves">
        <Bouton variante="principal" onClick={() => setEdition({ ...VIDE, classe_id: classeId })}>+ Nouvel élève</Bouton>
        <Bouton onClick={() => fichier.current?.click()} title="Fichier Excel avec au moins une colonne « Nom » ou « Nom et prénoms »">
          Importer Excel
        </Bouton>
        <Bouton onClick={exporter} disabled={!liste.length}>Exporter Excel</Bouton>
        <Bouton onClick={() => window.print()} disabled={!liste.length}>Imprimer</Bouton>
        <input
          ref={fichier} type="file" accept=".xls,.xlsx,.csv" className="hidden"
          onChange={(e) => e.target.files?.[0] && importer(e.target.files[0])}
        />
      </Entete>
      <EnteteImpression ecole={ecole} titre={`Liste des élèves ${classeChoisie ? `— ${classeChoisie.nom}` : ""}`} />

      <div className="no-print mb-4 flex flex-wrap gap-3">
        <select className={classeInput} value={classeId ?? ""} onChange={(e) => setClasseId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Toutes les classes</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        <input className={`${classeInput} w-72`} placeholder="Rechercher (nom, matricule)…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <span className="self-center text-sm text-slate-500">
          {liste.length} élève(s) · {liste.filter((e) => e.sexe === "M").length} G · {liste.filter((e) => e.sexe === "F").length} F
        </span>
      </div>

      <Alerte message={message?.texte ?? erreur} type={message?.type ?? "erreur"} />

      {eleves && liste.length === 0 ? (
        <Vide>Aucun élève. Ajoutez-en un ou importez une liste Excel (par exemple un fichier exporté de SmartIEPP).</Vide>
      ) : (
        <Tableau>
          <thead>
            <tr>
              <th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Né(e) le</th><th>Âge</th>
              <th>Classe</th><th>Red.</th><th>Contact parent</th><th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {liste.map((e, i) => (
              <tr key={e.id}>
                <td>{i + 1}</td>
                <td>{e.matricule}</td>
                <td className="font-medium">{e.nom} {e.prenoms}</td>
                <td>{e.sexe}</td>
                <td>{dateFr(e.date_naissance)}</td>
                <td>{age(e.date_naissance)}</td>
                <td>{e.classe ?? "—"}</td>
                <td>{e.redoublant ? "R" : ""}</td>
                <td>{e.contact_parent}</td>
                <td className="no-print whitespace-nowrap text-right">
                  <button className="mr-3 text-emerald-700 hover:underline" onClick={() => setEdition(e)}>Modifier</button>
                  <button className="text-red-700 hover:underline" onClick={() => supprimer(e)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      )}

      <Modal titre={edition?.id ? "Modifier l'élève" : "Nouvel élève"} ouvert={!!edition} fermer={() => { setEdition(null); setMessage(null); }}>
        {edition && (
          <form onSubmit={(e) => { e.preventDefault(); enregistrer(); }}>
            {message?.type === "erreur" && <Alerte message={message.texte} />}
            <div className="grid grid-cols-2 gap-3">
              <Champ label="Nom *"><input className={classeInput} value={edition.nom} onChange={(e) => ch("nom", e.target.value)} required autoFocus /></Champ>
              <Champ label="Prénoms"><input className={classeInput} value={edition.prenoms} onChange={(e) => ch("prenoms", e.target.value)} /></Champ>
              <Champ label="Matricule"><input className={classeInput} value={edition.matricule} onChange={(e) => ch("matricule", e.target.value)} /></Champ>
              <Champ label="Sexe">
                <select className={classeInput} value={edition.sexe} onChange={(e) => ch("sexe", e.target.value)}>
                  <option value="M">Masculin</option><option value="F">Féminin</option>
                </select>
              </Champ>
              <Champ label="Date de naissance"><input type="date" className={classeInput} value={edition.date_naissance} onChange={(e) => ch("date_naissance", e.target.value)} /></Champ>
              <Champ label="Lieu de naissance"><input className={classeInput} value={edition.lieu_naissance} onChange={(e) => ch("lieu_naissance", e.target.value)} /></Champ>
              <Champ label="Classe">
                <select className={classeInput} value={edition.classe_id ?? ""} onChange={(e) => ch("classe_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Aucune —</option>
                  {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </Champ>
              <Champ label="Statut">
                <select className={classeInput} value={edition.redoublant} onChange={(e) => ch("redoublant", Number(e.target.value))}>
                  <option value={0}>Non redoublant</option><option value={1}>Redoublant</option>
                </select>
              </Champ>
              <Champ label="Nom du parent / tuteur"><input className={classeInput} value={edition.nom_parent} onChange={(e) => ch("nom_parent", e.target.value)} /></Champ>
              <Champ label="Contact du parent"><input className={classeInput} value={edition.contact_parent} onChange={(e) => ch("contact_parent", e.target.value)} /></Champ>
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
