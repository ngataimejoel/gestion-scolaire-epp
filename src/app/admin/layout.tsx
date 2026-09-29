import Link from "next/link";
import { actionDeconnexion } from "@/app/actions/auth";
import { exigerUtilisateur } from "@/lib/auth/next";

/** Espace de l'administrateur de la plateforme : offres et abonnements des écoles, sans accès aux données des élèves. */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const u = await exigerUtilisateur(["PLATFORM_ADMIN"]);
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-bordure bg-surface px-4 py-2.5 text-sm">
        <span className="mr-auto font-bold text-principal">GESTION SCOLAIRE EPP · Administration</span>
        <span className="hidden text-attenue sm:inline">{u.fullName}</span>
        <Link href="/changer-mot-de-passe" className="lien">Mot de passe</Link>
        <form action={actionDeconnexion}>
          <button className="lien">Déconnexion</button>
        </form>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
