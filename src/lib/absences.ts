/**
 * Retards et absences (feuilles ABSENCES ELEVES et ABSENCES PERSONNEL) : un journal chronologique,
 * une ligne par événement. Il alimente le RAPPORT MENSUEL (taux de fréquentation, assiduité du personnel)
 * et le bulletin (jours d'absence, retards).
 *
 * - Élèves : saisis par le directeur ou par l'enseignant de la classe.
 * - Personnel : saisi par le directeur uniquement.
 * - Un doublon (même personne, même date, même nature) est signalé et doit être confirmé.
 */
import { z } from "zod";
import type { Db } from "./db";
import type { Prisma, User } from "@/generated/prisma/client";
import { journaliser } from "./audit";
import type { Resultat } from "./auth/service";
import { classesVisibles } from "./eleves";
import { anneeDuMois, compterParSexe, tauxFrequentation, type ParSexe } from "./regles";

type Utilisateur = Pick<User, "id" | "schoolId" | "role">;

const decimal = (v: string) => Number(v.trim().replace(",", "."));

export const schemaEvenement = z
  .object({
    cible: z.enum(["eleve", "personnel"]),
    personId: z.string().min(1, "Choisissez l'élève ou l'agent."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
    nature: z.enum(["ABSENCE", "RETARD"], { message: "Choisissez la nature." }),
    days: z.string().prefault(""),
    minutes: z.string().prefault(""),
    reason: z.string().trim().max(60).prefault(""),
    justified: z.enum(["OUI", "NON"]).prefault("NON"),
    notes: z.string().trim().max(300).prefault(""),
    confirmerDoublon: z.boolean().prefault(false),
  })
  .superRefine((v, ctx) => {
    if (v.nature === "ABSENCE") {
      const j = decimal(v.days);
      if (!v.days.trim() || !Number.isFinite(j) || j <= 0 || j > 31 || (j * 2) % 1 !== 0)
        ctx.addIssue({ code: "custom", path: ["days"], message: "Jours d'absence : un nombre de 0,5 à 31 (par demi-journées)." });
    } else {
      const m = Number(v.minutes);
      if (!Number.isInteger(m) || m <= 0 || m > 600) ctx.addIssue({ code: "custom", path: ["minutes"], message: "Retard : un nombre de minutes entre 1 et 600." });
    }
  });
export type DonneesEvenement = z.input<typeof schemaEvenement>;

/** Bornes de l'année scolaire active : du 1er septembre au 31 août. */
const bornes = (debut: number) => ({ de: new Date(Date.UTC(debut, 8, 1)), a: new Date(Date.UTC(debut + 1, 7, 31)) });

export async function enregistrerEvenement(db: Db, u: Utilisateur, donnees: DonneesEvenement): Promise<Resultat<{ id: string }>> {
  if (!u.schoolId) return { ok: false, erreur: "Accès refusé." };
  const p = schemaEvenement.safeParse(donnees);
  if (!p.success) return { ok: false, erreur: p.error.issues[0].message, champ: p.error.issues[0].path.join(".") };
  const v = p.data;
  const annee = await db.academicYear.findFirst({ where: { schoolId: u.schoolId, isActive: true } });
  if (!annee) return { ok: false, erreur: "Aucune année scolaire active." };
  const date = new Date(`${v.date}T00:00:00Z`);
  const { de, a } = bornes(annee.startYear);
  if (date < de || date > a) return { ok: false, champ: "date", erreur: `La date doit être dans l'année scolaire ${annee.label}.` };

  let cible: { enrollmentId?: string; staffId?: string; nom: string };
  if (v.cible === "eleve") {
    const classes = await classesVisibles(db, u);
    const ins = await db.enrollment.findFirst({
      where: { id: v.personId, academicYearId: annee.id, classroomId: { in: classes.map((c) => c.id) } },
      include: { student: true },
    });
    if (!ins) return { ok: false, champ: "personId", erreur: "Élève introuvable dans vos classes." };
    cible = { enrollmentId: ins.id, nom: ins.student.fullName };
  } else {
    if (u.role !== "DIRECTOR") return { ok: false, erreur: "Seul le directeur enregistre les absences du personnel." };
    const s = await db.staff.findFirst({ where: { id: v.personId, schoolId: u.schoolId } });
    if (!s) return { ok: false, champ: "personId", erreur: "Agent introuvable." };
    cible = { staffId: s.id, nom: `${s.lastName} ${s.firstNames}` };
  }
  // Motif : saisie libre comme dans le classeur ; la liste des Paramètres sert de suggestions.
  if (!v.confirmerDoublon) {
    const doublon = await db.attendanceEvent.findFirst({
      where: { schoolId: u.schoolId, date, nature: v.nature, enrollmentId: cible.enrollmentId ?? undefined, staffId: cible.staffId ?? undefined },
    });
    if (doublon)
      return {
        ok: false,
        champ: "confirmerDoublon",
        erreur: `${v.nature === "ABSENCE" ? "Une absence" : "Un retard"} de ${cible.nom} est déjà enregistré(e) à cette date. Cochez la confirmation s'il s'agit bien d'un autre événement.`,
      };
  }
  const data = {
    schoolId: u.schoolId,
    academicYearId: annee.id,
    date,
    enrollmentId: cible.enrollmentId ?? null,
    staffId: cible.staffId ?? null,
    nature: v.nature,
    days: v.nature === "ABSENCE" ? decimal(v.days) : null,
    minutes: v.nature === "RETARD" ? Number(v.minutes) : null,
    reason: v.reason || null,
    justified: v.justified === "OUI",
    notes: v.notes || null,
    createdById: u.id,
  };
  const e = await db.attendanceEvent.create({ data });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "creation", entity: "AttendanceEvent", entityId: e.id, after: { ...data, date: v.date, personne: cible.nom } });
  return { ok: true, id: e.id };
}

/** Supprime une ligne saisie par erreur : le directeur, ou l'enseignant qui l'a saisie. */
export async function supprimerEvenement(db: Db, u: Utilisateur, id: string): Promise<Resultat> {
  const e = await db.attendanceEvent.findFirst({ where: { id, schoolId: u.schoolId ?? "" } });
  if (!e) return { ok: false, erreur: "Événement introuvable." };
  if (u.role !== "DIRECTOR" && e.createdById !== u.id) return { ok: false, erreur: "Vous ne pouvez supprimer que les événements que vous avez saisis." };
  await db.attendanceEvent.delete({ where: { id } });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "suppression", entity: "AttendanceEvent", entityId: id, before: e as unknown as Prisma.InputJsonValue });
  return { ok: true };
}

/** Journal de l'année active, du plus récent au plus ancien, limité aux classes visibles pour un enseignant. */
export async function journalEvenements(db: Db, u: Utilisateur, cible: "eleve" | "personnel", mois?: number) {
  const annee = await db.academicYear.findFirst({ where: { schoolId: u.schoolId!, isActive: true } });
  if (!annee) return [];
  const classes = await classesVisibles(db, u);
  const periode = mois ? { gte: new Date(Date.UTC(anneeDuMois(mois, annee.startYear), mois - 1, 1)), lt: new Date(Date.UTC(anneeDuMois(mois, annee.startYear), mois, 1)) } : undefined;
  if (cible === "personnel" && u.role !== "DIRECTOR") return [];
  return db.attendanceEvent.findMany({
    where: {
      schoolId: u.schoolId!,
      academicYearId: annee.id,
      ...(periode ? { date: periode } : {}),
      ...(cible === "eleve" ? { enrollment: { classroomId: { in: classes.map((c) => c.id) } } } : { staffId: { not: null } }),
    },
    include: { enrollment: { include: { student: true, classroom: true } }, staff: { include: { classes: { include: { classroom: true } } } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}

/* --------------------------------------------------------- Rapport mensuel */

/**
 * RAPPORT MENSUEL, partie « effectifs et fréquentation » : pour chaque classe et chaque sexe,
 * taux = MAX(0 ; 1 − jours d'absence du mois ÷ (effectif × jours de classe du mois)).
 * Effectif = élèves inscrits dans la classe (comme le classeur) ; jours = total des jours d'absence du journal.
 */
export async function frequentationDuMois(db: Db, schoolId: string, mois: number) {
  const annee = await db.academicYear.findFirst({ where: { schoolId, isActive: true }, include: { months: true } });
  if (!annee) return null;
  const an = anneeDuMois(mois, annee.startYear);
  const jours = Number(annee.months.find((m) => m.month === mois)?.schoolDays ?? 0);
  const [classes, evenements] = await Promise.all([
    db.classroom.findMany({
      where: { academicYearId: annee.id },
      include: { enrollments: { include: { student: { select: { sex: true } } } } },
      orderBy: [{ level: { position: "asc" } }, { name: "asc" }],
    }),
    db.attendanceEvent.findMany({
      where: { academicYearId: annee.id, enrollmentId: { not: null }, date: { gte: new Date(Date.UTC(an, mois - 1, 1)), lt: new Date(Date.UTC(an, mois, 1)) } },
      include: { enrollment: { include: { student: { select: { sex: true } } } } },
    }),
  ]);
  const joursAbsence = (filtre: (e: (typeof evenements)[number]) => boolean) => evenements.filter(filtre).reduce((s, e) => s + Number(e.days ?? 0), 0);
  const taux = (effectif: ParSexe, abs: ParSexe) => ({
    M: tauxFrequentation(abs.M, effectif.M, jours),
    F: tauxFrequentation(abs.F, effectif.F, jours),
    T: tauxFrequentation(abs.M + abs.F, effectif.M + effectif.F, jours),
  });
  const lignes = classes.map((c) => {
    const effectif = compterParSexe(c.enrollments.map((e) => ({ sexe: e.student.sex })));
    const abs = {
      M: joursAbsence((e) => e.enrollment!.classroomId === c.id && e.enrollment!.student.sex === "M"),
      F: joursAbsence((e) => e.enrollment!.classroomId === c.id && e.enrollment!.student.sex === "F"),
    };
    const abandons = compterParSexe(c.enrollments.filter((e) => e.status === "ABANDON").map((e) => ({ sexe: e.student.sex })));
    return { classroomId: c.id, nom: c.name, effectif, abandons, joursAbsence: abs, taux: taux(effectif, abs) };
  });
  const effectif = { M: lignes.reduce((s, l) => s + l.effectif.M, 0), F: lignes.reduce((s, l) => s + l.effectif.F, 0) };
  const abs = { M: lignes.reduce((s, l) => s + l.joursAbsence.M, 0), F: lignes.reduce((s, l) => s + l.joursAbsence.F, 0) };
  return {
    mois,
    annee: an,
    jours,
    lignes,
    total: { effectif, abandons: { M: lignes.reduce((s, l) => s + l.abandons.M, 0), F: lignes.reduce((s, l) => s + l.abandons.F, 0) }, joursAbsence: abs, taux: taux(effectif, abs) },
  };
}

/** RAPPORT MENSUEL, partie « assiduité et ponctualité du personnel » : un résumé par agent pour le mois. */
export async function assiduitePersonnel(db: Db, schoolId: string, mois: number) {
  const annee = await db.academicYear.findFirst({ where: { schoolId, isActive: true } });
  if (!annee) return [];
  const an = anneeDuMois(mois, annee.startYear);
  const personnel = await db.staff.findMany({
    where: { schoolId },
    include: {
      classes: { where: { classroom: { academicYearId: annee.id } }, include: { classroom: true } },
      attendance: { where: { date: { gte: new Date(Date.UTC(an, mois - 1, 1)), lt: new Date(Date.UTC(an, mois, 1)) } } },
    },
    orderBy: [{ lastName: "asc" }],
  });
  return personnel.map((p) => {
    const retards = p.attendance.filter((a) => a.nature === "RETARD");
    const absences = p.attendance.filter((a) => a.nature === "ABSENCE");
    const jours = absences.reduce((s, a) => s + Number(a.days ?? 0), 0);
    const minutes = retards.reduce((s, a) => s + (a.minutes ?? 0), 0);
    return {
      nom: `${p.lastName} ${p.firstNames}`,
      cours: p.classes.map((c) => c.classroom.name).join(", ") || "-",
      evenements: [retards.length && `${retards.length} retard(s)`, absences.length && `${absences.length} absence(s)`].filter(Boolean).join(" et ") || "-",
      duree: [jours && `${String(jours).replace(".", ",")} j`, minutes && `${minutes} min`].filter(Boolean).join(" + ") || "-",
      motifs: [...new Set(p.attendance.map((a) => a.reason).filter(Boolean))].join(", ") || "-",
    };
  });
}
