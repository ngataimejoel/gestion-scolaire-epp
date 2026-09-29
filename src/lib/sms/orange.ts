/**
 * Envoi de SMS par l'API Orange « SMS Côte d'Ivoire » (developer.orange.com), activé par SMS_PROVIDER=orange.
 * Jeton OAuth2 (client credentials) gardé en mémoire jusqu'à son expiration. Clés lues uniquement côté serveur.
 */
import type { FournisseurSms } from "./index";

const API = "https://api.orange.com";
let jeton: { valeur: string; expire: number } | null = null;

/** Numéro local ivoirien (10 chiffres) ou déjà international → format tel:+225… attendu par l'API. */
export function adresseOrange(telephone: string): string {
  const chiffres = telephone.replace(/\D/g, "");
  if (chiffres.startsWith("225") && chiffres.length === 13) return `tel:+${chiffres}`;
  if (chiffres.length === 10) return `tel:+225${chiffres}`;
  throw new Error(`Numéro de téléphone invalide pour l'envoi de SMS : ${telephone}`);
}

function config() {
  const id = process.env.ORANGE_SMS_CLIENT_ID;
  const secret = process.env.ORANGE_SMS_CLIENT_SECRET;
  const expediteur = process.env.ORANGE_SMS_EXPEDITEUR;
  if (!id || !secret || !expediteur) throw new Error("SMS Orange : renseignez ORANGE_SMS_CLIENT_ID, ORANGE_SMS_CLIENT_SECRET et ORANGE_SMS_EXPEDITEUR.");
  return { id, secret, expediteur: adresseOrange(expediteur), nom: process.env.SMS_SENDER || undefined };
}

async function obtenirJeton(id: string, secret: string, maintenant = Date.now()): Promise<string> {
  if (jeton && jeton.expire > maintenant + 60_000) return jeton.valeur;
  const r = await fetch(`${API}/oauth/v3/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`SMS Orange : authentification refusée (${r.status}).`);
  const d = (await r.json()) as { access_token: string; expires_in: number };
  jeton = { valeur: d.access_token, expire: maintenant + Number(d.expires_in) * 1000 };
  return jeton.valeur;
}

export const orange: FournisseurSms = {
  nom: "orange",
  async envoyer(telephone, message) {
    const c = config();
    const valeur = await obtenirJeton(c.id, c.secret);
    const r = await fetch(`${API}/smsmessaging/v1/outbound/${encodeURIComponent(c.expediteur)}/requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${valeur}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        outboundSMSMessageRequest: { address: adresseOrange(telephone), senderAddress: c.expediteur, senderName: c.nom, outboundSMSTextMessage: { message } },
      }),
    });
    if (r.status === 401) jeton = null;
    if (!r.ok) throw new Error(`SMS Orange : envoi refusé (${r.status}).`);
  },
};

/** Tests uniquement : oublie le jeton en mémoire. */
export const oublierJetonOrange = () => {
  jeton = null;
};
