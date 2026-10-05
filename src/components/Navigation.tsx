"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LIENS = [
  ["/", "Tableau de bord"],
  ["/eleves/", "Élèves"],
  ["/classes/", "Classes"],
  ["/personnel/", "Personnel"],
  ["/compositions/", "Compositions"],
  ["/statistiques/", "Statistiques"],
  ["/parametres/", "Paramètres"],
] as const;

export default function Navigation() {
  const chemin = usePathname();
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin.startsWith(href.slice(0, -1)));
  return (
    <nav className="no-print flex w-56 shrink-0 flex-col bg-emerald-900 text-emerald-50">
      <div className="px-5 py-5">
        <div className="text-lg font-bold leading-tight">Gestion Scolaire</div>
        <div className="text-xs text-emerald-300">École primaire</div>
      </div>
      <ul className="flex flex-col gap-0.5 px-2">
        {LIENS.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              className={`block rounded-md px-3 py-2 text-sm ${actif(href) ? "bg-emerald-700 font-semibold text-white" : "hover:bg-emerald-800"}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
