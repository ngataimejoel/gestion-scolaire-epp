/**
 * Registre des élèves (feuille REGISTRE ELEVES) : base unique, chaque élève est saisi une seule fois ;
 * les états, effectifs et résultats se calculent à partir d'elle.
 *
 * - Matricule école CLASSE-NNN-AA attribué à l'inscription puis figé (ambiguïté n° 3 : dans le classeur il est
 *   recalculé à chaque insertion ou tri de ligne, ce qui peut changer le matricule d'un élève déjà connu).
 * - Matricule DESPS / identifiant : 9 caractères, majuscule en première ou dernière position, unique dans l'école.
 * - Âge = années révolues à la date de référence de l'année scolaire.
 * - Rien n'est écrasé ni supprimé en silence : doublons signalés, suppression refusée dès qu'il existe des notes
 *   ou des absences, historique avant/après.
 */
import { z } from "zod";
import type { Db } from "./db";
import { limiteAtteinte } from "./abonnement";
import type { EnrollmentStatus, GuardianRelation, Prisma, User } from "@/generated/prisma/client";
import { journaliser } from "./audit";
import type { Resultat } from "./auth/service";
import { normaliserTelephone } from "./auth/telephone";
import { anneesRevolues, despsValide, estEnSurAge, matriculeEcole } from "./regles";

type Utilisateur = Pick<User, "id" | "schoolId" | "role">;

const opt = (max = 120) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères au plus.`)
    .transform((v) => v || null);
const dateOpt = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Date invalide." });
      return z.NEVER;
    }
    return d;
  });
const ouiNon = z.enum(["OUI", "NON"]).transform((v) => v === "OUI");
const telOpt = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normaliserTelephone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Téléphone invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." });
      return z.NEVER;
    }
    return n;
  });

const parent = z.object({ fullName: opt(), profession: opt(80), residence: opt(80), phone: telOpt });

export const schemaEleve = z
  .object({
    classroomId: z.string().min(1, "Choisissez la classe."),
    despsId: z
      .string()
      .trim()
      .transform((v) => v || null)
      .refine((v) => v == null || despsValide(v), "Matricule DESPS : 9 caractères, avec une majuscule en première ou en dernière position."),
    fullName: z
      .string()
      .trim()
      .min(3, "Nom et prénoms obligatoires.")
      .max(120)
      .transform((v) => v.replace(/\s+/g, " ")),
    sex: z.enum(["M", "F"], { message: "Choisissez le sexe." }),
    birthDate: dateOpt,
    nationality: opt(60),
    locality: opt(80),
    subPrefecture: opt(80),
    hasBirthCertificate: ouiNon,
    certificateNumber: opt(40),
    certificateDate: dateOpt,
    civilRegistryCenter: opt(80),
    isOrphan: ouiNon,
    orphanOf: opt(20),
    isRepeating: ouiNon,
    status: z.enum(["PRESENT", "ABANDON", "TRANSFERE"]),
    statusDate: dateOpt,
    notes: opt(500),
    pere: parent,
    mere: parent,
    tuteur: parent,
    confirmerDoublon: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.isOrphan && !v.orphanOf) ctx.addIssue({ code: "custom", path: ["orphanOf"], message: "Précisez « Orphelin de »." });
    if (v.status !== "PRESENT" && !v.statusDate)
      ctx.addIssue({ code: "custom", path: ["statusDate"], message: "Indiquez la date de l'abandon ou du transfert." });
  });

export type DonneesEleve = z.input<typeof schemaEleve>;

function erreur(e: z.ZodError) {
  const i = e.issues[0];
  return { ok: false as const, erreur: i.message, champ: i.path.join(".") };
}

async function listeAutorisee(db: Db, schoolId: string, liste: "NATIONALITY" | "ORPHAN_OF", valeur: string | null) {
  if (!valeur || (liste === "ORPHAN_OF" && valeur === "-")) return true;
  return !!(await db.choiceItem.findFirst({ where: { schoolId, list: liste, value: valeur } }));
}

/** Contrôles communs à l'inscription et à la modification. */
async function controler(db: Db, schoolId: string, v: z.output<typeof schemaEleve>, studentId?: string, verifierHomonyme = true) {
  if (!(await listeAutorisee(db, schoolId, "NATIONALITY", v.nationality)))
    return { ok: false as const, champ: "nationality", erreur: "Nationalité absente de la liste des Paramètres." };
  if (v.isOrphan && !(await listeAutorisee(db, schoolId, "ORPHAN_OF", v.orphanOf)))
    return { ok: false as const, champ: "orphanOf", erreur: "Valeur « Orphelin de » absente de la liste des Paramètres." };
  if (v.despsId) {
    const pris = await db.student.findFirst({ where: { schoolId, despsId: v.despsId, NOT: studentId ? { id: studentId } : undefined } });
    if (pris) return { ok: false as const, champ: "despsId", erreur: `Ce matricule DESPS est déjà attribué à ${pris.fullName} (${pris.schoolMatricule}).` };
  }
  // Alerte « Homonymes » du tableau de bord : même nom (et même date de naissance) déjà saisi.
  if (verifierHomonyme && !v.confirmerDoublon) {
    const homonyme = await db.student.findFirst({
      where: { schoolId, fullName: { equals: v.fullName, mode: "insensitive" }, NOT: studentId ? { id: studentId } : undefined },
    });
    if (homonyme)
      return {
        ok: false as const,
        champ: "confirmerDoublon",
        erreur: `Un élève du même nom existe déjà : ${homonyme.fullName} (${homonyme.schoolMatricule}). S'il s'agit bien d'un autre enfant, cochez la confirmation puis enregistrez.`,
      };
  }
  return null;
}

function parents(v: z.output<typeof schemaEleve>) {
  return (
    [
      ["PERE", v.pere],
      ["MERE", v.mere],
      ["TUTEUR", v.tuteur],
    ] as [GuardianRelation, z.output<typeof parent>][]
  ).filter(([, p]) => p.fullName);
}

const champsEleve = (v: z.output<typeof schemaEleve>) => ({
  despsId: v.despsId,
  fullName: v.fullName,
  sex: v.sex,
  birthDate: v.birthDate,
  nationality: v.nationality,
  locality: v.locality,
  subPrefecture: v.subPrefecture,
  hasBirthCertificate: v.hasBirthCertificate,
  certificateNumber: v.hasBirthCertificate ? v.certificateNumber : null,
  certificateDate: v.hasBirthCertificate ? v.certificateDate : null,
  civilRegistryCenter: v.civilRegistryCenter,
  isOrphan: v.isOrphan,
  orphanOf: v.isOrphan ? v.orphanOf : null,
});

/** Prochain matricule du niveau pour l'année : plus grand numéro attribué + 1 (un numéro libéré par la suppression d'une fiche saisie par erreur peut resservir s'il était le dernier). */
export async function prochainMatricule(tx: Prisma.TransactionClient, schoolId: string, niveau: string, anneeDebut: number) {
  const suffixe = `-${String(anneeDebut).slice(2, 4)}`;
  const existants = await tx.student.findMany({
    where: { schoolId, schoolMatricule: { startsWith: `${niveau}-`, endsWith: suffixe } },
    select: { schoolMatricule: true },
  });
  const max = existants.reduce((m, s) => Math.max(m, Number(s.schoolMatricule.split("-")[1]) || 0), 0);
  return matriculeEcole(niveau, max + 1, anneeDebut);
}

/** Inscrit un nouvel élève dans une classe de l'année active. */
export async function inscrireEleve(db: Db, u: Utilisateur, donnees: DonneesEleve): Promise<Resultat<{ studentId: string; matricule: string }>> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur peut inscrire un élève." };
  const limite = await limiteAtteinte(db, u.schoolId, "eleves");
  if (limite) return { ok: false, erreur: limite };
  const p = schemaEleve.safeParse(donnees);
  if (!p.success) return erreur(p.error);
  const v = p.data;
  const classe = await db.classroom.findFirst({
    where: { id: v.classroomId, schoolId: u.schoolId, academicYear: { isActive: true } },
    include: { level: true, academicYear: true },
  });
  if (!classe) return { ok: false, champ: "classroomId", erreur: "Classe introuvable pour l'année en cours." };
  const refus = await controler(db, u.schoolId, v);
  if (refus) return refus;

  const eleve = await db.$transaction(async (tx) => {
    const matricule = await prochainMatricule(tx, u.schoolId!, classe.level.code, classe.academicYear.startYear);
    return tx.student.create({
      data: {
        ...champsEleve(v),
        schoolId: u.schoolId!,
        schoolMatricule: matricule,
        guardians: { create: parents(v).map(([relation, g]) => ({ relation, fullName: g.fullName!, profession: g.profession, residence: g.residence, phone: g.phone })) },
        enrollments: {
          create: {
            academicYearId: classe.academicYearId,
            classroomId: classe.id,
            isRepeating: v.isRepeating,
            status: v.status,
            statusDate: v.statusDate,
            notes: v.notes,
          },
        },
      },
    });
  });
  await journaliser(db, {
    schoolId: u.schoolId, userId: u.id, action: "inscription", entity: "Student", entityId: eleve.id,
    after: { matricule: eleve.schoolMatricule, fullName: eleve.fullName, classe: classe.name },
  });
  return { ok: true, studentId: eleve.id, matricule: eleve.schoolMatricule };
}

/** Modifie la fiche d'un élève. Le matricule école reste celui attribué à l'inscription. */
export async function modifierEleve(db: Db, u: Utilisateur, studentId: string, donnees: DonneesEleve): Promise<Resultat> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur peut modifier le registre." };
  const p = schemaEleve.safeParse(donnees);
  if (!p.success) return erreur(p.error);
  const v = p.data;
  const avant = await db.student.findFirst({
    where: { id: studentId, schoolId: u.schoolId },
    include: { guardians: true, enrollments: { where: { academicYear: { isActive: true } }, include: { classroom: true } } },
  });
  if (!avant) return { ok: false, erreur: "Élève introuvable." };
  const classe = await db.classroom.findFirst({ where: { id: v.classroomId, schoolId: u.schoolId, academicYear: { isActive: true } } });
  if (!classe) return { ok: false, champ: "classroomId", erreur: "Classe introuvable pour l'année en cours." };
  const refus = await controler(db, u.schoolId, v, studentId, avant.fullName.toLowerCase() !== v.fullName.toLowerCase());
  if (refus) return refus;
  const ins = avant.enrollments[0];
  if (ins && ins.classroomId !== classe.id) {
    const notes = await db.grade.count({ where: { enrollmentId: ins.id } });
    const ancienne = await db.classroom.findUniqueOrThrow({ where: { id: ins.classroomId } });
    if (notes && ancienne.levelId !== classe.levelId)
      return { ok: false, champ: "classroomId", erreur: "L'élève a déjà des notes dans son niveau : il ne peut changer que de division du même niveau." };
  }

  await db.$transaction(async (tx) => {
    await tx.student.update({ where: { id: studentId }, data: champsEleve(v) });
    await tx.guardian.deleteMany({ where: { studentId } });
    await tx.guardian.createMany({
      data: parents(v).map(([relation, g]) => ({ studentId, relation, fullName: g.fullName!, profession: g.profession, residence: g.residence, phone: g.phone })),
    });
    const inscription = { classroomId: classe.id, isRepeating: v.isRepeating, status: v.status, statusDate: v.status === "PRESENT" ? null : v.statusDate, notes: v.notes };
    if (ins) await tx.enrollment.update({ where: { id: ins.id }, data: inscription });
    else await tx.enrollment.create({ data: { ...inscription, studentId, academicYearId: classe.academicYearId } });
  });
  const { guardians, enrollments, ...eleveAvant } = avant;
  await journaliser(db, {
    schoolId: u.schoolId, userId: u.id, action: "modification", entity: "Student", entityId: studentId,
    before: JSON.parse(JSON.stringify({ ...eleveAvant, guardians, inscription: enrollments[0] ?? null })),
    after: JSON.parse(JSON.stringify({ ...champsEleve(v), parents: parents(v), classe: classe.name, isRepeating: v.isRepeating, status: v.status, statusDate: v.statusDate, notes: v.notes })),
  });
  return { ok: true };
}

/** Supprime un élève saisi par erreur ; refusé dès qu'il a des notes ou des absences (utiliser alors le statut). */
export async function supprimerEleve(db: Db, u: Utilisateur, studentId: string): Promise<Resultat> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur peut supprimer un élève." };
  const e = await db.student.findFirst({ where: { id: studentId, schoolId: u.schoolId }, include: { guardians: true, enrollments: true } });
  if (!e) return { ok: false, erreur: "Élève introuvable." };
  const ids = e.enrollments.map((x) => x.id);
  const [notes, absences] = await Promise.all([
    db.grade.count({ where: { enrollmentId: { in: ids } } }),
    db.attendanceEvent.count({ where: { enrollmentId: { in: ids } } }),
  ]);
  if (notes || absences)
    return { ok: false, erreur: "Cet élève a déjà des notes ou des absences : il ne peut pas être supprimé. Indiquez plutôt son statut (ABANDON ou TRANSFERE)." };
  await db.student.delete({ where: { id: e.id } });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "suppression", entity: "Student", entityId: e.id, before: JSON.parse(JSON.stringify(e)) });
  return { ok: true };
}

/* ------------------------------------------------------------------ Lecture */

/** Classes visibles : toutes pour le directeur, celles qu'il tient pour un enseignant. */
export async function classesVisibles(db: Db, u: Utilisateur) {
  return db.classroom.findMany({
    where: {
      schoolId: u.schoolId!,
      academicYear: { isActive: true },
      ...(u.role === "DIRECTOR" ? {} : { teachers: { some: { staff: { userId: u.id } } } }),
    },
    include: { level: true },
    orderBy: [{ level: { position: "asc" } }, { name: "asc" }],
  });
}

export interface FiltresRegistre {
  classroomId?: string;
  statut?: EnrollmentStatus;
  recherche?: string;
}

/** Registre de l'année active, dans l'ordre des classes puis des matricules, avec l'âge calculé. */
export async function listerEleves(db: Db, u: Utilisateur, f: FiltresRegistre = {}) {
  const classes = await classesVisibles(db, u);
  const ids = classes.map((c) => c.id).filter((id) => !f.classroomId || id === f.classroomId);
  const q = f.recherche?.trim();
  const inscriptions = await db.enrollment.findMany({
    where: {
      classroomId: { in: ids },
      ...(f.statut ? { status: f.statut } : {}),
      ...(q
        ? { student: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { schoolMatricule: { contains: q, mode: "insensitive" } }, { despsId: { contains: q, mode: "insensitive" } }] } }
        : {}),
    },
    include: { student: { include: { guardians: true } }, classroom: { include: { level: true } }, academicYear: true },
  });
  const ordre = new Map(classes.map((c, i) => [c.id, i]));
  return inscriptions
    .sort((a, b) => ordre.get(a.classroomId)! - ordre.get(b.classroomId)! || a.student.schoolMatricule.localeCompare(b.student.schoolMatricule))
    .map((i) => {
      const age = anneesRevolues(i.student.birthDate, i.academicYear.ageReferenceDate);
      return { ...i, age, surAge: estEnSurAge(age, i.classroom.level.code) };
    });
}

/** Fiche complète d'un élève, limitée à l'école (et aux classes de l'enseignant). */
export async function ficheEleve(db: Db, u: Utilisateur, studentId: string) {
  const classes = await classesVisibles(db, u);
  const e = await db.student.findFirst({
    where: {
      id: studentId,
      schoolId: u.schoolId!,
      ...(u.role === "DIRECTOR" ? {} : { enrollments: { some: { classroomId: { in: classes.map((c) => c.id) } } } }),
    },
    include: {
      guardians: true,
      enrollments: { include: { classroom: { include: { level: true } }, academicYear: true }, orderBy: { academicYear: { startYear: "desc" } } },
    },
  });
  if (!e) return null;
  const courante = e.enrollments.find((x) => x.academicYear.isActive) ?? null;
  const age = courante ? anneesRevolues(e.birthDate, courante.academicYear.ageReferenceDate) : null;
  return { ...e, courante, age, surAge: courante ? estEnSurAge(age, courante.classroom.level.code) : false };
}
