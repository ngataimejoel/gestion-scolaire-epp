import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { ficheEleve } from "@/lib/eleves";
import { bulletinEleve } from "@/lib/bulletin";
import { BulletinDoc } from "@/components/bulletin";
import { BoutonImprimer } from "@/components/imprimer";

export const metadata: Metadata = { title: "Bulletin" };

export default async function BulletinEleve({ params }: PageProps<"/eleves/[id]/bulletin">) {
  const u = await exigerUtilisateur();
  const { id } = await params;
  // ficheEleve vérifie l'école et, pour un enseignant, sa classe.
  if (!(await ficheEleve(db(), u, id))) notFound();
  const b = await bulletinEleve(db(), u.schoolId!, id);
  if (!b) notFound();
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/eleves/${id}`} className="lien text-sm">← Fiche de l&apos;élève</Link>
        <BoutonImprimer libelle="Imprimer ou enregistrer en PDF" />
      </div>
      <BulletinDoc b={b} />
    </div>
  );
}
