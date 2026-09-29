/**
 * Parcours d'import en trois temps : 1) envoi et analyse du fichier (rien n'est écrit dans l'école),
 * 2) aperçu : nouveaux élèves et agents, doublons, erreurs, écarts de paramètres,
 * 3) confirmation par le directeur, puis rapport (dont la comparaison des résultats avec ceux du fichier).
 * Le contenu du fichier n'est conservé que le temps de la décision : il est effacé après import ou annulation.
 */
import type { Db } from "../db";
import type { Prisma, User } from "@/generated/prisma/client";
import type { Resultat } from "../auth/service";
import type { DonneesClasseur } from "../demo/classeur";
import { journaliser } from "../audit";
import { lireClasseur, type AttenduEleve } from "./lecture";
import { comparerResultats, executer, planifier, type OptionsImport, type Plan, type RapportImport } from "./import";

type Directeur = Pick<User, "id" | "schoolId" | "role">;
export const TAILLE_MAX = 8 * 1024 * 1024;

interface AnalyseStockee {
  donnees?: DonneesClasseur;
  attendus?: Record<string, AttenduEleve>;
  feuillesLues: string[];
  feuillesManquantes: string[];
  resume?: ReturnType<typeof resumer>;
}

export async function analyserImport(db: Db, u: Directeur, fichier: ArrayBuffer | Buffer, nomFichier: string): Promise<Resultat<{ jobId: string }>> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur peut importer un classeur." };
  if (!/\.(xlsx|xlsm)$/i.test(nomFichier)) return { ok: false, champ: "fichier", erreur: "Choisissez le classeur Excel (.xlsm ou .xlsx)." };
  if (fichier.byteLength > TAILLE_MAX) return { ok: false, champ: "fichier", erreur: "Fichier trop volumineux (8 Mo au plus)." };
  let lecture;
  try {
    lecture = await lireClasseur(fichier);
  } catch (e) {
    return { ok: false, champ: "fichier", erreur: e instanceof Error ? e.message : "Fichier illisible." };
  }
  const analyse: AnalyseStockee = { donnees: lecture.donnees, attendus: lecture.attendus, feuillesLues: lecture.feuillesLues, feuillesManquantes: lecture.feuillesManquantes };
  const job = await db.importJob.create({
    data: { schoolId: u.schoolId, filename: nomFichier.slice(0, 200), status: "ANALYZED", analysis: analyse as unknown as Prisma.InputJsonValue, createdById: u.id },
  });
  return { ok: true, jobId: job.id };
}

/** Résumé sérialisable du plan, pour l'aperçu et le rapport. */
function resumer(p: Plan) {
  const classe = new Map(p.ctx.classes.map((c) => [c.id, c.name]));
  return {
    nouveauxEleves: p.nouveauxEleves.map((n) => ({ nom: String(n.e.nom), classe: classe.get(n.classroomId) ?? "", matricule: n.matricule ?? "à attribuer", statut: n.statut })),
    doublonsEleves: p.doublonsEleves,
    nouveauxAgents: p.nouveauxAgents.map((a) => ({ nom: `${a.nom} ${a.prenoms}`.trim(), fonction: String(a.p.fonction ?? ""), classe: a.classroomId ? (classe.get(a.classroomId) ?? "") : "", telephone: !!a.telephone })),
    doublonsAgents: p.doublonsAgents,
    presences: p.presences.length,
    notes: p.notes.length,
    notesIgnoreesExistants: p.notesIgnoreesExistants,
    evenements: p.evenements.length,
    evenementsDejaPresents: p.evenementsDejaPresents,
    ecartsParametres: p.ecartsParametres.map(({ libelle, ecole, fichier }) => ({ libelle, ecole, fichier })),
    problemes: p.problemes,
  };
}

export type Apercu = ReturnType<typeof resumer>;

/** Aperçu recalculé sur l'état actuel de l'école (la base a pu changer depuis l'envoi). */
export async function apercuImport(db: Db, u: Directeur, jobId: string) {
  const job = await db.importJob.findFirst({ where: { id: jobId, schoolId: u.schoolId ?? "-" } });
  if (!job) return null;
  const a = job.analysis as unknown as AnalyseStockee;
  const apercu = job.status === "ANALYZED" && a.donnees ? resumer(await planifier(db, u.schoolId!, a.donnees)) : (a.resume ?? null);
  return { job, analyse: a, apercu, rapport: job.report as unknown as RapportImport | null };
}

export async function confirmerImport(db: Db, u: Directeur, jobId: string, options: Pick<OptionsImport, "parametres" | "comptesEnseignants">): Promise<Resultat<{ rapport: RapportImport }>> {
  const job = await db.importJob.findFirst({ where: { id: jobId, schoolId: u.schoolId ?? "-" } });
  if (!job) return { ok: false, erreur: "Import introuvable." };
  // Réservation : un double clic ne peut pas importer deux fois.
  const n = await db.importJob.updateMany({ where: { id: jobId, status: "ANALYZED" }, data: { status: "CONFIRMED" } });
  if (!n.count) return { ok: false, erreur: "Cet import a déjà été traité." };
  const a = job.analysis as unknown as AnalyseStockee;
  const r = await executer(db, u, a.donnees!, options).catch((e) => ({ ok: false as const, erreur: `Import interrompu, rien n'a été enregistré : ${e instanceof Error ? e.message : e}` }));
  if (!r.ok) {
    await db.importJob.update({ where: { id: jobId }, data: { status: "ANALYZED" } });
    return r;
  }
  r.rapport.comparaison = await comparerResultats(db, u.schoolId!, r.plan, r.studentIds, a.attendus ?? {});
  const resume = resumer(r.plan);
  await db.importJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      report: JSON.parse(JSON.stringify(r.rapport)),
      analysis: { feuillesLues: a.feuillesLues, feuillesManquantes: a.feuillesManquantes, resume } as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, rapport: r.rapport };
}

export async function annulerImport(db: Db, u: Directeur, jobId: string): Promise<Resultat> {
  const job = await db.importJob.findFirst({ where: { id: jobId, schoolId: u.schoolId ?? "-", status: "ANALYZED" } });
  if (!job) return { ok: false, erreur: "Import introuvable ou déjà traité." };
  const a = job.analysis as unknown as AnalyseStockee;
  await db.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED", analysis: { feuillesLues: a.feuillesLues, feuillesManquantes: a.feuillesManquantes } } });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "import_annule", entity: "ImportJob", entityId: jobId, after: { fichier: job.filename } });
  return { ok: true };
}

export const STATUT_IMPORT = {
  ANALYZED: ["À confirmer", "alerte"],
  CONFIRMED: ["En cours", "alerte"],
  COMPLETED: ["Importé", "ok"],
  FAILED: ["Échoué", "erreur"],
  CANCELLED: ["Annulé", "neutre"],
} as const;

export const importsRecents = (db: Db, schoolId: string) =>
  db.importJob.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, filename: true, status: true, createdAt: true, completedAt: true } });
