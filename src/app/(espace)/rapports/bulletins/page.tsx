import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { classesVisibles } from "@/lib/eleves";
import { bulletinEleve } from "@/lib/bulletin";
import { BulletinDoc } from "@/components/bulletin";
import { BoutonImprimer } from "@/components/imprimer";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Bulletins de la classe" };

export default async function BulletinsClasse({ searchParams }: PageProps<"/rapports/bulletins">) {
  const u = await exigerUtilisateur();
  const { classe } = await searchParams;
  const classes = await classesVisibles(db(), u);
  const c = classes.find((x) => x.id === classe) ?? classes[0];
  if (!c) return <Alerte type="info">Aucune classe ne vous est attribuée.</Alerte>;
  const inscriptions = await db().enrollment.findMany({ where: { classroomId: c.id, status: "PRESENT" }, include: { student: true }, orderBy: { student: { schoolMatricule: "asc" } } });
  const bulletins = (await Promise.all(inscriptions.map((i) => bulletinEleve(db(), u.schoolId!, i.studentId)))).filter((b) => b != null);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="space-y-3 print:hidden">
        <Link href={`/resultats?classe=${c.id}`} className="lien text-sm">← Résultats</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Bulletins · {c.name}</h1>
            <p className="text-attenue">{bulletins.length} bulletin(s), un par page à l&apos;impression (élèves présents).</p>
          </div>
          <BoutonImprimer libelle="Imprimer tous les bulletins" className="btn-principal" />
        </div>
        {classes.length > 1 && (
          <nav aria-label="Classes" className="flex flex-wrap gap-2">
            {classes.map((x) => (
              <Link key={x.id} href={`/rapports/bulletins?classe=${x.id}`} className={`rounded-full px-3 py-1.5 text-sm ${x.id === c.id ? "bg-principal text-white" : "border border-bordure bg-surface"}`}>{x.name}</Link>
            ))}
          </nav>
        )}
      </div>
      {bulletins.map((b) => (
        <BulletinDoc key={b.eleve.id} b={b} />
      ))}
    </div>
  );
}
