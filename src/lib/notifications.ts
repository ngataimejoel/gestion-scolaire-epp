/**
 * Notifications : dans l'application, par SMS et par e-mail. Chaque envoi est tracé (table notifications)
 * avec sa date d'envoi ou son erreur. Les fournisseurs SMS et e-mail sont choisis par variables d'environnement.
 */
import type { Db } from "./db";
import type { NotificationChannel, User } from "@/generated/prisma/client";
import { envoyerSms } from "./sms";
import { envoyerEmail } from "./email";

export interface Message {
  titre: string;
  corps: string;
  canaux?: NotificationChannel[];
}

/** Envoie un message à des utilisateurs sur les canaux demandés (dans l'application par défaut). */
export async function notifier(db: Db, destinataires: Pick<User, "id" | "schoolId" | "phone" | "email">[], m: Message) {
  const canaux = m.canaux ?? ["IN_APP"];
  for (const u of destinataires) {
    for (const canal of canaux) {
      if (canal === "IN_APP") {
        await db.notification.create({ data: { schoolId: u.schoolId, userId: u.id, channel: canal, title: m.titre, body: m.corps, sentAt: new Date() } });
        continue;
      }
      if (canal === "EMAIL" && !u.email) continue;
      let erreur: string | null = null;
      try {
        if (canal === "SMS") await envoyerSms(u.phone, `${m.titre} : ${m.corps}`.slice(0, 459));
        else await envoyerEmail(u.email!, m.titre, m.corps);
      } catch (e) {
        erreur = e instanceof Error ? e.message : String(e);
      }
      await db.notification.create({
        data: { schoolId: u.schoolId, userId: u.id, channel: canal, title: m.titre, body: m.corps, sentAt: erreur ? null : new Date(), error: erreur, readAt: new Date() },
      });
    }
  }
}

export async function notifierDirecteurs(db: Db, schoolId: string, m: Message) {
  const directeurs = await db.user.findMany({ where: { schoolId, role: "DIRECTOR", isActive: true } });
  await notifier(db, directeurs, m);
  return directeurs.length;
}

/* ------------------------------------------------------------------ Consultation */

export const mesNotifications = (db: Db, userId: string, nombre = 100) =>
  db.notification.findMany({ where: { userId, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: nombre });

export const nombreNonLues = (db: Db, userId: string) => db.notification.count({ where: { userId, channel: "IN_APP", readAt: null } });

/** Marque une notification (ou toutes) comme lue ; uniquement celles de l'utilisateur. */
export const marquerLues = (db: Db, userId: string, id?: string) =>
  db.notification.updateMany({ where: { userId, channel: "IN_APP", readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });

/* ------------------------------------------------------------------ Alertes quotidiennes */

const JOUR = 86_400_000;
const debutDuJour = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const dateFr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
export const DELAI_RAPPEL_COMPOSITION = 3;
export const DELAI_SAISIE_NOTES = 7;

async function envoyerUneFois(db: Db, destinataires: Pick<User, "id" | "schoolId" | "phone" | "email">[], m: Message) {
  const nouveaux = [];
  for (const u of destinataires) {
    if (!(await db.notification.count({ where: { userId: u.id, title: m.titre, body: m.corps } }))) nouveaux.push(u);
  }
  if (nouveaux.length) await notifier(db, nouveaux, m);
  return nouveaux.length;
}

/**
 * Alertes du cahier des charges envoyées une fois par jour (route /api/taches) :
 * composition dans 3 jours (enseignants de la classe et directeur), notes toujours en saisie 7 jours après
 * l'évaluation (enseignants de la classe). Par SMS en plus si l'offre de l'école inclut les notifications SMS.
 */
export async function alertesQuotidiennes(db: Db, maintenant = new Date(), smsAutorise: (schoolId: string) => Promise<boolean> = async () => false) {
  const aujourdhui = debutDuJour(maintenant);
  const evaluations = await db.assessment.findMany({
    where: {
      academicYear: { isActive: true },
      OR: [
        { date: new Date(aujourdhui.getTime() + DELAI_RAPPEL_COMPOSITION * JOUR) },
        { date: { lte: new Date(aujourdhui.getTime() - DELAI_SAISIE_NOTES * JOUR), gte: new Date(aujourdhui.getTime() - 60 * JOUR) } },
      ],
    },
  });
  let envois = 0;
  for (const ev of evaluations) {
    const canaux: NotificationChannel[] = (await smsAutorise(ev.schoolId)) ? ["IN_APP", "SMS"] : ["IN_APP"];
    const classes = await db.classroom.findMany({
      where: { academicYearId: ev.academicYearId, level: ev.track === "CM2" ? { code: "CM2" } : { code: { not: "CM2" } } },
      include: {
        assessmentStates: { where: { assessmentId: ev.id } },
        teachers: { include: { staff: { include: { user: true } } } },
      },
    });
    const enseignants = (c: (typeof classes)[number]) => c.teachers.map((t) => t.staff.user).filter((u): u is User => !!u && u.isActive);
    if (ev.date!.getTime() > aujourdhui.getTime()) {
      const directeurs = await db.user.findMany({ where: { schoolId: ev.schoolId, role: "DIRECTOR", isActive: true } });
      const tous = [...directeurs, ...classes.flatMap(enseignants)];
      envois += await envoyerUneFois(db, [...new Map(tous.map((u) => [u.id, u])).values()], {
        titre: `Évaluation dans ${DELAI_RAPPEL_COMPOSITION} jours`,
        corps: `${ev.label} le ${dateFr(ev.date!)}${ev.track === "CM2" ? " (CM2)" : ""}. Préparez les feuilles de notes.`,
        canaux,
      });
      continue;
    }
    for (const c of classes) {
      if ((c.assessmentStates[0]?.state ?? "OPEN") !== "OPEN") continue;
      envois += await envoyerUneFois(db, enseignants(c), {
        titre: `Notes à terminer : ${c.name}`,
        corps: `${ev.label} du ${dateFr(ev.date!)} : la feuille de ${c.name} n'est pas encore validée. Terminez la saisie puis validez-la.`,
        canaux,
      });
    }
  }
  return envois;
}
