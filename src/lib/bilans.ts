/**
 * Bilans calculés à partir du registre et des résultats : TABLEAU DE BORD (indicateurs et alertes),
 * SYNTHESE FIN D'ANNEE (par niveau) et RAPPORT DE COMPOSITION (statistiques d'une évaluation).
 */
import type { Db } from "./db";
import { resultatsEcole, type ResultatsClasse } from "./resultats";
import {
  anneesRevolues,
  compterParSexe,
  despsValide,
  effectifsProbables,
  estEnSurAge,
  estEnseignant,
  NIVEAUX,
  statistiquesComposition,
  tauxAdmission,
  type ParSexe,
} from "./regles";

const somme = (l: ParSexe[]): ParSexe => ({ M: l.reduce((s, x) => s + x.M, 0), F: l.reduce((s, x) => s + x.F, 0) });
const parSexe = <T extends { sexe: "M" | "F" }>(l: T[]) => compterParSexe(l);

/* ------------------------------------------------------------ Synthèse */

export interface LigneSynthese {
  niveau: string;
  seuil: number;
  bareme: number;
  inscrits: ParSexe;
  presents: ParSexe;
  abandons: ParSexe;
  admis: ParSexe;
  redoublants: ParSexe;
  probable: ParSexe;
}

/**
 * SYNTHESE FIN D'ANNEE, par niveau (les divisions d'un même niveau sont additionnées) :
 * abandons = inscrits − présents ; redoublants = décision REDOUBLE ; effectif probable de l'année suivante.
 */
export function syntheseParNiveau(resultats: ResultatsClasse[], nouveauxCp1: number): LigneSynthese[] {
  const niveaux = [...new Set(resultats.slice().sort((a, b) => a.classe.position - b.classe.position).map((r) => r.classe.niveau))];
  const lignes = niveaux.map((niveau) => {
    const classes = resultats.filter((r) => r.classe.niveau === niveau);
    const eleves = classes.flatMap((r) => r.eleves);
    const inscrits = parSexe(eleves);
    const presents = parSexe(eleves.filter((e) => e.statut === "PRESENT"));
    return {
      niveau,
      seuil: classes[0].classe.seuil,
      bareme: classes[0].classe.bareme,
      inscrits,
      presents,
      abandons: { M: inscrits.M - presents.M, F: inscrits.F - presents.F },
      admis: parSexe(eleves.filter((e) => e.decision === "ADMIS")),
      redoublants: parSexe(eleves.filter((e) => e.decision === "REDOUBLE")),
      probable: { M: 0, F: 0 },
    };
  });
  // L'effectif probable suit l'ordre des niveaux CP1 → CM2 (un niveau absent compte pour zéro).
  const complets = NIVEAUX.map((n) => lignes.find((l) => l.niveau === n) ?? { redoublants: { M: 0, F: 0 }, admis: { M: 0, F: 0 } });
  const probables = effectifsProbables(complets, nouveauxCp1);
  for (const l of lignes) {
    const i = NIVEAUX.indexOf(l.niveau as (typeof NIVEAUX)[number]);
    if (i >= 0) l.probable = probables[i];
  }
  return lignes;
}

export const totalSynthese = (l: LigneSynthese[]) => ({
  inscrits: somme(l.map((x) => x.inscrits)),
  presents: somme(l.map((x) => x.presents)),
  abandons: somme(l.map((x) => x.abandons)),
  admis: somme(l.map((x) => x.admis)),
  redoublants: somme(l.map((x) => x.redoublants)),
  probable: somme(l.map((x) => x.probable)),
});

/* --------------------------------------------------- Statistiques d'évaluation */

/**
 * RAPPORT DE COMPOSITION pour l'évaluation n° 1 à 4, par classe : inscrits, présents, absents, admis
 * (moyenne de l'évaluation ≥ seuil), taux, moyenne de la classe et les trois meilleurs.
 */
export function statistiquesEvaluation(resultats: ResultatsClasse[], numero: number) {
  return resultats.map((r) => {
    const k = numero - 1;
    const s = statistiquesComposition(
      r.eleves.map((e) => ({ nom: e.nom, sexe: e.sexe, present: e.presences[k], moyenne: e.moyennes[k] })),
      r.classe.seuil,
    );
    const notes = r.eleves.map((e) => e.moyennes[k]).filter((m, i): m is number => m != null && r.eleves[i].presences[k] !== false);
    return {
      classe: r.classe,
      evaluation: r.evaluations[k],
      ...s,
      moyenneClasse: notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null,
      taux: {
        M: s.presents.M ? s.admis.M / s.presents.M : null,
        F: s.presents.F ? s.admis.F / s.presents.F : null,
        T: s.presents.M + s.presents.F ? (s.admis.M + s.admis.F) / (s.presents.M + s.presents.F) : null,
      },
    };
  });
}

/* ------------------------------------------------------- Tableau de bord */

export interface Alerte {
  libelle: string;
  nombre: number;
  gravite: "alerte" | "erreur";
  detail?: string;
  lien?: string;
}

/** TABLEAU DE BORD : indicateurs de l'école, effectifs et résultats par classe, alertes de gestion. */
export async function tableauDeBord(db: Db, schoolId: string) {
  const [resultats, annee, personnel, eleves, feuilles] = await Promise.all([
    resultatsEcole(db, schoolId),
    db.academicYear.findFirst({ where: { schoolId, isActive: true } }),
    db.staff.findMany({ where: { schoolId }, include: { classes: { include: { classroom: { select: { academicYearId: true } } } } } }),
    db.student.findMany({ where: { schoolId }, include: { enrollments: { include: { classroom: { include: { level: true } }, academicYear: true } } } }),
    db.classAssessment.findMany({ where: { classroom: { schoolId } } }),
  ]);
  const tous = resultats.flatMap((r) => r.eleves);
  const presents = tous.filter((e) => e.statut === "PRESENT");
  const admis = tous.filter((e) => e.decision === "ADMIS");
  const abandons = tous.filter((e) => e.statut === "ABANDON");
  const enseignants = personnel.filter((p) => estEnseignant(p.function));

  const parClasse = resultats.map((r) => {
    const p = r.eleves.filter((e) => e.statut === "PRESENT");
    const a = r.eleves.filter((e) => e.decision === "ADMIS");
    const tenue = personnel.filter((s) => s.classes.some((c) => c.classroomId === r.classe.id));
    return {
      id: r.classe.id,
      nom: r.classe.nom,
      effectif: parSexe(r.eleves),
      presents: p.length,
      admis: a.length,
      taux: p.length ? a.length / p.length : null,
      abandons: r.eleves.filter((e) => e.statut === "ABANDON").length,
      enseignant: tenue.map((s) => `${s.lastName} ${s.firstNames}`).join(", ") || null,
    };
  });

  // Alertes du classeur (contrôles intégrés), plus les feuilles de notes à valider.
  const actives = eleves.map((s) => ({ s, ins: s.enrollments.find((e) => e.academicYear.isActive) }));
  const noms = new Map<string, number>();
  for (const { s } of actives) noms.set(s.fullName.toLowerCase(), (noms.get(s.fullName.toLowerCase()) ?? 0) + 1);
  const surAge = actives.filter(({ s, ins }) => ins && estEnSurAge(anneesRevolues(s.birthDate, ins.academicYear.ageReferenceDate), ins.classroom.level.code));
  const classesSansEnseignant = parClasse.filter((c) => !c.enseignant).map((c) => c.nom);
  const aujourdhui = new Date();
  const aValider = resultats.flatMap((r) =>
    r.evaluations
      .filter((e) => e.date && e.date < aujourdhui)
      .filter((e) => (feuilles.find((f) => f.classroomId === r.classe.id && f.assessmentId === e.id)?.state ?? "OPEN") === "OPEN")
      .map((e) => `${r.classe.nom} (${e.libelle})`),
  );
  const alertes: Alerte[] = [
    { libelle: "Élèves sans extrait de naissance", nombre: actives.filter(({ s, ins }) => ins && !s.hasBirthCertificate).length, gravite: "alerte", lien: "/eleves" },
    { libelle: "Homonymes (même nom saisi deux fois, à vérifier)", nombre: actives.filter(({ s }) => (noms.get(s.fullName.toLowerCase()) ?? 0) > 1).length, gravite: "alerte", lien: "/eleves" },
    { libelle: "Élèves sans classe cette année", nombre: actives.filter(({ ins }) => !ins).length, gravite: "erreur", lien: "/eleves" },
    { libelle: "MGA manquantes (élèves présents)", nombre: presents.filter((e) => e.mga == null).length, gravite: "alerte", lien: "/resultats" },
    { libelle: "Classes sans enseignant", nombre: classesSansEnseignant.length, gravite: "erreur", detail: classesSansEnseignant.join(", "), lien: "/personnel" },
    { libelle: "Élèves en sur-âge (3 ans ou plus au-dessus de l'âge normal)", nombre: surAge.length, gravite: "alerte", lien: "/eleves" },
    { libelle: "Matricules DESPS non conformes", nombre: actives.filter(({ s }) => s.despsId && !despsValide(s.despsId)).length, gravite: "erreur", lien: "/eleves" },
    { libelle: "Feuilles de notes passées encore en saisie", nombre: aValider.length, gravite: "alerte", detail: aValider.slice(0, 6).join(", ") + (aValider.length > 6 ? "…" : ""), lien: "/classes" },
  ];

  return {
    annee,
    effectif: tous.length,
    filles: tous.filter((e) => e.sexe === "F").length,
    presents: presents.length,
    admis: admis.length,
    tauxAdmission: tauxAdmission(admis.length, presents.length),
    tauxAbandon: tous.length ? abandons.length / tous.length : 0,
    enseignants: enseignants.length,
    elevesParEnseignant: enseignants.length ? tous.length / enseignants.length : null,
    parClasse,
    alertes,
    resultats,
  };
}
