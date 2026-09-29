import { db } from "@/lib/db";
import { fournisseur } from "@/lib/paiement/fournisseurs";
import { actualiserPaiement } from "@/lib/paiement";

/**
 * Notification de paiement envoyée par le fournisseur (webhook). La signature est vérifiée, puis le statut est
 * relu auprès du fournisseur avant toute activation : le contenu de la notification n'est jamais cru seul.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/paiement/[fournisseur]">) {
  const { fournisseur: nom } = await ctx.params;
  const f = fournisseur(nom);
  if (!f || f.nom === "simulation") return new Response("Fournisseur inconnu.", { status: 404 });
  const corps = await req.text();
  let lu: Awaited<ReturnType<typeof f.lireNotification>>;
  try {
    lu = await f.lireNotification(corps, req.headers);
  } catch {
    lu = null;
  }
  if (!lu) return new Response("Notification refusée.", { status: 401 });
  const p = lu.reference
    ? await db().payment.findFirst({ where: { id: lu.reference, provider: f.nom } })
    : lu.refFournisseur
      ? await db().payment.findFirst({ where: { providerRef: lu.refFournisseur, provider: f.nom } })
      : null;
  if (!p) return new Response("Paiement inconnu.", { status: 200 });
  await actualiserPaiement(db(), p.id, `notification ${f.nom}`);
  return new Response("OK", { status: 200 });
}

// CinetPay teste l'adresse de notification par une requête GET.
export function GET() {
  return new Response("OK", { status: 200 });
}
