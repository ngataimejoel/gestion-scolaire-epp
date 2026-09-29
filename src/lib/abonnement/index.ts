/**
 * Abonnement de chaque école à la plateforme : offres, état, limites, fonctions incluses et lecture seule.
 * Point central : toute action d'écriture passe par ecritureBloquee(), toute fonction payante par aLaFonction(),
 * toute création d'élève ou de compte enseignant par limiteAtteinte(). Aucun prix n'est écrit dans le code :
 * les offres sont en base (table plans), modifiables par l'administrateur de la plateforme.
 */
import { z } from "zod";
import type { Db } from "../db";
import type { Plan, User } from "@/generated/prisma/client";
import { journaliser } from "../audit";
import type { Resultat } from "../auth/service";
import initiales from "../../../prisma/offres-initiales.json";

export const JOUR_MS = 86_400_000;

/** Fonctions pouvant être incluses dans une offre (clés stockées dans plans.features). */
export const FONCTIONS: Record<string, string> = {
  notes: "Saisie des notes et résultats",
  absences: "Retards et absences",
  rapports: "Rapports officiels et bulletins",
  statistiques: "Statistiques",
  export_excel: "Export Excel",
  import_excel: "Import du classeur Excel",
  notifications_sms: "Notifications par SMS",
  assistant: "Assistant du directeur",
  sauvegarde: "Sauvegarde et restauration de l'école",
  support_prioritaire: "Support prioritaire",
};

export const LIBELLES_STATUT = {
  ACTIVE: "Actif",
  PENDING: "En attente de paiement",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
  PAYMENT_FAILED: "Paiement échoué",
} as const;

/** Charge les offres de départ si la table est vide. Ne modifie jamais des offres existantes. */
export async function initialiserOffres(db: Db): Promise<number> {
  if (await db.plan.count()) return 0;
  const r = await db.plan.createMany({
    data: initiales.offres.map((o) => ({ ...o, features: [...o.features] })),
    skipDuplicates: true,
  });
  return r.count;
}

export const ajouterJours = (d: Date, n: number) => new Date(d.getTime() + n * JOUR_MS);

/**
 * Ouvre la période d'essai d'une école qui n'a jamais eu d'abonnement actif (à l'inscription, ou pour une école
 * créée avant l'étape 10). Un verrou par école empêche deux essais en cas de requêtes simultanées.
 */
export async function ouvrirEssai(db: Db, schoolId: string, maintenant = new Date()) {
  await initialiserOffres(db);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"essai:" + schoolId}))`;
    if (await tx.subscription.count({ where: { schoolId, startsAt: { not: null } } })) {
      // Essai éventuellement ouvert à l'instant par une requête simultanée (son heure de début peut suivre la nôtre).
      return tx.subscription.findFirst({ where: { schoolId, status: "ACTIVE", endsAt: { gt: maintenant } }, include: { plan: true }, orderBy: { startsAt: "asc" } });
    }
    const essai = await tx.plan.findFirst({ where: { isTrial: true, isActive: true }, orderBy: { position: "asc" } });
    if (!essai) return null;
    return tx.subscription.create({
      data: { schoolId, planId: essai.id, status: "ACTIVE", startsAt: maintenant, endsAt: ajouterJours(maintenant, essai.durationDays) },
      include: { plan: true },
    });
  });
}

export interface EtatAbonnement {
  actif: boolean;
  lectureSeule: boolean;
  essai: boolean;
  plan: Plan | null;
  /** Fin de la période couverte, renouvellements déjà payés compris. */
  finLe: Date | null;
  joursRestants: number;
  paiementsEnAttente: number;
}

/**
 * État de l'abonnement d'une école à une date donnée. Les abonnements arrivés à échéance passent à « Expiré »
 * au passage ; une école qui n'a jamais eu d'abonnement reçoit sa période d'essai.
 */
export async function etatAbonnement(db: Db, schoolId: string, maintenant = new Date()): Promise<EtatAbonnement> {
  await db.subscription.updateMany({ where: { schoolId, status: "ACTIVE", endsAt: { lte: maintenant } }, data: { status: "EXPIRED" } });
  const actifs = await db.subscription.findMany({ where: { schoolId, status: "ACTIVE" }, include: { plan: true }, orderBy: { startsAt: "asc" } });
  let courant = actifs.find((s) => !s.startsAt || s.startsAt <= maintenant) ?? null;
  if (!courant && !actifs.length && !(await db.subscription.count({ where: { schoolId, startsAt: { not: null } } }))) {
    courant = await ouvrirEssai(db, schoolId, maintenant);
    if (courant) actifs.push(courant);
  }
  const dernier = courant ? null : await db.subscription.findFirst({ where: { schoolId, status: "EXPIRED" }, orderBy: { endsAt: "desc" }, include: { plan: true } });
  const fins = actifs.map((s) => s.endsAt?.getTime() ?? 0);
  const finLe = fins.length ? new Date(Math.max(...fins)) : (dernier?.endsAt ?? null);
  return {
    actif: !!courant,
    lectureSeule: !courant,
    essai: !!courant?.plan.isTrial,
    plan: courant?.plan ?? dernier?.plan ?? null,
    finLe,
    joursRestants: courant && finLe ? Math.max(0, Math.ceil((finLe.getTime() - maintenant.getTime()) / JOUR_MS)) : 0,
    paiementsEnAttente: await db.payment.count({ where: { schoolId, status: "PENDING" } }),
  };
}

export const MESSAGE_LECTURE_SEULE =
  "L'abonnement de l'école est arrivé à échéance : le site est en lecture seule, aucune donnée n'est perdue. Le directeur peut le renouveler dans Abonnement.";

/** Message d'erreur si l'utilisateur ne peut pas écrire (abonnement expiré), sinon null. */
export async function ecritureBloquee(db: Db, u: Pick<User, "role" | "schoolId">): Promise<string | null> {
  if (u.role === "PLATFORM_ADMIN" || !u.schoolId) return null;
  return (await etatAbonnement(db, u.schoolId)).lectureSeule ? MESSAGE_LECTURE_SEULE : null;
}

/** Vrai si l'offre en cours de l'école inclut la fonction (et que l'abonnement est actif). */
export async function aLaFonction(db: Db, schoolId: string, fonction: keyof typeof FONCTIONS): Promise<boolean> {
  const e = await etatAbonnement(db, schoolId);
  return e.actif && !!e.plan?.features.includes(fonction);
}

/** Nombre d'élèves inscrits cette année et de comptes enseignants actifs, comparés aux limites de l'offre. */
export async function utilisation(db: Db, schoolId: string) {
  const [eleves, enseignants] = await Promise.all([
    db.enrollment.count({ where: { classroom: { schoolId }, academicYear: { isActive: true } } }),
    db.user.count({ where: { schoolId, role: "TEACHER", isActive: true } }),
  ]);
  return { eleves, enseignants };
}

/** Message si la limite de l'offre empêche d'ajouter un élève ou un compte enseignant, sinon null. */
export async function limiteAtteinte(db: Db, schoolId: string, quoi: "eleves" | "enseignants"): Promise<string | null> {
  const e = await etatAbonnement(db, schoolId);
  if (!e.plan) return null;
  const max = quoi === "eleves" ? e.plan.maxStudents : e.plan.maxTeachers;
  if (max == null) return null;
  const u = await utilisation(db, schoolId);
  if (u[quoi] < max) return null;
  return quoi === "eleves"
    ? `L'offre « ${e.plan.name} » est limitée à ${max} élèves. Passez à une offre supérieure dans Abonnement pour en inscrire davantage.`
    : `L'offre « ${e.plan.name} » est limitée à ${max} comptes enseignants. Passez à une offre supérieure dans Abonnement.`;
}

/* ------------------------------------------------------------------------------------------------
 * Administration des offres (administrateur de la plateforme uniquement)
 * ---------------------------------------------------------------------------------------------- */

type Admin = Pick<User, "id" | "role">;
const entier = (min: number) => z.string().trim().regex(/^\d+$/, "Nombre entier attendu.").transform(Number).pipe(z.number().int().min(min));
const limite = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .pipe(z.string().regex(/^\d+$/, "Nombre entier ou vide (illimité).").transform(Number).nullable());

export const schemaOffre = z.object({
  name: z.string().trim().min(2, "Nom de l'offre requis.").max(60),
  priceXof: entier(0),
  durationDays: entier(1),
  maxStudents: limite,
  maxTeachers: limite,
  features: z.array(z.string()).transform((l) => l.filter((f) => f in FONCTIONS)),
  isActive: z.boolean(),
  position: entier(0),
});

export async function majOffre(db: Db, admin: Admin, planId: string | null, donnees: unknown, code?: string): Promise<Resultat<{ planId: string }>> {
  if (admin.role !== "PLATFORM_ADMIN") return { ok: false, erreur: "Réservé à l'administrateur de la plateforme." };
  const p = schemaOffre.safeParse(donnees);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, erreur: i.message, champ: String(i.path[0] ?? "") };
  }
  const v = p.data;
  if (!planId) {
    const c = (code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,20}$/.test(c)) return { ok: false, champ: "code", erreur: "Code en majuscules, 2 à 20 caractères (ex. ECOLE_PLUS)." };
    if (await db.plan.findUnique({ where: { code: c } })) return { ok: false, champ: "code", erreur: "Ce code d'offre existe déjà." };
    const cree = await db.plan.create({ data: { ...v, code: c, isTrial: false } });
    await journaliser(db, { userId: admin.id, action: "creation", entity: "Plan", entityId: cree.id, after: { ...v, code: c } });
    return { ok: true, planId: cree.id };
  }
  const avant = await db.plan.findUnique({ where: { id: planId } });
  if (!avant) return { ok: false, erreur: "Offre introuvable." };
  if (avant.isTrial && v.priceXof !== 0) return { ok: false, champ: "priceXof", erreur: "L'offre d'essai reste gratuite." };
  await db.plan.update({ where: { id: planId }, data: v });
  const { id: _id, ...ancien } = avant;
  await journaliser(db, { userId: admin.id, action: "modification", entity: "Plan", entityId: planId, before: ancien, after: v });
  return { ok: true, planId };
}

/** Écoles de la plateforme avec leur abonnement (aucune donnée d'élève n'est exposée). */
export async function ecolesDeLaPlateforme(db: Db) {
  const ecoles = await db.school.findMany({
    orderBy: { createdAt: "desc" },
    include: { users: { where: { role: "DIRECTOR" }, select: { fullName: true, phone: true } } },
  });
  return Promise.all(
    ecoles.map(async (s) => ({ id: s.id, nom: s.name, code: s.code, creeLe: s.createdAt, directeurs: s.users, etat: await etatAbonnement(db, s.id), utilisation: await utilisation(db, s.id) })),
  );
}
