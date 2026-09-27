import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { classesVisibles } from "@/lib/eleves";
import { actionEnregistrerEleve } from "@/app/actions/eleves";
import { FormEleve } from "@/components/formulaires/eleve";

export const metadata: Metadata = { title: "Inscrire un élève" };

export default async function NouvelEleve({ searchParams }: PageProps<"/eleves/nouveau">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const { classe } = await searchParams;
  const [classes, listes] = await Promise.all([
    classesVisibles(db(), u),
    db().choiceItem.findMany({ where: { schoolId: u.schoolId!, list: { in: ["NATIONALITY", "ORPHAN_OF"] } }, orderBy: { position: "asc" } }),
  ]);
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/eleves" className="lien text-sm">← Élèves</Link>
        <h1 className="mt-1 text-2xl font-bold">Inscrire un élève</h1>
        <p className="text-attenue">Le matricule école (CLASSE-NNN-AA) est attribué à l&apos;enregistrement puis ne change plus.</p>
      </div>
      <section className="carte">
        <FormEleve
          action={actionEnregistrerEleve.bind(null, null)}
          classes={classes.map((c) => [c.id, c.name])}
          nationalites={listes.filter((l) => l.list === "NATIONALITY").map((l) => l.value)}
          orphelins={listes.filter((l) => l.list === "ORPHAN_OF").map((l) => l.value)}
          valeurs={{ classroomId: typeof classe === "string" ? classe : undefined }}
        />
      </section>
    </div>
  );
}
