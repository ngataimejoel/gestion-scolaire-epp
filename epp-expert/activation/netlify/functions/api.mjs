// Service d'activation de GESTION SCOLAIRE EPP EXPERT (Netlify Functions + Netlify Blobs).
// Variables d'environnement du site (jamais dans le dépôt) :
//   EPP_LICENCE_CLE_PRIVEE : clé privée Ed25519 (PKCS8 DER en base64)
//   EPP_ADMIN_TOKEN        : jeton du générateur de codes (au moins 32 caractères)
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

export default async (req) =>
  traiter(req, {
    store: stockage(),
    privateKey: clePrivee(process.env.EPP_LICENCE_CLE_PRIVEE),
    jetonAdmin: process.env.EPP_ADMIN_TOKEN,
  });

export const config = { path: ["/api/activer", "/api/sante", "/api/admin/*"] };
