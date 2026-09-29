/**
 * Personnel (feuille PERSONNEL) : toutes les colonnes du classeur, âge (date de référence des âges),
 * ancienneté (date d'édition des états), classe tenue, et compte de connexion des enseignants.
 */
import { z } from "zod";
import type { Db } from "./db";
import type { User } from "@/generated/prisma/client";
import { journaliser } from "./audit";
import { limiteAtteinte } from "./abonnement";
import { creerCompteEnseignant, type Resultat } from "./auth/service";
import { supprimerAutresSessions } from "./auth/sessions";
import { normaliserTelephone } from "./auth/telephone";
import { envoyerSms } from "./sms";
import { anneesRevolues, estEnseignant } from "./regles";

type Directeur = Pick<User, "id" | "schoolId" | "role">;

/** Un compte est créé pour tout membre qui enseigne (INSTITUTEUR*, DIRECTEUR ADJOINT), sauf le directeur lui-même. */
export const aUnCompteEnseignant = (fonction: string) => estEnseignant(fonction) && fonction !== "DIRECTEUR";

const opt = (max = 80) =>
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

export const schemaPersonnel = z.object({
  matricule: z.string().trim().toUpperCase().min(1, "Matricule obligatoire.").max(30),
  lastName: z.string().trim().toUpperCase().min(1, "Nom obligatoire.").max(60),
  firstNames: z.string().trim().min(1, "Prénoms obligatoires.").max(100),
  sex: z.enum(["M", "F"], { message: "Choisissez le sexe." }),
  birthDate: dateOpt.prefault(""),
  function: z.string().trim().min(1, "Choisissez une fonction."),
  grade: opt(40).prefault(""),
  diploma: opt(60).prefault(""),
  serviceStartDate: dateOpt.prefault(""),
  arrivalDate: dateOpt.prefault(""),
  phone: z.string().trim().max(20).optional().default(""),
  maritalStatus: opt(30).prefault(""),
  notes: opt(500).prefault(""),
  classroomId: z.string().optional().default(""), // classe tenue pour l'année active ("" = aucune)
});
export type DonneesPersonnel = z.input<typeof schemaPersonnel>;

function erreur(e: z.ZodError) {
  const i = e.issues[0];
  return { ok: false as const, erreur: i.message, champ: i.path.join(".") };
}

async function valider(db: Db, schoolId: string, donnees: unknown, staffId?: string) {
  const p = schemaPersonnel.safeParse(donnees);
  if (!p.success) return erreur(p.error);
  const v = p.data;
  if (!(await db.choiceItem.findFirst({ where: { schoolId, list: "STAFF_FUNCTION", value: v.function } })))
    return { ok: false as const, champ: "function", erreur: "Fonction absente de la liste des Paramètres." };
  if (v.maritalStatus && !(await db.choiceItem.findFirst({ where: { schoolId, list: "MARITAL_STATUS", value: v.maritalStatus } })))
    return { ok: false as const, champ: "maritalStatus", erreur: "Situation matrimoniale absente de la liste des Paramètres." };
  const phone = v.phone ? normaliserTelephone(v.phone) : null;
  if (v.phone && !phone) return { ok: false as const, champ: "phone", erreur: "Numéro invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." };
  if (aUnCompteEnseignant(v.function) && !phone)
    return { ok: false as const, champ: "phone", erreur: "Le numéro est obligatoire pour un enseignant : il sert d'identifiant de connexion." };
  const doublon = await db.staff.findFirst({ where: { schoolId, matricule: v.matricule, NOT: staffId ? { id: staffId } : undefined } });
  if (doublon) return { ok: false as const, champ: "matricule", erreur: `Ce matricule est déjà attribué à ${doublon.lastName} ${doublon.firstNames}.` };
  if (v.classroomId && !(await db.classroom.findFirst({ where: { id: v.classroomId, schoolId, academicYear: { isActive: true } } })))
    return { ok: false as const, champ: "classroomId", erreur: "Classe introuvable pour l'année en cours." };
  return { ok: true as const, v: { ...v, phone } };
}

/** Classe tenue : remplace l'affectation de l'année active pour ce membre du personnel. */
async function affecterClasse(db: Db, schoolId: string, staffId: string, classroomId: string) {
  const actuelles = await db.classTeacher.findMany({ where: { staffId, classroom: { schoolId, academicYear: { isActive: true } } } });
  await db.$transaction([
    db.classTeacher.deleteMany({ where: { staffId, classroomId: { in: actuelles.map((a) => a.classroomId) } } }),
    ...(classroomId ? [db.classTeacher.create({ data: { staffId, classroomId } })] : []),
  ]);
}

const champs = (v: Exclude<Awaited<ReturnType<typeof valider>>, { ok: false }>["v"]) => ({
  matricule: v.matricule,
  lastName: v.lastName,
  firstNames: v.firstNames,
  sex: v.sex,
  birthDate: v.birthDate,
  function: v.function,
  grade: v.grade,
  diploma: v.diploma,
  serviceStartDate: v.serviceStartDate,
  arrivalDate: v.arrivalDate,
  phone: v.phone,
  maritalStatus: v.maritalStatus,
  notes: v.notes,
});

/** Enregistre un membre du personnel ; s'il enseigne, son compte est créé et ses identifiants envoyés par SMS. */
export async function enregistrerPersonnel(
  db: Db,
  directeur: Directeur,
  donnees: unknown,
): Promise<Resultat<{ staffId: string; compte?: { phone: string; motDePasse: string }; avertissement?: string }>> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut enregistrer le personnel." };
  const r = await valider(db, directeur.schoolId, donnees);
  if (!r.ok) return r;
  const v = r.v;
  if (v.phone && aUnCompteEnseignant(v.function) && (await db.user.findUnique({ where: { phone: v.phone } })))
    return { ok: false, champ: "phone", erreur: "Ce numéro est déjà utilisé par un autre compte." };
  if (aUnCompteEnseignant(v.function)) {
    const limite = await limiteAtteinte(db, directeur.schoolId, "enseignants");
    if (limite) return { ok: false, erreur: limite };
  }

  const staff = await db.staff.create({ data: { ...champs(v), schoolId: directeur.schoolId } });
  if (v.classroomId) await affecterClasse(db, directeur.schoolId, staff.id, v.classroomId);
  await journaliser(db, { schoolId: directeur.schoolId, userId: directeur.id, action: "creation", entity: "Staff", entityId: staff.id, after: JSON.parse(JSON.stringify(champs(v))) });
  if (!aUnCompteEnseignant(v.function)) return { ok: true, staffId: staff.id };

  const c = await creerCompteEnseignant(db, directeur, staff.id);
  if (!c.ok) return { ok: true, staffId: staff.id, avertissement: `Membre enregistré, mais le compte n'a pas pu être créé : ${c.erreur}` };
  return { ok: true, staffId: staff.id, compte: { phone: c.phone, motDePasse: c.motDePasse } };
}

/**
 * Modifie un membre du personnel. Si son numéro change et qu'il a un compte, l'identifiant de connexion suit
 * (le nouveau numéro est prévenu par SMS et les sessions ouvertes sont fermées).
 */
export async function modifierPersonnel(db: Db, directeur: Directeur, staffId: string, donnees: unknown): Promise<Resultat<{ avertissement?: string }>> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut modifier le personnel." };
  const avant = await db.staff.findFirst({ where: { id: staffId, schoolId: directeur.schoolId }, include: { user: true } });
  if (!avant) return { ok: false, erreur: "Membre du personnel introuvable." };
  const r = await valider(db, directeur.schoolId, donnees, staffId);
  if (!r.ok) return r;
  const v = r.v;
  if (avant.user && v.phone && v.phone !== avant.user.phone) {
    if (await db.user.findUnique({ where: { phone: v.phone } })) return { ok: false, champ: "phone", erreur: "Ce numéro est déjà utilisé par un autre compte." };
  }
  if (avant.user && !v.phone) return { ok: false, champ: "phone", erreur: "Ce membre a un compte : son numéro (identifiant) ne peut pas être vidé." };

  await db.staff.update({ where: { id: staffId }, data: champs(v) });
  await affecterClasse(db, directeur.schoolId, staffId, v.classroomId);
  let avertissement: string | undefined;
  if (avant.user) {
    const nom = `${v.lastName} ${v.firstNames}`.trim();
    await db.user.update({ where: { id: avant.user.id }, data: { phone: v.phone!, fullName: nom } });
    if (v.phone !== avant.user.phone) {
      await supprimerAutresSessions(db, avant.user.id);
      await envoyerSms(v.phone!, `GESTION SCOLAIRE EPP - Votre identifiant de connexion est désormais ce numéro. Votre mot de passe ne change pas.`);
      avertissement = "L'identifiant de connexion a été remplacé par le nouveau numéro.";
    }
  }
  await journaliser(db, {
    schoolId: directeur.schoolId, userId: directeur.id, action: "modification", entity: "Staff", entityId: staffId,
    before: JSON.parse(JSON.stringify({ ...avant, user: undefined })), after: JSON.parse(JSON.stringify({ ...champs(v), classroomId: v.classroomId || null })),
  });
  return { ok: true, avertissement };
}

/** Active ou désactive le compte d'un enseignant (départ, mutation) sans effacer son historique. */
export async function changerActivationCompte(db: Db, directeur: Directeur, staffId: string, actif: boolean): Promise<Resultat> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut gérer les comptes." };
  const s = await db.staff.findFirst({ where: { id: staffId, schoolId: directeur.schoolId }, include: { user: true } });
  if (!s?.user) return { ok: false, erreur: "Ce membre n'a pas de compte." };
  if (s.user.role !== "TEACHER") return { ok: false, erreur: "Seul un compte enseignant peut être désactivé ici." };
  if (actif && !s.user.isActive) {
    const limite = await limiteAtteinte(db, directeur.schoolId, "enseignants");
    if (limite) return { ok: false, erreur: limite };
  }
  await db.user.update({ where: { id: s.user.id }, data: { isActive: actif } });
  if (!actif) await supprimerAutresSessions(db, s.user.id);
  await journaliser(db, { schoolId: directeur.schoolId, userId: directeur.id, action: actif ? "activation_compte" : "desactivation_compte", entity: "User", entityId: s.user.id });
  return { ok: true };
}

/** Supprime une fiche saisie par erreur ; refusé si le membre a un compte, une classe ou des absences. */
export async function supprimerPersonnel(db: Db, directeur: Directeur, staffId: string): Promise<Resultat> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut supprimer une fiche." };
  const s = await db.staff.findFirst({ where: { id: staffId, schoolId: directeur.schoolId }, include: { _count: { select: { attendance: true, classes: true } } } });
  if (!s) return { ok: false, erreur: "Membre du personnel introuvable." };
  if (s.userId || s._count.attendance || s._count.classes)
    return { ok: false, erreur: "Ce membre a un compte, une classe ou des absences enregistrées : désactivez plutôt son compte et retirez sa classe." };
  await db.staff.delete({ where: { id: s.id } });
  await journaliser(db, { schoolId: directeur.schoolId, userId: directeur.id, action: "suppression", entity: "Staff", entityId: s.id, before: JSON.parse(JSON.stringify(s)) });
  return { ok: true };
}

/** Liste du personnel avec âge, ancienneté et classe tenue (colonnes calculées de la feuille PERSONNEL). */
export async function listerPersonnel(db: Db, schoolId: string) {
  const [liste, annee, reglages] = await Promise.all([
    db.staff.findMany({
      where: { schoolId },
      include: {
        user: { select: { mustChangePassword: true, lastLoginAt: true, isActive: true } },
        classes: { where: { classroom: { academicYear: { isActive: true } } }, include: { classroom: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstNames: "asc" }],
    }),
    db.academicYear.findFirst({ where: { schoolId, isActive: true } }),
    db.schoolSettings.findUnique({ where: { schoolId } }),
  ]);
  // Ordre du classeur : directeur, puis enseignants, puis autres agents.
  const rang = (f: string) => (f.startsWith("DIRECTEUR") ? 0 : f.startsWith("INSTITUTEUR") ? 1 : 2);
  return liste
    .sort((a, b) => rang(a.function) - rang(b.function))
    .map((s) => ({
      ...s,
      age: annee ? anneesRevolues(s.birthDate, annee.ageReferenceDate) : null,
      anciennete: reglages?.reportDate ? anneesRevolues(s.serviceStartDate, reglages.reportDate) : null,
      classeTenue: s.classes.map((c) => c.classroom.name).join(", ") || null,
    }));
}
