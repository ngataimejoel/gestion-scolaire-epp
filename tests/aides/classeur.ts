import donnees from "../fixtures/donnees-classeur.json";
import attendu from "../fixtures/attendu-classeur.json";
import type { Db } from "../../src/lib/db";
import { chargerClasseur, type DonneesClasseur } from "../../src/lib/demo/classeur";
import { creerCompteEnseignant } from "../../src/lib/auth/service";

export const DONNEES = donnees as unknown as DonneesClasseur;
export const ATTENDU = attendu as unknown as {
  resultats: Record<string, [number | null, number | null, number | null, number | null, number | null, string, number | null, string | null]>;
  frequentation: { mois: number; annee: number; jours: number; classes: Record<string, { M: number; F: number; T: number }>; total: { M: number; F: number; T: number } };
  synthese: Record<string, Record<"inscrits" | "presents" | "abandons" | "admis" | "redoublants" | "probable", [number, number]>>;
  tableauDeBord: { effectif: number; presents: number; tauxAdmission: number; sansExtrait: number; enseignants: number; tauxAbandon: number };
};

/** École du classeur (EPP LIGUIYO) avec son directeur. */
export const ecoleDuClasseur = (db: Db, telephoneDirecteur = "0730908035", code?: string) =>
  chargerClasseur(db, DONNEES, { telephoneDirecteur, motDePasse: "Ecole2026", code });

/** Compte enseignant de la classe indiquée (créé à la demande). */
export async function enseignantDe(db: Db, directeur: { id: string; schoolId: string | null; role: "DIRECTOR" | "TEACHER" | "PLATFORM_ADMIN" }, classe: string) {
  const s = await db.staff.findFirstOrThrow({ where: { schoolId: directeur.schoolId!, classes: { some: { classroom: { name: classe } } } } });
  if (!s.userId) {
    const r = await creerCompteEnseignant(db, directeur, s.id);
    if (!r.ok) throw new Error(r.erreur);
  }
  const staff = await db.staff.findUniqueOrThrow({ where: { id: s.id }, include: { user: true } });
  return staff.user!;
}
