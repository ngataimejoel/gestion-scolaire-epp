import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { journalEcole, LIBELLES_ENTITE } from "@/lib/historique";

export const metadata: Metadata = { title: "Historique" };

const quand = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "short", timeStyle: "short" });

export default async function Historique({ searchParams }: PageProps<"/historique">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const sp = await searchParams;
  const lire = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filtre = { entite: lire("entite"), userId: lire("qui"), du: lire("du"), au: lire("au"), page: Number(lire("page")) || 1 };
  const j = await journalEcole(db(), u.schoolId!, filtre);
  const lien = (page: number) => `/historique?${new URLSearchParams(Object.entries({ entite: filtre.entite, qui: filtre.userId, du: filtre.du, au: filtre.au, page: String(page) }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Historique des modifications</h1>
        <p className="text-attenue">Chaque création, modification ou suppression est enregistrée avec son auteur, sa date et les valeurs avant et après.</p>
      </div>
      <form className="carte flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm font-medium">
          Données
          <select name="entite" defaultValue={filtre.entite ?? ""} className="champ">
            <option value="">Toutes</option>
            {Object.entries(LIBELLES_ENTITE).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Auteur
          <select name="qui" defaultValue={filtre.userId ?? ""} className="champ">
            <option value="">Tous</option>
            {j.utilisateurs.map((x) => (
              <option key={x.id} value={x.id}>{x.fullName}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Du
          <input type="date" name="du" defaultValue={filtre.du} className="champ" />
        </label>
        <label className="text-sm font-medium">
          Au
          <input type="date" name="au" defaultValue={filtre.au} className="champ" />
        </label>
        <button className="btn-principal">Filtrer</button>
        <Link href="/historique" className="lien pb-3 text-sm">Effacer</Link>
      </form>
      <p className="text-sm text-attenue">{j.total} opération{j.total > 1 ? "s" : ""}</p>
      <div className="carte overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-attenue">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Auteur</th>
              <th className="px-4 py-3 font-medium">Opération</th>
              <th className="px-4 py-3 font-medium">Données</th>
              <th className="px-4 py-3 font-medium">Détail</th>
            </tr>
          </thead>
          <tbody>
            {j.lignes.map((l) => (
              <tr key={l.id} className="border-t border-bordure align-top">
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{quand(l.date)}</td>
                <td className="px-4 py-2.5">{l.auteur}</td>
                <td className="px-4 py-2.5">{l.action}</td>
                <td className="px-4 py-2.5">{l.entite}</td>
                <td className="px-4 py-2.5 text-xs text-attenue">
                  {l.details.slice(0, 6).map((d, i) => (
                    <p key={i} className="break-words">{d}</p>
                  ))}
                  {l.details.length > 6 && <p>… {l.details.length - 6} autre(s) champ(s)</p>}
                </td>
              </tr>
            ))}
            {j.lignes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-attenue">Aucune opération pour ces critères.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {j.pages > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label="Pages">
          {j.page > 1 && <Link className="btn-secondaire" href={lien(j.page - 1)}>Plus récentes</Link>}
          <span className="text-attenue">Page {j.page} sur {j.pages}</span>
          {j.page < j.pages && <Link className="btn-secondaire" href={lien(j.page + 1)}>Plus anciennes</Link>}
        </nav>
      )}
    </div>
  );
}
