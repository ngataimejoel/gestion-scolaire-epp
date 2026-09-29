import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { lireAccesParent } from "@/lib/auth/next";
import { bulletinEleve } from "@/lib/bulletin";
import { BulletinDoc } from "@/components/bulletin";
import { BoutonImprimer } from "@/components/imprimer";

export const metadata: Metadata = { title: "Bulletin de notes", robots: { index: false } };

export default async function BulletinParent() {
  const acces = await lireAccesParent();
  if (!acces) redirect("/parents");
  const b = await bulletinEleve(db(), acces.schoolId, acces.studentId);
  if (!b) redirect("/parents/eleve");
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/parents/eleve" className="lien text-sm">← Informations de l&apos;élève</Link>
        <BoutonImprimer libelle="Imprimer ou enregistrer en PDF" className="btn-principal" />
      </div>
      <BulletinDoc b={b} />
    </div>
  );
}
