import { db } from "@/lib/db";
import { egaliteSure } from "@/lib/paiement/fournisseurs";
import { rappelsAbonnement } from "@/lib/paiement";

/**
 * Tâches quotidiennes (rappels d'abonnement J-15, J-7, J-1…). À appeler une fois par jour par un planificateur
 * (cron) avec l'en-tête « Authorization: Bearer <CRON_SECRET> ».
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !egaliteSure(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Accès refusé.", { status: 401 });
  const rappels = await rappelsAbonnement(db());
  return Response.json({ rappels });
}
