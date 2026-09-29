import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { tableauDeBord } from "@/lib/bilans";
import { tableauDesClasses, LIBELLES_ETAT } from "@/lib/notes";
import { resultatsVisibles } from "@/lib/resultats";
import { dateFr } from "@/lib/dates";
import { nombre, pct } from "@/lib/format";
import { Pastille, TON_ETAT } from "@/components/pastille";

export const metadata: Metadata = { title: "Tableau de bord" };

function Indicateur({ titre, valeur, detail, jauge }: { titre: string; valeur: string; detail?: string; jauge?: number | null }) {
  return (
    <div className="carte space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-attenue">{titre}</p>
      <p className="text-3xl font-bold tabular-nums">{valeur}</p>
      {detail && <p className="text-sm text-attenue">{detail}</p>}
      {jauge != null && (
        <div className="h-2 overflow-hidden rounded-full bg-fond" role="presentation">
          <div className="h-full rounded-full bg-principal" style={{ width: `${Math.round(jauge * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default async function TableauDeBord({ searchParams }: PageProps<"/tableau-de-bord">) {
  const u = await exigerUtilisateur();
  const { mdp } = await searchParams;
  const bandeau = mdp && <p role="status" className="rounded-lg bg-succes-fond px-3 py-2.5 text-sm text-principal">Mot de passe enregistré.</p>;

  if (u.role !== "DIRECTOR") {
    const [classes, resultats] = await Promise.all([tableauDesClasses(db(), u), resultatsVisibles(db(), u)]);
    return (
      <div className="max-w-5xl space-y-6">
        {bandeau}
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
          <p className="text-attenue">{u.school?.name}</p>
        </div>
        {!classes.length && <p className="carte text-attenue">Aucune classe ne vous est encore attribuée : le directeur l&apos;indique dans votre fiche du personnel.</p>}
        {classes.map((c) => {
          const r = resultats.find((x) => x.classe.id === c.id);
          const presents = r?.eleves.filter((e) => e.statut === "PRESENT").length ?? 0;
          const admis = r?.eleves.filter((e) => e.decision === "ADMIS").length ?? 0;
          return (
            <section key={c.id} className="carte space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{c.nom}</h2>
                <p className="text-sm text-attenue">
                  {c.effectif.M} G · {c.effectif.F} F · {presents} présents · {admis} admis
                </p>
              </div>
              <ul className="divide-y divide-bordure text-sm">
                {c.evaluations.map((e) => (
                  <li key={e.numero} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/notes?classe=${c.id}&eval=${e.numero}`} className="lien">{e.libelle} · {dateFr(e.date)}</Link>
                    <span className="flex items-center gap-2 text-attenue">
                      {e.completes}/{e.attendus} notés <Pastille ton={TON_ETAT[e.etat]}>{LIBELLES_ETAT[e.etat]}</Pastille>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  const t = await tableauDeBord(db(), u.schoolId!);
  const total = t.parClasse.reduce((s, c) => ({ M: s.M + c.effectif.M, F: s.F + c.effectif.F }), { M: 0, F: 0 });
  const reglages = await db().schoolSettings.findUnique({ where: { schoolId: u.schoolId! } });
  return (
    <div className="max-w-6xl space-y-6">
      {bandeau}
      <div>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-attenue">
          {u.school?.name} · {t.annee?.label} · Édité le {dateFr(reglages?.reportDate)}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicateur titre="Effectif inscrit" valeur={String(t.effectif)} detail={t.effectif ? `${pct(t.filles / t.effectif)} de filles` : undefined} />
        <Indicateur titre="Présents" valeur={String(t.presents)} detail={`Taux d'abandon ${pct(t.tauxAbandon)}`} />
        <Indicateur titre="Taux d'admission" valeur={t.presents ? pct(t.tauxAdmission) : "—"} detail={`${t.admis} admis sur ${t.presents} présents`} jauge={t.presents ? t.tauxAdmission : null} />
        <Indicateur titre="Enseignants" valeur={String(t.enseignants)} detail={t.elevesParEnseignant ? `${nombre(t.elevesParEnseignant)} élèves par enseignant` : undefined} />
      </div>

      <section className="carte overflow-x-auto p-0 sm:p-0">
        <h2 className="px-5 pt-5 font-semibold">Effectifs et résultats par classe</h2>
        <table className="mt-3 w-full min-w-[720px] text-sm">
          <thead className="border-y border-bordure text-attenue">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Classe</th>
              <th className="px-3 py-2 text-right font-medium">Garçons</th>
              <th className="px-3 py-2 text-right font-medium">Filles</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Admis</th>
              <th className="px-3 py-2 text-right font-medium">Taux</th>
              <th className="px-3 py-2 text-right font-medium">Abandons</th>
              <th className="px-4 py-2 text-left font-medium">Enseignant</th>
            </tr>
          </thead>
          <tbody>
            {t.parClasse.map((c) => (
              <tr key={c.id} className="border-b border-bordure">
                <td className="px-4 py-2 font-semibold"><Link href={`/resultats?classe=${c.id}`} className="lien">{c.nom}</Link></td>
                <td className="px-3 py-2 text-right tabular-nums">{c.effectif.M}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.effectif.F}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.effectif.M + c.effectif.F}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.admis}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(c.taux)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.abandons}</td>
                <td className="px-4 py-2">{c.enseignant ?? <Pastille ton="erreur">aucun</Pastille>}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-4 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums">{total.M}</td>
              <td className="px-3 py-2 text-right tabular-nums">{total.F}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.effectif}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.admis}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.presents ? pct(t.tauxAdmission) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.parClasse.reduce((s, c) => s + c.abandons, 0)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="carte space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Alertes de gestion</h2>
          <span className="text-xs text-attenue">Contrôles intégrés du classeur</span>
        </div>
        <ul className="divide-y divide-bordure text-sm">
          {t.alertes.map((a) => (
            <li key={a.libelle} className="flex items-center justify-between gap-3 py-2">
              <span>
                {a.lien && a.nombre ? <Link href={a.lien} className="lien">{a.libelle}</Link> : a.libelle}
                {a.nombre > 0 && a.detail && <span className="block text-xs text-attenue">{a.detail}</span>}
              </span>
              <Pastille ton={a.nombre ? a.gravite : "ok"}>{a.nombre ? a.nombre : "0 ✓"}</Pastille>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
