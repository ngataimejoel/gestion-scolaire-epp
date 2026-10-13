"use client";

import { useState } from "react";
import { api, dateFr, type Personnel } from "@/lib/api";
import { exporterExcel } from "@/lib/excel";
import {
  Alerte, Bouton, Champ, classeInput, confirmer, Entete, EnteteImpression, Modal, Tableau, useDonnees, Vide,
} from "@/components/ui";

const FONCTIONS = ["Directeur", "Instituteur", "Instituteur adjoint", "Instituteur stagiaire", "Enseignant bénévole", "Gardien", "Autre"];
const VIDE: Personnel = { matricule: "", nom: "", prenoms: "", sexe: "M", date_naissance: "", fonction: "Instituteur", telephone: "" };

export default function PagePersonnel() {
  const { donnees: personnel, erreur, recharger } = useDonnees(api.personnel);
  const { donnees: classes } = useDonnees(api.classes);
  const { donnees: ecole } = useDonnees(api.ecole);
  const [edition, setEdition] = useState<Personnel | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const classeDe = (id?: number) => classes?.filter((c) => c.enseignant_id === id).map((c) => c.nom).join(", ") ?? "";

  async function enregistrer() {
    if (!edition) return;
    try {
      await api.enregistrerPersonnel(edition);
      setEdition(null);
      setMessage(null);
      recharger();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function supprimer(p: Personnel) {
    if (!confirmer(`Supprimer ${p.nom} ${p.prenoms} ?`)) return;
    await api.supprimerPersonnel(p.id!);
    recharger();
  }

  const ch = (k: keyof Personnel, v: string) => setEdition((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div>
      <Entete titre="Personnel">
        <Bouton variante="principal" onClick={() => setEdition({ ...VIDE })}>+ Nouvel agent</Bouton>
        <Bouton
          disabled={!personnel?.length}
          onClick={() =>
            exporterExcel(
              "Liste du personnel",
              (personnel ?? []).map((p, i) => ({
                "N°": i + 1, Matricule: p.matricule, Nom: p.nom, "Prénoms": p.prenoms, Sexe: p.sexe,
                "Date de naissance": dateFr(p.date_naissance), Fonction: p.fonction, Classe: classeDe(p.id), "Téléphone": p.telephone,
              })),
              "Personnel"
            )
          }
        >
          Exporter Excel
        </Bouton>
        <Bouton onClick={() => window.print()} disabled={!personnel?.length}>Imprimer</Bouton>
      </Entete>
      <EnteteImpression ecole={ecole} titre="Liste du personnel" />
      <Alerte message={erreur} />
      {personnel && personnel.length === 0 ? (
        <Vide>Aucun agent enregistré.</Vide>
      ) : (
        <Tableau>
          <thead>
            <tr><th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Né(e) le</th><th>Fonction</th><th>Classe</th><th>Téléphone</th><th className="no-print"></th></tr>
          </thead>
          <tbody>
            {personnel?.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td>{p.matricule}</td>
                <td className="font-medium">{p.nom} {p.prenoms}</td>
                <td>{p.sexe}</td>
                <td>{dateFr(p.date_naissance)}</td>
                <td>{p.fonction}</td>
                <td>{classeDe(p.id)}</td>
                <td>{p.telephone}</td>
                <td className="no-print whitespace-nowrap text-right">
                  <button className="mr-3 text-emerald-700 hover:underline" onClick={() => setEdition(p)}>Modifier</button>
                  <button className="text-red-700 hover:underline" onClick={() => supprimer(p)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      )}

      <Modal titre={edition?.id ? "Modifier l'agent" : "Nouvel agent"} ouvert={!!edition} fermer={() => { setEdition(null); setMessage(null); }}>
        {edition && (
          <form onSubmit={(e) => { e.preventDefault(); enregistrer(); }}>
            <Alerte message={message} />
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
              <Champ label="Fonction">
                <select className={classeInput} value={edition.fonction} onChange={(e) => ch("fonction", e.target.value)}>
                  {FONCTIONS.map((f) => <option key={f}>{f}</option>)}
                </select>
              </Champ>
              <Champ label="Téléphone"><input className={classeInput} value={edition.telephone} onChange={(e) => ch("telephone", e.target.value)} /></Champ>
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
