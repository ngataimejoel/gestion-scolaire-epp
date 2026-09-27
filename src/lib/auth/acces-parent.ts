/**
 * Accès parents (décision de NGATTA, 27/09/2026) : pas de compte ni de mot de passe.
 * Le parent saisit le matricule école OU le matricule DESPS de l'élève, et sa date de naissance.
 * Ces deux informations se devinent plus facilement qu'un mot de passe : les essais ratés sont limités par adresse IP
 * et l'accès ouvert ne dure que 30 minutes, en lecture seule, pour un seul élève.
 */
import type { Db } from "../db";
import { journaliser } from "../audit";
import { compterTentative, LIMITES, messageBlocage, tempsDeBlocage } from "./limites";

export const DUREE_ACCES_PARENT_S = 30 * 60;

export type ResultatParent =
  | { ok: true; studentId: string; schoolId: string }
  | { ok: false; erreur: string; choixEcoles?: { schoolId: string; nom: string }[] };

function dateIso(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [a, mo, j] = v.includes("/") ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]];
  const d = new Date(Date.UTC(+a, +mo - 1, +j));
  return d.getUTCDate() === +j && d.getUTCMonth() === +mo - 1 ? d : null;
}

export async function accesParent(
  db: Db,
  saisie: { identifiant: string; naissance: string; schoolId?: string },
  ip: string | null,
): Promise<ResultatParent> {
  const cle = `parent:${ip ?? "inconnue"}`;
  const bloque = await tempsDeBlocage(db, cle);
  if (bloque) return { ok: false, erreur: messageBlocage(bloque) };

  const id = (saisie.identifiant ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const naissance = dateIso((saisie.naissance ?? "").trim());
  if (!id || !naissance) return { ok: false, erreur: "Saisissez le matricule de l'élève et sa date de naissance." };

  const eleves = await db.student.findMany({
    where: {
      birthDate: naissance,
      OR: [{ schoolMatricule: id }, { despsId: { equals: id, mode: "insensitive" } }],
      ...(saisie.schoolId ? { schoolId: saisie.schoolId } : {}),
    },
    include: { school: { select: { id: true, name: true } } },
    take: 10,
  });
  if (!eleves.length) {
    const b = await compterTentative(db, cle, LIMITES.parent);
    return { ok: false, erreur: b ? messageBlocage(b) : "Aucun élève ne correspond à ce matricule et cette date de naissance." };
  }
  // Même matricule école dans deux établissements : le parent choisit l'école de son enfant.
  if (eleves.length > 1)
    return {
      ok: false,
      erreur: "Ce matricule existe dans plusieurs écoles. Choisissez celle de votre enfant.",
      choixEcoles: eleves.map((e) => ({ schoolId: e.school.id, nom: e.school.name })),
    };
  const e = eleves[0];
  await journaliser(db, { schoolId: e.schoolId, action: "consultation_parent", entity: "Student", entityId: e.id, ip });
  return { ok: true, studentId: e.id, schoolId: e.schoolId };
}
