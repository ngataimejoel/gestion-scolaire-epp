import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { aLaFonction } from "@/lib/abonnement";
import { QUESTIONS, reconnaitre, repondre, type CleQuestion } from "@/lib/assistant";

export const metadata: Metadata = { title: "Assistant" };

export default async function Assistant({ searchParams }: PageProps<"/assistant">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const inclus = await aLaFonction(db(), u.schoolId!, "assistant");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const cleDemandee = typeof sp.cle === "string" && QUESTIONS.some((x) => x.cle === sp.cle) ? (sp.cle as CleQuestion) : null;
  const cle = cleDemandee ?? (q ? reconnaitre(q) : null);
  const reponse = inclus && cle ? await repondre(db(), u.schoolId!, cle) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Assistant du directeur</h1>
        <p className="text-attenue">Réponses calculées à l&apos;instant sur les données de l&apos;école. Aucune donnée ne quitte la plateforme.</p>
      </div>
      {!inclus ? (
        <section className="carte space-y-2">
          <p>L&apos;assistant fait partie des offres qui l&apos;incluent (Premium par défaut).</p>
          <Link href="/abonnement" className="btn-principal inline-block">Voir les offres</Link>
        </section>
      ) : (
        <>
          <form method="get" className="carte flex flex-wrap gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium">
              Votre question
              <input name="q" defaultValue={q} placeholder="Ex. : combien d'élèves n'ont pas d'extrait de naissance ?" className="champ" />
            </label>
            <button className="btn-principal self-end">Demander</button>
          </form>
          <nav aria-label="Questions fréquentes" className="flex flex-wrap gap-2">
            {QUESTIONS.map((x) => (
              <Link
                key={x.cle}
                href={`/assistant?cle=${x.cle}`}
                className={`rounded-full border px-3 py-1.5 text-sm ${x.cle === cle ? "border-principal bg-principal text-white" : "border-bordure bg-surface hover:bg-fond"}`}
              >
                {x.titre}
              </Link>
            ))}
          </nav>
          {q && !cle && (
            <p className="carte">
              Je ne sais pas encore répondre à « {q} ». Choisissez l&apos;une des questions ci-dessus ; elles couvrent les effectifs, les résultats, les
              absences, les notes à saisir, le calendrier, l&apos;état civil et l&apos;abonnement.
            </p>
          )}
          {reponse && (
            <section className="carte space-y-4" aria-live="polite">
              <h2 className="text-lg font-semibold">{reponse.question}</h2>
              <p>{reponse.texte}</p>
              {reponse.tableau && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-attenue">
                      <tr>
                        {reponse.tableau.entetes.map((e, i) => (
                          <th key={e} className={`py-2 pr-4 font-medium ${i > 0 && typeof reponse.tableau!.lignes[0]?.[i] === "number" ? "text-right" : ""}`}>{e}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reponse.tableau.lignes.map((l, i) => (
                        <tr key={i} className="border-t border-bordure">
                          {l.map((c, k) => (
                            <td key={k} className={`py-2 pr-4 ${typeof c === "number" ? "text-right tabular-nums" : ""}`}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {reponse.lien && (
                <Link href={reponse.lien.href} className="lien text-sm">Vérifier dans : {reponse.lien.libelle}</Link>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
