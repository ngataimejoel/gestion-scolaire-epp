"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { Alerte, Entete, Tableau, useDonnees, Vide } from "@/components/ui";

function Carte({ titre, valeur, detail }: { titre: string; valeur: number | string; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{titre}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-800">{valeur}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </div>
  );
}

export default function TableauDeBord() {
  const { donnees: t, erreur } = useDonnees(api.tableauDeBord);
  if (erreur) return <Alerte message={erreur} />;
  if (!t) return null;
  const total = t.eleves.G + t.eleves.F;
  const somme = (k: "garcons" | "filles") => t.classes.reduce((s, c) => s + (c[k] ?? 0), 0);
  return (
    <div>
      <Entete titre={t.ecole.nom || "Tableau de bord"} />
      {!t.ecole.nom && (
        <Alerte
          type="succes"
          message="Bienvenue ! Commencez par renseigner votre école dans Paramètres, puis créez vos classes et ajoutez les élèves."
        />
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Carte titre="Élèves" valeur={total} detail={`${t.eleves.G} garçons · ${t.eleves.F} filles`} />
        <Carte titre="Classes" valeur={t.classes.length} detail={t.eleves.sans_classe ? `${t.eleves.sans_classe} élève(s) sans classe` : undefined} />
        <Carte titre="Personnel" valeur={t.personnel} />
        <Carte titre="Redoublants" valeur={t.eleves.redoublants} detail={total ? `${Math.round((t.eleves.redoublants / total) * 100)} % des élèves` : undefined} />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-slate-700">Effectifs par classe {t.ecole.annee_scolaire && `(${t.ecole.annee_scolaire})`}</h2>
      {t.classes.length === 0 ? (
        <Vide>
          Aucune classe pour l&apos;instant. <Link className="text-emerald-700 underline" href="/classes/">Créer les classes</Link>
        </Vide>
      ) : (
        <Tableau>
          <thead>
            <tr><th>Classe</th><th>Niveau</th><th>Enseignant</th><th>Garçons</th><th>Filles</th><th>Total</th></tr>
          </thead>
          <tbody>
            {t.classes.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.nom}</td>
                <td>{c.niveau}</td>
                <td>{c.enseignant || "—"}</td>
                <td>{c.garcons}</td>
                <td>{c.filles}</td>
                <td className="font-semibold">{(c.garcons ?? 0) + (c.filles ?? 0)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={3}>Total</td>
              <td>{somme("garcons")}</td>
              <td>{somme("filles")}</td>
              <td>{somme("garcons") + somme("filles")}</td>
            </tr>
          </tbody>
        </Tableau>
      )}
    </div>
  );
}
