/**
 * Moteur de calcul de GESTION SCOLAIRE EPP.
 *
 * Chaque fonction reproduit une formule du classeur GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm.
 * La feuille d'origine est indiquée en commentaire. Ces fonctions sont pures (aucun accès à la base)
 * afin d'être testées contre les valeurs du classeur (tests/regles.test.ts).
 */

export type FeuilleNotes = "CP" | "CE1" | "CE2_CM1" | "CM2";
export type Sexe = "M" | "F";
export type Statut = "PRESENT" | "ABANDON" | "TRANSFERE";
export type Decision = "ADMIS" | "REDOUBLE" | "ABANDON" | "TRANSFERE" | "";
export type Observation = "Très bien" | "Bien" | "Assez bien" | "Passable" | "Insuffisant" | "";

export const NIVEAUX = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
export type Niveau = (typeof NIVEAUX)[number];

/** PARAMETRES : âge normal d'entrée par niveau (alerte sur-âge = âge normal + 3). */
export const AGE_NORMAL: Record<Niveau, number> = { CP1: 6, CP2: 7, CE1: 8, CE2: 9, CM1: 10, CM2: 11 };

export function feuilleDuNiveau(niveau: string): FeuilleNotes {
  if (niveau === "CP1" || niveau === "CP2") return "CP";
  if (niveau === "CE1") return "CE1";
  if (niveau === "CM2") return "CM2";
  return "CE2_CM1";
}

/** ROUND(x; 2) d'Excel : arrondi à la demi-unité supérieure, sans les erreurs de virgule flottante. */
export function arrondi2(x: number): number {
  return Math.sign(x) * Math.round((Math.abs(x) + 1e-9) * 100) / 100;
}

/** DATEDIF(debut; fin; "Y") : années révolues. */
export function anneesRevolues(debut: Date | string | null | undefined, fin: Date | string): number | null {
  if (!debut) return null;
  const a = typeof debut === "string" ? new Date(debut) : debut;
  const b = typeof fin === "string" ? new Date(fin) : fin;
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
}

/**
 * REGISTRE ELEVES, alerte TABLEAU DE BORD : sur-âge si âge ≥ âge normal + 3.
 * Écart signalé : la formule du classeur compare la date de naissance au lieu de l'âge ; on utilise l'âge.
 */
export function estEnSurAge(age: number | null, niveau: string): boolean {
  const normal = AGE_NORMAL[niveau as Niveau];
  return age != null && normal != null && age >= normal + 3;
}

/** REGISTRE ELEVES : matricule école = CLASSE-NNN-AA (figé à l'inscription). */
export function matriculeEcole(niveau: string, rangDansClasse: number, anneeDebut: number): string {
  return `${niveau}-${String(rangDansClasse).padStart(3, "0")}-${String(anneeDebut).slice(2, 4)}`;
}

/** REGISTRE ELEVES : identifiant DESPS de 9 caractères, avec une majuscule en première ou dernière position. */
export function despsValide(v: string | null | undefined): boolean {
  if (!v) return false;
  return v.length === 9 && /^(?:[A-Z][A-Za-z0-9]{8}|[A-Za-z0-9]{8}[A-Z])$/.test(v);
}

/* ------------------------------------------------------------------ Notes */

export interface MatiereCfg {
  nom: string;
  /** CP : coefficient (0 = matière ignorée). Autres feuilles : barème de la matière. */
  poids: number;
}

export interface SaisieEvaluation {
  /** Colonne « Présent ? ». false = NON. */
  present: boolean;
  /** Une note par matière, dans l'ordre de la configuration ; null = non saisie. */
  notes: (number | null)[];
}

/**
 * NOTES CP / CE1 / CE2-CM1 / CM2 : moyenne d'une évaluation.
 * - absent (NON) → 0 ;
 * - aucune note → null (cellule vide) ;
 * - CP : ROUND(Σ note × coef ÷ Σ coef des matières notées ; 2), notes sur 10 ;
 * - autres : ROUND(total ÷ Σ barèmes des matières notées × échelle ; 2), échelle 10 (20 au CM2).
 */
export function moyenneEvaluation(
  feuille: FeuilleNotes,
  matieres: MatiereCfg[],
  saisie: SaisieEvaluation | null | undefined,
  echelle: number,
): number | null {
  if (!saisie) return null;
  if (!saisie.present) return 0;
  let num = 0;
  let den = 0;
  let saisies = 0;
  matieres.forEach((m, i) => {
    const n = saisie.notes[i];
    if (typeof n !== "number") return;
    saisies++;
    if (feuille === "CP") {
      num += n * m.poids;
      den += m.poids;
    } else {
      num += n;
      den += m.poids;
    }
  });
  if (!saisies || !den) return null;
  return feuille === "CP" ? arrondi2(num / den) : arrondi2((num / den) * echelle);
}

/** NOTES CE1 / CE2-CM1 / CM2 : total des points de l'évaluation (0 si absent). */
export function totalEvaluation(saisie: SaisieEvaluation | null | undefined): number | null {
  if (!saisie) return null;
  if (!saisie.present) return 0;
  const v = saisie.notes.filter((x): x is number => typeof x === "number");
  return v.length ? arrondi2(v.reduce((a, b) => a + b, 0)) : null;
}

/** Contrôle de saisie : une note doit être comprise entre 0 et le maximum de la matière. */
export function noteValide(note: number, feuille: FeuilleNotes, matiere: MatiereCfg): boolean {
  const max = feuille === "CP" ? 10 : matiere.poids;
  return Number.isFinite(note) && note >= 0 && note <= max;
}

/* -------------------------------------------------------------- Résultats */

export interface ResultatAnnuel {
  moyennes: (number | null)[];
  moyenne3Compos: number | null;
  mga: number | null;
  decision: Decision;
  observation: Observation;
}

/**
 * RESULTATS (CP1 à CM1) : MGA = ROUND((moyenne des compositions 1 à 3 disponibles + 2 × passage) ÷ 3 ; 2).
 * RESULTATS CM2 : MGA = ROUND((C1 + C2 + EB1 + EB2) ÷ 4 ; 2), seulement si les 4 existent.
 */
export function calculerMga(niveau: string, moyennes: (number | null)[]): { moyenne3Compos: number | null; mga: number | null } {
  if (niveau === "CM2") {
    const ok = moyennes.length === 4 && moyennes.every((x) => x != null);
    return { moyenne3Compos: null, mga: ok ? arrondi2((moyennes as number[]).reduce((a, b) => a + b, 0) / 4) : null };
  }
  const v = moyennes.slice(0, 3).filter((x): x is number => x != null);
  const moyenne3Compos = v.length ? arrondi2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  const passage = moyennes[3];
  const mga = moyenne3Compos != null && passage != null ? arrondi2((moyenne3Compos + 2 * passage) / 3) : null;
  return { moyenne3Compos, mga };
}

/** RESULTATS : ABANDON / TRANSFERE selon le statut ; vide sans MGA ; ADMIS si MGA ≥ seuil ; sinon REDOUBLE. */
export function decisionFinale(statut: Statut, mga: number | null, seuil: number): Decision {
  if (statut === "ABANDON") return "ABANDON";
  if (statut === "TRANSFERE") return "TRANSFERE";
  if (mga == null) return "";
  return mga >= seuil ? "ADMIS" : "REDOUBLE";
}

/** RESULTATS : appréciation ramenée sur 10 (MGA ÷ barème × 10). */
export function observation(decision: Decision, mga: number | null, bareme: number): Observation {
  if (decision === "REDOUBLE") return "Insuffisant";
  if (decision !== "ADMIS" || mga == null) return "";
  const x = (mga / bareme) * 10;
  if (x >= 8) return "Très bien";
  if (x >= 7) return "Bien";
  if (x >= 6) return "Assez bien";
  return "Passable";
}

export function resultatAnnuel(
  niveau: string,
  statut: Statut,
  moyennes: (number | null)[],
  seuil: number,
  bareme: number,
): ResultatAnnuel {
  const { moyenne3Compos, mga } = calculerMga(niveau, moyennes);
  const decision = decisionFinale(statut, mga, seuil);
  return { moyennes, moyenne3Compos, mga, decision, observation: observation(decision, mga, bareme) };
}

/**
 * RESULTATS : rang = 1 + nombre d'élèves PRESENT de la même classe ayant une MGA strictement supérieure.
 * Les élèves non présents ou sans MGA n'ont pas de rang (ex æquo possibles).
 */
export function calculerRangs<T extends { id: string; statut: Statut; mga: number | null }>(classe: T[]): Map<string, number | null> {
  const mgas = classe.filter((e) => e.statut === "PRESENT" && e.mga != null).map((e) => e.mga as number);
  const rangs = new Map<string, number | null>();
  for (const e of classe) {
    rangs.set(e.id, e.statut !== "PRESENT" || e.mga == null ? null : 1 + mgas.filter((m) => m > (e.mga as number)).length);
  }
  return rangs;
}

export function rangEnLettres(rang: number | null, sexe: Sexe): string {
  if (rang == null) return "—";
  if (rang === 1) return sexe === "F" ? "1re" : "1er";
  return `${rang}e`;
}

/* ------------------------------------------------ Absences et fréquentation */

/** RAPPORT MENSUEL : taux = MAX(0 ; 1 − jours d'absence ÷ (effectif × jours de classe)). Vide si effectif ou jours nuls. */
export function tauxFrequentation(joursAbsence: number, effectif: number, joursDeClasse: number): number | null {
  if (!effectif || !joursDeClasse) return null;
  return Math.max(0, 1 - joursAbsence / (effectif * joursDeClasse));
}

/** PARAMETRES : les mois ≥ septembre appartiennent à l'année de début, les autres à l'année suivante. */
export function anneeDuMois(mois: number, anneeDebut: number): number {
  return mois >= 9 ? anneeDebut : anneeDebut + 1;
}

/** RAPPORT MENSUEL : indice de l'évaluation (0 à 3) dont la date tombe dans le mois, ou -1. */
export function evaluationDuMois(dates: (Date | string | null)[], mois: number, annee: number): number {
  return dates.findIndex((d) => {
    if (!d) return false;
    const x = typeof d === "string" ? new Date(d) : d;
    return x.getUTCMonth() + 1 === mois && x.getUTCFullYear() === annee;
  });
}

/* ------------------------------------------------------ Rapports et bilans */

export interface ParSexe {
  M: number;
  F: number;
}

export const compterParSexe = <T extends { sexe: Sexe }>(l: T[]): ParSexe => ({
  M: l.filter((e) => e.sexe === "M").length,
  F: l.filter((e) => e.sexe === "F").length,
});

/** TABLEAU DE BORD / RAPPORT DE RENTREE : enseignants = fonctions INSTITUTEUR* et DIRECTEUR*. */
export function estEnseignant(fonction: string | null | undefined): boolean {
  return !!fonction && /^(INSTITUTEUR|DIRECTEUR)/.test(fonction);
}

/** Taux d'admission = admis ÷ élèves au statut PRESENT (0 si aucun, comme le classeur). */
export function tauxAdmission(admis: number, presents: number): number {
  return presents ? admis / presents : 0;
}

/**
 * SYNTHESE FIN D'ANNEE : effectif probable de l'année suivante, par sexe.
 * Niveau n = redoublants de n + admis de n−1 ; CP1 = redoublants + ROUND(nouveaux CP1 attendus ÷ 2) par sexe.
 * Les admis du CM2 sortent (entrée en 6e).
 */
export function effectifsProbables(
  niveaux: { redoublants: ParSexe; admis: ParSexe }[],
  nouveauxCp1: number,
): ParSexe[] {
  const moitie = Math.round(nouveauxCp1 / 2);
  return niveaux.map((n, i) =>
    i === 0
      ? { M: n.redoublants.M + moitie, F: n.redoublants.F + moitie }
      : { M: n.redoublants.M + niveaux[i - 1].admis.M, F: n.redoublants.F + niveaux[i - 1].admis.F },
  );
}

/**
 * RAPPORT DE COMPOSITION : présents = moyenne numérique et présence ≠ NON ;
 * absents = présence NON ; admis = moyenne de l'évaluation ≥ seuil ; les trois meilleurs du niveau.
 */
export function statistiquesComposition<T extends { sexe: Sexe; present: boolean | null; moyenne: number | null }>(
  eleves: T[],
  seuil: number,
) {
  const presents = eleves.filter((e) => e.moyenne != null && e.present !== false);
  const absents = eleves.filter((e) => e.present === false);
  const admis = presents.filter((e) => (e.moyenne as number) >= seuil);
  return {
    inscrits: compterParSexe(eleves),
    presents: compterParSexe(presents),
    absents: compterParSexe(absents),
    admis: compterParSexe(admis),
    meilleurs: presents.slice().sort((a, b) => (b.moyenne as number) - (a.moyenne as number)).slice(0, 3),
  };
}
