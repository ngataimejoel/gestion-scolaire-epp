import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { dateFr } from "@/lib/dates";
import { LIBELLES_ETAT, tableauDesClasses } from "@/lib/notes";
import { Pastille, TON_ETAT } from "@/components/pastille";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Classes" };

export default async function Classes() {
  const u = await exigerUtilisateur();
  const classes = await tableauDesClasses(db(), u);
  const directeur = u.role === "DIRECTOR";
  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-attenue">
          Effectifs et avancement de la saisie des notes de l&apos;année en cours.
          {directeur && <> Les classes et les matières se règlent dans <Link href="/parametres" className="lien">Paramètres</Link>, l&apos;enseignant de chaque classe dans <Link href="/personnel" className="lien">Personnel</Link>.</>}
        </p>
      </div>
      {!classes.length && <Alerte type="info">Aucune classe ne vous est attribuée pour l&apos;instant.</Alerte>}
      <div className="grid gap-4 lg:grid-cols-2">
        {classes.map((c) => (
          <section key={c.id} className="carte space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{c.nom}</h2>
              <p className="text-sm text-attenue">
                {c.effectif.M} G · {c.effectif.F} F · <b className="text-texte">{c.effectif.M + c.effectif.F}</b> élèves
              </p>
            </div>
            <p className="text-sm">
              Enseignant : {c.enseignants.length ? c.enseignants.join(", ") : <Pastille ton="erreur">aucun</Pastille>}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {c.evaluations.map((e) => (
                  <tr key={e.numero} className="border-t border-bordure">
                    <td className="py-2 pr-2">
                      <Link href={`/notes?classe=${c.id}&eval=${e.numero}`} className="lien">{e.libelle}</Link>
                      <span className="block text-xs text-attenue">{dateFr(e.date)}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-attenue">
                      {e.completes}/{e.attendus} élèves notés
                    </td>
                    <td className="py-2 text-right">
                      <Pastille ton={TON_ETAT[e.etat]}>{LIBELLES_ETAT[e.etat]}</Pastille>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
