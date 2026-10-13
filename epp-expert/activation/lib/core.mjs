// Logique du service d'activation, indépendante de l'hébergeur (testée avec un stockage en mémoire).
//
// Stockage : interface { get(cle), setIfNew(cle, valeur) -> bool, set(cle, valeur), delete(cle), list(prefixe) }.
//   codes/<CODE>        : { type: "1an" | "vie", note, cree_le, revoque }
//   utilisations/<CODE> : { machine, ecole, active_le, licence, signature }  (créé une seule fois : usage unique)
//
// La licence renvoyée est un JSON encodé en base64url, signé en Ed25519 avec la clé privée du
// service. L'application ne connaît que la clé publique : elle vérifie la licence hors ligne.
import crypto from "node:crypto";

export const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sans 0/O, 1/I
export const TYPES = { "1an": "1 an", vie: "À vie" };
const JOUR = 86400000;

export class ErreurActivation extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function normaliserCode(code) {
  const brut = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^EPP/, "");
  if (brut.length !== 16 || [...brut].some((c) => !ALPHABET.includes(c))) return null;
  return `EPP-${brut.slice(0, 4)}-${brut.slice(4, 8)}-${brut.slice(8, 12)}-${brut.slice(12, 16)}`;
}

export function nouveauCode() {
  const octets = crypto.randomBytes(16);
  const brut = [...octets].map((o) => ALPHABET[o % 32]).join(""); // 256 % 32 = 0 : pas de biais
  return normaliserCode(brut);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function clePrivee(pkcs8Base64) {
  return crypto.createPrivateKey({ key: Buffer.from(pkcs8Base64, "base64"), format: "der", type: "pkcs8" });
}

export function clePubliqueBrute(privateKey) {
  return Buffer.from(crypto.createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url").toString("base64");
}

export function verifierLicence(privateKey, licence, signature) {
  try {
    const pub = crypto.createPublicKey(privateKey);
    if (!crypto.verify(null, Buffer.from(licence, "base64url"), pub, Buffer.from(signature, "base64url"))) return null;
    return JSON.parse(Buffer.from(licence, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function genererCodes(store, { type, nombre = 1, note = "" }, maintenant = new Date()) {
  if (!TYPES[type]) throw new ErreurActivation(400, "Type de code inconnu (1an ou vie).");
  nombre = Number(nombre);
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 500) throw new ErreurActivation(400, "Nombre de codes : 1 à 500.");
  const codes = [];
  while (codes.length < nombre) {
    const code = nouveauCode();
    const cree = await store.setIfNew(`codes/${code}`, {
      type, note: String(note).slice(0, 200), cree_le: maintenant.toISOString(), revoque: false,
    });
    if (cree) codes.push(code);
  }
  return codes.map((code) => ({ code, type, note }));
}

export async function activer(store, privateKey, demande, maintenant = new Date()) {
  const code = normaliserCode(demande.code);
  const machine = String(demande.machine || "");
  if (!code) throw new ErreurActivation(400, "Code d'activation mal saisi.");
  if (!/^[0-9a-f]{64}$/.test(machine)) throw new ErreurActivation(400, "Identifiant de l'ordinateur invalide.");
  const rec = await store.get(`codes/${code}`);
  if (!rec) throw new ErreurActivation(404, "Code d'activation inconnu.");
  if (rec.revoque) throw new ErreurActivation(403, "Ce code a été annulé par le fournisseur.");

  const deja = await store.get(`utilisations/${code}`);
  if (deja) {
    // un code ne sert qu'une fois ; seul l'ordinateur qui l'a activé peut récupérer sa licence (réinstallation)
    if (deja.machine !== machine) throw new ErreurActivation(409, "Ce code a déjà été utilisé sur un autre ordinateur.");
    return { licence: deja.licence, signature: deja.signature, reactivation: true };
  }

  let base = maintenant.getTime();
  if (rec.type === "1an" && demande.licence_actuelle && demande.signature_actuelle) {
    // renouvellement avant échéance : les jours restants ne sont pas perdus
    const act = verifierLicence(privateKey, demande.licence_actuelle, demande.signature_actuelle);
    if (act && act.machine === machine && act.expire_le && Date.parse(act.expire_le) > base) base = Date.parse(act.expire_le);
  }
  const contenu = {
    v: 1, produit: "GESTION SCOLAIRE EPP EXPERT", code, type: rec.type, machine,
    ecole: String(demande.ecole || "").slice(0, 120), active_le: maintenant.toISOString(),
    expire_le: rec.type === "vie" ? null : new Date(base + 365 * JOUR).toISOString(),
  };
  const licence = b64u(JSON.stringify(contenu));
  const signature = b64u(crypto.sign(null, Buffer.from(licence, "base64url"), privateKey));
  const enregistre = await store.setIfNew(`utilisations/${code}`, {
    machine, ecole: contenu.ecole, active_le: contenu.active_le, version: String(demande.version || ""),
    licence, signature,
  });
  if (!enregistre) {
    // activation simultanée du même code : celle qui a été enregistrée la première l'emporte
    return activer(store, privateKey, demande, maintenant);
  }
  return { licence, signature, reactivation: false };
}

export async function lister(store) {
  const out = [];
  for (const cle of await store.list("codes/")) {
    const code = cle.slice("codes/".length);
    const rec = await store.get(cle);
    const u = await store.get(`utilisations/${code}`);
    let expire_le = null;
    if (u) expire_le = JSON.parse(Buffer.from(u.licence, "base64url").toString("utf8")).expire_le;
    out.push({ code, ...rec, utilise: !!u, ecole: u?.ecole || "", active_le: u?.active_le || null, expire_le });
  }
  return out.sort((a, b) => (a.cree_le < b.cree_le ? 1 : -1));
}

export async function liberer(store, code) {
  code = normaliserCode(code);
  if (!code || !(await store.get(`codes/${code}`))) throw new ErreurActivation(404, "Code inconnu.");
  await store.delete(`utilisations/${code}`);
}

export async function revoquer(store, code) {
  code = normaliserCode(code);
  const rec = code && (await store.get(`codes/${code}`));
  if (!rec) throw new ErreurActivation(404, "Code inconnu.");
  await store.set(`codes/${code}`, { ...rec, revoque: true });
}

export function jetonAdminValide(req, attendu) {
  const recu = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!attendu || attendu.length < 32 || !recu) return false;
  const a = crypto.createHash("sha256").update(recu).digest();
  const b = crypto.createHash("sha256").update(attendu).digest();
  return crypto.timingSafeEqual(a, b);
}

export function memoire() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async setIfNew(k, v) { if (m.has(k)) return false; m.set(k, structuredClone(v)); return true; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { m.delete(k); },
    async list(p) { return [...m.keys()].filter((k) => k.startsWith(p)); },
  };
}

// Traitement HTTP commun (Netlify et serveur local de test)
export async function traiter(req, { store, privateKey, jetonAdmin }) {
  const url = new URL(req.url);
  const json = (corps, status = 200) => Response.json(corps, { status });
  try {
    if (url.pathname.endsWith("/api/activer") && req.method === "POST") {
      return json(await activer(store, privateKey, await req.json()));
    }
    if (url.pathname.endsWith("/api/sante")) return json({ ok: true, cle_publique: clePubliqueBrute(privateKey) });
    if (url.pathname.includes("/api/admin/")) {
      if (!jetonAdminValide(req, jetonAdmin)) return json({ erreur: "Accès refusé." }, 401);
      const action = url.pathname.split("/api/admin/")[1];
      const corps = req.method === "POST" ? await req.json() : {};
      if (action === "codes" && req.method === "GET") return json({ codes: await lister(store) });
      if (action === "codes" && req.method === "POST") return json({ codes: await genererCodes(store, corps) }, 201);
      if (action === "liberer" && req.method === "POST") { await liberer(store, corps.code); return json({ ok: true }); }
      if (action === "revoquer" && req.method === "POST") { await revoquer(store, corps.code); return json({ ok: true }); }
    }
    return json({ erreur: "Introuvable." }, 404);
  } catch (e) {
    if (e instanceof ErreurActivation) return json({ erreur: e.message }, e.status);
    if (e instanceof SyntaxError) return json({ erreur: "Requête invalide." }, 400);
    console.error(e);
    return json({ erreur: "Erreur du service d'activation." }, 500);
  }
}
