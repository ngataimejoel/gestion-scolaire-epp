/**
 * Valeurs par défaut reprises de la feuille PARAMETRES du classeur GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm.
 * Elles servent à préparer une nouvelle école ; le directeur les modifie ensuite dans Paramètres.
 */
import type { ChoiceList, GradeSheet } from "@/generated/prisma/client";

export const MINISTERE = "MINISTERE DE L'EDUCATION NATIONALE ET DE L'ALPHABETISATION";

/** Seuils d'admission par classe : moyenne de passage et barème (/10 ou /20). */
export const NIVEAUX_DEFAUT: { code: string; gradeSheet: GradeSheet; passMark: number; scale: number; normalAge: number }[] = [
  { code: "CP1", gradeSheet: "CP", passMark: 5, scale: 10, normalAge: 6 },
  { code: "CP2", gradeSheet: "CP", passMark: 5, scale: 10, normalAge: 7 },
  { code: "CE1", gradeSheet: "CE1", passMark: 5, scale: 10, normalAge: 8 },
  { code: "CE2", gradeSheet: "CE2_CM1", passMark: 5, scale: 10, normalAge: 9 },
  { code: "CM1", gradeSheet: "CE2_CM1", passMark: 5, scale: 10, normalAge: 10 },
  { code: "CM2", gradeSheet: "CM2", passMark: 10, scale: 20, normalAge: 11 },
];

const CP = ["ECRITURE", "E.D.H.C", "EXPRESSION ECRITE", "MATHEMATIQUE", "ORTHOGRAPHE", "DESSIN", "CHANT ET POESIE", "LECTURE"];

/**
 * Matières par feuille de notes et par évaluation (1 à 4).
 * CP : [matière, coefficient] (notes /10). Autres feuilles : [matière, barème].
 */
export const MATIERES_DEFAUT: Record<Exclude<GradeSheet, "PRESCHOOL">, [string, number][][]> = {
  CP: [1, 2, 3, 4].map(() => CP.map((m) => [m, 1] as [string, number])),
  CE1: [1, 2, 3, 4].map(() => [["EXPLOITATION DE TEXTE", 50], ["EVEIL AU MILIEU", 40], ["MATHEMATIQUES", 40], ["DICTEE", 10]] as [string, number][]),
  CE2_CM1: [1, 2, 3, 4].map(() => [["EXPLOITATION DE TEXTE", 50], ["EVEIL AU MILIEU", 50], ["MATHEMATIQUES", 50], ["DICTEE", 20]] as [string, number][]),
  CM2: [1, 2, 3, 4].map((n) => {
    const base: [string, number][] = [["EXPLOITATION DE TEXTE", 50], ["EVEIL AU MILIEU", 50], ["MATHEMATIQUES", 50], ["DICTEE", 20]];
    return n >= 3 ? [...base, ["EPREUVES PHYSIQUES", 20]] : base; // examens blancs : /190
  }),
};

export const EVALUATIONS = {
  STANDARD: ["1re composition", "2e composition", "3e composition", "Composition de passage"],
  CM2: ["1re composition", "2e composition", "1er examen blanc", "2e examen blanc"],
} as const;

/**
 * Calendrier 2026-2027 du classeur (dates provisoires) : [mois, jour, décalage d'année] pour CP1-CM1 puis CM2.
 * Pour une autre année, les mêmes jours sont reportés sur l'année de début / l'année suivante.
 */
const CALENDRIER: { standard: [number, number]; cm2: [number, number] }[] = [
  { standard: [12, 9], cm2: [12, 9] },
  { standard: [3, 10], cm2: [3, 10] },
  { standard: [5, 26], cm2: [3, 4] },
  { standard: [6, 16], cm2: [4, 27] },
];

const dateScolaire = (anneeDebut: number, [mois, jour]: [number, number]) =>
  new Date(Date.UTC(mois >= 9 ? anneeDebut : anneeDebut + 1, mois - 1, jour));

export function calendrierDefaut(anneeDebut: number) {
  return CALENDRIER.map((c) => ({ standard: dateScolaire(anneeDebut, c.standard), cm2: dateScolaire(anneeDebut, c.cm2) }));
}

/** Jours de classe par mois (septembre à juillet), valeurs 2026-2027 du classeur. */
export const JOURS_DEFAUT: [number, number][] = [
  [9, 13], [10, 22], [11, 21], [12, 17], [1, 20], [2, 15], [3, 23], [4, 15], [5, 21], [6, 22], [7, 12],
];

export const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

/** Listes de choix (validation des données). */
export const LISTES_DEFAUT: Record<ChoiceList, string[]> = {
  NATIONALITY: ["IVOIRIENNE", "BURKINABE", "MALIENNE", "GUINEENNE", "GHANEENNE", "NIGERIENNE", "TOGOLAISE", "BENINOISE", "AUTRE"],
  STAFF_FUNCTION: ["DIRECTEUR", "DIRECTEUR ADJOINT", "INSTITUTEUR ORDINAIRE", "INSTITUTEUR ADJOINT", "INSTITUTEUR STAGIAIRE", "GARDIEN", "CANTINIERE"],
  ORPHAN_OF: ["PERE", "MERE", "PERE ET MERE"],
  // Saisie libre dans le classeur : liste proposée, modifiable.
  ABSENCE_REASON: ["Maladie", "Sans motif", "Pluie / route coupée", "Travaux champêtres", "Deuil", "Convocation IEPP", "Formation", "Autre"],
  MARITAL_STATUS: ["CELIBATAIRE", "MARIE(E)", "DIVORCE(E)", "VEUF(VE)"],
};

export const LIBELLES_LISTES: Record<ChoiceList, string> = {
  NATIONALITY: "Nationalités",
  STAFF_FUNCTION: "Fonctions du personnel",
  ORPHAN_OF: "Orphelin de",
  ABSENCE_REASON: "Motifs d'absence",
  MARITAL_STATUS: "Situations matrimoniales",
};

/** Année scolaire en cours d'après la date : à partir d'août, l'année qui commence. */
export function anneeDebutCourante(d = new Date()): number {
  return d.getUTCMonth() + 1 >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
