import Link from "next/link";
import { actionDeconnexion } from "@/app/actions/auth";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";

// Menu du cahier des charges. Les modules des étapes suivantes apparaissent grisés tant qu'ils ne sont pas livrés.
const MENU: { titre: string; href?: string; directeur?: boolean }[] = [
  { titre: "Tableau de bord", href: "/tableau-de-bord" },
  { titre: "Élèves", href: "/eleves" },
  { titre: "Personnel", href: "/personnel", directeur: true },
  { titre: "Classes", href: "/classes" },
  { titre: "Notes", href: "/notes" },
  { titre: "Résultats", href: "/resultats" },
  { titre: "Absences" },
  { titre: "Rapports", directeur: true },
  { titre: "Statistiques", href: "/statistiques", directeur: true },
  { titre: "Notifications" },
  { titre: "Abonnement", directeur: true },
  { titre: "Paramètres", href: "/parametres", directeur: true },
];

export default async function EspaceLayout({ children }: LayoutProps<"/">) {
  const u = await exigerUtilisateur();
  const menu = MENU.filter((m) => !m.directeur || u.role === "DIRECTOR");
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="print:hidden border-b border-bordure bg-surface md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="px-4 py-4">
          <p className="text-sm font-bold text-principal">GESTION SCOLAIRE EPP</p>
          <p className="truncate text-xs text-attenue">{u.school?.name}</p>
        </div>
        <nav aria-label="Menu principal" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
          {menu.map((m) =>
            m.href ? (
              <Link key={m.titre} href={m.href} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium hover:bg-fond">
                {m.titre}
              </Link>
            ) : (
              <span key={m.titre} className="shrink-0 cursor-default rounded-lg px-3 py-2 text-sm text-attenue/70" title="Disponible dans une prochaine étape">
                {m.titre}
              </span>
            ),
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="print:hidden flex items-center justify-end gap-3 border-b border-bordure bg-surface px-4 py-2.5 text-sm">
          <span className="mr-auto truncate text-attenue sm:mr-0">
            {u.fullName} · {u.role === "DIRECTOR" ? "Directeur" : "Enseignant"}
            <span className="hidden sm:inline"> · {formaterTelephone(u.phone)}</span>
          </span>
          <Link href="/changer-mot-de-passe" className="lien">Mot de passe</Link>
          <form action={actionDeconnexion}>
            <button className="lien">Déconnexion</button>
          </form>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
