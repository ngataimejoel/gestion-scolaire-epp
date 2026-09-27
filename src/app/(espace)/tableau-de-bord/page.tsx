import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function TableauDeBord({ searchParams }: PageProps<"/tableau-de-bord">) {
  const u = await exigerUtilisateur();
  const { mdp } = await searchParams;
  const [personnel, comptes] = await Promise.all([
    db().staff.count({ where: { schoolId: u.schoolId! } }),
    db().user.count({ where: { schoolId: u.schoolId!, role: "TEACHER" } }),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      {mdp && <p role="status" className="rounded-lg bg-succes-fond px-3 py-2.5 text-sm text-principal">Mot de passe enregistré.</p>}
      <div>
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-attenue">{u.school?.name} · Code {u.school?.code}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="carte">
          <p className="text-sm text-attenue">Personnel enregistré</p>
          <p className="text-3xl font-bold">{personnel}</p>
        </div>
        <div className="carte">
          <p className="text-sm text-attenue">Comptes enseignants</p>
          <p className="text-3xl font-bold">{comptes}</p>
        </div>
      </div>
      {u.role === "DIRECTOR" && (
        <div className="carte">
          <h2 className="font-semibold">Pour commencer</h2>
          <p className="mt-1 text-sm text-attenue">
            Enregistrez vos enseignants dans <Link href="/personnel" className="lien">Personnel</Link> : leur compte est créé
            automatiquement et leurs identifiants leur sont envoyés par SMS. Les effectifs, résultats et alertes du classeur
            s&apos;afficheront ici avec les prochaines étapes.
          </p>
        </div>
      )}
    </div>
  );
}
