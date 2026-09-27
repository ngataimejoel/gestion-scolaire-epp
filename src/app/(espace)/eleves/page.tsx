import type { Metadata } from "next";
import Link from "next/link";
import { dateFr } from "@/lib/dates";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { classesVisibles, listerEleves } from "@/lib/eleves";
import { compterParSexe } from "@/lib/regles";
import { Alerte } from "@/components/ui";

export const metadata: Metadata = { title: "Élèves" };

const STATUTS = { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" } as const;

export default async function Eleves({ searchParams }: PageProps<"/eleves">) {
  const u = await exigerUtilisateur();
  const sp = await searchParams;
  const texte = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const classes = await classesVisibles(db(), u);
  const classe = classes.find((c) => c.id === texte("classe"))?.id;
  const statut = (Object.keys(STATUTS) as (keyof typeof STATUTS)[]).find((s) => s === texte("statut"));
  const q = texte("q");
  const eleves = await listerEleves(db(), u, { classroomId: classe, statut, recherche: q });
  const presents = eleves.filter((e) => e.status === "PRESENT");
  const n = compterParSexe(presents.map((e) => ({ sexe: e.student.sex })));
  const lien = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ classe, statut, q: q || undefined, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/eleves${s.size ? `?${s}` : ""}`;
  };
  const directeur = u.role === "DIRECTOR";

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Élèves</h1>
          <p className="text-attenue">Registre de l&apos;année en cours{directeur ? "" : " (vos classes)"}.</p>
        </div>
        {directeur && classes.length > 0 && (
          <Link href={classe ? `/eleves/nouveau?classe=${classe}` : "/eleves/nouveau"} className="btn-principal">
            Inscrire un élève
          </Link>
        )}
      </div>
      {sp.supprime && <Alerte type="succes">Fiche supprimée.</Alerte>}
      {classes.length === 0 && (
        <Alerte type="info">
          {directeur ? (
            <>Aucune classe pour l&apos;année en cours. Créez d&apos;abord les classes dans <Link href="/parametres" className="lien">Paramètres</Link>.</>
          ) : (
            "Aucune classe ne vous est encore attribuée. Le directeur l'indique dans votre fiche du personnel."
          )}
        </Alerte>
      )}

      <nav aria-label="Classes" className="flex flex-wrap gap-2">
        <Link href={lien({ classe: undefined })} className={`rounded-full px-3 py-1.5 text-sm ${!classe ? "bg-principal text-white" : "bg-surface border border-bordure"}`}>
          Toutes
        </Link>
        {classes.map((c) => (
          <Link key={c.id} href={lien({ classe: c.id })} className={`rounded-full px-3 py-1.5 text-sm ${classe === c.id ? "bg-principal text-white" : "bg-surface border border-bordure"}`}>
            {c.name}
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-3" action="/eleves">
        {classe && <input type="hidden" name="classe" value={classe} />}
        <label className="text-sm font-medium">
          Rechercher
          <input name="q" defaultValue={q} placeholder="Nom, matricule école ou DESPS" className="champ w-72 max-w-full" />
        </label>
        <label className="text-sm font-medium">
          Statut
          <select name="statut" defaultValue={statut ?? ""} className="champ">
            <option value="">Tous</option>
            {Object.entries(STATUTS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondaire">Filtrer</button>
      </form>

      <p className="text-sm" role="status">
        Présents : <b>{n.M}</b> garçons, <b>{n.F}</b> filles, <b>{n.M + n.F}</b> au total
        {eleves.length !== presents.length && <> · {eleves.length - presents.length} abandon(s) ou transfert(s)</>}
      </p>

      <div className="carte overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-bordure text-left text-attenue">
            <tr>
              <th className="px-3 py-3 font-medium">Matricule</th>
              <th className="px-3 py-3 font-medium">DESPS</th>
              <th className="px-3 py-3 font-medium">Nom et prénoms</th>
              <th className="px-3 py-3 font-medium">Sexe</th>
              <th className="px-3 py-3 font-medium">Naissance</th>
              <th className="px-3 py-3 font-medium">Âge</th>
              <th className="px-3 py-3 font-medium">Classe</th>
              <th className="px-3 py-3 font-medium">Extrait</th>
              <th className="px-3 py-3 font-medium">Red.</th>
              <th className="px-3 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {eleves.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-attenue">Aucun élève.</td>
              </tr>
            )}
            {eleves.map((e) => {
              // Couleurs du registre : extrait manquant, abandon, transfert.
              const fond = e.status === "ABANDON" ? "bg-rose-50 dark:bg-rose-950/30" : e.status === "TRANSFERE" ? "bg-zinc-100 text-attenue dark:bg-zinc-800/40" : !e.student.hasBirthCertificate ? "bg-amber-50 dark:bg-amber-950/30" : "";
              return (
                <tr key={e.id} className={`border-b border-bordure last:border-0 ${fond}`}>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    <Link href={`/eleves/${e.studentId}`} className="lien">{e.student.schoolMatricule}</Link>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{e.student.despsId ?? "—"}</td>
                  <td className="px-3 py-2.5 font-medium">{e.student.fullName}</td>
                  <td className="px-3 py-2.5">{e.student.sex}</td>
                  <td className="px-3 py-2.5 tabular-nums">{dateFr(e.student.birthDate)}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {e.age ?? "—"}
                    {e.surAge && <span className="ml-1 whitespace-nowrap rounded bg-accent/15 px-1 text-xs font-medium" title="Âge supérieur à l'âge normal du niveau">sur-âge</span>}
                  </td>
                  <td className="px-3 py-2.5">{e.classroom.name}</td>
                  <td className="px-3 py-2.5">{e.student.hasBirthCertificate ? "OUI" : <b>NON</b>}</td>
                  <td className="px-3 py-2.5">{e.isRepeating ? "OUI" : "NON"}</td>
                  <td className="px-3 py-2.5">{STATUTS[e.status]}{e.statusDate && <span className="text-xs text-attenue"> le {dateFr(e.statusDate)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-attenue">Fond jaune : extrait de naissance manquant · rose : abandon · gris : transféré.</p>
    </div>
  );
}
