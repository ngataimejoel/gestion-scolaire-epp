import { db } from "@/lib/db";
import { utilisateurCourant } from "@/lib/auth/next";
import { construireEtat, ETATS, lireRedaction, type CodeEtat } from "@/lib/etats";
import { classeurExcel, nomFichier } from "@/lib/excel";

/** Export Excel d'un état officiel (directeur uniquement, données de son école). */
export async function GET(req: Request) {
  const u = await utilisateurCourant();
  if (!u || u.role !== "DIRECTOR" || !u.schoolId || u.mustChangePassword) return new Response("Accès refusé.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const code = (Object.keys(ETATS) as CodeEtat[]).find((k) => k === sp.get("etat"));
  if (!code) return new Response("État inconnu.", { status: 400 });
  const etat = await construireEtat(db(), u.schoolId, code, {
    mois: Number(sp.get("mois")) || undefined,
    numero: Number(sp.get("compo")) || undefined,
    classroomId: sp.get("classe") ?? undefined,
  });
  const [school, annee, textes] = await Promise.all([
    db().school.findUniqueOrThrow({ where: { id: u.schoolId } }),
    db().academicYear.findFirstOrThrow({ where: { schoolId: u.schoolId, isActive: true } }),
    lireRedaction(db(), u.schoolId, etat),
  ]);
  const buf = await classeurExcel(
    { ecole: school.name, code: school.code, ministere: school.ministry, dren: school.regionalDirectorate, iepp: school.inspectorate, annee: annee.label },
    etat.titre,
    etat.sousTitre,
    etat.tableaux,
    etat.redaction.map((r) => [r.titre, textes[r.cle] ?? ""]),
  );
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomFichier(`${etat.titre} ${etat.sousTitre ?? ""} ${annee.label}`)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
