"use client";

import { useState } from "react";
import { api, type Classe } from "@/lib/api";
import { Alerte, Bouton, Champ, classeInput, confirmer, Entete, Modal, Tableau, useDonnees, Vide } from "@/components/ui";

export default function PageClasses() {
  const { donnees: classes, erreur, recharger } = useDonnees(api.classes);
  const { donnees: niveaux } = useDonnees(api.niveaux);
  const { donnees: personnel } = useDonnees(api.personnel);
  const [edition, setEdition] = useState<Classe | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function enregistrer() {
    if (!edition) return;
    try {
      await api.enregistrerClasse(edition);
      setEdition(null);
      setMessage(null);
      recharger();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function supprimer(c: Classe) {
    const n = (c.garcons ?? 0) + (c.filles ?? 0);
    if (!confirmer(`Supprimer la classe ${c.nom} ?${n ? ` Ses ${n} élève(s) seront conservés mais sans classe.` : ""}`)) return;
    await api.supprimerClasse(c.id!);
    recharger();
  }

  return (
    <div>
      <Entete titre="Classes">
        <Bouton variante="principal" onClick={() => setEdition({ nom: "", niveau: "CP1", enseignant_id: null })}>+ Nouvelle classe</Bouton>
      </Entete>
      <Alerte message={erreur} />
      {classes && classes.length === 0 ? (
        <Vide>Aucune classe. Créez par exemple « CP1 A », « CE2 », « CM2 B »…</Vide>
      ) : (
        <Tableau>
          <thead>
            <tr><th>Classe</th><th>Niveau</th><th>Enseignant</th><th>Garçons</th><th>Filles</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {classes?.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.nom}</td>
                <td>{c.niveau}</td>
                <td>{c.enseignant || "—"}</td>
                <td>{c.garcons}</td>
                <td>{c.filles}</td>
                <td className="font-semibold">{(c.garcons ?? 0) + (c.filles ?? 0)}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="mr-3 text-emerald-700 hover:underline" onClick={() => setEdition(c)}>Modifier</button>
                  <button className="text-red-700 hover:underline" onClick={() => supprimer(c)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </Tableau>
      )}

      <Modal titre={edition?.id ? "Modifier la classe" : "Nouvelle classe"} ouvert={!!edition} fermer={() => { setEdition(null); setMessage(null); }}>
        {edition && (
          <form onSubmit={(e) => { e.preventDefault(); enregistrer(); }}>
            <Alerte message={message} />
            <div className="grid grid-cols-2 gap-3">
              <Champ label="Nom de la classe *">
                <input className={classeInput} value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} required autoFocus placeholder="ex. CM2 A" />
              </Champ>
              <Champ label="Niveau">
                <select className={classeInput} value={edition.niveau} onChange={(e) => setEdition({ ...edition, niveau: e.target.value })}>
                  {niveaux?.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Champ>
              <Champ label="Enseignant">
                <select
                  className={classeInput}
                  value={edition.enseignant_id ?? ""}
                  onChange={(e) => setEdition({ ...edition, enseignant_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">— Aucun —</option>
                  {personnel?.map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenoms}</option>)}
                </select>
              </Champ>
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
