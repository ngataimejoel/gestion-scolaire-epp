import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { lireAccesParent } from "@/lib/auth/next";
import { actionQuitterParent } from "@/app/actions/auth";
import { anneesRevolues } from "@/lib/regles";
import { bulletinEleve } from "@/lib/bulletin";
import { f2, rangTexte } from "@/lib/format";
import Link from "next/link";

export const metadata: Metadata = { title: "Informations de l'élève", robots: { index: false } };

const date = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");

export default async function EleveParent() {
  const acces = await lireAccesParent();
  if (!acces) redirect("/parents");
  // Lecture limitée à l'élève et à l'école du jeton signé.
  const e = await db().student.findFirst({
    where: { id: acces.studentId, schoolId: acces.schoolId },
    include: {
      school: true,
      guardians: true,
      enrollments: { include: { classroom: true, academicYear: true }, orderBy: { academicYear: { startYear: "desc" } }, take: 1 },
    },
  });
  if (!e) redirect("/parents");
  const ins = e.enrollments[0];
  const b = await bulletinEleve(db(), acces.schoolId, e.id);
  const lignes: [string, string][] = [
    ["Matricule école", e.schoolMatricule],
    ["Matricule DESPS", e.despsId ?? "—"],
    ["Sexe", e.sex === "M" ? "Masculin" : "Féminin"],
    ["Date de naissance", date(e.birthDate)],
    ["Âge", ins && e.birthDate ? `${anneesRevolues(e.birthDate, ins.academicYear.ageReferenceDate)} ans` : "—"],
    ["Classe", ins ? `${ins.classroom.name} (${ins.academicYear.label})` : "—"],
    ["Statut", ins ? { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" }[ins.status] : "—"],
    ["Nationalité", e.nationality ?? "—"],
  ];
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-accent">{e.school.name}</p>
          <h1 className="mt-1 text-2xl font-bold">{e.fullName}</h1>
        </div>
        <form action={actionQuitterParent}>
          <button className="btn-secondaire text-sm">Quitter</button>
        </form>
      </div>
      <dl className="carte mt-6 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {lignes.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-attenue">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {e.guardians.length > 0 && (
        <section className="carte mt-4">
          <h2 className="font-semibold">Parents et tuteurs</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {e.guardians.map((g) => (
              <li key={g.id}>
                {{ PERE: "Père", MERE: "Mère", TUTEUR: "Tuteur" }[g.relation]} : {g.fullName}
              </li>
            ))}
          </ul>
        </section>
      )}
      {b && (
        <section className="carte mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Résultats {b.annee.label}</h2>
            <Link href="/parents/eleve/bulletin" className="btn-principal text-sm">Voir et imprimer le bulletin</Link>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {b.evaluations.map((ev, k) => (
              <div key={ev.id}>
                <dt className="text-xs text-attenue">{ev.libelle}</dt>
                <dd className="font-medium tabular-nums">{f2(b.resultat.moyennes[k])}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-attenue">MGA</dt>
              <dd className="font-bold tabular-nums">{f2(b.resultat.mga)} / {b.classe.bareme}</dd>
            </div>
            <div>
              <dt className="text-xs text-attenue">Rang</dt>
              <dd className="font-medium">{b.resultat.rang == null ? "—" : `${rangTexte(b.resultat.rang, b.resultat.sexe)} sur ${b.effectifClasse}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-attenue">Décision</dt>
              <dd className="font-medium">{b.resultat.decision || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-attenue">Absences / retards</dt>
              <dd className="font-medium">{b.absences.jours} j · {b.absences.retards}</dd>
            </div>
          </dl>
        </section>
      )}
      <p className="mt-6 text-sm text-attenue">Cet accès se ferme automatiquement après 30 minutes.</p>
    </div>
  );
}
