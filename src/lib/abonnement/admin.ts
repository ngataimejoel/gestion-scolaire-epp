import type { Db } from "../db";
import type { Resultat } from "../auth/service";
import { erreurMotDePasse, hacherMotDePasse } from "../auth/mot-de-passe";
import { normaliserTelephone } from "../auth/telephone";
import { journaliser } from "../audit";

/** Crée le compte administrateur de la plateforme. Refuse un numéro déjà utilisé (aucun compte n'est écrasé). */
export async function creerAdministrateur(db: Db, d: { telephone: string; nom: string; motDePasse: string }): Promise<Resultat<{ id: string }>> {
  const phone = normaliserTelephone(d.telephone);
  if (!phone) return { ok: false, champ: "telephone", erreur: "Numéro de téléphone invalide (10 chiffres)." };
  const faible = erreurMotDePasse(d.motDePasse);
  if (faible) return { ok: false, champ: "motDePasse", erreur: faible };
  if (await db.user.findUnique({ where: { phone } })) return { ok: false, champ: "telephone", erreur: "Ce numéro a déjà un compte : il n'a pas été modifié." };
  const u = await db.user.create({
    data: { phone, fullName: d.nom.trim() || "Administrateur", role: "PLATFORM_ADMIN", passwordHash: await hacherMotDePasse(d.motDePasse), phoneVerifiedAt: new Date() },
  });
  await journaliser(db, { userId: u.id, action: "creation", entity: "User", entityId: u.id, after: { role: "PLATFORM_ADMIN", phone } });
  return { ok: true, id: u.id };
}
