// Service d'activation d'AKWA SCHOOL (Netlify Functions + Netlify Blobs).
// Variables d'environnement du site (jamais dans le dépôt) :
//   EPP_LICENCE_CLE_PRIVEE : clé privée Ed25519 (PKCS8 DER en base64)
//   EPP_ADMIN_TOKEN        : jeton du générateur de codes (au moins 32 caractères)
//   RESEND_API_KEY         : clé de l'API d'envoi de mails Resend (mot de passe oublié) ; sans elle, pas d'envoi
//   EPP_MAIL_EXPEDITEUR    : expéditeur, ex. « AKWA SCHOOL <noreply@domaine-verifie> »
import { getStore } from "@netlify/blobs";
import { clePrivee, traiter } from "../../lib/core.mjs";

function stockage() {
  const s = getStore({ name: "activation-epp", consistency: "strong" });
  return {
    async get(k) { return s.get(k, { type: "json", consistency: "strong" }); },
    async setIfNew(k, v) { return (await s.setJSON(k, v, { onlyIfNew: true })).modified; },
    async set(k, v) { await s.setJSON(k, v); },
    async delete(k) { await s.delete(k); },
    async list(p) { return (await s.list({ prefix: p })).blobs.map((b) => b.key); },
  };
}

// Envoi par l'API Resend (https://resend.com), seulement si la clé est définie.
function envoyeurMail() {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) return null;
  return async ({ to, subject, text }) => {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EPP_MAIL_EXPEDITEUR || "AKWA SCHOOL <onboarding@resend.dev>", to, subject, text }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status} : ${await r.text()}`);
  };
}

export default async (req) =>
  traiter(req, {
    store: stockage(),
    privateKey: clePrivee(process.env.EPP_LICENCE_CLE_PRIVEE),
    jetonAdmin: process.env.EPP_ADMIN_TOKEN,
    envoyerMail: envoyeurMail(),
  });

export const config = { path: ["/api/activer", "/api/recuperation", "/api/sante", "/api/admin/*"] };
