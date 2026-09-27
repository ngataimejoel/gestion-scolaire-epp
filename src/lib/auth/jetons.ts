import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const jetonAleatoire = (octets = 32) => randomBytes(octets).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères (voir .env.example).");
  return s;
}

export const hmac = (valeur: string) => createHmac("sha256", secret()).update(valeur).digest("base64url");

export function egaliteSure(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Petite donnée signée et datée, pour les cookies courts (étape du code SMS, accès parent). */
export function signer(donnee: object, dureeSecondes: number): string {
  const corps = Buffer.from(JSON.stringify({ ...donnee, exp: Date.now() + dureeSecondes * 1000 })).toString("base64url");
  return `${corps}.${hmac(corps)}`;
}

export function lireSigne<T>(valeur: string | undefined | null): T | null {
  if (!valeur) return null;
  const [corps, signature] = valeur.split(".");
  if (!corps || !signature || !egaliteSure(signature, hmac(corps))) return null;
  try {
    const d = JSON.parse(Buffer.from(corps, "base64url").toString()) as T & { exp: number };
    return d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
}
