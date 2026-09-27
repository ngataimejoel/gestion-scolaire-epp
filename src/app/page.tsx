import Link from "next/link";
import { redirect } from "next/navigation";
import { utilisateurCourant } from "@/lib/auth/next";

export default async function Accueil() {
  if (await utilisateurCourant()) redirect("/tableau-de-bord");
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold tracking-[0.2em] text-accent">RÉPUBLIQUE DE CÔTE D&apos;IVOIRE</p>
      <h1 className="mt-2 text-3xl font-bold text-principal sm:text-4xl">GESTION SCOLAIRE EPP</h1>
      <p className="mt-3 max-w-2xl text-attenue">
        Registre des élèves, personnel, notes, résultats, absences et états officiels de l&apos;école primaire, calculés selon les
        règles du classeur de gestion.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="carte flex flex-col">
          <h2 className="text-lg font-semibold">Directeur et enseignants</h2>
          <p className="mt-1 flex-1 text-sm text-attenue">Connectez-vous avec votre numéro de téléphone et votre mot de passe.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/connexion" className="btn-principal">Se connecter</Link>
            <Link href="/inscription" className="btn-secondaire">Inscrire mon école</Link>
          </div>
        </section>
        <section className="carte flex flex-col">
          <h2 className="text-lg font-semibold">Parents d&apos;élèves</h2>
          <p className="mt-1 flex-1 text-sm text-attenue">
            Sans mot de passe : le matricule de l&apos;élève et sa date de naissance suffisent pour consulter ses informations.
          </p>
          <div className="mt-4">
            <Link href="/parents" className="btn-secondaire">Espace parents</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
