/**
 * Établissement et paramètres (feuille PARAMETRES). Toute modification est validée côté serveur,
 * limitée à l'école de l'utilisateur et inscrite au journal d'audit avec les valeurs avant/après.
 */
import { z } from "zod";
import type { Db } from "../db";
import type { ChoiceList, GradeSheet, Prisma, User } from "@/generated/prisma/client";
import { journaliser } from "../audit";
import type { Resultat } from "../auth/service";
import { calendrierDefaut, EVALUATIONS, JOURS_DEFAUT, LISTES_DEFAUT, MATIERES_DEFAUT, NIVEAUX_DEFAUT } from "./defauts";

type Tx = Prisma.TransactionClient;
type Directeur = Pick<User, "id" | "schoolId" | "role">;

/* ------------------------------------------------------- Préparation d'une école */

/** Crée les paramètres par défaut du classeur pour une nouvelle école (appelé à l'inscription). */
export async function preparerEcole(tx: Tx, schoolId: string, anneeDebut: number) {
  await tx.level.createMany({ data: NIVEAUX_DEFAUT.map((n, i) => ({ ...n, schoolId, position: i + 1 })) });
  const subjects = Object.entries(MATIERES_DEFAUT).flatMap(([sheet, evals]) =>
    evals.flatMap((matieres, e) =>
      matieres.map(([name, poids], position) => ({
        schoolId,
        gradeSheet: sheet as GradeSheet,
        assessmentNumber: e + 1,
        name,
        position,
        maxScore: sheet === "CP" ? 10 : poids,
        coefficient: sheet === "CP" ? poids : 1,
      })),
    ),
  );
  await tx.subject.createMany({ data: subjects });
  await tx.choiceItem.createMany({
    data: Object.entries(LISTES_DEFAUT).flatMap(([list, valeurs]) => valeurs.map((value, position) => ({ schoolId, list: list as ChoiceList, value, position }))),
  });
  await creerAnnee(tx, schoolId, anneeDebut, true);
}

/** Crée une année scolaire avec ses mois, son calendrier d'évaluations et une classe par niveau. */
export async function creerAnnee(tx: Tx, schoolId: string, anneeDebut: number, active: boolean) {
  const annee = await tx.academicYear.create({
    data: {
      schoolId,
      label: `${anneeDebut}-${anneeDebut + 1}`,
      startYear: anneeDebut,
      ageReferenceDate: new Date(Date.UTC(anneeDebut, 11, 31)),
      isActive: active,
      months: { create: JOURS_DEFAUT.map(([month, schoolDays]) => ({ month, year: month >= 9 ? anneeDebut : anneeDebut + 1, schoolDays })) },
    },
  });
  const cal = calendrierDefaut(anneeDebut);
  await tx.assessment.createMany({
    data: (["STANDARD", "CM2"] as const).flatMap((track) =>
      EVALUATIONS[track].map((label, i) => ({
        schoolId,
        academicYearId: annee.id,
        number: i + 1,
        track,
        label,
        date: track === "CM2" ? cal[i].cm2 : cal[i].standard,
      })),
    ),
  });
  const niveaux = await tx.level.findMany({ where: { schoolId }, orderBy: { position: "asc" } });
  await tx.classroom.createMany({ data: niveaux.map((n) => ({ schoolId, academicYearId: annee.id, levelId: n.id, name: n.code })) });
  await tx.schoolSettings.upsert({
    where: { schoolId },
    create: { schoolId, reportDate: new Date(Date.UTC(anneeDebut + 1, 5, 30)) },
    update: { reportDate: new Date(Date.UTC(anneeDebut + 1, 5, 30)) },
  });
  return annee;
}

/* ----------------------------------------------------------------- Lecture */

export async function lireParametres(db: Db, schoolId: string) {
  const [school, annee, niveaux, matieres, listes] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId }, include: { settings: true } }),
    db.academicYear.findFirst({
      where: { schoolId, isActive: true },
      include: {
        months: true,
        assessments: { orderBy: [{ track: "asc" }, { number: "asc" }] },
        classrooms: { include: { level: true, _count: { select: { enrollments: true } } }, orderBy: [{ level: { position: "asc" } }, { name: "asc" }] },
      },
    }),
    db.level.findMany({ where: { schoolId }, orderBy: { position: "asc" } }),
    db.subject.findMany({ where: { schoolId }, orderBy: [{ gradeSheet: "asc" }, { position: "asc" }, { assessmentNumber: "asc" }] }),
    db.choiceItem.findMany({ where: { schoolId }, orderBy: [{ list: "asc" }, { position: "asc" }] }),
  ]);
  return { school, annee, niveaux, matieres, listes };
}

/* ------------------------------------------------------------ Modifications */

function controle(d: Directeur): string | null {
  return d.role === "DIRECTOR" && d.schoolId ? null : "Seul le directeur peut modifier les paramètres.";
}
const erreurZod = (e: z.ZodError) => ({ ok: false as const, erreur: e.issues[0].message, champ: e.issues[0].path.join(".") });
const texteOpt = z.string().trim().max(160).transform((v) => v || null);
const dateIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.")
  .transform((v) => new Date(`${v}T00:00:00Z`));

export const schemaIdentite = z.object({
  name: z.string().trim().min(2, "Nom de l'établissement obligatoire.").max(160),
  code: z.string().trim().toUpperCase().min(2, "Code établissement obligatoire.").max(40),
  ministry: z.string().trim().min(2, "Ministère obligatoire.").max(160),
  regionalDirectorate: texteOpt,
  inspectorate: texteOpt,
  sector: texteOpt,
  locality: texteOpt,
  directorName: texteOpt,
});

export async function majIdentite(db: Db, d: Directeur, donnees: unknown): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const p = schemaIdentite.safeParse(donnees);
  if (!p.success) return erreurZod(p.error);
  const { directorName, ...ecole } = p.data;
  const avant = await db.school.findUniqueOrThrow({ where: { id: d.schoolId! }, include: { settings: true } });
  const doublon = await db.school.findFirst({ where: { code: ecole.code, NOT: { id: d.schoolId! } } });
  if (doublon) return { ok: false, champ: "code", erreur: "Ce code établissement est déjà utilisé par une autre école." };
  await db.school.update({ where: { id: d.schoolId! }, data: { ...ecole, settings: { update: { directorName } } } });
  const { settings, id: _id, createdAt: _c, ...avantEcole } = avant;
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "School", entityId: d.schoolId,
    before: { ...avantEcole, directorName: settings?.directorName ?? null }, after: p.data,
  });
  return { ok: true };
}

export const schemaAnnee = z.object({
  ageReferenceDate: dateIso,
  reportDate: dateIso,
  expectedNewCp1: z.coerce.number({ message: "Nombre invalide." }).int("Nombre entier attendu.").min(0).max(1000),
  neutralizeJustifiedAbsence: z.boolean(),
  teacherLoginOtp: z.boolean(),
});

export async function majAnnee(db: Db, d: Directeur, donnees: unknown): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const p = schemaAnnee.safeParse(donnees);
  if (!p.success) return erreurZod(p.error);
  const annee = await db.academicYear.findFirst({ where: { schoolId: d.schoolId!, isActive: true } });
  if (!annee) return { ok: false, erreur: "Aucune année scolaire active." };
  const { ageReferenceDate, ...reglages } = p.data;
  const avant = await db.schoolSettings.findUnique({ where: { schoolId: d.schoolId! } });
  await db.$transaction([
    db.academicYear.update({ where: { id: annee.id }, data: { ageReferenceDate } }),
    db.schoolSettings.update({ where: { schoolId: d.schoolId! }, data: reglages }),
  ]);
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "SchoolSettings", entityId: d.schoolId,
    before: { ageReferenceDate: annee.ageReferenceDate.toISOString(), reportDate: avant?.reportDate?.toISOString() ?? null, expectedNewCp1: avant?.expectedNewCp1 ?? null, neutralizeJustifiedAbsence: avant?.neutralizeJustifiedAbsence ?? null, teacherLoginOtp: avant?.teacherLoginOtp ?? null },
    after: { ...p.data, ageReferenceDate: ageReferenceDate.toISOString(), reportDate: p.data.reportDate.toISOString() },
  });
  return { ok: true };
}

/** Seuils d'admission : { [levelId]: { passMark, scale } }. Le seuil ne peut pas dépasser le barème. */
export async function majSeuils(db: Db, d: Directeur, donnees: Record<string, { passMark: string; scale: string }>): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const niveaux = await db.level.findMany({ where: { schoolId: d.schoolId! } });
  const maj: { id: string; passMark: number; scale: number }[] = [];
  for (const n of niveaux) {
    const v = donnees[n.id];
    if (!v) continue;
    const scale = Number(v.scale);
    const passMark = Number(String(v.passMark).replace(",", "."));
    if (scale !== 10 && scale !== 20) return { ok: false, champ: `scale.${n.id}`, erreur: `${n.code} : le barème doit être 10 ou 20.` };
    if (!Number.isFinite(passMark) || passMark < 0 || passMark > scale)
      return { ok: false, champ: `passMark.${n.id}`, erreur: `${n.code} : la moyenne de passage doit être comprise entre 0 et ${scale}.` };
    maj.push({ id: n.id, passMark, scale });
  }
  await db.$transaction(maj.map((m) => db.level.update({ where: { id: m.id }, data: { passMark: m.passMark, scale: m.scale } })));
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "Level",
    before: niveaux.map((n) => ({ code: n.code, passMark: Number(n.passMark), scale: n.scale })),
    after: maj.map((m) => ({ code: niveaux.find((n) => n.id === m.id)!.code, passMark: m.passMark, scale: m.scale })),
  });
  return { ok: true };
}

/** Calendrier des évaluations : { [assessmentId]: "AAAA-MM-JJ" | "" }, dates comprises dans l'année scolaire. */
export async function majCalendrier(db: Db, d: Directeur, donnees: Record<string, string>): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const annee = await db.academicYear.findFirst({ where: { schoolId: d.schoolId!, isActive: true }, include: { assessments: true } });
  if (!annee) return { ok: false, erreur: "Aucune année scolaire active." };
  const debut = new Date(Date.UTC(annee.startYear, 8, 1));
  const fin = new Date(Date.UTC(annee.startYear + 1, 7, 31));
  const maj: { id: string; date: Date | null }[] = [];
  for (const a of annee.assessments) {
    if (!(a.id in donnees)) continue;
    const v = donnees[a.id].trim();
    const date = v ? new Date(`${v}T00:00:00Z`) : null;
    if (date && (Number.isNaN(date.getTime()) || date < debut || date > fin))
      return { ok: false, champ: a.id, erreur: `${a.label}${a.track === "CM2" ? " (CM2)" : ""} : la date doit être comprise entre le 01/09/${annee.startYear} et le 31/08/${annee.startYear + 1}.` };
    maj.push({ id: a.id, date });
  }
  await db.$transaction(maj.map((m) => db.assessment.update({ where: { id: m.id }, data: { date: m.date } })));
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "Assessment",
    before: annee.assessments.map((a) => ({ id: a.id, date: a.date?.toISOString().slice(0, 10) ?? null })),
    after: maj.map((m) => ({ id: m.id, date: m.date?.toISOString().slice(0, 10) ?? null })),
  });
  return { ok: true };
}

/** Jours de classe par mois : { [mois]: "22" }. Entre 0 et 31 jours, demi-journées acceptées. */
export async function majJours(db: Db, d: Directeur, donnees: Record<string, string>): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const annee = await db.academicYear.findFirst({ where: { schoolId: d.schoolId!, isActive: true }, include: { months: true } });
  if (!annee) return { ok: false, erreur: "Aucune année scolaire active." };
  const maj: { id: string; schoolDays: number }[] = [];
  for (const m of annee.months) {
    const v = Number(String(donnees[m.month] ?? m.schoolDays).replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 31 || Math.round(v * 2) !== v * 2)
      return { ok: false, champ: String(m.month), erreur: "Jours de classe : nombre entre 0 et 31 (demi-journées acceptées)." };
    maj.push({ id: m.id, schoolDays: v });
  }
  await db.$transaction(maj.map((m) => db.schoolMonth.update({ where: { id: m.id }, data: { schoolDays: m.schoolDays } })));
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "SchoolMonth",
    before: annee.months.map((m) => ({ month: m.month, schoolDays: Number(m.schoolDays) })),
    after: annee.months.map((m, i) => ({ month: m.month, schoolDays: maj[i].schoolDays })),
  });
  return { ok: true };
}

/**
 * Coefficients (CP) et barèmes (autres feuilles) : { [subjectId]: "valeur" }.
 * Un barème ne peut pas descendre sous une note déjà saisie, pour ne jamais rendre une note invalide en silence.
 */
export async function majMatieres(db: Db, d: Directeur, donnees: Record<string, string>): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const matieres = await db.subject.findMany({ where: { schoolId: d.schoolId!, id: { in: Object.keys(donnees) } } });
  const maj: { id: string; data: { coefficient?: number; maxScore?: number } }[] = [];
  for (const m of matieres) {
    const v = Number(String(donnees[m.id]).replace(",", "."));
    if (m.gradeSheet === "CP") {
      if (!Number.isFinite(v) || v < 0 || v > 10) return { ok: false, champ: m.id, erreur: `${m.name} : coefficient entre 0 et 10 (0 = matière ignorée).` };
      maj.push({ id: m.id, data: { coefficient: v } });
    } else {
      if (!Number.isFinite(v) || v <= 0 || v > 200) return { ok: false, champ: m.id, erreur: `${m.name} : barème entre 1 et 200.` };
      const plusHaute = await db.grade.aggregate({ where: { subjectId: m.id }, _max: { score: true } });
      const max = plusHaute._max.score == null ? null : Number(plusHaute._max.score);
      if (max != null && v < max)
        return { ok: false, champ: m.id, erreur: `${m.name} (évaluation ${m.assessmentNumber}) : une note de ${max} est déjà saisie, le barème ne peut pas être inférieur.` };
      maj.push({ id: m.id, data: { maxScore: v } });
    }
  }
  await db.$transaction(maj.map((m) => db.subject.update({ where: { id: m.id }, data: m.data })));
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "Subject",
    before: matieres.map((m) => ({ id: m.id, name: m.name, evaluation: m.assessmentNumber, coefficient: Number(m.coefficient), maxScore: Number(m.maxScore) })),
    after: maj.map((m) => ({ id: m.id, ...m.data })),
  });
  return { ok: true };
}

/** Listes de choix : une valeur par ligne. IVOIRIENNE est obligatoire (effectifs Ivoiriens / étrangers). */
export async function majListe(db: Db, d: Directeur, liste: ChoiceList, texte: string): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const valeurs = [...new Set(texte.split(/\r?\n/).map((v) => v.trim()).filter(Boolean))];
  if (!valeurs.length) return { ok: false, champ: liste, erreur: "La liste doit contenir au moins une valeur." };
  if (valeurs.some((v) => v.length > 60)) return { ok: false, champ: liste, erreur: "Chaque valeur doit faire 60 caractères au plus." };
  if (liste === "NATIONALITY" && !valeurs.includes("IVOIRIENNE"))
    return { ok: false, champ: liste, erreur: "La valeur IVOIRIENNE est obligatoire : elle sert au décompte Ivoiriens / étrangers des états." };
  const avant = await db.choiceItem.findMany({ where: { schoolId: d.schoolId!, list: liste }, orderBy: { position: "asc" } });
  await db.$transaction([
    db.choiceItem.deleteMany({ where: { schoolId: d.schoolId!, list: liste } }),
    db.choiceItem.createMany({ data: valeurs.map((value, position) => ({ schoolId: d.schoolId!, list: liste, value, position })) }),
  ]);
  await journaliser(db, {
    schoolId: d.schoolId, userId: d.id, action: "modification", entity: "ChoiceItem", entityId: liste,
    before: avant.map((a) => a.value), after: valeurs,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ Classes */

/** Ajoute une classe (division) à un niveau pour l'année active, ex. « CM1 B » (ambiguïté n° 8 du dossier). */
export async function ajouterClasse(db: Db, d: Directeur, levelId: string, nom: string): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const name = nom.trim().toUpperCase().replace(/\s+/g, " ");
  if (!name || name.length > 20) return { ok: false, champ: "name", erreur: "Nom de classe : 1 à 20 caractères." };
  const [niveau, annee] = await Promise.all([
    db.level.findFirst({ where: { id: levelId, schoolId: d.schoolId! } }),
    db.academicYear.findFirst({ where: { schoolId: d.schoolId!, isActive: true } }),
  ]);
  if (!niveau || !annee) return { ok: false, erreur: "Niveau ou année introuvable." };
  if (await db.classroom.findFirst({ where: { academicYearId: annee.id, name } })) return { ok: false, champ: "name", erreur: "Cette classe existe déjà." };
  const c = await db.classroom.create({ data: { schoolId: d.schoolId!, academicYearId: annee.id, levelId, name } });
  await journaliser(db, { schoolId: d.schoolId, userId: d.id, action: "creation", entity: "Classroom", entityId: c.id, after: { name, niveau: niveau.code } });
  return { ok: true };
}

/** Supprime une classe vide ; une classe qui a des élèves inscrits n'est jamais supprimée. */
export async function supprimerClasse(db: Db, d: Directeur, classroomId: string): Promise<Resultat> {
  const refus = controle(d);
  if (refus) return { ok: false, erreur: refus };
  const c = await db.classroom.findFirst({ where: { id: classroomId, schoolId: d.schoolId! }, include: { _count: { select: { enrollments: true } } } });
  if (!c) return { ok: false, erreur: "Classe introuvable." };
  if (c._count.enrollments) return { ok: false, erreur: `La classe ${c.name} a ${c._count.enrollments} élève(s) : elle ne peut pas être supprimée.` };
  const autres = await db.classroom.count({ where: { academicYearId: c.academicYearId, levelId: c.levelId } });
  if (autres <= 1) return { ok: false, erreur: `${c.name} est la seule classe de son niveau : elle ne peut pas être supprimée.` };
  await db.classroom.delete({ where: { id: c.id } });
  await journaliser(db, { schoolId: d.schoolId, userId: d.id, action: "suppression", entity: "Classroom", entityId: c.id, before: { name: c.name } });
  return { ok: true };
}
