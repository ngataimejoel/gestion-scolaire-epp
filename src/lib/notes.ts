/**
 * Saisie des notes (feuilles NOTES CP, NOTES CE1, NOTES CE2-CM1, NOTES CM2).
 *
 * - Une feuille = une classe × une évaluation du calendrier ; matières et barèmes viennent des Paramètres.
 * - Colonne « Présent ? » : NON = moyenne 0 pour l'évaluation (règle du classeur), les notes éventuelles sont conservées.
 * - Contrôle de saisie : chaque note entre 0 et le maximum de la matière (10 au CP, le barème ailleurs).
 * - Cycle de vie : OPEN (saisie) → VALIDATED (l'enseignant a terminé) → LOCKED (verrouillée par le directeur).
 *   L'enseignant saisit tant que la feuille est ouverte ; le directeur peut encore corriger une feuille validée ;
 *   personne ne modifie une feuille verrouillée tant que le directeur ne l'a pas rouverte.
 * - Rien n'est écrasé en silence : si la feuille a changé depuis son ouverture (autre utilisateur, autre onglet),
 *   l'enregistrement est refusé ; chaque modification est inscrite au journal avec l'ancienne et la nouvelle note.
 */
import type { Db } from "./db";
import type { AssessmentState, User } from "@/generated/prisma/client";
import { journaliser } from "./audit";
import { notifier } from "./notifications";
import type { Resultat } from "./auth/service";
import { sha256 } from "./auth/jetons";
import { classesVisibles } from "./eleves";
import { feuilleDuNiveau, moyenneEvaluation, noteValide, totalEvaluation, type FeuilleNotes, type MatiereCfg, type SaisieEvaluation } from "./regles";

type Utilisateur = Pick<User, "id" | "schoolId" | "role">;

export const LIBELLES_ETAT: Record<AssessmentState, string> = { OPEN: "En saisie", VALIDATED: "Validée", LOCKED: "Verrouillée" };

/** Qui peut modifier une feuille dans cet état. */
export function peutSaisir(role: User["role"], etat: AssessmentState) {
  if (etat === "LOCKED") return false;
  return etat === "OPEN" || role === "DIRECTOR";
}

/** Convertit une saisie « 12,5 » en nombre ; "" = pas de note. */
export function lireNote(v: string): number | null | "invalide" {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "invalide";
}

/**
 * Saisie d'une ligne au sens du moteur de calcul : null si rien n'est renseigné.
 * Absence justifiée neutralisée (réglage de l'école, ambiguïté n° 6) : l'évaluation ne compte pas au lieu de valoir 0.
 */
export function saisieDe(present: boolean | null, notes: (number | null)[], neutraliser = false): SaisieEvaluation | null {
  if (present === false) return neutraliser ? null : { present: false, notes };
  if (present === null && notes.every((n) => n == null)) return null;
  return { present: true, notes };
}

async function classeAccessible(db: Db, u: Utilisateur, classroomId: string) {
  const classes = await classesVisibles(db, u);
  return classes.find((c) => c.id === classroomId) ?? null;
}

/** Charge une feuille de notes (classe × évaluation n° 1 à 4) avec les moyennes calculées. */
export async function feuilleDeNotes(db: Db, u: Utilisateur, classroomId: string, numero: number) {
  const classe = await classeAccessible(db, u, classroomId);
  if (!classe || ![1, 2, 3, 4].includes(numero)) return null;
  const feuille = feuilleDuNiveau(classe.level.code) as FeuilleNotes;
  const [evaluation, matieres, inscriptions, reglages] = await Promise.all([
    db.assessment.findFirstOrThrow({
      where: { academicYearId: classe.academicYearId, number: numero, track: classe.level.code === "CM2" ? "CM2" : "STANDARD" },
      include: { classStates: { where: { classroomId } } },
    }),
    db.subject.findMany({ where: { schoolId: classe.schoolId, gradeSheet: classe.level.gradeSheet, assessmentNumber: numero }, orderBy: { position: "asc" } }),
    db.enrollment.findMany({ where: { classroomId }, include: { student: true }, orderBy: { student: { schoolMatricule: "asc" } } }),
    db.schoolSettings.findUnique({ where: { schoolId: classe.schoolId } }),
  ]);
  const neutraliser = !!reglages?.neutralizeJustifiedAbsence;
  const [presences, notes] = await Promise.all([
    db.assessmentPresence.findMany({ where: { assessmentId: evaluation.id, enrollmentId: { in: inscriptions.map((i) => i.id) } } }),
    db.grade.findMany({ where: { assessmentId: evaluation.id, enrollmentId: { in: inscriptions.map((i) => i.id) } } }),
  ]);
  const cfg: MatiereCfg[] = matieres.map((m) => ({ nom: m.name, poids: feuille === "CP" ? Number(m.coefficient) : Number(m.maxScore) }));
  const echelle = classe.level.scale;
  const lignes = inscriptions.map((i) => {
    const p = presences.find((x) => x.enrollmentId === i.id);
    const n = matieres.map((m) => {
      const g = notes.find((x) => x.enrollmentId === i.id && x.subjectId === m.id);
      return g ? Number(g.score) : null;
    });
    const present = p ? p.present : null;
    const justifie = !!p && !p.present && p.justified;
    const s = saisieDe(present, n, neutraliser && justifie);
    return {
      enrollmentId: i.id,
      matricule: i.student.schoolMatricule,
      nom: i.student.fullName,
      sexe: i.student.sex,
      statut: i.status,
      present,
      justifie,
      notes: n,
      moyenne: moyenneEvaluation(feuille, cfg, s, echelle),
      total: feuille === "CP" ? null : totalEvaluation(s),
    };
  });
  const etat = evaluation.classStates[0]?.state ?? "OPEN";
  return {
    classe,
    evaluation,
    etat,
    feuille,
    echelle,
    neutraliser,
    matieres: matieres.map((m, i) => ({ id: m.id, nom: m.name, max: feuille === "CP" ? 10 : Number(m.maxScore), poids: cfg[i].poids })),
    lignes,
    modifiable: peutSaisir(u.role, etat),
    empreinte: empreinte(lignes),
  };
}

export type FeuilleDeNotes = NonNullable<Awaited<ReturnType<typeof feuilleDeNotes>>>;

/** Empreinte du contenu d'une feuille : sert à détecter qu'elle a changé depuis son ouverture. */
function empreinte(lignes: { enrollmentId: string; present: boolean | null; justifie: boolean; notes: (number | null)[] }[]) {
  return sha256(JSON.stringify(lignes.map((l) => [l.enrollmentId, l.present, l.justifie, l.notes])));
}

export interface SaisieLigne {
  enrollmentId: string;
  present: boolean;
  /** Absence justifiée (utile seulement si l'école neutralise ces absences). */
  justifie?: boolean;
  /** Note brute saisie par matière (subjectId → texte). */
  notes: Record<string, string>;
}

/** Enregistre une feuille de notes ; refusé si la feuille a changé entre-temps ou si une note sort du barème. */
export async function enregistrerNotes(
  db: Db,
  u: Utilisateur,
  classroomId: string,
  numero: number,
  saisies: SaisieLigne[],
  empreinteLue: string,
): Promise<Resultat<{ modifications: number }>> {
  const f = await feuilleDeNotes(db, u, classroomId, numero);
  if (!f) return { ok: false, erreur: "Feuille de notes introuvable ou classe non autorisée." };
  if (!f.modifiable)
    return {
      ok: false,
      erreur: f.etat === "LOCKED" ? "Cette feuille est verrouillée : seul le directeur peut la rouvrir." : "Cette feuille est validée : seul le directeur peut encore la corriger.",
    };
  if (f.empreinte !== empreinteLue)
    return { ok: false, erreur: "Les notes de cette feuille ont été modifiées ailleurs depuis son ouverture. Rechargez la page pour voir la dernière version : vos saisies n'ont pas été enregistrées." };

  const changements: { eleve: string; matiere: string; avant: number | string | null; apres: number | string | null }[] = [];
  const presences: { enrollmentId: string; present: boolean; justified: boolean }[] = [];
  const upserts: { enrollmentId: string; subjectId: string; score: number }[] = [];
  const suppressions: { enrollmentId: string; subjectId: string }[] = [];

  for (const s of saisies) {
    const l = f.lignes.find((x) => x.enrollmentId === s.enrollmentId);
    if (!l) return { ok: false, erreur: "Un élève de la saisie n'appartient pas à cette classe." };
    const justifie = !s.present && !!s.justifie;
    const libelle = (p: boolean | null, j: boolean) => (p === null ? null : p ? "OUI" : j ? "NON (justifiée)" : "NON");
    if ((l.present !== s.present || l.justifie !== justifie) && !(l.present === null && s.present && Object.values(s.notes).every((v) => !v.trim()))) {
      presences.push({ enrollmentId: l.enrollmentId, present: s.present, justified: justifie });
      changements.push({ eleve: l.matricule, matiere: "Présent ?", avant: libelle(l.present, l.justifie), apres: libelle(s.present, justifie) });
    }
    if (!s.present) continue; // absent : notes conservées telles quelles, moyenne 0
    for (const [i, m] of f.matieres.entries()) {
      if (!(m.id in s.notes)) continue;
      const v = lireNote(s.notes[m.id]);
      if (v === "invalide" || (v != null && !noteValide(v, f.feuille, { nom: m.nom, poids: m.max })))
        return { ok: false, champ: `n:${l.enrollmentId}:${m.id}`, erreur: `${l.nom}, ${m.nom} : la note doit être un nombre entre 0 et ${m.max}.` };
      const avant = l.notes[i];
      if (v === avant) continue;
      if (v == null) suppressions.push({ enrollmentId: l.enrollmentId, subjectId: m.id });
      else upserts.push({ enrollmentId: l.enrollmentId, subjectId: m.id, score: v });
      changements.push({ eleve: l.matricule, matiere: m.nom, avant, apres: v });
    }
  }
  if (!changements.length) return { ok: true, modifications: 0 };

  const assessmentId = f.evaluation.id;
  await db.$transaction([
    ...presences.map((p) =>
      db.assessmentPresence.upsert({
        where: { assessmentId_enrollmentId: { assessmentId, enrollmentId: p.enrollmentId } },
        create: { assessmentId, ...p },
        update: { present: p.present, justified: p.justified },
      }),
    ),
    ...upserts.map((g) =>
      db.grade.upsert({
        where: { assessmentId_enrollmentId_subjectId: { assessmentId, enrollmentId: g.enrollmentId, subjectId: g.subjectId } },
        create: { assessmentId, ...g, enteredById: u.id },
        update: { score: g.score, enteredById: u.id },
      }),
    ),
    ...(suppressions.length
      ? [db.grade.deleteMany({ where: { assessmentId, OR: suppressions.map((s) => ({ enrollmentId: s.enrollmentId, subjectId: s.subjectId })) } })]
      : []),
    ...(f.evaluation.classStates.length ? [] : [db.classAssessment.create({ data: { assessmentId, classroomId } })]),
  ]);
  await journaliser(db, {
    schoolId: u.schoolId, userId: u.id, action: "saisie_notes", entity: "Grade", entityId: `${classroomId}:${assessmentId}`,
    after: { classe: f.classe.name, evaluation: f.evaluation.label, changements },
  });
  return { ok: true, modifications: changements.length };
}

/** Élèves présents (statut PRESENT) dont la ligne n'est pas complète : ni absent, ni toutes les notes. */
export function lignesIncompletes(f: Pick<FeuilleDeNotes, "lignes" | "matieres">) {
  return f.lignes.filter(
    (l) => l.statut === "PRESENT" && l.present !== false && f.matieres.some((m, i) => m.poids > 0 && l.notes[i] == null),
  );
}

export type ActionFeuille = "valider" | "verrouiller" | "rouvrir";

/**
 * Valider (enseignant ou directeur, feuille complète), verrouiller (directeur), rouvrir (directeur).
 * La validation par un enseignant prévient le directeur dans ses notifications.
 */
export async function changerEtatFeuille(db: Db, u: Utilisateur, classroomId: string, numero: number, action: ActionFeuille): Promise<Resultat<{ etat: AssessmentState }>> {
  const f = await feuilleDeNotes(db, u, classroomId, numero);
  if (!f) return { ok: false, erreur: "Feuille de notes introuvable ou classe non autorisée." };
  const directeur = u.role === "DIRECTOR";
  let etat: AssessmentState;
  if (action === "valider") {
    if (f.etat !== "OPEN") return { ok: false, erreur: "Cette feuille est déjà validée." };
    const manquantes = lignesIncompletes(f);
    if (manquantes.length)
      return {
        ok: false,
        erreur: `Feuille incomplète : ${manquantes.length} élève(s) sans toutes leurs notes (${manquantes.slice(0, 3).map((l) => l.nom).join(", ")}${manquantes.length > 3 ? "…" : ""}). Saisissez les notes ou mettez « Présent ? » à NON.`,
      };
    etat = "VALIDATED";
  } else if (!directeur) {
    return { ok: false, erreur: "Seul le directeur peut verrouiller ou rouvrir une feuille." };
  } else if (action === "verrouiller") {
    if (f.etat === "LOCKED") return { ok: false, erreur: "Cette feuille est déjà verrouillée." };
    etat = "LOCKED";
  } else {
    if (f.etat === "OPEN") return { ok: false, erreur: "Cette feuille est déjà ouverte à la saisie." };
    etat = "OPEN";
  }
  const data = { state: etat, validatedById: etat === "OPEN" ? null : u.id, validatedAt: etat === "OPEN" ? null : new Date() };
  await db.classAssessment.upsert({
    where: { assessmentId_classroomId: { assessmentId: f.evaluation.id, classroomId } },
    create: { assessmentId: f.evaluation.id, classroomId, ...data },
    update: data,
  });
  await journaliser(db, {
    schoolId: u.schoolId, userId: u.id, action: `feuille_${action}`, entity: "ClassAssessment", entityId: `${classroomId}:${f.evaluation.id}`,
    before: { etat: f.etat }, after: { etat, classe: f.classe.name, evaluation: f.evaluation.label },
  });
  if (action === "valider" && !directeur) {
    const directeurs = await db.user.findMany({ where: { schoolId: u.schoolId, role: "DIRECTOR", isActive: true } });
    await db.notification.createMany({
      data: directeurs.map((d) => ({
        schoolId: u.schoolId, userId: d.id, channel: "IN_APP" as const,
        title: `Notes validées : ${f.classe.name}`,
        body: `La feuille « ${f.evaluation.label} » de ${f.classe.name} a été validée par l'enseignant. Vous pouvez la verrouiller.`,
      })),
    });
  }
  if (directeur && action === "rouvrir") {
    const enseignants = await db.user.findMany({ where: { isActive: true, staff: { classes: { some: { classroomId } } } } });
    await notifier(db, enseignants, {
      titre: `Feuille rouverte : ${f.classe.name}`,
      corps: `Le directeur a rouvert la feuille « ${f.evaluation.label} » de ${f.classe.name}. Vous pouvez corriger les notes puis la valider à nouveau.`,
    });
  }
  return { ok: true, etat };
}

/** Vue d'ensemble des classes : enseignant, effectifs et avancement de chaque évaluation. */
export async function tableauDesClasses(db: Db, u: Utilisateur) {
  const classes = await classesVisibles(db, u);
  if (!classes.length) return [];
  const ids = classes.map((c) => c.id);
  const [details, evaluations, presences, notes, matieres] = await Promise.all([
    db.classroom.findMany({
      where: { id: { in: ids } },
      include: { teachers: { include: { staff: true } }, enrollments: { include: { student: { select: { sex: true } } } }, assessmentStates: true },
    }),
    db.assessment.findMany({ where: { academicYearId: classes[0].academicYearId }, orderBy: { number: "asc" } }),
    db.assessmentPresence.findMany({ where: { enrollment: { classroomId: { in: ids } } }, select: { assessmentId: true, enrollmentId: true, present: true } }),
    db.grade.groupBy({ by: ["assessmentId", "enrollmentId"], where: { enrollment: { classroomId: { in: ids } } }, _count: true }),
    db.subject.groupBy({ by: ["gradeSheet", "assessmentNumber"], where: { schoolId: u.schoolId! }, _count: true }),
  ]);
  return classes.map((c) => {
    const d = details.find((x) => x.id === c.id)!;
    const presents = d.enrollments.filter((e) => e.status === "PRESENT");
    const track = c.level.code === "CM2" ? "CM2" : "STANDARD";
    return {
      id: c.id,
      nom: c.name,
      niveau: c.level.code,
      enseignants: d.teachers.map((t) => `${t.staff.lastName} ${t.staff.firstNames}`),
      effectif: { M: d.enrollments.filter((e) => e.student.sex === "M").length, F: d.enrollments.filter((e) => e.student.sex === "F").length },
      evaluations: evaluations
        .filter((a) => a.track === track)
        .map((a) => {
          const nbMatieres = matieres.find((m) => m.gradeSheet === c.level.gradeSheet && m.assessmentNumber === a.number)?._count ?? 0;
          const completes = presents.filter((e) => {
            if (presences.some((p) => p.assessmentId === a.id && p.enrollmentId === e.id && !p.present)) return true;
            return (notes.find((n) => n.assessmentId === a.id && n.enrollmentId === e.id)?._count ?? 0) >= nbMatieres;
          }).length;
          return {
            numero: a.number,
            libelle: a.label,
            date: a.date,
            etat: d.assessmentStates.find((s) => s.assessmentId === a.id)?.state ?? ("OPEN" as AssessmentState),
            completes,
            attendus: presents.length,
          };
        }),
    };
  });
}
