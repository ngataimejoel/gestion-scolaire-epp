/**
 * Personnel (feuille PERSONNEL). Étape 4 : enregistrement minimal d'un membre du personnel et création
 * automatique de son compte s'il enseigne. Le module complet (toutes les colonnes, modification, ancienneté)
 * arrive à l'étape 6.
 */
import { z } from "zod";
import type { Db } from "./db";
import type { User } from "@/generated/prisma/client";
import { journaliser } from "./audit";
import { creerCompteEnseignant, type Resultat } from "./auth/service";
import { normaliserTelephone } from "./auth/telephone";
import { estEnseignant } from "./regles";

/** Liste FONCTIONS de la feuille PARAMETRES. */
export const FONCTIONS = [
  "DIRECTEUR",
  "DIRECTEUR ADJOINT",
  "INSTITUTEUR ORDINAIRE",
  "INSTITUTEUR ADJOINT",
  "INSTITUTEUR STAGIAIRE",
  "GARDIEN",
  "CANTINIERE",
] as const;

export const schemaPersonnel = z.object({
  matricule: z.string().trim().toUpperCase().min(1, "Matricule obligatoire.").max(30),
  lastName: z.string().trim().toUpperCase().min(1, "Nom obligatoire.").max(60),
  firstNames: z.string().trim().min(1, "Prénoms obligatoires.").max(100),
  sex: z.enum(["M", "F"], { message: "Choisissez le sexe." }),
  function: z.enum(FONCTIONS, { message: "Choisissez une fonction de la liste." }),
  phone: z.string().trim().max(20).optional().default(""),
});

export async function enregistrerPersonnel(
  db: Db,
  directeur: Pick<User, "id" | "schoolId" | "role">,
  donnees: unknown,
): Promise<Resultat<{ staffId: string; compte?: { phone: string; motDePasse: string } }>> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut enregistrer le personnel." };
  const p = schemaPersonnel.safeParse(donnees);
  if (!p.success) return { ok: false, erreur: p.error.issues[0].message, champ: p.error.issues[0].path[0]?.toString() };
  const v = p.data;
  const enseigne = estEnseignant(v.function) && v.function !== "DIRECTEUR";
  const phone = v.phone ? normaliserTelephone(v.phone) : null;
  if (v.phone && !phone) return { ok: false, champ: "phone", erreur: "Numéro invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." };
  if (enseigne && !phone) return { ok: false, champ: "phone", erreur: "Le numéro est obligatoire pour un enseignant : il sert d'identifiant de connexion." };
  if (await db.staff.findUnique({ where: { schoolId_matricule: { schoolId: directeur.schoolId, matricule: v.matricule } } }))
    return { ok: false, champ: "matricule", erreur: "Ce matricule est déjà enregistré dans votre personnel." };
  if (phone && enseigne && (await db.user.findUnique({ where: { phone } })))
    return { ok: false, champ: "phone", erreur: "Ce numéro est déjà utilisé par un autre compte." };

  const staff = await db.staff.create({ data: { ...v, phone, schoolId: directeur.schoolId } });
  await journaliser(db, { schoolId: directeur.schoolId, userId: directeur.id, action: "creation", entity: "Staff", entityId: staff.id, after: { ...v, phone } });
  if (!enseigne) return { ok: true, staffId: staff.id };

  const c = await creerCompteEnseignant(db, directeur, staff.id);
  if (!c.ok) return { ok: true, staffId: staff.id }; // le membre est enregistré ; le compte pourra être créé depuis la liste
  return { ok: true, staffId: staff.id, compte: { phone: c.phone, motDePasse: c.motDePasse } };
}
