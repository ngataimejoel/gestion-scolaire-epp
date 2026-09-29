import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { journalEvenements } from "@/lib/absences";
import { classesVisibles } from "@/lib/eleves";
import { dateFr } from "@/lib/dates";
import { nombre } from "@/lib/format";
import { MOIS } from "@/lib/parametres/defauts";
import { actionEnregistrerAbsence, actionSupprimerAbsence } from "@/app/actions/absences";
import { FormAbsence } from "@/components/formulaires/absence";
import { BoutonAction } from "@/components/formulaires/bouton-action";
import { Pastille } from "@/components/pastille";

export const metadata: Metadata = { title: "Retards et absences" };

const MOIS_SCOLAIRES = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

export default async function Absences({ searchParams }: PageProps<"/absences">) {
  const u = await exigerUtilisateur();
  const sp = await searchParams;
  const directeur = u.role === "DIRECTOR";
  const cible = directeur && sp.cible === "personnel" ? "personnel" : "eleve";
  const mois = MOIS_SCOLAIRES.includes(Number(sp.mois)) ? Number(sp.mois) : undefined;
  const [journal, classes, motifs, personnel] = await Promise.all([
    journalEvenements(db(), u, cible, mois),
    classesVisibles(db(), u),
    db().choiceItem.findMany({ where: { schoolId: u.schoolId!, list: "ABSENCE_REASON" }, orderBy: { position: "asc" } }),
    cible === "personnel" ? db().staff.findMany({ where: { schoolId: u.schoolId! }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const eleves =
    cible === "eleve"
      ? await db().enrollment.findMany({ where: { classroomId: { in: classes.map((c) => c.id) }, status: "PRESENT" }, include: { student: true, classroom: true }, orderBy: [{ classroom: { name: "asc" } }, { student: { fullName: "asc" } }] })
      : [];
  const personnes: [string, string][] =
    cible === "eleve" ? eleves.map((e) => [e.id, `${e.student.fullName} · ${e.classroom.name}`]) : personnel.map((p) => [p.id, `${p.lastName} ${p.firstNames} · ${p.function}`]);
  const jours = journal.reduce((s, e) => s + Number(e.days ?? 0), 0);
  const retards = journal.filter((e) => e.nature === "RETARD").length;
  const lien = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ cible, mois: mois ? String(mois) : undefined, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/absences?${q}`;
  };
  const onglet = (actif: boolean) => `rounded-full px-3 py-1.5 text-sm ${actif ? "bg-principal text-white" : "border border-bordure bg-surface"}`;

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Retards et absences</h1>
          <p className="text-attenue">Journal chronologique : une ligne par événement. Il alimente le rapport mensuel et les bulletins.</p>
        </div>
        {directeur && (
          <nav className="flex gap-2" aria-label="Journal">
            <Link href={lien({ cible: "eleve" })} className={onglet(cible === "eleve")}>Élèves</Link>
            <Link href={lien({ cible: "personnel" })} className={onglet(cible === "personnel")}>Personnel</Link>
          </nav>
        )}
      </div>
      <section className="carte space-y-3">
        <h2 className="font-semibold">Ajouter {cible === "eleve" ? "un retard ou une absence d'élève" : "un retard ou une absence du personnel"}</h2>
        <FormAbsence
          action={actionEnregistrerAbsence.bind(null, cible)}
          personnes={personnes}
          motifs={motifs.map((m) => m.value)}
          libellePersonne={cible === "eleve" ? "Élève" : "Agent"}
          aujourdhui={new Date().toISOString().slice(0, 10)}
        />
      </section>
      <nav className="flex flex-wrap gap-2" aria-label="Mois">
        <Link href={lien({ mois: undefined })} className={onglet(!mois)}>Toute l&apos;année</Link>
        {MOIS_SCOLAIRES.map((m) => (
          <Link key={m} href={lien({ mois: String(m) })} className={onglet(mois === m)}>{MOIS[m]}</Link>
        ))}
      </nav>
      <p className="text-sm" role="status">
        {journal.length} événement(s) · {nombre(jours)} jour(s) d&apos;absence · {retards} retard(s)
      </p>
      <div className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-bordure text-left text-attenue">
            <tr>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Nom et prénoms</th>
              <th className="px-3 py-3 font-medium">{cible === "eleve" ? "Classe" : "Cours tenu"}</th>
              <th className="px-3 py-3 font-medium">Nature</th>
              <th className="px-3 py-3 text-right font-medium">Jours</th>
              <th className="px-3 py-3 text-right font-medium">Retard (min)</th>
              <th className="px-3 py-3 font-medium">Motif</th>
              <th className="px-3 py-3 font-medium">Justifié</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {!journal.length && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-attenue">Aucun événement enregistré.</td>
              </tr>
            )}
            {journal.map((e) => (
              <tr key={e.id} className="border-b border-bordure last:border-0">
                <td className="px-3 py-2 tabular-nums">{dateFr(e.date)}</td>
                <td className="px-3 py-2 font-medium">{e.enrollment ? e.enrollment.student.fullName : `${e.staff?.lastName} ${e.staff?.firstNames}`}</td>
                <td className="px-3 py-2">{e.enrollment ? e.enrollment.classroom.name : e.staff?.classes.map((c) => c.classroom.name).join(", ") || "-"}</td>
                <td className="px-3 py-2"><Pastille ton={e.nature === "ABSENCE" ? "erreur" : "alerte"}>{e.nature === "ABSENCE" ? "Absence" : "Retard"}</Pastille></td>
                <td className="px-3 py-2 text-right tabular-nums">{e.days == null ? "" : nombre(Number(e.days))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.minutes ?? ""}</td>
                <td className="px-3 py-2">{e.reason ?? ""}</td>
                <td className="px-3 py-2">{e.justified ? "OUI" : "NON"}</td>
                <td className="px-3 py-2 text-right">
                  {(directeur || e.createdById === u.id) && <BoutonAction action={actionSupprimerAbsence.bind(null, e.id)} libelle="Supprimer" confirmation="Supprimer cette ligne du journal ?" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
