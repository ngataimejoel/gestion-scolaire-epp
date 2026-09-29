/**
 * Les six états officiels du classeur, décrits sous forme de tableaux pour être affichés, imprimés
 * et exportés en Excel à l'identique :
 * RAPPORT DE RENTREE, RAPPORT MENSUEL, RAPPORT DE COMPOSITION, EFFECTIFS, SYNTHESE FIN D'ANNEE, ETAT PAR CLASSE.
 * Tout est calculé ; seules les observations sont rédigées par le directeur (ReportDraft).
 */
import type { Db } from "./db";
import type { ReportType } from "@/generated/prisma/client";
import { assiduitePersonnel, frequentationDuMois } from "./absences";
import { statistiquesEvaluation, syntheseParNiveau, totalSynthese } from "./bilans";
import { dateFr } from "./dates";
import { resultatsEcole } from "./resultats";
import { MOIS } from "./parametres/defauts";
import { anneesRevolues, estEnseignant, evaluationDuMois, type ParSexe } from "./regles";
import { formaterTelephone } from "./auth/telephone";
import { journaliser } from "./audit";

/** Cellule : texte, nombre, ou pourcentage (fraction 0..1, affichée « 54,2 % », exportée en % Excel). */
export type Cellule = string | number | null | { pct: number | null };
export interface EnteteCellule {
  t: string;
  c?: number; // colonnes fusionnées
  r?: number; // lignes fusionnées
}
export interface Tableau {
  titre?: string;
  entetes: EnteteCellule[][];
  lignes: { cellules: Cellule[]; total?: boolean; gauche?: number }[];
  note?: string;
}
export interface Redaction {
  cle: string;
  titre: string;
}
export interface Etat {
  code: CodeEtat;
  titre: string;
  sousTitre?: string;
  tableaux: Tableau[];
  redaction: Redaction[];
  type: ReportType | null;
  periode: string;
  paysage?: boolean;
}

export const ETATS = {
  rentree: "Rapport de rentrée",
  mensuel: "Rapport mensuel",
  composition: "Rapport de composition",
  effectifs: "Tableau des effectifs",
  synthese: "Synthèse de fin d'année",
  classe: "État par classe",
} as const;
export type CodeEtat = keyof typeof ETATS;

const gft = (x: ParSexe): Cellule[] => [x.M, x.F, x.M + x.F];
const enteteGft = (premiere: string, groupes: string[]): EnteteCellule[][] => [
  [{ t: premiere, r: 2 }, ...groupes.map((g) => ({ t: g, c: 3 }))],
  groupes.flatMap(() => [{ t: "G" }, { t: "F" }, { t: "T" }]),
];
const somme = (l: ParSexe[]): ParSexe => ({ M: l.reduce((s, x) => s + x.M, 0), F: l.reduce((s, x) => s + x.F, 0) });
const parSexe = <T>(l: T[], sexe: (x: T) => "M" | "F"): ParSexe => ({ M: l.filter((x) => sexe(x) === "M").length, F: l.filter((x) => sexe(x) === "F").length });

async function donneesClasses(db: Db, schoolId: string) {
  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId, isActive: true } });
  const classes = await db.classroom.findMany({
    where: { academicYearId: annee.id },
    include: {
      level: true,
      teachers: { include: { staff: true } },
      enrollments: { include: { student: { include: { guardians: true } } }, orderBy: { student: { schoolMatricule: "asc" } } },
    },
    orderBy: [{ level: { position: "asc" } }, { name: "asc" }],
  });
  return { annee, classes };
}

/* --------------------------------------------------------------- Rentrée */

async function rentree(db: Db, schoolId: string): Promise<Etat> {
  const { classes } = await donneesClasses(db, schoolId);
  const personnel = await db.staff.findMany({ where: { schoolId }, include: { classes: { include: { classroom: true } } }, orderBy: { lastName: "asc" } });
  const ens = personnel.filter((p) => estEnseignant(p.function));
  const cours = (p: (typeof personnel)[number]) => p.classes.filter((c) => classes.some((x) => x.id === c.classroomId)).map((c) => c.classroom.name).join(", ") || "-";
  const nr = classes.map((c) => parSexe(c.enrollments.filter((e) => !e.isRepeating), (e) => e.student.sex));
  const r = classes.map((c) => parSexe(c.enrollments.filter((e) => e.isRepeating), (e) => e.student.sex));
  return {
    code: "rentree",
    titre: "Rapport de rentrée",
    sousTitre: "Effectifs et personnel",
    type: "RENTREE",
    periode: "annee",
    paysage: true,
    tableaux: [
      {
        titre: "1. Liste des enseignants",
        entetes: [[{ t: "N°" }, { t: "Nom et prénoms" }, { t: "Matricule" }, { t: "Fonction" }, { t: "Genre" }, { t: "Corps et grade" }, { t: "Cours tenu" }, { t: "Contact" }]],
        lignes: ens.map((p, i) => ({
          cellules: [i + 1, `${p.lastName} ${p.firstNames}`, p.matricule, p.function, p.sex === "M" ? "H" : "F", p.grade ?? "", cours(p), p.phone ? formaterTelephone(p.phone) : ""],
          gauche: 2,
        })),
        note: `Personnel enseignant : ${ens.length} (${ens.filter((p) => p.sex === "M").length} H, ${ens.filter((p) => p.sex === "F").length} F)`,
      },
      {
        titre: "2. Tableau des effectifs élèves",
        entetes: enteteGft("Cours", [...classes.map((c) => c.name), "Total"]),
        lignes: [
          { cellules: ["Non redoublants", ...nr.flatMap(gft), ...gft(somme(nr))] },
          { cellules: ["Redoublants", ...r.flatMap(gft), ...gft(somme(r))] },
          { cellules: ["Total", ...nr.flatMap((x, i) => gft({ M: x.M + r[i].M, F: x.F + r[i].F })), ...gft(somme([...nr, ...r]))], total: true },
        ],
      },
    ],
    redaction: [{ cle: "observations", titre: "Observations" }],
  };
}

/* --------------------------------------------------------------- Mensuel */

async function mensuel(db: Db, schoolId: string, mois: number): Promise<Etat> {
  const [f, personnel, resultats] = await Promise.all([frequentationDuMois(db, schoolId, mois), assiduitePersonnel(db, schoolId, mois), resultatsEcole(db, schoolId)]);
  const t = f!;
  // Évaluation prévue dans le mois d'après le calendrier (comme le classeur)
  const evals = resultats
    .map((r) => {
      const k = evaluationDuMois(r.evaluations.map((e) => e.date), mois, t.annee);
      return k < 0 ? null : { r, k };
    })
    .filter((x) => x != null);
  const stats = evals.map(({ r, k }) => ({ r, k, s: statistiquesEvaluation([r], k + 1)[0] }));
  return {
    code: "mensuel",
    titre: "Rapport mensuel du directeur",
    sousTitre: `Mois : ${MOIS[mois]} ${t.annee} · ${String(t.jours).replace(".", ",")} jours de classe`,
    type: "MENSUEL",
    periode: `${t.annee}-${String(mois).padStart(2, "0")}`,
    paysage: true,
    tableaux: [
      {
        titre: "1. Effectifs et fréquentation",
        entetes: enteteGft("Cours", ["Effectifs", "Abandons", "Taux de fréquentation"]),
        lignes: [
          ...t.lignes.map((l) => ({ cellules: [l.nom, ...gft(l.effectif), ...gft(l.abandons), { pct: l.taux.M }, { pct: l.taux.F }, { pct: l.taux.T }] })),
          { cellules: ["Total", ...gft(t.total.effectif), ...gft(t.total.abandons), { pct: t.total.taux.M }, { pct: t.total.taux.F }, { pct: t.total.taux.T }], total: true },
        ],
        note: "Taux = 1 − jours d'absence du mois ÷ (effectif × jours de classe du mois).",
      },
      {
        titre: "2. Assiduité et ponctualité du personnel",
        entetes: [[{ t: "N°" }, { t: "Nom et prénoms" }, { t: "Cours tenu" }, { t: "Retard ou absence" }, { t: "Durée" }, { t: "Motif" }, { t: "Émargement" }]],
        lignes: personnel.map((p, i) => ({ cellules: [i + 1, p.nom, p.cours, p.evenements, p.duree, p.motifs, ""], gauche: 2 })),
      },
      {
        titre: "3. b. Résultats de l'évaluation du mois",
        entetes: enteteGft("Cours", ["Effectif", "Ont composé", "Ont obtenu la moyenne"]),
        lignes: stats.map(({ r, k, s }) => ({ cellules: [`${r.classe.nom} · ${r.evaluations[k].libelle}`, ...gft(s.inscrits), ...gft(s.presents), ...gft(s.admis)], gauche: 1 })),
        note: stats.length ? undefined : `Aucune évaluation n'est prévue en ${MOIS[mois].toLowerCase()} d'après le calendrier des Paramètres.`,
      },
    ],
    redaction: [
      { cle: "animations", titre: "3. a. Animations pédagogiques" },
      { cle: "extra", titre: "3. c. Activités extra-scolaires (coopérative, bibliothèque, cantine)" },
      { cle: "relations", titre: "4. Relations humaines" },
      { cle: "evenements", titre: "5. Événements ayant marqué la vie de l'école" },
      { cle: "difficultes", titre: "6. Difficultés rencontrées" },
      { cle: "satisfactions", titre: "7. Satisfactions" },
      { cle: "conclusion", titre: "8. Conclusion" },
    ],
  };
}

/* ----------------------------------------------------------- Composition */

async function composition(db: Db, schoolId: string, numero: number): Promise<Etat> {
  const resultats = await resultatsEcole(db, schoolId);
  const st = statistiquesEvaluation(resultats, numero);
  const tot = (k: "inscrits" | "presents" | "absents" | "admis") => somme(st.map((s) => s[k]));
  const ligne = (lib: string, k: "inscrits" | "presents" | "absents" | "admis") => ({ cellules: [lib, ...st.flatMap((s) => gft(s[k])), ...gft(tot(k))] });
  const taux = (a: ParSexe, p: ParSexe): Cellule[] => [
    { pct: p.M ? a.M / p.M : null },
    { pct: p.F ? a.F / p.F : null },
    { pct: p.M + p.F ? (a.M + a.F) / (p.M + p.F) : null },
  ];
  const ev = resultats.find((r) => r.classe.niveau !== "CM2")?.evaluations[numero - 1];
  const evCm2 = resultats.find((r) => r.classe.niveau === "CM2")?.evaluations[numero - 1];
  return {
    code: "composition",
    titre: "Rapport de composition",
    sousTitre: `Composition N° ${numero} · ${ev?.libelle ?? ""}${evCm2 && evCm2.libelle !== ev?.libelle ? ` (CM2 : ${evCm2.libelle})` : ""} · ${dateFr(ev?.date)}`,
    type: "COMPOSITION",
    periode: `compo-${numero}`,
    paysage: true,
    tableaux: [
      {
        entetes: enteteGft("", [...st.map((s) => s.classe.nom), "Total"]),
        lignes: [
          ligne("Inscrits", "inscrits"),
          ligne("Présents", "presents"),
          ligne("Absents", "absents"),
          ligne("Admis", "admis"),
          { cellules: ["Taux d'admis", ...st.flatMap((s) => taux(s.admis, s.presents)), ...taux(tot("admis"), tot("presents"))], total: true },
        ],
        note: "Présents : élèves ayant une moyenne et non marqués absents. Admis : moyenne de l'évaluation ≥ seuil de la classe.",
      },
      {
        titre: "Les trois meilleurs par classe",
        entetes: [[{ t: "Classe" }, { t: "Premier" }, { t: "Moy." }, { t: "Deuxième" }, { t: "Moy." }, { t: "Troisième" }, { t: "Moy." }]],
        lignes: st.map((s) => ({
          cellules: [s.classe.nom, ...[0, 1, 2].flatMap((i): Cellule[] => (s.meilleurs[i] ? [s.meilleurs[i].nom, s.meilleurs[i].moyenne] : ["—", null]))],
          gauche: 7,
        })),
      },
    ],
    redaction: [{ cle: "observations", titre: "Observations du directeur" }],
  };
}

/* ------------------------------------------------------------- Effectifs */

async function effectifs(db: Db, schoolId: string): Promise<Etat> {
  const { classes } = await donneesClasses(db, schoolId);
  type Ins = (typeof classes)[number]["enrollments"][number];
  const colonnes: [string, (e: Ins) => boolean][] = [
    ["Effectif inscrit", () => true],
    ["Ivoiriens", (e) => e.student.nationality === "IVOIRIENNE"],
    ["Étrangers", (e) => !!e.student.nationality && e.student.nationality !== "IVOIRIENNE"],
    ["Orphelins", (e) => e.student.isOrphan],
    ["Avec extrait", (e) => e.student.hasBirthCertificate],
    ["Sans extrait", (e) => !e.student.hasBirthCertificate],
    ["Redoublants", (e) => e.isRepeating],
    ["Abandons", (e) => e.status === "ABANDON"],
  ];
  const ligne = (lib: string, l: Ins[], total = false) => ({
    cellules: [lib, ...colonnes.flatMap(([, f]) => gft(parSexe(l.filter(f), (e) => e.student.sex)))],
    total,
  });
  const tous = classes.flatMap((c) => c.enrollments);
  return {
    code: "effectifs",
    titre: "Tableau des effectifs des élèves",
    type: null,
    periode: "annee",
    paysage: true,
    tableaux: [
      {
        entetes: enteteGft("Classe", colonnes.map(([t]) => t)),
        lignes: [...classes.map((c) => ligne(c.name, c.enrollments)), ligne("TOTAL", tous, true)],
        note: `Contrôle : total des effectifs = ${tous.length} = nombre d'élèves inscrits au registre cette année.`,
      },
    ],
    redaction: [],
  };
}

/* -------------------------------------------------------------- Synthèse */

async function synthese(db: Db, schoolId: string): Promise<Etat> {
  const [resultats, reglages] = await Promise.all([resultatsEcole(db, schoolId), db.schoolSettings.findUnique({ where: { schoolId } })]);
  const nouveaux = reglages?.expectedNewCp1 ?? 0;
  const l = syntheseParNiveau(resultats, nouveaux);
  const t = totalSynthese(l);
  const taux = (a: ParSexe, p: ParSexe): Cellule[] => [{ pct: p.M ? a.M / p.M : null }, { pct: p.F ? a.F / p.F : null }, { pct: p.M + p.F ? (a.M + a.F) / (p.M + p.F) : null }];
  const ligne = (lib: string, x: typeof t, seuil: string, total = false) => ({
    cellules: [lib, ...gft(x.inscrits), ...gft(x.presents), ...gft(x.abandons), seuil, ...gft(x.admis), ...taux(x.admis, x.presents), ...gft(x.redoublants), ...gft(x.probable)],
    total,
  });
  const g = ["Effectif inscrit", "Effectif présent", "Abandons"];
  const g2 = ["Admis", "Taux d'admission", "Redoublants", "Effectif probable année suivante"];
  return {
    code: "synthese",
    titre: "Tableau de synthèse de fin d'année",
    type: "SYNTHESE",
    periode: "annee",
    paysage: true,
    tableaux: [
      {
        entetes: [
          [{ t: "Cours", r: 2 }, ...g.map((x) => ({ t: x, c: 3 })), { t: "Seuil MGA", r: 2 }, ...g2.map((x) => ({ t: x, c: 3 }))],
          Array.from({ length: 7 }, () => [{ t: "G" }, { t: "F" }, { t: "T" }]).flat(),
        ],
        lignes: [...l.map((x) => ligne(x.niveau, x, `${String(x.seuil).replace(".", ",")}/${x.bareme}`)), ligne("TOTAL", t, "", true)],
        note: `Taux d'admission = admis ÷ présents. Effectif probable = redoublants du niveau + admis du niveau précédent ; CP1 = redoublants + ${nouveaux} nouveaux inscrits attendus, répartis à parts égales entre garçons et filles. Les admis du CM2 sont les sortants (entrée en 6e).`,
      },
    ],
    redaction: [{ cle: "observations", titre: "Observations" }],
  };
}

/* --------------------------------------------------------- État par classe */

async function parClasse(db: Db, schoolId: string, classroomId?: string): Promise<Etat> {
  const { annee, classes } = await donneesClasses(db, schoolId);
  const c = classes.find((x) => x.id === classroomId) ?? classes[0];
  const l = c?.enrollments ?? [];
  type Ins = (typeof l)[number];
  const cnt = (f: (e: Ins) => boolean) => gft(parSexe(l.filter(f), (e) => e.student.sex));
  const parent = (e: Ins, r: "PERE" | "MERE") => e.student.guardians.find((g) => g.relation === r);
  const tel = (p?: { phone: string | null }) => (p?.phone ? formaterTelephone(p.phone) : "");
  const statut = { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" } as const;
  return {
    code: "classe",
    titre: `État de la classe de ${c?.name ?? "—"}`,
    sousTitre: `Enseignant : ${c?.teachers.map((t) => `${t.staff.lastName} ${t.staff.firstNames}`).join(", ") || "—"}`,
    type: null,
    periode: c?.id ?? "",
    paysage: true,
    tableaux: [
      {
        entetes: [["N°", "Matricule", "Nom et prénoms", "Sexe", "Âge", "Nationalité", "Extrait", "Orphelin", "Père", "Tél. père", "Mère", "Tél. mère", "Red.", "Statut"].map((t) => ({ t }))],
        lignes: l.map((e, i) => ({
          cellules: [
            i + 1, e.student.schoolMatricule, e.student.fullName, e.student.sex, anneesRevolues(e.student.birthDate, annee.ageReferenceDate),
            e.student.nationality ?? "", e.student.hasBirthCertificate ? "OUI" : "NON", e.student.isOrphan ? "OUI" : "NON",
            parent(e, "PERE")?.fullName ?? "", tel(parent(e, "PERE")), parent(e, "MERE")?.fullName ?? "", tel(parent(e, "MERE")),
            e.isRepeating ? "OUI" : "NON", statut[e.status],
          ],
          gauche: 3,
        })),
      },
      {
        titre: "Récapitulatif",
        entetes: [[{ t: "" }, { t: "Garçons" }, { t: "Filles" }, { t: "Total" }]],
        lignes: [
          { cellules: ["Effectif inscrit", ...cnt(() => true)] },
          { cellules: ["Présents (fin d'année)", ...cnt((e) => e.status === "PRESENT")] },
          { cellules: ["Abandons", ...cnt((e) => e.status === "ABANDON")] },
          { cellules: ["Ivoiriens", ...cnt((e) => e.student.nationality === "IVOIRIENNE")] },
          { cellules: ["Étrangers", ...cnt((e) => !!e.student.nationality && e.student.nationality !== "IVOIRIENNE")] },
          { cellules: ["Orphelins", ...cnt((e) => e.student.isOrphan)] },
          { cellules: ["dont de père", ...cnt((e) => e.student.isOrphan && e.student.orphanOf === "PERE")] },
          { cellules: ["dont de mère", ...cnt((e) => e.student.isOrphan && e.student.orphanOf === "MERE")] },
          { cellules: ["dont de père et mère", ...cnt((e) => e.student.isOrphan && e.student.orphanOf === "PERE ET MERE")] },
          { cellules: ["Avec extrait", ...cnt((e) => e.student.hasBirthCertificate)] },
          { cellules: ["Sans extrait", ...cnt((e) => !e.student.hasBirthCertificate)] },
          { cellules: ["Redoublants", ...cnt((e) => e.isRepeating)] },
        ],
      },
    ],
    redaction: [],
  };
}

export interface ParametresEtat {
  mois?: number;
  numero?: number;
  classroomId?: string;
}

/** Construit un état ; `schoolId` borne toutes les lectures. */
export async function construireEtat(db: Db, schoolId: string, code: CodeEtat, p: ParametresEtat = {}): Promise<Etat> {
  switch (code) {
    case "rentree":
      return rentree(db, schoolId);
    case "mensuel":
      return mensuel(db, schoolId, p.mois ?? 10);
    case "composition":
      return composition(db, schoolId, p.numero ?? 1);
    case "effectifs":
      return effectifs(db, schoolId);
    case "synthese":
      return synthese(db, schoolId);
    case "classe":
      return parClasse(db, schoolId, p.classroomId);
  }
}

/** Textes rédigés d'un état (observations, rubriques du rapport mensuel). */
export async function lireRedaction(db: Db, schoolId: string, etat: Etat): Promise<Record<string, string>> {
  if (!etat.type || !etat.redaction.length) return {};
  const annee = await db.academicYear.findFirst({ where: { schoolId, isActive: true } });
  if (!annee) return {};
  const r = await db.reportDraft.findUnique({ where: { academicYearId_type_period: { academicYearId: annee.id, type: etat.type, period: etat.periode } } });
  return (r?.content as Record<string, string>) ?? {};
}

/** Enregistre les textes rédigés par le directeur pour un état (jamais écrasés sans trace : journal avant/après). */
export async function enregistrerRedaction(
  db: Db,
  u: { id: string; schoolId: string | null; role: string },
  code: CodeEtat,
  p: ParametresEtat,
  textes: Record<string, string>,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur rédige les rapports." };
  const etat = await construireEtat(db, u.schoolId, code, p);
  if (!etat.type) return { ok: false, erreur: "Cet état ne comporte pas de texte à rédiger." };
  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId: u.schoolId, isActive: true } });
  const content = Object.fromEntries(etat.redaction.map((r) => [r.cle, String(textes[r.cle] ?? "").slice(0, 4000)]));
  const cle = { academicYearId_type_period: { academicYearId: annee.id, type: etat.type, period: etat.periode } };
  const avant = await db.reportDraft.findUnique({ where: cle });
  await db.reportDraft.upsert({
    where: cle,
    create: { schoolId: u.schoolId, academicYearId: annee.id, type: etat.type, period: etat.periode, content, updatedById: u.id },
    update: { content, updatedById: u.id },
  });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "redaction", entity: "ReportDraft", entityId: `${etat.type}:${etat.periode}`, before: (avant?.content as object) ?? undefined, after: content });
  return { ok: true };
}
