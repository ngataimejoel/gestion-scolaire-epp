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
