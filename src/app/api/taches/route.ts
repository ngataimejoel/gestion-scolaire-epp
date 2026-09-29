import { db } from "@/lib/db";
import { aLaFonction } from "@/lib/abonnement";
import { alertesQuotidiennes } from "@/lib/notifications";
import { egaliteSure } from "@/lib/paiement/fournisseurs";
import { rappelsAbonnement } from "@/lib/paiement";

/**
 * Tâches quotidiennes : rappels d'abonnement (J-15, J-7, J-1), évaluation dans 3 jours, notes non validées
 * 7 jours après l'évaluation. À appeler une fois par jour par un planificateur (cron) avec l'en-tête
 * « Authorization: Bearer <CRON_SECRET> ». Chaque message n'est envoyé qu'une fois.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !egaliteSure(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Accès refusé.", { status: 401 });
  const rappels = await rappelsAbonnement(db());
  const alertes = await alertesQuotidiennes(db(), new Date(), (schoolId) => aLaFonction(db(), schoolId, "notifications_sms"));
  return Response.json({ rappels, alertes });
}
