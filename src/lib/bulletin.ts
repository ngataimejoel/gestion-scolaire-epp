/**
 * Bulletin de notes d'un élève pour l'année active : notes par matière et par évaluation, moyennes, MGA,
 * rang parmi les présents de la classe, décision, observation, absences et retards.
 * Utilisé par l'espace parent, la fiche élève et l'impression par classe.
 */
import type { Db } from "./db";
import { resultatsEcole } from "./resultats";
import { feuilleDuNiveau } from "./regles";

export async function bulletinEleve(db: Db, schoolId: string, studentId: string) {
  const eleve = await db.student.findFirst({
    where: { id: studentId, schoolId },
    include: {
      school: { include: { settings: true } },
      enrollments: { where: { academicYear: { isActive: true } }, include: { classroom: { include: { level: true, teachers: { include: { staff: true } } } }, academicYear: true } },
    },
  });
  const ins = eleve?.enrollments[0];
  if (!eleve || !ins) return null;
  const [classe] = await resultatsEcole(db, schoolId, [ins.classroomId]);
  const resultat = classe.eleves.find((e) => e.enrollmentId === ins.id)!;
  const [matieres, notes, presences, absences] = await Promise.all([
    db.subject.findMany({ where: { schoolId, gradeSheet: ins.classroom.level.gradeSheet }, orderBy: { position: "asc" } }),
    db.grade.findMany({ where: { enrollmentId: ins.id } }),
    db.assessmentPresence.findMany({ where: { enrollmentId: ins.id } }),
    db.attendanceEvent.findMany({ where: { enrollmentId: ins.id } }),
  ]);
  const feuille = feuilleDuNiveau(ins.classroom.level.code);
  // La dernière évaluation a la liste la plus complète (au CM2 : épreuves physiques des examens blancs).
  const noms = [...new Set([...matieres].sort((a, b) => b.assessmentNumber - a.assessmentNumber || a.position - b.position).map((m) => m.name))];
  const ordre = (n: string) => matieres.find((m) => m.name === n)?.position ?? 99;
  noms.sort((a, b) => ordre(a) - ordre(b));
  const lignes = noms.map((nom) => ({
    nom,
    notes: classe.evaluations.map((ev) => {
      const m = matieres.find((x) => x.name === nom && x.assessmentNumber === ev.numero);
      if (!m) return { valeur: null, max: null, absent: false, prevue: false };
      const absent = presences.some((p) => p.assessmentId === ev.id && !p.present);
      const g = notes.find((n) => n.assessmentId === ev.id && n.subjectId === m.id);
      return { valeur: g ? Number(g.score) : null, max: feuille === "CP" ? null : Number(m.maxScore), absent, prevue: true };
    }),
  }));
  return {
    ecole: eleve.school,
    annee: ins.academicYear,
    eleve,
    inscription: ins,
    classe: classe.classe,
    enseignant: ins.classroom.teachers.map((t) => `${t.staff.lastName} ${t.staff.firstNames}`).join(", ") || null,
    evaluations: classe.evaluations,
    matieres: lignes,
    resultat,
    effectifClasse: classe.eleves.filter((e) => e.statut === "PRESENT").length,
    absences: {
      jours: absences.filter((a) => a.nature === "ABSENCE").reduce((s, a) => s + Number(a.days ?? 0), 0),
      retards: absences.filter((a) => a.nature === "RETARD").length,
    },
  };
}

export type Bulletin = NonNullable<Awaited<ReturnType<typeof bulletinEleve>>>;
