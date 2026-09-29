/**
 * Résultats de l'année (feuilles RESULTATS et RESULTATS CM2), calculés à la demande à partir des notes :
 * moyennes des 4 évaluations, moyenne des 3 compositions, MGA, décision, rang dans la classe, observation.
 * Même moteur que la saisie (src/lib/regles) : les valeurs sont identiques au classeur.
 */
import type { Db } from "./db";
import type { EnrollmentStatus, Sex, User } from "@/generated/prisma/client";
import { classesVisibles } from "./eleves";
import { saisieDe } from "./notes";
import { calculerRangs, feuilleDuNiveau, moyenneEvaluation, resultatAnnuel, type Decision, type MatiereCfg, type Observation } from "./regles";

type Utilisateur = Pick<User, "id" | "schoolId" | "role">;

export interface ResultatEleve {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  despsId: string | null;
  nom: string;
  sexe: Sex;
  statut: EnrollmentStatus;
  redoublant: boolean;
  moyennes: (number | null)[];
  /** Présence à chaque évaluation : true, false (absent) ou null (non renseignée). */
  presences: (boolean | null)[];
  moyenne3Compos: number | null;
  mga: number | null;
  decision: Decision;
  observation: Observation;
  rang: number | null;
}

export interface ResultatsClasse {
  classe: { id: string; nom: string; niveau: string; seuil: number; bareme: number; position: number };
  evaluations: { id: string; numero: number; libelle: string; date: Date | null }[];
  eleves: ResultatEleve[];
}

/**
 * Résultats de l'année active pour les classes indiquées (toutes les classes de l'école par défaut).
 * `schoolId` borne toujours la lecture : aucune donnée d'une autre école ne peut remonter.
 */
export async function resultatsEcole(db: Db, schoolId: string, classroomIds?: string[]): Promise<ResultatsClasse[]> {
  const annee = await db.academicYear.findFirst({ where: { schoolId, isActive: true } });
  if (!annee) return [];
  const [classes, evaluations, matieres, reglages] = await Promise.all([
    db.classroom.findMany({
      where: { schoolId, academicYearId: annee.id, ...(classroomIds ? { id: { in: classroomIds } } : {}) },
      include: { level: true, enrollments: { include: { student: true } } },
      orderBy: [{ level: { position: "asc" } }, { name: "asc" }],
    }),
    db.assessment.findMany({ where: { academicYearId: annee.id }, orderBy: { number: "asc" } }),
    db.subject.findMany({ where: { schoolId }, orderBy: { position: "asc" } }),
    db.schoolSettings.findUnique({ where: { schoolId } }),
  ]);
  const inscriptions = classes.flatMap((c) => c.enrollments.map((e) => e.id));
  const [presences, notes] = await Promise.all([
    db.assessmentPresence.findMany({ where: { enrollmentId: { in: inscriptions } } }),
    db.grade.findMany({ where: { enrollmentId: { in: inscriptions } }, select: { enrollmentId: true, assessmentId: true, subjectId: true, score: true } }),
  ]);
  const neutraliser = !!reglages?.neutralizeJustifiedAbsence;
  const presenceDe = new Map(presences.map((p) => [`${p.enrollmentId}:${p.assessmentId}`, p]));
  const noteDe = new Map(notes.map((n) => [`${n.enrollmentId}:${n.assessmentId}:${n.subjectId}`, Number(n.score)]));

  return classes.map((c) => {
    const feuille = feuilleDuNiveau(c.level.code);
    const evals = evaluations.filter((a) => a.track === (c.level.code === "CM2" ? "CM2" : "STANDARD"));
    const cfg = evals.map((a) => {
      const m = matieres.filter((x) => x.gradeSheet === c.level.gradeSheet && x.assessmentNumber === a.number);
      return { ids: m.map((x) => x.id), cfg: m.map((x): MatiereCfg => ({ nom: x.name, poids: feuille === "CP" ? Number(x.coefficient) : Number(x.maxScore) })) };
    });
    const seuil = Number(c.level.passMark);
    const eleves = c.enrollments
      .slice()
      .sort((a, b) => a.student.schoolMatricule.localeCompare(b.student.schoolMatricule))
      .map((e) => {
        const presencesEleve: (boolean | null)[] = [];
        const moyennes = evals.map((a, k) => {
          const p = presenceDe.get(`${e.id}:${a.id}`);
          presencesEleve.push(p ? p.present : null);
          const n = cfg[k].ids.map((id) => noteDe.get(`${e.id}:${a.id}:${id}`) ?? null);
          const s = saisieDe(p ? p.present : null, n, neutraliser && !!p && !p.present && p.justified);
          return moyenneEvaluation(feuille, cfg[k].cfg, s, c.level.scale);
        });
        const r = resultatAnnuel(c.level.code, e.status, moyennes, seuil, c.level.scale);
        return {
          enrollmentId: e.id,
          studentId: e.studentId,
          matricule: e.student.schoolMatricule,
          despsId: e.student.despsId,
          nom: e.student.fullName,
          sexe: e.student.sex,
          statut: e.status,
          redoublant: e.isRepeating,
          moyennes,
          presences: presencesEleve,
          moyenne3Compos: r.moyenne3Compos,
          mga: r.mga,
          decision: r.decision,
          observation: r.observation,
          rang: null as number | null,
        };
      });
    const rangs = calculerRangs(eleves.map((e) => ({ id: e.enrollmentId, statut: e.statut, mga: e.mga })));
    for (const e of eleves) e.rang = rangs.get(e.enrollmentId) ?? null;
    return {
      classe: { id: c.id, nom: c.name, niveau: c.level.code, seuil, bareme: c.level.scale, position: c.level.position },
      evaluations: evals.map((a) => ({ id: a.id, numero: a.number, libelle: a.label, date: a.date })),
      eleves,
    };
  });
}

/** Résultats des classes visibles par l'utilisateur (toutes pour le directeur, les siennes pour l'enseignant). */
export async function resultatsVisibles(db: Db, u: Utilisateur) {
  const classes = await classesVisibles(db, u);
  if (!classes.length) return [];
  return resultatsEcole(db, u.schoolId!, classes.map((c) => c.id));
}
