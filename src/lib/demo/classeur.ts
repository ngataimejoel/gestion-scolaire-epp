/**
 * Chargement des données d'exemple du classeur (EPP LIGUIYO, 64 élèves, 8 agents, notes, absences) dans une
 * école neuve. Sert aux tests de référence (les résultats doivent être identiques au classeur) et à
 * l'école de démonstration (npm run db:seed).
 */
import type { Db } from "../db";
import { hacherMotDePasse } from "../auth/mot-de-passe";
import { preparerEcole } from "../parametres/service";
import { executer } from "../classeur/import";

type Ligne = (string | number | null)[];
export interface DonneesClasseur {
  E: Record<string, string | number | null>[];
  N: Record<string, Ligne[]>;
  CFG?: Record<string, [string, number][][]>;
  P: Record<string, string | number | null>[];
  AE: { date: string; mat: string; nature: string; jours: number | null; min: number | null; motif: string | null; just: string | null; obs: string | null }[];
  AP: DonneesClasseur["AE"];
  PAR: Record<string, unknown> & { ecole: string; code: string; annee: string };
}

const jour = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null);

/** Crée l'école du classeur avec son directeur ; renvoie l'école et le compte directeur. */
export async function chargerClasseur(db: Db, D: DonneesClasseur, opts: { telephoneDirecteur: string; motDePasse: string; code?: string }) {
  const P = D.PAR as unknown as Record<string, string>;
  const anneeDebut = Number(P.annee.slice(0, 4));
  const passwordHash = await hacherMotDePasse(opts.motDePasse);

  const { school, directeur } = await db.$transaction(
    async (tx) => {
      const school = await tx.school.create({
        data: {
          name: P.ecole, code: opts.code ?? P.code, ministry: P.ministere, regionalDirectorate: P.dren, inspectorate: P.iepp,
          sector: P.secteur, locality: P.localite,
        },
      });
      await preparerEcole(tx, school.id, anneeDebut);
      await tx.schoolSettings.update({
        where: { schoolId: school.id },
        data: { directorName: P.directeur, reportDate: jour(P.dateEdition), expectedNewCp1: Number(P.nouveauxCP1) || 0 },
      });
      await tx.academicYear.updateMany({ where: { schoolId: school.id, isActive: true }, data: { ageReferenceDate: jour(P.dateRefAge)! } });
      const directeur = await tx.user.create({
        data: { schoolId: school.id, phone: opts.telephoneDirecteur, fullName: P.directeur, role: "DIRECTOR", passwordHash, phoneVerifiedAt: new Date() },
      });
      return { school, directeur };
    },
    { timeout: 30_000 },
  );

  // Personnel, élèves, notes et absences : même code que l'import du classeur par le directeur.
  const r = await executer(db, directeur, D, { ignorerLimites: true });
  if (!r.ok) throw new Error(r.erreur);
  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId: school.id, isActive: true } });
  return { school, directeur, annee };
}
