/** Tests d'intégration des paramètres de l'établissement (étape 5). */
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { confirmerInscription, demanderInscription } from "../src/lib/auth/service";
import { dernierSmsSimule } from "../src/lib/sms";
import {
  ajouterClasse,
  lireParametres,
  majAnnee,
  majCalendrier,
  majIdentite,
  majJours,
  majListe,
  majMatieres,
  majSeuils,
  supprimerClasse,
} from "../src/lib/parametres/service";
import { anneeDebutCourante } from "../src/lib/parametres/defauts";
import donnees from "./fixtures/donnees-classeur.json";

const code = (tel: string) => /(\d{6})\./.exec(dernierSmsSimule(tel)?.message ?? "")?.[1] ?? "";

describe.skipIf(!baseDisponible)("Paramètres de l'établissement", () => {
  const db = baseDeTest();
  beforeEach(() => viderBase(db));

  async function ecole(tel = "0707123456", codeEcole = "EPP-GAG-0123") {
    await demanderInscription(db, { fullName: "KOUAME Ernest", phone: tel, schoolName: "EPP LIGUIYO", schoolCode: codeEcole, password: "Ecole2026", confirm: "Ecole2026" });
    const r = await confirmerInscription(db, tel, code(tel));
    if (!r.ok) throw new Error(r.erreur);
    return r.user;
  }

  it("une nouvelle école reçoit les paramètres du classeur", async () => {
    const d = await ecole();
    const p = await lireParametres(db, d.schoolId!);
    const a = anneeDebutCourante();
    expect(p.annee?.label).toBe(`${a}-${a + 1}`);
    expect(p.annee?.ageReferenceDate.toISOString().slice(0, 10)).toBe(`${a}-12-31`);
    expect(p.school.settings?.reportDate?.toISOString().slice(0, 10)).toBe(`${a + 1}-06-30`);
    // Seuils : CP1-CM1 5/10, CM2 10/20
    expect(p.niveaux.map((n) => [n.code, Number(n.passMark), n.scale])).toEqual(
      Object.entries(donnees.PAR.seuils).map(([c, [s, b]]) => [c, s, b]),
    );
    // Matières : mêmes noms et barèmes que le classeur, pour les 4 évaluations de chaque feuille
    const cle = { CP: "CP", CE1: "CE1", CE2_CM1: "CEM", CM2: "CM2" } as const;
    for (const [sheet, k] of Object.entries(cle)) {
      for (let e = 0; e < 4; e++) {
        const m = p.matieres.filter((x) => x.gradeSheet === sheet && x.assessmentNumber === e + 1);
        const attendu = (donnees.CFG as unknown as Record<string, [string, number][][]>)[k][e];
        expect(m.map((x) => [x.name, sheet === "CP" ? Number(x.coefficient) : Number(x.maxScore)])).toEqual(attendu);
      }
    }
    // Jours de classe et calendrier
    expect(p.annee!.months.map((m) => [m.month, Number(m.schoolDays)]).sort((x, y) => ((x[0] + 3) % 12) - ((y[0] + 3) % 12))).toEqual(
      (donnees.PAR.jours as [string, number, number][]).map(([, m, j]) => [m, j]),
    );
    const cal = p.annee!.assessments;
    expect(cal).toHaveLength(8);
    expect(cal.find((x) => x.track === "CM2" && x.number === 3)?.date?.toISOString().slice(5, 10)).toBe("03-04");
    expect(cal.find((x) => x.track === "STANDARD" && x.number === 4)?.label).toBe("Composition de passage");
    // Une classe par niveau, listes de choix
    expect(p.annee!.classrooms.map((c) => c.name)).toEqual(["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]);
    expect(p.listes.filter((l) => l.list === "NATIONALITY").map((l) => l.value)).toEqual(donnees.PAR.nationalites);
    expect(p.listes.filter((l) => l.list === "STAFF_FUNCTION").map((l) => l.value)).toEqual(donnees.PAR.fonctions);
  });

  it("identité : modification journalisée, code unique entre écoles", async () => {
    const d = await ecole();
    await ecole("0101010101", "EPP-AUTRE");
    const base = { name: "EPP LIGUIYO 1", code: "epp-gag-0123", ministry: "MINISTERE", regionalDirectorate: "DREN GAGNOA", inspectorate: "IEPP GAGNOA 2", sector: "", locality: "LIGUIYO", directorName: "M. KOUAME" };
    expect(await majIdentite(db, d, base)).toEqual({ ok: true });
    const s = await db.school.findUniqueOrThrow({ where: { id: d.schoolId! }, include: { settings: true } });
    expect(s).toMatchObject({ name: "EPP LIGUIYO 1", code: "EPP-GAG-0123", sector: null, settings: { directorName: "M. KOUAME" } });
    expect(await majIdentite(db, d, { ...base, code: "EPP-AUTRE" })).toMatchObject({ ok: false, champ: "code" });
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: "School", action: "modification" } });
    expect(log.before).toMatchObject({ name: "EPP LIGUIYO" });
    expect(log.after).toMatchObject({ name: "EPP LIGUIYO 1" });
  });

  it("un enseignant ne peut pas modifier les paramètres", async () => {
    const d = await ecole();
    expect(await majSeuils(db, { ...d, role: "TEACHER" }, {})).toMatchObject({ ok: false });
  });

  it("année : dates, nouveaux CP1 et réglages", async () => {
    const d = await ecole();
    expect(await majAnnee(db, d, { ageReferenceDate: "2026-12-31", reportDate: "2027-06-30", expectedNewCp1: "24", neutralizeJustifiedAbsence: false, teacherLoginOtp: true })).toEqual({ ok: true });
    expect(await db.schoolSettings.findUniqueOrThrow({ where: { schoolId: d.schoolId! } })).toMatchObject({ expectedNewCp1: 24, teacherLoginOtp: true });
    expect(await majAnnee(db, d, { ageReferenceDate: "31/12/2026", reportDate: "2027-06-30", expectedNewCp1: "24", neutralizeJustifiedAbsence: false, teacherLoginOtp: true })).toMatchObject({ ok: false });
  });

  it("seuils : barème 10 ou 20, seuil entre 0 et le barème", async () => {
    const d = await ecole();
    const [cp1] = await db.level.findMany({ where: { schoolId: d.schoolId! }, orderBy: { position: "asc" } });
    expect(await majSeuils(db, d, { [cp1.id]: { passMark: "5,5", scale: "10" } })).toEqual({ ok: true });
    expect(Number((await db.level.findUniqueOrThrow({ where: { id: cp1.id } })).passMark)).toBe(5.5);
    expect(await majSeuils(db, d, { [cp1.id]: { passMark: "12", scale: "10" } })).toMatchObject({ ok: false });
    expect(await majSeuils(db, d, { [cp1.id]: { passMark: "5", scale: "15" } })).toMatchObject({ ok: false });
  });

  it("calendrier : dates dans l'année scolaire uniquement", async () => {
    const d = await ecole();
    const a = anneeDebutCourante();
    const ev = await db.assessment.findFirstOrThrow({ where: { schoolId: d.schoolId!, number: 1, track: "STANDARD" } });
    expect(await majCalendrier(db, d, { [ev.id]: `${a}-12-10` })).toEqual({ ok: true });
    expect(await majCalendrier(db, d, { [ev.id]: `${a + 2}-01-10` })).toMatchObject({ ok: false });
    expect(await majCalendrier(db, d, { [ev.id]: "" })).toEqual({ ok: true });
    expect((await db.assessment.findUniqueOrThrow({ where: { id: ev.id } })).date).toBeNull();
  });

  it("jours de classe : 0 à 31, demi-journées acceptées", async () => {
    const d = await ecole();
    expect(await majJours(db, d, { "10": "21,5" })).toEqual({ ok: true });
    expect(await majJours(db, d, { "10": "40" })).toMatchObject({ ok: false });
    expect(await majJours(db, d, { "10": "21.3" })).toMatchObject({ ok: false });
  });

  it("matières : coefficient CP, barème non inférieur à une note déjà saisie", async () => {
    const d = await ecole();
    const cp = await db.subject.findFirstOrThrow({ where: { schoolId: d.schoolId!, gradeSheet: "CP", name: "DESSIN", assessmentNumber: 1 } });
    expect(await majMatieres(db, d, { [cp.id]: "0" })).toEqual({ ok: true });
    const dictee = await db.subject.findFirstOrThrow({ where: { schoolId: d.schoolId!, gradeSheet: "CE1", name: "DICTEE", assessmentNumber: 1 } });
    // Une note de 9/10 existe déjà : le barème ne peut pas passer à 8.
    const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId: d.schoolId! } });
    const classe = await db.classroom.findFirstOrThrow({ where: { schoolId: d.schoolId!, name: "CE1" } });
    const eleve = await db.student.create({ data: { schoolId: d.schoolId!, schoolMatricule: "CE1-001-26", fullName: "X", sex: "M" } });
    const ins = await db.enrollment.create({ data: { studentId: eleve.id, academicYearId: annee.id, classroomId: classe.id } });
    const ev = await db.assessment.findFirstOrThrow({ where: { academicYearId: annee.id, number: 1, track: "STANDARD" } });
    await db.grade.create({ data: { assessmentId: ev.id, enrollmentId: ins.id, subjectId: dictee.id, score: 9 } });
    expect(await majMatieres(db, d, { [dictee.id]: "8" })).toMatchObject({ ok: false, erreur: expect.stringContaining("9") });
    expect(await majMatieres(db, d, { [dictee.id]: "20" })).toEqual({ ok: true });
  });

  it("listes de choix : IVOIRIENNE obligatoire, doublons retirés", async () => {
    const d = await ecole();
    expect(await majListe(db, d, "NATIONALITY", "BURKINABE\nMALIENNE")).toMatchObject({ ok: false });
    expect(await majListe(db, d, "NATIONALITY", "IVOIRIENNE\nBURKINABE\nBURKINABE\n\nSENEGALAISE")).toEqual({ ok: true });
    expect((await db.choiceItem.findMany({ where: { schoolId: d.schoolId!, list: "NATIONALITY" }, orderBy: { position: "asc" } })).map((x) => x.value)).toEqual([
      "IVOIRIENNE", "BURKINABE", "SENEGALAISE",
    ]);
  });

  it("classes : plusieurs divisions par niveau, suppression d'une classe vide uniquement", async () => {
    const d = await ecole();
    const cm1 = await db.level.findFirstOrThrow({ where: { schoolId: d.schoolId!, code: "CM1" } });
    expect(await ajouterClasse(db, d, cm1.id, "cm1  b")).toEqual({ ok: true });
    expect(await ajouterClasse(db, d, cm1.id, "CM1 B")).toMatchObject({ ok: false });
    const b = await db.classroom.findFirstOrThrow({ where: { schoolId: d.schoolId!, name: "CM1 B" } });
    const a = await db.classroom.findFirstOrThrow({ where: { schoolId: d.schoolId!, name: "CM1" } });
    const eleve = await db.student.create({ data: { schoolId: d.schoolId!, schoolMatricule: "CM1-001-26", fullName: "X", sex: "M" } });
    await db.enrollment.create({ data: { studentId: eleve.id, academicYearId: a.academicYearId, classroomId: b.id } });
    expect(await supprimerClasse(db, d, b.id)).toMatchObject({ ok: false, erreur: expect.stringContaining("1 élève") });
    await db.enrollment.deleteMany();
    expect(await supprimerClasse(db, d, b.id)).toEqual({ ok: true });
    expect(await supprimerClasse(db, d, a.id)).toMatchObject({ ok: false, erreur: expect.stringContaining("seule classe") });
  });

  it("isolation : une école ne modifie pas les classes d'une autre", async () => {
    const d = await ecole();
    const autre = await ecole("0101010101", "EPP-AUTRE");
    const classeAutre = await db.classroom.findFirstOrThrow({ where: { schoolId: autre.schoolId! } });
    expect(await supprimerClasse(db, d, classeAutre.id)).toMatchObject({ ok: false, erreur: "Classe introuvable." });
    const niveauAutre = await db.level.findFirstOrThrow({ where: { schoolId: autre.schoolId! } });
    expect(await ajouterClasse(db, d, niveauAutre.id, "X")).toMatchObject({ ok: false });
    const matiereAutre = await db.subject.findFirstOrThrow({ where: { schoolId: autre.schoolId!, gradeSheet: "CP" } });
    await majMatieres(db, d, { [matiereAutre.id]: "5" });
    expect(Number((await db.subject.findUniqueOrThrow({ where: { id: matiereAutre.id } })).coefficient)).toBe(1);
  });
});
