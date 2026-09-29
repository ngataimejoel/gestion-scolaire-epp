import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { resultatsEcole } from "@/lib/resultats";
import { statistiquesEvaluation } from "@/lib/bilans";
import { dateFr } from "@/lib/dates";
import { f2, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Statistiques" };

const OBSERVATIONS = ["Très bien", "Bien", "Assez bien", "Passable", "Insuffisant"] as const;

export default async function Statistiques({ searchParams }: PageProps<"/statistiques">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const sp = await searchParams;
  const numero = [1, 2, 3, 4].includes(Number(sp.eval)) ? Number(sp.eval) : 1;
  const resultats = await resultatsEcole(db(), u.schoolId!);
  const stats = statistiquesEvaluation(resultats, numero);
  const libelles = resultats.find((r) => r.classe.niveau !== "CM2")?.evaluations ?? [];
  const libellesCm2 = resultats.find((r) => r.classe.niveau === "CM2")?.evaluations ?? [];

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Statistiques</h1>
        <p className="text-attenue">Résultats de chaque évaluation par classe, et bilan de fin d&apos;année.</p>
      </div>
      <nav aria-label="Évaluations" className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((n) => (
          <Link key={n} href={`/statistiques?eval=${n}`} className={`rounded-full px-3 py-1.5 text-sm ${n === numero ? "bg-principal text-white" : "border border-bordure bg-surface"}`}>
            {libelles[n - 1]?.libelle ?? `Évaluation ${n}`}
            {libellesCm2[n - 1] && libellesCm2[n - 1].libelle !== libelles[n - 1]?.libelle ? ` / ${libellesCm2[n - 1].libelle} (CM2)` : ""}
          </Link>
        ))}
      </nav>

      <section className="carte space-y-4">
        <h2 className="font-semibold">Taux d&apos;admis par classe</h2>
        <p className="text-sm text-attenue">Part des élèves ayant composé dont la moyenne atteint le seuil d&apos;admission de la classe.</p>
        <div className="space-y-2" role="list">
          {stats.map((s) => (
            <div key={s.classe.id} role="listitem" className="grid grid-cols-[4rem_1fr_4.5rem] items-center gap-3 text-sm">
              <span className="font-semibold">{s.classe.nom}</span>
              <div className="h-5 rounded bg-fond" title={`${s.classe.nom} : ${pct(s.taux.T)} (${s.admis.M + s.admis.F} admis sur ${s.presents.M + s.presents.F} présents)`}>
                {s.taux.T != null && <div className="h-full rounded bg-principal" style={{ width: `${Math.max(s.taux.T * 100, 0.5)}%` }} />}
              </div>
              <span className="text-right tabular-nums">{pct(s.taux.T)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="carte overflow-x-auto p-0 sm:p-0">
        <h2 className="px-5 pt-5 font-semibold">Détail par classe</h2>
        <table className="tableau-officiel mt-3 w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th rowSpan={2}>Classe</th>
              <th rowSpan={2}>Date</th>
              {["Inscrits", "Présents", "Absents", "Admis", "Taux d'admis"].map((t) => (
                <th key={t} colSpan={3}>{t}</th>
              ))}
              <th rowSpan={2}>Moyenne de la classe</th>
            </tr>
            <tr>{Array.from({ length: 5 }, (_, i) => ["G", "F", "T"].map((x) => <th key={`${i}${x}`}>{x}</th>))}</tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.classe.id}>
                <td className="gauche font-semibold">{s.classe.nom}</td>
                <td>{dateFr(s.evaluation?.date)}</td>
                {[s.inscrits, s.presents, s.absents, s.admis].map((x, i) => [x.M, x.F, x.M + x.F].map((v, j) => <td key={`${i}${j}`} className="tabular-nums">{v}</td>))}
                <td className="tabular-nums">{pct(s.taux.M)}</td>
                <td className="tabular-nums">{pct(s.taux.F)}</td>
                <td className="font-semibold tabular-nums">{pct(s.taux.T)}</td>
                <td className="tabular-nums">{f2(s.moyenneClasse)} / {s.classe.bareme}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="carte overflow-x-auto">
          <h2 className="font-semibold">Les trois meilleurs</h2>
          <table className="tableau-officiel mt-3 w-full text-sm">
            <thead>
              <tr>
                <th>Classe</th>
                <th>1er</th>
                <th>2e</th>
                <th>3e</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.classe.id}>
                  <td className="gauche font-semibold">{s.classe.nom}</td>
                  {[0, 1, 2].map((i) => (
                    <td key={i} className="gauche">
                      {s.meilleurs[i] ? <>{s.meilleurs[i].nom} <span className="tabular-nums text-attenue">({f2(s.meilleurs[i].moyenne)})</span></> : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="carte overflow-x-auto">
          <h2 className="font-semibold">Observations de fin d&apos;année</h2>
          <table className="tableau-officiel mt-3 w-full text-sm">
            <thead>
              <tr>
                <th>Classe</th>
                {OBSERVATIONS.map((o) => (
                  <th key={o}>{o}</th>
                ))}
                <th>Sans MGA</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((r) => {
                const p = r.eleves.filter((e) => e.statut === "PRESENT");
                return (
                  <tr key={r.classe.id}>
                    <td className="gauche font-semibold">{r.classe.nom}</td>
                    {OBSERVATIONS.map((o) => (
                      <td key={o} className="tabular-nums">{p.filter((e) => e.observation === o).length}</td>
                    ))}
                    <td className="tabular-nums">{p.filter((e) => e.mga == null).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
