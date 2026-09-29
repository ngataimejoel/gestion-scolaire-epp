import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { resultatsVisibles } from "@/lib/resultats";
import { f2, rangTexte, STATUTS } from "@/lib/format";
import { Pastille } from "@/components/pastille";
import { BoutonImprimer } from "@/components/imprimer";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Résultats" };

const TON = { ADMIS: "ok", REDOUBLE: "erreur", ABANDON: "neutre", TRANSFERE: "neutre", "": "neutre" } as const;

export default async function Resultats({ searchParams }: PageProps<"/resultats">) {
  const u = await exigerUtilisateur();
  const { classe } = await searchParams;
  const toutes = await resultatsVisibles(db(), u);
  if (!toutes.length)
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">Résultats</h1>
        <Alerte type="info">Aucune classe ne vous est attribuée pour l&apos;instant.</Alerte>
      </div>
    );
  const r = toutes.find((c) => c.classe.id === classe) ?? toutes[0];
  const cm2 = r.classe.niveau === "CM2";
  const nb = cm2 ? 4 : 3;
  const presents = r.eleves.filter((e) => e.statut === "PRESENT");
  const admis = r.eleves.filter((e) => e.decision === "ADMIS").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Résultats · {r.classe.nom}</h1>
          <p className="text-attenue">
            {cm2 ? "RESULTATS CM2" : "RESULTATS"} · calculés à partir des feuilles de notes, aucune saisie ici.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/rapports/bulletins?classe=${r.classe.id}`} className="btn-secondaire">Bulletins de la classe</Link>
          <BoutonImprimer />
        </div>
      </div>
      {toutes.length > 1 && (
        <nav aria-label="Classes" className="flex flex-wrap gap-2 print:hidden">
          {toutes.map((c) => (
            <Link key={c.classe.id} href={`/resultats?classe=${c.classe.id}`} className={`rounded-full px-3 py-1.5 text-sm ${c.classe.id === r.classe.id ? "bg-principal text-white" : "border border-bordure bg-surface"}`}>
              {c.classe.nom}
            </Link>
          ))}
        </nav>
      )}
      <p className="text-sm" role="status">
        {admis} admis sur {presents.length} présents
        {presents.length > 0 && <> · taux d&apos;admission {((admis / presents.length) * 100).toFixed(1).replace(".", ",")} %</>}
      </p>
      <div className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-bordure text-attenue">
            <tr>
              <th className="px-2 py-3 text-left font-medium">N°</th>
              <th className="px-2 py-3 text-left font-medium">Matricule</th>
              <th className="px-2 py-3 text-left font-medium">Nom et prénoms</th>
              <th className="px-2 py-3 text-left font-medium">Sexe</th>
              <th className="px-2 py-3 text-left font-medium">Statut</th>
              {r.evaluations.slice(0, nb).map((e) => (
                <th key={e.id} className="px-2 py-3 text-right font-medium">{e.libelle}</th>
              ))}
              {!cm2 && <th className="px-2 py-3 text-right font-medium">Moy. des 3 compos</th>}
              {!cm2 && <th className="px-2 py-3 text-right font-medium">{r.evaluations[3]?.libelle}</th>}
              <th className="px-2 py-3 text-right font-medium">MGA /{r.classe.bareme}</th>
              <th className="px-2 py-3 text-left font-medium">Décision</th>
              <th className="px-2 py-3 text-right font-medium">Rang</th>
              <th className="px-2 py-3 text-left font-medium">Observation</th>
            </tr>
          </thead>
          <tbody>
            {r.eleves.map((e, i) => (
              <tr key={e.enrollmentId} className={`border-b border-bordure last:border-0 ${e.statut !== "PRESENT" ? "bg-rose-50 dark:bg-rose-950/30" : ""}`}>
                <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                  <Link href={`/eleves/${e.studentId}`} className="lien">{e.matricule}</Link>
                </td>
                <td className="px-2 py-2 font-medium">{e.nom}</td>
                <td className="px-2 py-2">{e.sexe}</td>
                <td className="px-2 py-2">{STATUTS[e.statut]}</td>
                {e.moyennes.slice(0, nb).map((m, k) => (
                  <td key={k} className={`px-2 py-2 text-right tabular-nums ${m === 0 ? "font-semibold text-erreur" : ""}`}>{f2(m)}</td>
                ))}
                {!cm2 && <td className="px-2 py-2 text-right tabular-nums">{f2(e.moyenne3Compos)}</td>}
                {!cm2 && <td className={`px-2 py-2 text-right tabular-nums ${e.moyennes[3] === 0 ? "font-semibold text-erreur" : ""}`}>{f2(e.moyennes[3])}</td>}
                <td className="px-2 py-2 text-right font-bold tabular-nums">{f2(e.mga)}</td>
                <td className="px-2 py-2">{e.decision ? <Pastille ton={TON[e.decision]}>{e.decision}</Pastille> : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{rangTexte(e.rang, e.sexe)}</td>
                <td className="px-2 py-2">{e.observation || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-4xl text-xs text-attenue">
        {cm2
          ? `MGA = (1re compo + 2e compo + 1er examen blanc + 2e examen blanc) ÷ 4, calculée quand les 4 moyennes existent. Admis si MGA ≥ ${String(r.classe.seuil).replace(".", ",")}/20.`
          : `MGA = (moyenne des compositions 1 à 3 + 2 × composition de passage) ÷ 3. Admis si MGA ≥ ${String(r.classe.seuil).replace(".", ",")}/${r.classe.bareme}.`}{" "}
        Un élève absent à une évaluation compte 0 pour celle-ci. Le rang est établi sur la MGA parmi les présents de la classe (ex æquo possibles).
      </p>
    </div>
  );
}
