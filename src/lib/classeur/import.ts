/**
 * Import du classeur Excel dans une école : analyse (aperçu, doublons, erreurs, écarts de paramètres), puis
 * confirmation. Règle absolue : aucune donnée existante n'est écrasée. Un élève ou un agent déjà présent est
 * signalé comme doublon et laissé tel quel ; ses notes du fichier ne sont pas reprises. Les paramètres de l'école
 * ne sont remplacés que si le directeur le demande expressément.
 */
import type { Db } from "../db";
import type { GradeSheet, GuardianRelation, Prisma, User } from "@/generated/prisma/client";
import type { DonneesClasseur } from "../demo/classeur";
import { norm, type AttenduEleve } from "./lecture";
import { normaliserTelephone } from "../auth/telephone";
import { despsValide, estEnseignant, feuilleDuNiveau, noteValide } from "../regles";
import { prochainMatricule } from "../eleves";
import { limiteAtteinte, utilisation, etatAbonnement } from "../abonnement";
import { creerCompteEnseignant, type Resultat } from "../auth/service";
import { resultatsEcole } from "../resultats";

type Tx = Prisma.TransactionClient;
type Directeur = Pick<User, "id" | "schoolId" | "role">;
type Ligne = Record<string, string | number | null>;

export interface Probleme {
  feuille: string;
  ligne: string;
  message: string;
  /** true : la ligne (ou la note) n'est pas importée. */
  ignore: boolean;
}

export interface Ecart {
  libelle: string;
  ecole: string;
  fichier: string;
}

export interface OptionsImport {
  parametres?: boolean;
  comptesEnseignants?: boolean;
  /** Réservé au chargement de l'école de démonstration et aux tests. */
  ignorerLimites?: boolean;
}

const FEUILLE_NOTES: Record<GradeSheet, string | null> = { CP: "CP", CE1: "CE1", CE2_CM1: "CEM", CM2: "CM2", PRESCHOOL: null };
const NOM_FEUILLE_NOTES: Record<string, string> = { CP: "NOTES CP", CE1: "NOTES CE1", CEM: "NOTES CE2-CM1", CM2: "NOTES CM2" };
const txt = (v: unknown) => (v == null || v === "" || v === "-" ? null : String(v).trim() || null);
const jour = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
const illisible = (v: unknown) => typeof v === "string" && v.startsWith("!");
const cleIdentite = (nom: string, naiss: string | null) => `${norm(nom)}|${naiss ?? ""}`;
const aff = (v: unknown) => (v == null || v === "" ? "vide" : String(v));
const dateAff = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/* ------------------------------------------------------------------------------------------------ Plan */

async function contexte(db: Db | Tx, schoolId: string) {
  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId, isActive: true }, include: { months: true, assessments: true } });
  const [school, classes, niveaux, matieres, eleves, personnel, verrous, evenements] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId }, include: { settings: true } }),
    db.classroom.findMany({ where: { academicYearId: annee.id }, include: { level: true, teachers: true, _count: { select: { enrollments: true } } } }),
    db.level.findMany({ where: { schoolId } }),
    db.subject.findMany({ where: { schoolId }, orderBy: { position: "asc" } }),
    db.student.findMany({
      where: { schoolId },
      select: { id: true, fullName: true, birthDate: true, despsId: true, schoolMatricule: true, enrollments: { where: { academicYearId: annee.id }, select: { id: true } } },
    }),
    db.staff.findMany({ where: { schoolId }, select: { id: true, matricule: true, phone: true, lastName: true, firstNames: true, userId: true } }),
    db.classAssessment.findMany({ where: { state: "LOCKED", classroom: { academicYearId: annee.id } } }),
    db.attendanceEvent.findMany({ where: { schoolId, academicYearId: annee.id }, select: { enrollmentId: true, staffId: true, date: true, nature: true } }),
  ]);
  return { annee, school, classes, niveaux, matieres, eleves, personnel, verrous, evenements };
}

type Contexte = Awaited<ReturnType<typeof contexte>>;

/** Tout ce que l'import fera, calculé sans rien écrire. Recalculé à la confirmation (la base a pu changer). */
export async function planifier(db: Db | Tx, schoolId: string, D: DonneesClasseur, ctx?: Contexte) {
  const c = ctx ?? (await contexte(db, schoolId));
  const problemes: Probleme[] = [];
  const pb = (feuille: string, ligne: string, message: string, ignore = true) => problemes.push({ feuille, ligne, message, ignore });
  const classeParNom = new Map(c.classes.map((x) => [norm(x.name), x]));
  const debutAnnee = new Date(Date.UTC(c.annee.startYear, 8, 1));
  const finAnnee = new Date(Date.UTC(c.annee.startYear + 1, 8, 1));

  /* Élèves */
  const parDesps = new Map(c.eleves.filter((s) => s.despsId).map((s) => [s.despsId!.toUpperCase(), s]));
  const parIdentite = new Map(c.eleves.map((s) => [cleIdentite(s.fullName, dateAff(s.birthDate)), s]));
  const matriculesPris = new Set(c.eleves.map((s) => s.schoolMatricule));
  const vus = new Set<string>();
  const nouveauxEleves: { index: number; e: Ligne; classroomId: string; niveau: string; matricule: string | null; statut: string; naiss: string | null }[] = [];
  const doublonsEleves: { nom: string; classe: string; raison: string; matriculeEcole: string }[] = [];
  /** Matricule du fichier → élève : nouveau (indice dans nouveauxEleves) ou inscription existante. */
  const eleveDuFichier = new Map<string, { nouveau: number } | { enrollmentId: string | null }>();

  D.E.forEach((e, i) => {
    const nom = txt(e.nom);
    if (!nom) return;
    const ligne = `N° ${e.n ?? i + 1} – ${nom}`;
    const F = "REGISTRE ELEVES";
    const sexe = norm(e.sexe);
    if (sexe !== "M" && sexe !== "F") return pb(F, ligne, `Sexe « ${aff(e.sexe)} » : M ou F attendu.`);
    const classe = classeParNom.get(norm(e.classe));
    if (!classe) return pb(F, ligne, `Classe « ${aff(e.classe)} » inconnue pour l'année ${c.annee.label} : ajoutez-la dans Paramètres puis relancez l'analyse.`);
    if (illisible(e.naiss)) return pb(F, ligne, `Date de naissance illisible (${String(e.naiss).slice(1)}).`);
    const statut = norm(e.statut) || "PRESENT";
    if (!["PRESENT", "ABANDON", "TRANSFERE"].includes(statut)) return pb(F, ligne, `Statut « ${aff(e.statut)} » : PRESENT, ABANDON ou TRANSFERE attendu.`);
    if (illisible(e.acteDu)) pb(F, ligne, "Date de l'acte de naissance illisible : laissée vide.", false);
    const desps = txt(e.desps)?.toUpperCase() ?? null;
    if (desps && !despsValide(desps)) pb(F, ligne, `Matricule DESPS « ${desps} » non conforme : importé tel quel et signalé dans le tableau de bord, comme dans le classeur.`, false);

    const naiss = (e.naiss as string | null) ?? null;
    const cle = cleIdentite(nom, naiss);
    const existant = (desps && parDesps.get(desps)) || parIdentite.get(cle);
    const mat = txt(e.mat);
    if (existant) {
      doublonsEleves.push({ nom, classe: classe.name, raison: desps && parDesps.get(desps) ? `même matricule DESPS (${desps})` : "même nom et même date de naissance", matriculeEcole: existant.schoolMatricule });
      if (mat) eleveDuFichier.set(mat, { enrollmentId: existant.enrollments[0]?.id ?? null });
      return;
    }
    if (vus.has(cle) || (desps && vus.has(desps))) {
      doublonsEleves.push({ nom, classe: classe.name, raison: "présent deux fois dans le fichier", matriculeEcole: "" });
      return;
    }
    vus.add(cle);
    if (desps) vus.add(desps);
    let matricule: string | null = null;
    if (mat && /^[A-Z0-9]+-\d{3}-\d{2}$/.test(mat) && !matriculesPris.has(mat)) matricule = mat;
    else if (mat) pb(F, ligne, `Matricule école ${mat} déjà utilisé dans l'école : un nouveau matricule sera attribué.`, false);
    if (matricule) matriculesPris.add(matricule);
    if (mat) eleveDuFichier.set(mat, { nouveau: nouveauxEleves.length });
    nouveauxEleves.push({ index: i, e, classroomId: classe.id, niveau: classe.level.code, matricule, statut, naiss });
  });

  /* Personnel */
  const nouveauxAgents: { index: number; p: Ligne; nom: string; prenoms: string; sexe: "M" | "F"; classroomId: string | null; telephone: string | null }[] = [];
  const doublonsAgents: { nom: string; raison: string }[] = [];
  const agentDuFichier = new Map<string, { nouveau: number } | { staffId: string }>();
  const nomAgent = (s: { lastName: string; firstNames: string }) => norm(`${s.lastName} ${s.firstNames}`);
  const classesAffectees = new Set(c.classes.filter((x) => x.teachers.length).map((x) => x.id));
  D.P.forEach((p, i) => {
    const complet = txt(p.nom);
    if (!complet) return;
    const F = "PERSONNEL";
    const ligne = `N° ${p.n ?? i + 1} – ${complet}`;
    const sexe = norm(p.sexe);
    if (sexe !== "M" && sexe !== "F") return pb(F, ligne, `Sexe « ${aff(p.sexe)} » : M ou F attendu.`);
    const mat = txt(p.mat)?.toUpperCase() ?? null;
    if (!mat) return pb(F, ligne, "Matricule obligatoire (comme dans la fiche Personnel du site).");
    const tel = normaliserTelephone(String(p.tel ?? ""));
    const existant =
      (mat && c.personnel.find((s) => s.matricule && norm(s.matricule) === norm(mat))) ||
      (tel && c.personnel.find((s) => s.phone === tel)) ||
      c.personnel.find((s) => nomAgent(s) === norm(complet));
    if (existant) {
      doublonsAgents.push({ nom: complet, raison: mat && existant.matricule && norm(existant.matricule) === norm(mat) ? `même matricule (${mat})` : tel && existant.phone === tel ? "même téléphone" : "même nom" });
      if (mat) agentDuFichier.set(mat, { staffId: existant.id });
      return;
    }
    if (nouveauxAgents.some((a) => norm(`${a.nom} ${a.prenoms}`) === norm(complet))) {
      doublonsAgents.push({ nom: complet, raison: "présent deux fois dans le fichier" });
      return;
    }
    let classroomId: string | null = null;
    if (txt(p.classe)) {
      const cl = classeParNom.get(norm(p.classe));
      if (!cl) pb(F, ligne, `Classe tenue « ${p.classe} » inconnue : l'agent est importé sans classe.`, false);
      else if (classesAffectees.has(cl.id)) pb(F, ligne, `La classe ${cl.name} a déjà un enseignant : affectation à faire dans Personnel si besoin.`, false);
      else {
        classroomId = cl.id;
        classesAffectees.add(cl.id);
      }
    }
    if (p.tel && !tel) pb(F, ligne, `Téléphone « ${p.tel} » illisible : laissé vide.`, false);
    for (const k of ["naiss", "priseService", "arrivee"]) if (illisible(p[k])) pb(F, ligne, `Date « ${String(p[k]).slice(1)} » illisible : laissée vide.`, false);
    const [nom, ...prenoms] = complet.split(" ");
    if (mat) agentDuFichier.set(mat, { nouveau: nouveauxAgents.length });
    nouveauxAgents.push({ index: i, p, nom: nom.toUpperCase(), prenoms: prenoms.join(" "), sexe, classroomId, telephone: tel });
  });

  /* Notes : seulement pour les élèves créés par cet import (jamais par-dessus des notes existantes). */
  const presences: { eleve: number; assessmentId: string; present: boolean }[] = [];
  const notes: { eleve: number; assessmentId: string; subjectId: string; score: number }[] = [];
  let notesIgnoreesExistants = 0;
  const matieresManquantes = new Set<string>();
  for (const [mat, lignes] of Object.entries(D.N)) {
    const cible = eleveDuFichier.get(mat);
    if (!cible) continue;
    if (!("nouveau" in cible)) {
      if (lignes.some((l) => l && l.slice(1).some((v) => v != null))) notesIgnoreesExistants++;
      continue;
    }
    const n = nouveauxEleves[cible.nouveau];
    const niveau = c.niveaux.find((x) => x.code === n.niveau)!;
    const cleFeuille = FEUILLE_NOTES[niveau.gradeSheet];
    if (!cleFeuille) continue;
    const feuille = feuilleDuNiveau(n.niveau);
    lignes.forEach((l, k) => {
      if (!l) return;
      const [presence, ...valeurs] = l;
      if (presence == null && valeurs.every((v) => v == null)) return;
      const ev = c.annee.assessments.find((a) => a.number === k + 1 && a.track === (n.niveau === "CM2" ? "CM2" : "STANDARD"));
      if (!ev) return;
      const nomsFichier = D.CFG?.[cleFeuille]?.[k]?.map(([nom]) => nom);
      const matieresEcole = c.matieres.filter((m) => m.gradeSheet === niveau.gradeSheet && m.assessmentNumber === k + 1);
      if (c.verrous.some((v) => v.classroomId === n.classroomId && v.assessmentId === ev.id)) {
        pb(NOM_FEUILLE_NOTES[cleFeuille], `${mat} – ${ev.label}`, "Feuille verrouillée dans cette classe : notes non importées.");
        return;
      }
      presences.push({ eleve: cible.nouveau, assessmentId: ev.id, present: norm(presence) !== "NON" });
      valeurs.forEach((v, j) => {
        if (typeof v !== "number") return;
        const m = nomsFichier ? matieresEcole.find((x) => norm(x.name) === norm(nomsFichier[j])) : matieresEcole[j];
        if (!m) {
          matieresManquantes.add(`${NOM_FEUILLE_NOTES[cleFeuille]} – ${ev.label} : ${nomsFichier?.[j] ?? `matière n° ${j + 1}`}`);
          return;
        }
        if (!noteValide(v, feuille, { nom: m.name, poids: Number(m.maxScore) })) {
          pb(NOM_FEUILLE_NOTES[cleFeuille], `${mat} – ${ev.label}`, `${m.name} : ${v} hors barème (0 à ${feuille === "CP" ? 10 : Number(m.maxScore)}), note non importée.`);
          return;
        }
        notes.push({ eleve: cible.nouveau, assessmentId: ev.id, subjectId: m.id, score: v });
      });
    });
  }
  for (const m of matieresManquantes) pb("NOTES", m, "Matière absente des Paramètres de l'école : notes non importées.");

  /* Retards et absences */
  const existants = new Set(c.evenements.map((a) => `${a.enrollmentId ?? a.staffId}|${a.date.toISOString().slice(0, 10)}|${a.nature}`));
  type Evt = { cible: { nouveauEleve: number } | { nouvelAgent: number } | { enrollmentId: string } | { staffId: string }; date: Date; nature: "RETARD" | "ABSENCE"; days: number | null; minutes: number | null; reason: string | null; justified: boolean; notes: string | null };
  const evenements: Evt[] = [];
  let evenementsDejaPresents = 0;
  const lireEvenement = (a: DonneesClasseur["AE"][number], F: string, cible: Evt["cible"] | null, cleExistant: string | null) => {
    const ligne = `${a.date} – ${a.mat}`;
    if (!cible) return pb(F, ligne, `Matricule ${a.mat} introuvable dans le fichier et dans l'école.`);
    if (illisible(a.date) || !jour(a.date)) return pb(F, ligne, "Date illisible.");
    const date = jour(a.date)!;
    if (date < debutAnnee || date >= finAnnee) return pb(F, ligne, `Date hors de l'année scolaire ${c.annee.label}.`);
    const nature = norm(a.nature);
    if (nature !== "RETARD" && nature !== "ABSENCE") return pb(F, ligne, `Nature « ${aff(a.nature)} » : RETARD ou ABSENCE attendu.`);
    const days = nature === "ABSENCE" ? a.jours : null;
    const minutes = nature === "RETARD" ? a.min : null;
    if (nature === "ABSENCE" && (days == null || days <= 0 || days > 31 || Math.round(days * 2) !== days * 2)) return pb(F, ligne, "Jours d'absence : nombre par demi-journée (0,5 ; 1 ; 1,5…) attendu.");
    if (nature === "RETARD" && (minutes == null || minutes < 1 || minutes > 600)) return pb(F, ligne, "Retard : durée en minutes (1 à 600) attendue.");
    if (cleExistant && existants.has(`${cleExistant}|${a.date}|${nature}`)) {
      evenementsDejaPresents++;
      return;
    }
    evenements.push({ cible, date, nature, days, minutes, reason: txt(a.motif), justified: norm(a.just) === "OUI", notes: txt(a.obs) });
  };
  for (const a of D.AE) {
    const x = eleveDuFichier.get(String(a.mat));
    const cible = !x ? null : "nouveau" in x ? { nouveauEleve: x.nouveau } : x.enrollmentId ? { enrollmentId: x.enrollmentId } : null;
    lireEvenement(a, "ABSENCES ELEVES", cible, x && !("nouveau" in x) ? x.enrollmentId : null);
  }
  for (const a of D.AP) {
    const x = agentDuFichier.get(String(a.mat));
    const cible = !x ? null : "nouveau" in x ? { nouvelAgent: x.nouveau } : { staffId: x.staffId };
    lireEvenement(a, "ABSENCES PERSONNEL", cible, x && "staffId" in x ? x.staffId : null);
  }

  return {
    ctx: c,
    nouveauxEleves,
    doublonsEleves,
    nouveauxAgents,
    doublonsAgents,
    presences,
    notes,
    notesIgnoreesExistants,
    evenements,
    evenementsDejaPresents,
    ecartsParametres: ecartsParametres(c, D),
    problemes,
  };
}

export type Plan = Awaited<ReturnType<typeof planifier>>;

/* ------------------------------------------------------------------------------------------------ Paramètres */

type ParametresFichier = {
  ministere?: string | null; dren?: string | null; iepp?: string | null; ecole?: string | null; localite?: string | null; secteur?: string | null;
  directeur?: string | null; dateEdition?: string | null; dateRefAge?: string | null; nouveauxCP1?: number | null; annee?: string | null;
  seuils?: Record<string, [number, number]>; calendrier?: [string, string | null, string | null][]; jours?: [string, number, number][];
};

/** Écarts entre les paramètres de l'école et ceux du fichier (rien n'est modifié sans l'accord du directeur). */
function ecartsParametres(c: Contexte, D: DonneesClasseur): (Ecart & { appliquer: (tx: Tx) => Promise<unknown> })[] {
  const P = (D.PAR ?? {}) as unknown as ParametresFichier;
  const e: (Ecart & { appliquer: (tx: Tx) => Promise<unknown> })[] = [];
  const ajouter = (libelle: string, ecole: unknown, fichier: unknown, appliquer: (tx: Tx) => Promise<unknown>) => {
    if (fichier == null || fichier === "") return;
    if (String(ecole ?? "") === String(fichier)) return;
    e.push({ libelle, ecole: aff(ecole), fichier: aff(fichier), appliquer });
  };
  const s = c.school;
  const id = s.id;
  ajouter("Nom de l'établissement", s.name, P.ecole, (tx) => tx.school.update({ where: { id }, data: { name: P.ecole! } }));
  ajouter("Ministère", s.ministry, P.ministere, (tx) => tx.school.update({ where: { id }, data: { ministry: P.ministere! } }));
  ajouter("Direction régionale (DREN)", s.regionalDirectorate, P.dren, (tx) => tx.school.update({ where: { id }, data: { regionalDirectorate: P.dren } }));
  ajouter("Inspection (IEPP)", s.inspectorate, P.iepp, (tx) => tx.school.update({ where: { id }, data: { inspectorate: P.iepp } }));
  ajouter("Secteur pédagogique", s.sector, P.secteur, (tx) => tx.school.update({ where: { id }, data: { sector: P.secteur } }));
  ajouter("Localité", s.locality, P.localite, (tx) => tx.school.update({ where: { id }, data: { locality: P.localite } }));
  ajouter("Nom du directeur", s.settings?.directorName, P.directeur, (tx) => tx.schoolSettings.update({ where: { schoolId: id }, data: { directorName: P.directeur } }));
  ajouter("Date d'édition des états", dateAff(s.settings?.reportDate), P.dateEdition, (tx) => tx.schoolSettings.update({ where: { schoolId: id }, data: { reportDate: jour(P.dateEdition) } }));
  ajouter("Nouveaux inscrits CP1 attendus", s.settings?.expectedNewCp1, P.nouveauxCP1, (tx) => tx.schoolSettings.update({ where: { schoolId: id }, data: { expectedNewCp1: Number(P.nouveauxCP1) || 0 } }));
  ajouter("Date de référence pour l'âge", dateAff(c.annee.ageReferenceDate), P.dateRefAge, (tx) => tx.academicYear.update({ where: { id: c.annee.id }, data: { ageReferenceDate: jour(P.dateRefAge)! } }));
  for (const n of c.niveaux) {
    const f = P.seuils?.[n.code];
    if (!f) continue;
    ajouter(`Seuil d'admission ${n.code}`, Number(n.passMark), f[0], (tx) => tx.level.update({ where: { id: n.id }, data: { passMark: f[0] } }));
    ajouter(`Barème ${n.code}`, n.scale, f[1], (tx) => tx.level.update({ where: { id: n.id }, data: { scale: f[1] } }));
  }
  (P.calendrier ?? []).forEach(([libelle, standard, cm2], i) => {
    for (const [track, date] of [["STANDARD", standard], ["CM2", cm2]] as const) {
      const a = c.annee.assessments.find((x) => x.number === i + 1 && x.track === track);
      if (a && date) ajouter(`Date – ${libelle}${track === "CM2" ? " (CM2)" : ""}`, dateAff(a.date), date, (tx) => tx.assessment.update({ where: { id: a.id }, data: { date: jour(date) } }));
    }
  });
  for (const [mois, num, jours] of P.jours ?? []) {
    const m = c.annee.months.find((x) => x.month === num);
    if (m) ajouter(`Jours de classe – ${mois}`, Number(m.schoolDays), jours, (tx) => tx.schoolMonth.update({ where: { id: m.id }, data: { schoolDays: jours } }));
  }
  for (const [cle, evals] of Object.entries(D.CFG ?? {})) {
    const sheet = (Object.entries(FEUILLE_NOTES).find(([, v]) => v === cle)?.[0] ?? null) as GradeSheet | null;
    if (!sheet) continue;
    evals.forEach((matieres, k) =>
      matieres.forEach(([nom, poids]) => {
        const m = c.matieres.find((x) => x.gradeSheet === sheet && x.assessmentNumber === k + 1 && norm(x.name) === norm(nom));
        if (!m) return;
        if (sheet === "CP") ajouter(`Coefficient ${nom} (${NOM_FEUILLE_NOTES[cle]}, évaluation ${k + 1})`, Number(m.coefficient), poids, (tx) => tx.subject.update({ where: { id: m.id }, data: { coefficient: poids } }));
        else ajouter(`Barème ${nom} (${NOM_FEUILLE_NOTES[cle]}, évaluation ${k + 1})`, Number(m.maxScore), poids, (tx) => tx.subject.update({ where: { id: m.id }, data: { maxScore: poids } }));
      }),
    );
  }
  return e;
}

/* ------------------------------------------------------------------------------------------------ Exécution */

export interface RapportImport {
  eleves: number;
  doublonsEleves: number;
  agents: number;
  doublonsAgents: number;
  presences: number;
  notes: number;
  evenements: number;
  parametres: number;
  comptes: number;
  problemes: number;
  matricules: Record<string, string>;
  comparaison?: { comparees: number; identiques: number; ecarts: { nom: string; fichier: AttenduEleve; site: AttenduEleve }[] };
}

/** Écrit le plan en une seule transaction : tout ou rien. */
export async function executer(db: Db, directeur: Directeur, D: DonneesClasseur, options: OptionsImport = {}): Promise<Resultat<{ rapport: RapportImport; plan: Plan; studentIds: string[] }>> {
  const schoolId = directeur.schoolId!;
  if (directeur.role !== "DIRECTOR" || !schoolId) return { ok: false, erreur: "Seul le directeur peut importer un classeur." };
  const offre = options.ignorerLimites ? null : (await etatAbonnement(db, schoolId)).plan;
  const resultat = await db.$transaction(
    async (tx) => {
      const plan = await planifier(tx, schoolId, D);
      const c = plan.ctx;
      if (offre?.maxStudents != null) {
        const u = await utilisation(tx as unknown as Db, schoolId);
        if (u.eleves + plan.nouveauxEleves.length > offre.maxStudents)
          return { ok: false as const, erreur: `L'offre « ${offre.name} » est limitée à ${offre.maxStudents} élèves : ${u.eleves} déjà inscrits + ${plan.nouveauxEleves.length} à importer. Passez à une offre supérieure dans Abonnement.` };
      }
      let parametres = 0;
      if (options.parametres)
        for (const e of plan.ecartsParametres) {
          await e.appliquer(tx);
          parametres++;
        }

      // Personnel et classes tenues ; la fiche DIRECTEUR est reliée au compte du directeur s'il n'en a pas.
      const agents: string[] = [];
      const aDejaFiche = c.personnel.some((s) => s.userId === directeur.id);
      const telDirecteur = (await tx.user.findUniqueOrThrow({ where: { id: directeur.id } })).phone;
      const fichesDirecteur = plan.nouveauxAgents.filter((a) => norm(a.p.fonction) === "DIRECTEUR");
      const ficheLiee = aDejaFiche ? null : (fichesDirecteur.find((a) => a.telephone === telDirecteur) ?? (fichesDirecteur.length === 1 ? fichesDirecteur[0] : null));
      for (const a of plan.nouveauxAgents) {
        const p = a.p;
        const s = await tx.staff.create({
          data: {
            schoolId, matricule: txt(p.mat)!.toUpperCase(), lastName: a.nom, firstNames: a.prenoms, sex: a.sexe, birthDate: jour(p.naiss), function: txt(p.fonction) ?? "",
            grade: txt(p.grade), diploma: txt(p.diplome), serviceStartDate: jour(p.priseService), arrivalDate: jour(p.arrivee), phone: a.telephone,
            maritalStatus: txt(p.sitMat), notes: txt(p.obs), userId: a === ficheLiee ? directeur.id : null,
          },
        });
        if (a.classroomId) await tx.classTeacher.create({ data: { classroomId: a.classroomId, staffId: s.id } });
        agents.push(s.id);
      }

      // Élèves, parents et inscriptions
      const inscriptions: string[] = [];
      const studentIds: string[] = [];
      const matricules: Record<string, string> = {};
      const parents: [GuardianRelation, string, string][] = [["PERE", "pere", "pere"], ["MERE", "mere", "mere"], ["TUTEUR", "tuteur", "tut"]];
      for (const n of plan.nouveauxEleves) {
        const e = n.e;
        const matricule = n.matricule ?? (await prochainMatricule(tx, schoolId, n.niveau, c.annee.startYear));
        const orphelin = norm(e.orphelin) === "OUI";
        const s = await tx.student.create({
          data: {
            schoolId, schoolMatricule: matricule, despsId: txt(e.desps)?.toUpperCase() ?? null, fullName: String(e.nom).trim().replace(/\s+/g, " "), sex: norm(e.sexe) as "M" | "F",
            birthDate: jour(n.naiss), nationality: txt(e.nat), locality: txt(e.loc), subPrefecture: txt(e.sp), hasBirthCertificate: norm(e.extrait) !== "NON",
            certificateNumber: txt(e.acte), certificateDate: jour(e.acteDu), civilRegistryCenter: txt(e.centre), isOrphan: orphelin, orphanOf: orphelin ? txt(e.orphDe) : null,
            guardians: {
              create: parents
                .map(([relation, k, p]) => ({ relation, fullName: txt(e[k]), profession: txt(e[`${p}Prof`]), residence: txt(e[`${p}Res`]), phone: normaliserTelephone(String(e[`${p}Tel`] ?? "")) }))
                .filter((g): g is typeof g & { fullName: string } => !!g.fullName),
            },
            enrollments: {
              create: { academicYearId: c.annee.id, classroomId: n.classroomId, isRepeating: norm(e.redoublant) === "OUI", status: n.statut as "PRESENT" | "ABANDON" | "TRANSFERE", notes: txt(e.obs) },
            },
          },
          include: { enrollments: true },
        });
        inscriptions.push(s.enrollments[0].id);
        studentIds.push(s.id);
        if (e.mat && String(e.mat) !== matricule) matricules[String(e.mat)] = matricule;
      }

      await tx.assessmentPresence.createMany({ data: plan.presences.map((p) => ({ assessmentId: p.assessmentId, enrollmentId: inscriptions[p.eleve], present: p.present })) });
      await tx.grade.createMany({ data: plan.notes.map((g) => ({ assessmentId: g.assessmentId, enrollmentId: inscriptions[g.eleve], subjectId: g.subjectId, score: g.score })) });
      await tx.attendanceEvent.createMany({
        data: plan.evenements.map((a) => ({
          schoolId, academicYearId: c.annee.id, date: a.date, nature: a.nature, days: a.days, minutes: a.minutes, reason: a.reason, justified: a.justified, notes: a.notes,
          enrollmentId: "nouveauEleve" in a.cible ? inscriptions[a.cible.nouveauEleve] : "enrollmentId" in a.cible ? a.cible.enrollmentId : null,
          staffId: "nouvelAgent" in a.cible ? agents[a.cible.nouvelAgent] : "staffId" in a.cible ? a.cible.staffId : null,
        })),
      });

      const rapport: RapportImport = {
        eleves: plan.nouveauxEleves.length, doublonsEleves: plan.doublonsEleves.length, agents: agents.length, doublonsAgents: plan.doublonsAgents.length,
        presences: plan.presences.length, notes: plan.notes.length, evenements: plan.evenements.length, parametres, comptes: 0,
        problemes: plan.problemes.length, matricules,
      };
      await tx.auditLog.create({ data: { schoolId, userId: directeur.id, action: "import", entity: "ImportJob", after: JSON.parse(JSON.stringify({ ...rapport, matricules: undefined })) } });
      return { ok: true as const, rapport, plan, agents, studentIds };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  if (!resultat.ok) return resultat;

  // Comptes enseignants (hors transaction : envoi des identifiants par SMS), si le directeur l'a demandé.
  if (options.comptesEnseignants) {
    for (const [i, a] of resultat.plan.nouveauxAgents.entries()) {
      if (!a.telephone || !estEnseignant(txt(a.p.fonction))) continue;
      if (await limiteAtteinte(db, schoolId, "enseignants")) break;
      if ((await creerCompteEnseignant(db, directeur, resultat.agents[i])).ok) resultat.rapport.comptes++;
    }
  }
  return { ok: true, rapport: resultat.rapport, plan: resultat.plan, studentIds: resultat.studentIds };
}

/**
 * Compare les résultats recalculés par le site (MGA, décision, rang) avec ceux du fichier, pour les classes
 * entièrement importées (dans une classe qui avait déjà des élèves, les rangs changent légitimement).
 */
export async function comparerResultats(db: Db, schoolId: string, plan: Plan, studentIds: string[], attendus: Record<string, AttenduEleve>) {
  const classesVides = new Set(plan.ctx.classes.filter((c) => c._count.enrollments === 0).map((c) => c.id));
  const cibles = plan.nouveauxEleves.map((n, i) => ({ n, id: studentIds[i] })).filter((x) => classesVides.has(x.n.classroomId) && attendus[String(x.n.e.mat)]);
  if (!cibles.length) return undefined;
  const r = (await resultatsEcole(db, schoolId, [...new Set(cibles.map((x) => x.n.classroomId))])).flatMap((c) => c.eleves);
  const ecarts: NonNullable<RapportImport["comparaison"]>["ecarts"] = [];
  for (const x of cibles) {
    const a = attendus[String(x.n.e.mat)];
    const s = r.find((e) => e.studentId === x.id);
    if (!s) continue;
    const site = { mga: s.mga, decision: s.decision || null, rang: s.rang };
    const fichier = { mga: a.mga, decision: a.decision || null, rang: a.rang };
    if (site.mga !== fichier.mga || site.decision !== fichier.decision || site.rang !== fichier.rang) ecarts.push({ nom: String(x.n.e.nom), fichier, site });
  }
  return { comparees: cibles.length, identiques: cibles.length - ecarts.length, ecarts };
}
