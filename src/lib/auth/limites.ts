import type { Db } from "../db";

export interface RegleLimite {
  max: number; // tentatives autorisées dans la fenêtre
  fenetreMs: number;
  blocageMs: number; // durée du blocage une fois la limite atteinte
}

export const LIMITES = {
  connexion: { max: 10, fenetreMs: 15 * 60_000, blocageMs: 15 * 60_000 }, // par adresse IP
  envoiCode: { max: 5, fenetreMs: 60 * 60_000, blocageMs: 60 * 60_000 }, // SMS par numéro et par heure
  parent: { max: 5, fenetreMs: 15 * 60_000, blocageMs: 15 * 60_000 }, // essais ratés d'accès parent
} satisfies Record<string, RegleLimite>;

/** Secondes restantes avant de pouvoir réessayer, ou 0 si l'action est permise. */
export async function tempsDeBlocage(db: Db, cle: string): Promise<number> {
  const r = await db.rateLimit.findUnique({ where: { key: cle } });
  if (!r?.blockedUntil || r.blockedUntil <= new Date()) return 0;
  return Math.ceil((r.blockedUntil.getTime() - Date.now()) / 1000);
}

/** Compte une tentative ; bloque la clé quand la limite de la fenêtre est dépassée. Renvoie le blocage en secondes. */
export async function compterTentative(db: Db, cle: string, regle: RegleLimite): Promise<number> {
  const maintenant = new Date();
  const r = await db.rateLimit.findUnique({ where: { key: cle } });
  const nouvelleFenetre = !r || maintenant.getTime() - r.windowStart.getTime() > regle.fenetreMs;
  const count = nouvelleFenetre ? 1 : r.count + 1;
  const blockedUntil = count >= regle.max ? new Date(maintenant.getTime() + regle.blocageMs) : null;
  await db.rateLimit.upsert({
    where: { key: cle },
    create: { key: cle, count, windowStart: maintenant, blockedUntil },
    update: { count, windowStart: nouvelleFenetre ? maintenant : undefined, blockedUntil: blockedUntil ?? r?.blockedUntil },
  });
  return blockedUntil ? Math.ceil(regle.blocageMs / 1000) : 0;
}

export const effacerTentatives = (db: Db, cle: string) => db.rateLimit.deleteMany({ where: { key: cle } });

export function messageBlocage(secondes: number): string {
  const min = Math.ceil(secondes / 60);
  return `Trop de tentatives. Réessayez dans ${min} minute${min > 1 ? "s" : ""}.`;
}
