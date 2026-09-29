import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { construireEtat, ETATS, lireRedaction, type CodeEtat, type ParametresEtat } from "@/lib/etats";
import { MOIS } from "@/lib/parametres/defauts";
import { actionRedaction } from "@/app/actions/rapports";
import { EtatDoc } from "@/components/etat";
import { FormSection } from "@/components/formulaires/section";
import { BoutonImprimer } from "@/components/imprimer";

export const metadata: Metadata = { title: "Rapports" };

const MOIS_SCOLAIRES = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

export default async function Rapports({ searchParams }: PageProps<"/rapports">) {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const sp = await searchParams;
  const code = (Object.keys(ETATS) as CodeEtat[]).find((k) => k === sp.etat) ?? "rentree";
  const classes = await db().classroom.findMany({ where: { schoolId: u.schoolId!, academicYear: { isActive: true } }, orderBy: [{ level: { position: "asc" } }, { name: "asc" }] });
  const p: ParametresEtat = {
    mois: MOIS_SCOLAIRES.includes(Number(sp.mois)) ? Number(sp.mois) : new Date().getUTCMonth() + 1 === 8 ? 9 : new Date().getUTCMonth() + 1,
    numero: [1, 2, 3, 4].includes(Number(sp.compo)) ? Number(sp.compo) : 1,
    classroomId: classes.find((c) => c.id === sp.classe)?.id ?? classes[0]?.id,
  };
  const [etat, school, annee] = await Promise.all([
    construireEtat(db(), u.schoolId!, code, p),
    db().school.findUniqueOrThrow({ where: { id: u.schoolId! }, include: { settings: true } }),
    db().academicYear.findFirstOrThrow({ where: { schoolId: u.schoolId!, isActive: true } }),
  ]);
  const textes = await lireRedaction(db(), u.schoolId!, etat);
  const q = (x: Record<string, string | number | undefined>) =>
    new URLSearchParams(Object.entries({ etat: code, mois: p.mois, compo: p.numero, classe: p.classroomId, ...x }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  const onglet = (actif: boolean) => `rounded-full px-3 py-1.5 text-sm ${actif ? "bg-principal text-white" : "border border-bordure bg-surface"}`;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Rapports et états officiels</h1>
            <p className="text-attenue">Tout est calculé à partir du registre, des notes et du journal des absences ; seules les observations sont à rédiger.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/export/etat?${q({})}`} className="btn-secondaire">Exporter en Excel</a>
            <BoutonImprimer libelle="Imprimer / PDF" className="btn-principal" />
          </div>
        </div>
        <nav aria-label="États" className="flex flex-wrap gap-2">
          {(Object.entries(ETATS) as [CodeEtat, string][]).map(([k, t]) => (
            <Link key={k} href={`/rapports?${q({ etat: k })}`} className={onglet(k === code)}>{t}</Link>
          ))}
          <Link href="/rapports/bulletins" className={onglet(false)}>Bulletins</Link>
        </nav>
        {code === "mensuel" && (
          <nav aria-label="Mois" className="flex flex-wrap gap-2">
            {MOIS_SCOLAIRES.map((m) => (
              <Link key={m} href={`/rapports?${q({ mois: m })}`} className={onglet(m === p.mois)}>{MOIS[m]}</Link>
            ))}
          </nav>
        )}
        {code === "composition" && (
          <nav aria-label="Compositions" className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((n) => (
              <Link key={n} href={`/rapports?${q({ compo: n })}`} className={onglet(n === p.numero)}>Composition {n}</Link>
            ))}
          </nav>
        )}
        {code === "classe" && (
          <nav aria-label="Classes" className="flex flex-wrap gap-2">
            {classes.map((c) => (
              <Link key={c.id} href={`/rapports?${q({ classe: c.id })}`} className={onglet(c.id === p.classroomId)}>{c.name}</Link>
            ))}
          </nav>
        )}
      </div>
      <EtatDoc
        etat={etat}
        ecole={school}
        annee={annee.label}
        textes={textes}
        formulaire={
          etat.redaction.length > 0 && (
            <FormSection action={actionRedaction.bind(null, code, p)}>
              {etat.redaction.map((r) => (
                <label key={r.cle} className="block text-sm font-medium">
                  {r.titre}
                  <textarea name={`t.${r.cle}`} rows={3} defaultValue={textes[r.cle] ?? ""} className="champ" placeholder="À rédiger" />
                </label>
              ))}
            </FormSection>
          )
        }
      />
    </div>
  );
}
