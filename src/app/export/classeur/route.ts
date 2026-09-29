import { db } from "@/lib/db";
import { utilisateurCourant } from "@/lib/auth/next";
import { aLaFonction } from "@/lib/abonnement";
import { exporterClasseur, type ContenuExport } from "@/lib/classeur/ecriture";
import { nomFichier } from "@/lib/excel";
import { journaliser } from "@/lib/audit";

const TITRES: Record<ContenuExport, string> = { complet: "Sauvegarde", eleves: "Registre eleves", personnel: "Personnel", resultats: "Resultats" };

/**
 * Export au format du classeur (directeur uniquement, données de son école). La sauvegarde complète reste
 * disponible même abonnement expiré : une école doit toujours pouvoir récupérer ses données.
 */
export async function GET(req: Request) {
  const u = await utilisateurCourant();
  if (!u || u.role !== "DIRECTOR" || !u.schoolId || u.mustChangePassword) return new Response("Accès refusé.", { status: 403 });
  const demande = new URL(req.url).searchParams.get("contenu") ?? "complet";
  const contenu = (Object.keys(TITRES) as ContenuExport[]).find((k) => k === demande);
  if (!contenu) return new Response("Contenu inconnu.", { status: 400 });
  if (contenu !== "complet" && !(await aLaFonction(db(), u.schoolId, "export_excel"))) return new Response("L'export Excel n'est pas inclus dans votre offre.", { status: 403 });
  const [buf, school, annee] = await Promise.all([
    exporterClasseur(db(), u.schoolId, contenu),
    db().school.findUniqueOrThrow({ where: { id: u.schoolId } }),
    db().academicYear.findFirstOrThrow({ where: { schoolId: u.schoolId, isActive: true } }),
  ]);
  await journaliser(db(), { schoolId: u.schoolId, userId: u.id, action: "export", entity: "School", entityId: u.schoolId, after: { contenu } });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomFichier(`${TITRES[contenu]} ${school.name} ${annee.label}`)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
