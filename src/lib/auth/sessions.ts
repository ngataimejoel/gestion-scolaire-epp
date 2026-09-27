import type { Db } from "../db";
import { jetonAleatoire, sha256 } from "./jetons";

export const SESSION_DUREE_MS = 7 * 24 * 60 * 60_000; // 7 jours
export const COOKIE_SESSION = "epp_session";

/** Crée une session ; seule l'empreinte SHA-256 du jeton est stockée en base. */
export async function creerSession(db: Db, userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const jeton = jetonAleatoire();
  const expiresAt = new Date(Date.now() + SESSION_DUREE_MS);
  await db.session.create({
    data: { id: sha256(jeton), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { jeton, expiresAt };
}

export async function utilisateurDeSession(db: Db, jeton: string | undefined | null) {
  if (!jeton) return null;
  const s = await db.session.findUnique({
    where: { id: sha256(jeton) },
    include: { user: { include: { school: true } } },
  });
  if (!s) return null;
  if (s.expiresAt <= new Date() || !s.user.isActive) {
    await db.session.deleteMany({ where: { id: s.id } });
    return null;
  }
  return s.user;
}

export const supprimerSession = (db: Db, jeton: string) => db.session.deleteMany({ where: { id: sha256(jeton) } });

/** Déconnecte toutes les sessions d'un utilisateur, sauf éventuellement la session courante. */
export function supprimerAutresSessions(db: Db, userId: string, jetonConserve?: string) {
  return db.session.deleteMany({ where: { userId, ...(jetonConserve ? { NOT: { id: sha256(jetonConserve) } } : {}) } });
}
