import Link from "next/link";
import { redirect } from "next/navigation";
import { actionDeconnexion } from "@/app/actions/auth";
import { exigerUtilisateur } from "@/lib/auth/next";
import { formaterTelephone } from "@/lib/auth/telephone";
import { etatAbonnement } from "@/lib/abonnement";
import { db } from "@/lib/db";
import { dateFr } from "@/lib/dates";
import { nombreNonLues } from "@/lib/notifications";

// Menu du cahier des charges. Les modules des étapes suivantes apparaissent grisés tant qu'ils ne sont pas livrés.
const MENU: { titre: string; href?: string; directeur?: boolean }[] = [
  { titre: "Tableau de bord", href: "/tableau-de-bord" },
  { titre: "Élèves", href: "/eleves" },
  { titre: "Personnel", href: "/personnel", directeur: true },
  { titre: "Classes", href: "/classes" },
  { titre: "Notes", href: "/notes" },
  { titre: "Résultats", href: "/resultats" },
  { titre: "Absences", href: "/absences" },
  { titre: "Rapports", href: "/rapports", directeur: true },
  { titre: "Statistiques", href: "/statistiques", directeur: true },
  { titre: "Notifications", href: "/notifications" },
  { titre: "Assistant", href: "/assistant", directeur: true },
  { titre: "Historique", href: "/historique", directeur: true },
  { titre: "Abonnement", href: "/abonnement", directeur: true },
  { titre: "Paramètres", href: "/parametres", directeur: true },
];

export default async function EspaceLayout({ children }: LayoutProps<"/">) {
  const u = await exigerUtilisateur();
  if (u.role === "PLATFORM_ADMIN" || !u.schoolId) redirect("/admin");
  const [abonnement, nonLues] = await Promise.all([etatAbonnement(db(), u.schoolId), nombreNonLues(db(), u.id)]);
  const directeur = u.role === "DIRECTOR";
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
              <Link key={m.titre} href={m.href} className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-fond">
                {m.titre}
                {m.href === "/notifications" && nonLues > 0 && (
                  <span className="rounded-full bg-principal px-1.5 text-xs font-semibold text-white tabular-nums" aria-label={`${nonLues} non lues`}>
                    {nonLues}
                  </span>
                )}
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
        {abonnement.lectureSeule ? (
          <p role="alert" className="print:hidden bg-erreur-fond px-4 py-2.5 text-sm text-erreur sm:px-8">
            L&apos;abonnement de l&apos;école est arrivé à échéance : le site est en lecture seule, aucune donnée n&apos;est perdue.{" "}
            {directeur ? <Link href="/abonnement" className="font-semibold underline">Renouveler l&apos;abonnement</Link> : "Le directeur peut le renouveler."}
          </p>
        ) : (
          abonnement.joursRestants <= 15 && (
            <p role="status" className="print:hidden bg-info-fond px-4 py-2.5 text-sm sm:px-8">
              {abonnement.essai ? "Période d'essai" : `Abonnement ${abonnement.plan?.name ?? ""}`} : fin le {dateFr(abonnement.finLe)} ({abonnement.joursRestants} jour
              {abonnement.joursRestants > 1 ? "s" : ""}).{" "}
              {directeur && <Link href="/abonnement" className="font-semibold underline">Renouveler</Link>}
            </p>
          )
        )}
        <main className="flex-1 px-4 py-6 sm:px-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
