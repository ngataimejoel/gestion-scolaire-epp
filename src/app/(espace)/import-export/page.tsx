import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { aLaFonction, ecritureBloquee } from "@/lib/abonnement";
import { importsRecents, STATUT_IMPORT } from "@/lib/classeur/service";
import { actionAnalyserImport } from "@/app/actions/import";
import { FormImport } from "@/components/formulaires/import";
import { Pastille } from "@/components/pastille";

export const metadata: Metadata = { title: "Import et sauvegarde" };

const quand = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "short", timeStyle: "short" });

export default async function ImportExport() {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const schoolId = u.schoolId!;
  const [imports, importInclus, exportInclus, bloque] = await Promise.all([
    importsRecents(db(), schoolId),
    aLaFonction(db(), schoolId, "import_excel"),
    aLaFonction(db(), schoolId, "export_excel"),
    ecritureBloquee(db(), u),
  ]);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import et sauvegarde</h1>
        <p className="text-attenue">Échange avec le classeur Excel GESTION SCOLAIRE EPP : mêmes feuilles et mêmes colonnes dans les deux sens.</p>
      </div>

      <section className="carte space-y-3">
        <h2 className="text-lg font-semibold">Sauvegarde de l&apos;école</h2>
        <p className="text-sm">
          Un seul fichier Excel avec toutes les données de l&apos;année : paramètres, registre des élèves, personnel, notes des quatre feuilles,
          résultats et absences. Il s&apos;ouvre dans Excel et peut être réimporté ici pour restaurer une école.
          Elle reste disponible même si l&apos;abonnement a expiré.
        </p>
        <a href="/export/classeur?contenu=complet" className="btn-principal inline-block">Télécharger la sauvegarde</a>
      </section>

      <section className="carte space-y-3">
        <h2 className="text-lg font-semibold">Exports Excel</h2>
        {exportInclus ? (
          <div className="flex flex-wrap gap-3">
            <a href="/export/classeur?contenu=eleves" className="btn-secondaire">Registre des élèves</a>
            <a href="/export/classeur?contenu=personnel" className="btn-secondaire">Personnel</a>
            <a href="/export/classeur?contenu=resultats" className="btn-secondaire">Résultats</a>
            <Link href="/rapports" className="lien self-center text-sm">États officiels (PDF et Excel) dans Rapports</Link>
          </div>
        ) : (
          <p className="text-sm">L&apos;export Excel n&apos;est pas inclus dans votre offre. <Link href="/abonnement" className="lien">Voir les offres</Link></p>
        )}
      </section>

      <section className="carte space-y-3">
        <h2 className="text-lg font-semibold">Importer le classeur</h2>
        <p className="text-sm">
          Le fichier est d&apos;abord analysé : vous voyez les élèves et agents nouveaux, les doublons, les erreurs et les réglages
          différents avant de confirmer. Les données déjà présentes dans le site ne sont jamais remplacées : un élève ou un agent
          déjà enregistré est ignoré, et les notes ne sont importées que pour les nouveaux élèves.
        </p>
        {bloque ? (
          <p className="text-sm text-erreur">{bloque}</p>
        ) : importInclus ? (
          <FormImport action={actionAnalyserImport} />
        ) : (
          <p className="text-sm">L&apos;import n&apos;est pas inclus dans votre offre. <Link href="/abonnement" className="lien">Voir les offres</Link></p>
        )}
      </section>

      {imports.length > 0 && (
        <section className="carte overflow-x-auto p-0">
          <h2 className="px-4 pt-4 text-lg font-semibold">Imports récents</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-attenue">
              <tr>
                <th className="px-4 py-3 font-medium">Envoyé le</th>
                <th className="px-4 py-3 font-medium">Fichier</th>
                <th className="px-4 py-3 font-medium">État</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id} className="border-t border-bordure">
                  <td className="px-4 py-3 whitespace-nowrap">{quand(i.createdAt)}</td>
                  <td className="px-4 py-3">{i.filename}</td>
                  <td className="px-4 py-3"><Pastille ton={STATUT_IMPORT[i.status][1]}>{STATUT_IMPORT[i.status][0]}</Pastille></td>
                  <td className="px-4 py-3 text-right"><Link href={`/import-export/${i.id}`} className="lien">{i.status === "ANALYZED" ? "Voir l'aperçu" : "Voir"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
