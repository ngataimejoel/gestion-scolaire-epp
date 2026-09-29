/**
 * Export de l'école au format du classeur (mêmes feuilles, mêmes intitulés de colonnes) : PARAMETRES, REGISTRE ELEVES,
 * PERSONNEL, NOTES (4 feuilles), RESULTATS, ABSENCES. Le fichier sert de sauvegarde lisible dans Excel et peut être
 * réimporté dans le site (import du classeur). Valeurs seulement : ni formule ni macro.
 */
import ExcelJS from "exceljs";
import type { Db } from "../db";
import type { GradeSheet } from "@/generated/prisma/client";
import { resultatsEcole } from "../resultats";
import { anneesRevolues } from "../regles";
import { MOIS } from "../parametres/defauts";

export type ContenuExport = "complet" | "eleves" | "personnel" | "resultats";

const FEUILLES_NOTES: { sheet: GradeSheet; nom: string; cm2: boolean }[] = [
  { sheet: "CP", nom: "NOTES CP", cm2: false },
  { sheet: "CE1", nom: "NOTES CE1", cm2: false },
  { sheet: "CE2_CM1", nom: "NOTES CE2-CM1", cm2: false },
  { sheet: "CM2", nom: "NOTES CM2", cm2: true },
];
const LIBELLES_EVAL = ["1re COMPOSITION", "2e COMPOSITION", "3e COMPOSITION", "COMPOSITION DE PASSAGE"];
const LIBELLES_EVAL_CM2 = ["1re COMPOSITION", "2e COMPOSITION", "1er EXAMEN BLANC", "2e EXAMEN BLANC"];

const jour = (d: Date | null | undefined) => (d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null);
const oui = (b: boolean) => (b ? "OUI" : "NON");
const LIGNE_ENTETE = 9;

function entete(ws: ExcelJS.Worksheet, titre: string, ecole: string, annee: string, colonnes: string[], largeurs?: number[]) {
  ws.getCell("A1").value = ecole;
  ws.getCell("A2").value = `ANNEE SCOLAIRE : ${annee}`;
  ws.getCell("A6").value = titre;
  ws.getCell("A6").font = { bold: true, size: 13 };
  const r = ws.getRow(LIGNE_ENTETE);
  colonnes.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.value = c;
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFEA" } };
    ws.getColumn(i + 1).width = largeurs?.[i] ?? Math.min(28, Math.max(8, c.length + 2));
  });
  ws.views = [{ state: "frozen", ySplit: LIGNE_ENTETE }];
}

function lignes(ws: ExcelJS.Worksheet, donnees: (string | number | Date | null)[][]) {
  donnees.forEach((l, i) => {
    const r = ws.getRow(LIGNE_ENTETE + 1 + i);
    l.forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v ?? null;
      if (v instanceof Date) c.numFmt = "dd/mm/yyyy";
    });
  });
}

export async function exporterClasseur(db: Db, schoolId: string, contenu: ContenuExport = "complet") {
  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId, isActive: true }, include: { assessments: true, months: true } });
  const [school, niveaux, matieres, classes, eleves, personnel, presences, notes, evenements, resultats] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId }, include: { settings: true, choiceItems: { orderBy: { position: "asc" } } } }),
    db.level.findMany({ where: { schoolId }, orderBy: { position: "asc" } }),
    db.subject.findMany({ where: { schoolId }, orderBy: [{ assessmentNumber: "asc" }, { position: "asc" }] }),
    db.classroom.findMany({ where: { academicYearId: annee.id }, include: { level: true }, orderBy: [{ level: { position: "asc" } }, { name: "asc" }] }),
    db.enrollment.findMany({
      where: { academicYearId: annee.id, classroom: { schoolId } },
      include: { student: { include: { guardians: true } }, classroom: { include: { level: true } } },
    }),
    db.staff.findMany({ where: { schoolId }, include: { classes: { include: { classroom: true } } }, orderBy: [{ lastName: "asc" }, { firstNames: "asc" }] }),
    db.assessmentPresence.findMany({ where: { enrollment: { academicYearId: annee.id, classroom: { schoolId } } } }),
    db.grade.findMany({ where: { enrollment: { academicYearId: annee.id, classroom: { schoolId } } } }),
    db.attendanceEvent.findMany({ where: { schoolId, academicYearId: annee.id }, include: { enrollment: { include: { student: true, classroom: true } }, staff: { include: { classes: { include: { classroom: true } } } } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    resultatsEcole(db, schoolId),
  ]);
  const ordreClasse = new Map(classes.map((c, i) => [c.id, i]));
  const inscrits = [...eleves].sort((a, b) => ordreClasse.get(a.classroomId)! - ordreClasse.get(b.classroomId)! || a.student.schoolMatricule.localeCompare(b.student.schoolMatricule));
  // Personnel dans l'ordre du classeur : directeur, puis les maîtres dans l'ordre des classes, puis les autres agents.
  const rangAgent = (p: (typeof personnel)[number]) =>
    p.function === "DIRECTEUR" ? -1 : Math.min(...p.classes.map((c) => ordreClasse.get(c.classroomId) ?? 1e6), 1e6);
  personnel.sort((a, b) => rangAgent(a) - rangAgent(b));
  const ecole = `${school.name}  -  Code : ${school.code}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GESTION SCOLAIRE EPP";
  wb.created = new Date();
  const ref = annee.ageReferenceDate;

  if (contenu === "complet") {
    const ws = wb.addWorksheet("PARAMETRES");
    ws.getColumn(2).width = 44;
    ws.getColumn(3).width = 44;
    for (const c of [4, 5, 6, 7, 8, 9, 10]) ws.getColumn(c).width = 20;
    ws.getCell("B1").value = "PARAMETRES DE L'ETABLISSEMENT";
    ws.getCell("B1").font = { bold: true };
    const s = school.settings;
    const identite: [string, string | number | Date | null][] = [
      ["Ministère", school.ministry],
      ["Direction régionale (DREN)", school.regionalDirectorate],
      ["Inspection (IEPP)", school.inspectorate],
      ["Nom de l'établissement", school.name],
      ["Code établissement", school.code],
      ["Année scolaire", annee.label],
      ["Localité", school.locality],
      ["Nom du directeur", s?.directorName ?? null],
      ["Date d'édition des états", jour(s?.reportDate)],
      ["Date de référence pour le calcul de l'âge", jour(ref)],
      ["Nouveaux inscrits CP1 attendus", s?.expectedNewCp1 ?? 0],
      ["Secteur pédagogique", school.sector],
    ];
    identite.forEach(([l, v], i) => {
      ws.getCell(4 + i, 2).value = l;
      const c = ws.getCell(4 + i, 3);
      c.value = v;
      if (v instanceof Date) c.numFmt = "dd/mm/yyyy";
    });
    ws.getCell("B17").value = "SEUILS D'ADMISSION PAR CLASSE";
    ws.getCell("C17").value = "Moy. compo de passage (seuil)";
    ws.getCell("D17").value = "Barème (/10 ou /20)";
    niveaux.forEach((n, i) => {
      ws.getCell(18 + i, 2).value = n.code;
      ws.getCell(18 + i, 3).value = Number(n.passMark);
      ws.getCell(18 + i, 4).value = n.scale;
    });
    ws.getCell("B27").value = "CALENDRIER DES EVALUATIONS";
    ws.getCell("B28").value = "Evaluation";
    ws.getCell("C28").value = "Date – CP1 à CM1";
    ws.getCell("D28").value = "Date – CM2";
    for (let k = 1; k <= 4; k++) {
      const st = annee.assessments.find((a) => a.number === k && a.track === "STANDARD");
      const cm = annee.assessments.find((a) => a.number === k && a.track === "CM2");
      ws.getCell(28 + k, 2).value = `${k} – ${st?.label ?? LIBELLES_EVAL[k - 1]}${cm && cm.label !== st?.label ? ` / ${cm.label} CM2` : ""}`;
      for (const [col, a] of [[3, st], [4, cm]] as const) {
        const c = ws.getCell(28 + k, col);
        c.value = jour(a?.date);
        c.numFmt = "dd/mm/yyyy";
      }
    }
    ws.getCell("B36").value = "JOURS DE CLASSE PAR MOIS";
    ws.getCell("B37").value = "Mois";
    ws.getCell("C37").value = "N° du mois";
    ws.getCell("D37").value = "Jours de classe";
    const mois = [...annee.months].sort((a, b) => ((a.month + 3) % 12) - ((b.month + 3) % 12));
    mois.forEach((m, i) => {
      ws.getCell(38 + i, 2).value = MOIS[m.month] || String(m.month);
      ws.getCell(38 + i, 3).value = m.month;
      ws.getCell(38 + i, 4).value = Number(m.schoolDays);
    });
    // Listes de choix (colonnes E à J, comme le classeur)
    const liste = (col: number, titre: string, depart: number, valeurs: string[]) => {
      ws.getCell(depart - 1, col).value = titre;
      valeurs.forEach((v, i) => (ws.getCell(depart + i, col).value = v));
    };
    const choix = (l: string) => school.choiceItems.filter((c) => c.list === l).map((c) => c.value);
    ws.getCell("E1").value = "LISTES DE CHOIX";
    liste(5, "Classe", 3, classes.map((c) => c.name));
    liste(6, "Sexe", 3, ["M", "F"]);
    liste(7, "Nationalité", 3, choix("NATIONALITY"));
    liste(8, "Oui/Non", 3, ["OUI", "NON"]);
    liste(9, "Orphelin de", 3, ["-", ...choix("ORPHAN_OF").filter((v) => v !== "-")]);
    liste(10, "Statut", 3, ["PRESENT", "ABANDON", "TRANSFERE"]);
    const debutFonctions = Math.max(13, 4 + classes.length + 1);
    liste(5, "Fonctions (personnel)", debutFonctions + 1, choix("STAFF_FUNCTION"));
  }

  if (contenu === "complet" || contenu === "eleves") {
    const ws = wb.addWorksheet("REGISTRE ELEVES");
    entete(ws, "REGISTRE GENERAL DES ELEVES", ecole, annee.label, [
      "N°", "Matricule Ecole", "Matricule DESPS / Identifiant", "Nom et Prénoms", "Sexe", "Classe", "Date de naissance", "Age", "Nationalité", "Localité",
      "Sous-préfecture", "Extrait ?", "Acte N°", "Du", "Centre d'état civil", "Orphelin", "Orphelin de", "Nom et Prénoms du père", "Profession père",
      "Résidence père", "Tél. père", "Nom et Prénoms de la mère", "Profession mère", "Résidence mère", "Tél. mère", "Nom et Prénoms du tuteur(trice)",
      "Profession tuteur", "Résidence tuteur", "Tél. tuteur", "Redoublant", "Statut", "Observations",
    ], [6, 14, 16, 30]);
    lignes(
      ws,
      inscrits.map((i, n) => {
        const e = i.student;
        const g = (r: string) => e.guardians.find((x) => x.relation === r);
        const parent = (r: string) => {
          const x = g(r);
          return [x?.fullName ?? null, x?.profession ?? null, x?.residence ?? null, x?.phone ? x.phone.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : null];
        };
        return [
          n + 1, e.schoolMatricule, e.despsId, e.fullName, e.sex, i.classroom.name, jour(e.birthDate), anneesRevolues(e.birthDate, ref), e.nationality, e.locality,
          e.subPrefecture, oui(e.hasBirthCertificate), e.certificateNumber, jour(e.certificateDate), e.civilRegistryCenter, oui(e.isOrphan), e.isOrphan ? e.orphanOf : "-",
          ...parent("PERE"), ...parent("MERE"), ...parent("TUTEUR"), oui(i.isRepeating), i.status, i.notes,
        ];
      }),
    );
  }

  if (contenu === "complet" || contenu === "personnel") {
    const ws = wb.addWorksheet("PERSONNEL");
    entete(ws, "LISTE DU PERSONNEL", ecole, annee.label, [
      "N°", "Matricule", "Nom et Prénoms", "Sexe", "Date de naissance", "Age", "Fonction", "Grade / Emploi", "Classe tenue", "Diplôme le plus élevé",
      "Date de prise de service", "Ancienneté (ans)", "Date d'arrivée dans l'école", "Tél.", "Situation matrimoniale", "Observations",
    ], [6, 12, 30]);
    const edition = school.settings?.reportDate ?? new Date();
    lignes(
      ws,
      personnel.map((p, n) => [
        n + 1, p.matricule, `${p.lastName} ${p.firstNames}`.trim(), p.sex, jour(p.birthDate), anneesRevolues(p.birthDate, ref), p.function, p.grade ?? "-",
        p.classes.filter((c) => c.classroom.academicYearId === annee.id).map((c) => c.classroom.name).join(", ") || "-", p.diploma ?? "-", jour(p.serviceStartDate),
        anneesRevolues(p.serviceStartDate, edition), jour(p.arrivalDate), p.phone ? p.phone.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : null, p.maritalStatus, p.notes,
      ]),
    );
  }

  if (contenu === "complet") {
    for (const f of FEUILLES_NOTES) {
      const cl = classes.filter((c) => c.level.gradeSheet === f.sheet);
      if (!cl.length) continue;
      const ws = wb.addWorksheet(f.nom);
      const colonnes = ["N°", "Matricule Ecole", "Nom et Prénoms", "Sexe", "Classe", "Statut"];
      const blocs: { numero: number; debut: number; matieres: typeof matieres }[] = [];
      for (let k = 1; k <= 4; k++) {
        const m = matieres.filter((x) => x.gradeSheet === f.sheet && x.assessmentNumber === k);
        blocs.push({ numero: k, debut: colonnes.length + 1, matieres: m });
        colonnes.push("Présent ?", ...m.map((x) => (f.sheet === "CP" ? x.name : `${x.name}\n(/${Number(x.maxScore)})`)));
        if (f.sheet !== "CP") colonnes.push(`TOTAL\n(/${m.reduce((s, x) => s + Number(x.maxScore), 0)})`);
        colonnes.push(f.sheet === "CP" ? "MOYENNE" : `MOYENNE (/${cl[0].level.scale})`);
      }
      entete(ws, `FEUILLE DE NOTES – ${f.nom.replace("NOTES ", "")}`, ecole, annee.label, colonnes, [6, 14, 30]);
      for (const b of blocs) {
        ws.getCell(LIGNE_ENTETE - 2, b.debut).value = (f.cm2 ? LIBELLES_EVAL_CM2 : LIBELLES_EVAL)[b.numero - 1];
        ws.getCell(LIGNE_ENTETE - 1, b.debut).value = "OUI/NON";
        b.matieres.forEach((m, j) => (ws.getCell(LIGNE_ENTETE - 1, b.debut + 1 + j).value = f.sheet === "CP" ? Number(m.coefficient) : Number(m.maxScore)));
      }
      const res = new Map(resultats.flatMap((r) => r.eleves).map((e) => [e.enrollmentId, e]));
      lignes(
        ws,
        inscrits
          .filter((i) => i.classroom.level.gradeSheet === f.sheet)
          .map((i, n) => {
            const l: (string | number | null)[] = [n + 1, i.student.schoolMatricule, i.student.fullName, i.student.sex, i.classroom.name, i.status];
            for (const b of blocs) {
              const ev = annee.assessments.find((a) => a.number === b.numero && a.track === (f.cm2 ? "CM2" : "STANDARD"));
              const pr = presences.find((p) => p.enrollmentId === i.id && p.assessmentId === ev?.id);
              const ns = b.matieres.map((m) => {
                const g = notes.find((x) => x.enrollmentId === i.id && x.assessmentId === ev?.id && x.subjectId === m.id);
                return g ? Number(g.score) : null;
              });
              l.push(pr ? oui(pr.present) : null, ...ns);
              if (f.sheet !== "CP") l.push(ns.some((x) => x != null) ? ns.reduce<number>((s, x) => s + (x ?? 0), 0) : null);
              l.push(res.get(i.id)?.moyennes[b.numero - 1] ?? null);
            }
            return l;
          }),
      );
    }
  }

  if (contenu === "complet" || contenu === "resultats") {
    for (const cm2 of [false, true]) {
      const rs = resultats.filter((r) => (r.classe.niveau === "CM2") === cm2);
      if (!rs.length) continue;
      const ws = wb.addWorksheet(cm2 ? "RESULTATS CM2" : "RESULTATS");
      const cols = cm2
        ? ["N°", "Matricule Ecole", "Nom et Prénoms", "Sexe", "Statut", "Moy. 1re compo. (/20)", "Moy. 2e compo. (/20)", "Moy. 1er examen blanc (/20)", "Moy. 2e examen blanc (/20)", "MGA (/20)", "Barème", "Seuil", "Décision", "Rang (MGA)", "Observation"]
        : ["N°", "Matricule Ecole", "Nom et Prénoms", "Sexe", "Classe", "Statut", "Moy. 1re compo.", "Moy. 2e compo.", "Moy. 3e compo.", "Moyenne des 3 compos.", "Moy. compo de passage", "MGA", "Barème", "Seuil", "Décision", "Rang (MGA)", "Observation"];
      entete(ws, cm2 ? "RESULTATS DES COMPOSITIONS CM2" : "RESULTATS DES COMPOSITIONS", ecole, annee.label, cols, [6, 14, 30]);
      let n = 0;
      lignes(
        ws,
        rs.flatMap((r) =>
          r.eleves.map((e) =>
            cm2
              ? [++n, e.matricule, e.nom, e.sexe, e.statut, ...e.moyennes, e.mga, r.classe.bareme, r.classe.seuil, e.decision || null, e.rang, e.observation || null]
              : [++n, e.matricule, e.nom, e.sexe, r.classe.nom, e.statut, e.moyennes[0], e.moyennes[1], e.moyennes[2], e.moyenne3Compos, e.moyennes[3], e.mga, r.classe.bareme, r.classe.seuil, e.decision || null, e.rang, e.observation || null],
          ),
        ),
      );
    }
  }

  if (contenu === "complet") {
    const ae = wb.addWorksheet("ABSENCES ELEVES");
    entete(ae, "CONTROLE DES RETARDS ET ABSENCES DES ELEVES", ecole, annee.label, ["N°", "Date", "Matricule Ecole", "Nom et Prénoms", "Classe", "Sexe", "Nature", "Jours d'absence", "Retard (minutes)", "Motif", "Justifié ?", "Observations"], [6, 12, 14, 30]);
    lignes(
      ae,
      evenements
        .filter((a) => a.enrollment)
        .map((a, n) => [n + 1, jour(a.date), a.enrollment!.student.schoolMatricule, a.enrollment!.student.fullName, a.enrollment!.classroom.name, a.enrollment!.student.sex, a.nature, a.days != null ? Number(a.days) : null, a.minutes, a.reason, oui(a.justified), a.notes]),
    );
    const ap = wb.addWorksheet("ABSENCES PERSONNEL");
    entete(ap, "CONTROLE DES RETARDS ET ABSENCES DU PERSONNEL", ecole, annee.label, ["N°", "Date", "Matricule", "Nom et Prénoms", "Cours tenu", "Sexe", "Nature", "Jours d'absence", "Retard (minutes)", "Motif", "Justifié ?", "Observations"], [6, 12, 12, 30]);
    lignes(
      ap,
      evenements
        .filter((a) => a.staff)
        .map((a, n) => [n + 1, jour(a.date), a.staff!.matricule, `${a.staff!.lastName} ${a.staff!.firstNames}`.trim(), a.staff!.classes.map((c) => c.classroom.name).join(", ") || "-", a.staff!.sex, a.nature, a.days != null ? Number(a.days) : null, a.minutes, a.reason, oui(a.justified), a.notes]),
    );
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
