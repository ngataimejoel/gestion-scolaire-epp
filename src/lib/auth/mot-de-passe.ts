import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";

// Argon2id (algorithme 2), paramètres recommandés par l'OWASP.
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hacherMotDePasse = (mdp: string) => hash(mdp, OPTIONS);

export async function verifierMotDePasse(empreinte: string, mdp: string): Promise<boolean> {
  try {
    return await verify(empreinte, mdp);
  } catch {
    return false;
  }
}

/** Règle de robustesse : au moins 8 caractères, dont une lettre et un chiffre. */
export function erreurMotDePasse(mdp: string): string | null {
  if (mdp.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (mdp.length > 128) return "Le mot de passe est trop long (128 caractères au plus).";
  if (!/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  return null;
}

// Sans caractères ambigus (0/O, 1/l/I) pour une lecture facile par SMS.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function caracteresAleatoires(n: number, alphabet = ALPHABET): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

/**
 * Mot de passe provisoire d'un enseignant (demande de NGATTA) :
 * 4 derniers chiffres du numéro + 4 caractères aléatoires. À changer à la première connexion.
 * Une lettre est toujours présente pour respecter la règle de robustesse.
 */
export function motDePasseProvisoire(telephone: string): string {
  const lettres = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  return telephone.slice(-4) + lettres[randomInt(lettres.length)] + caracteresAleatoires(3);
}
