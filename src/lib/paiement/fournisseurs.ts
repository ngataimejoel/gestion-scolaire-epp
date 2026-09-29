/**
 * Fournisseurs de paiement interchangeables (Mobile Money en Côte d'Ivoire).
 * Les clés ne sont lues que dans les variables d'environnement du serveur, jamais envoyées au navigateur.
 * Règle de sécurité : une notification (webhook) n'est jamais crue sur parole. Sa signature est vérifiée quand le
 * fournisseur en fournit une, puis le statut et le montant sont relus auprès du fournisseur (verifier()).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type StatutFournisseur = "SUCCEEDED" | "FAILED" | "PENDING";

export interface DemandeFournisseur {
  /** Identifiant du paiement en base, transmis comme référence de transaction. */
  reference: string;
  montant: number;
  description: string;
  urlRetour: string;
  urlNotification: string;
}

export interface Verification {
  reference: string;
  refFournisseur?: string;
  statut: StatutFournisseur;
  montant: number | null;
  devise?: string;
  brut?: unknown;
}

export interface FournisseurPaiement {
  nom: string;
  libelle: string;
  initier(d: DemandeFournisseur): Promise<{ urlPaiement: string; refFournisseur: string }>;
  /** Lit une notification après vérification de son authenticité ; null si elle est invalide. */
  lireNotification(corps: string, entetes: Headers): Promise<{ reference?: string; refFournisseur?: string } | null>;
  /** Interroge le fournisseur, source de vérité du statut et du montant. */
  verifier(p: { reference: string; refFournisseur: string | null }): Promise<Verification>;
}

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Variable d'environnement manquante : ${k}`);
  return v;
};

export function egaliteSure(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function json(r: Response) {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`Réponse inattendue du fournisseur (${r.status}).`);
  }
}

/* Simulation : pour la démonstration et les tests. Le paiement est confirmé à la main sur /abonnement/simulation. */
const simulation: FournisseurPaiement = {
  nom: "simulation",
  libelle: "Paiement simulé (démonstration)",
  async initier(d) {
    return { urlPaiement: `/abonnement/simulation?paiement=${encodeURIComponent(d.reference)}`, refFournisseur: `SIM-${d.reference}` };
  },
  async lireNotification() {
    return null; // aucune notification externe en simulation
  },
  async verifier(p) {
    return { reference: p.reference, statut: "PENDING", montant: null };
  },
};

/*
 * CinetPay (Orange Money, MTN MoMo, Moov Money, Wave, cartes) : API Checkout v2.
 * Variables : CINETPAY_API_KEY, CINETPAY_SITE_ID, et CINETPAY_SECRET_KEY pour vérifier l'en-tête x-token.
 */
const CINETPAY = "https://api-checkout.cinetpay.com/v2";
const CHAMPS_XTOKEN = [
  "cpm_site_id", "cpm_trans_id", "cpm_trans_date", "cpm_amount", "cpm_currency", "signature", "payment_method", "cel_phone_num",
  "cpm_phone_prefixe", "cpm_language", "cpm_version", "cpm_payment_config", "cpm_page_action", "cpm_custom", "cpm_designation", "cpm_error_message",
];

const cinetpay: FournisseurPaiement = {
  nom: "cinetpay",
  libelle: "Mobile Money et carte (CinetPay)",
  async initier(d) {
    const r = await fetch(`${CINETPAY}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: env("CINETPAY_API_KEY"),
        site_id: env("CINETPAY_SITE_ID"),
        transaction_id: d.reference,
        amount: d.montant,
        currency: "XOF",
        description: d.description.replace(/[^\w\s\-.]/g, " ").slice(0, 100),
        notify_url: d.urlNotification,
        return_url: d.urlRetour,
        channels: "ALL",
        lang: "fr",
      }),
    });
    const j = await json(r);
    if (j.code !== "201" || !j.data?.payment_url) throw new Error(`CinetPay : ${j.message ?? "paiement refusé"} ${j.description ?? ""}`.trim());
    return { urlPaiement: j.data.payment_url, refFournisseur: j.data.payment_token ?? d.reference };
  },
  async lireNotification(corps, entetes) {
    const p = new URLSearchParams(corps);
    const reference = p.get("cpm_trans_id");
    if (!reference) return null;
    if (p.get("cpm_site_id") && p.get("cpm_site_id") !== process.env.CINETPAY_SITE_ID) return null;
    const secret = process.env.CINETPAY_SECRET_KEY;
    if (secret) {
      const attendu = createHmac("sha256", secret).update(CHAMPS_XTOKEN.map((k) => p.get(k) ?? "").join("")).digest("hex");
      if (!egaliteSure(attendu, entetes.get("x-token") ?? "")) return null;
    }
    return { reference };
  },
  async verifier(p) {
    const r = await fetch(`${CINETPAY}/payment/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: env("CINETPAY_API_KEY"), site_id: env("CINETPAY_SITE_ID"), transaction_id: p.reference }),
    });
    const j = await json(r);
    const s = String(j.data?.status ?? "");
    const statut: StatutFournisseur = s === "ACCEPTED" ? "SUCCEEDED" : s === "REFUSED" || s === "CANCELED" ? "FAILED" : "PENDING";
    return { reference: p.reference, statut, montant: j.data?.amount != null ? Number(j.data.amount) : null, devise: j.data?.currency, brut: j };
  },
};

/*
 * Wave (Checkout API). Variables : WAVE_API_KEY et WAVE_WEBHOOK_SECRET (en-tête Wave-Signature : t=…,v1=…).
 */
const WAVE = "https://api.wave.com/v1";
const TOLERANCE_WAVE_S = 300;

export function signatureWaveValide(corps: string, entete: string, secret: string, maintenantS = Math.floor(Date.now() / 1000)) {
  const parties = Object.fromEntries(entete.split(",").map((x) => x.trim().split("=", 2) as [string, string]));
  const t = Number(parties.t);
  if (!t || Math.abs(maintenantS - t) > TOLERANCE_WAVE_S) return false;
  const attendu = createHmac("sha256", secret).update(`${parties.t}${corps}`).digest("hex");
  return entete
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("v1="))
    .some((x) => egaliteSure(attendu, x.slice(3)));
}

const wave: FournisseurPaiement = {
  nom: "wave",
  libelle: "Wave",
  async initier(d) {
    const r = await fetch(`${WAVE}/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WAVE_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: String(d.montant), currency: "XOF", success_url: d.urlRetour, error_url: d.urlRetour, client_reference: d.reference }),
    });
    const j = await json(r);
    if (!r.ok || !j.wave_launch_url) throw new Error(`Wave : ${j.message ?? j.code ?? "paiement refusé"}`);
    return { urlPaiement: j.wave_launch_url, refFournisseur: j.id };
  },
  async lireNotification(corps, entetes) {
    if (!signatureWaveValide(corps, entetes.get("wave-signature") ?? "", env("WAVE_WEBHOOK_SECRET"))) return null;
    const j = JSON.parse(corps);
    if (!String(j.type ?? "").startsWith("checkout.session.")) return null;
    return { reference: j.data?.client_reference, refFournisseur: j.data?.id };
  },
  async verifier(p) {
    if (!p.refFournisseur) return { reference: p.reference, statut: "PENDING", montant: null };
    const r = await fetch(`${WAVE}/checkout/sessions/${encodeURIComponent(p.refFournisseur)}`, { headers: { Authorization: `Bearer ${env("WAVE_API_KEY")}` } });
    const j = await json(r);
    if (j.client_reference && j.client_reference !== p.reference) throw new Error("Wave : référence de paiement incohérente.");
    const statut: StatutFournisseur =
      j.payment_status === "succeeded" ? "SUCCEEDED" : j.payment_status === "cancelled" || j.checkout_status === "expired" ? "FAILED" : "PENDING";
    return { reference: p.reference, refFournisseur: j.id, statut, montant: j.amount != null ? Number(j.amount) : null, devise: j.currency, brut: j };
  },
};

const TOUS: Record<string, FournisseurPaiement> = { simulation, cinetpay, wave };

/** Permet de brancher un autre fournisseur (PayDunya, FedaPay…) sans toucher au reste du code. */
export function enregistrerFournisseurPaiement(f: FournisseurPaiement) {
  TOUS[f.nom] = f;
}

/** Simulation autorisée hors production, ou en production si AUTORISER_PAIEMENT_SIMULE=oui (démonstration). */
export const simulationAutorisee = () => process.env.NODE_ENV !== "production" || process.env.AUTORISER_PAIEMENT_SIMULE === "oui";

/** Fournisseurs activés par PAYMENT_PROVIDERS (liste séparée par des virgules, « simulation » par défaut). */
export function fournisseursActifs(): FournisseurPaiement[] {
  const noms = (process.env.PAYMENT_PROVIDERS ?? "simulation")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return noms.filter((n) => TOUS[n] && (n !== "simulation" || simulationAutorisee())).map((n) => TOUS[n]);
}

export const fournisseur = (nom: string) => fournisseursActifs().find((f) => f.nom === nom) ?? null;
