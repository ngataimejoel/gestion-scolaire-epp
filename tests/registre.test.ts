/** Tests d'intégration du registre des élèves et du personnel (étape 6). */
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { confirmerInscription, connexion, demanderInscription } from "../src/lib/auth/service";
import { dernierSmsSimule } from "../src/lib/sms";
import { ficheEleve, inscrireEleve, listerEleves, modifierEleve, supprimerEleve, type DonneesEleve } from "../src/lib/eleves";
import { changerActivationCompte, enregistrerPersonnel, listerPersonnel, modifierPersonnel, supprimerPersonnel } from "../src/lib/personnel";
import { anneeDebutCourante } from "../src/lib/parametres/defauts";

const code = (tel: string) => /(\d{6})\./.exec(dernierSmsSimule(tel)?.message ?? "")?.[1] ?? "";
const AA = String(anneeDebutCourante()).slice(2);
const vide = { fullName: "", profession: "", residence: "", phone: "" };

describe.skipIf(!baseDisponible)("Registre des élèves et personnel", () => {
  const db = baseDeTest();
  beforeEach(() => viderBase(db));

  async function ecole(tel = "0707123456", codeEcole = "EPP-A") {
    await demanderInscription(db, { fullName: "KOUAME Ernest", phone: tel, schoolName: "EPP LIGUIYO", schoolCode: codeEcole, password: "Ecole2026", confirm: "Ecole2026" });
    const r = await confirmerInscription(db, tel, code(tel));
    if (!r.ok) throw new Error(r.erreur);
    return r.user;
  }
  const classe = async (schoolId: string, name: string) => (await db.classroom.findFirstOrThrow({ where: { schoolId, name } })).id;
  const eleve = (classroomId: string, e: Partial<DonneesEleve> = {}): DonneesEleve => ({
    classroomId,
    despsId: "",
    fullName: "DIGBEU Ismaël Kouadio",
    sex: "M",
    birthDate: "2020-09-04",
    nationality: "IVOIRIENNE",
    locality: "LIGUIYO",
    subPrefecture: "GAGNOA",
    hasBirthCertificate: "OUI",
    certificateNumber: "946",
    certificateDate: "2020-10-15",
    civilRegistryCenter: "GAGNOA",
    isOrphan: "NON",
    orphanOf: "",
    isRepeating: "NON",
    status: "PRESENT",
    statusDate: "",
    notes: "",
    pere: { fullName: "YAO Konan", profession: "PLANTEUR", residence: "LIGUIYO", phone: "07 38 90 90 84" },
    mere: { ...vide, fullName: "YAO Grâce" },
    tuteur: vide,
    ...e,
  });

  it("matricule CLASSE-NNN-AA attribué par niveau, à la suite du plus grand numéro", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    const r1 = await inscrireEleve(db, d, eleve(cp1));
    const r2 = await inscrireEleve(db, d, eleve(cp1, { fullName: "KONAN Franck" }));
    expect(r1).toMatchObject({ ok: true, matricule: `CP1-001-${AA}` });
    expect(r2).toMatchObject({ ok: true, matricule: `CP1-002-${AA}` });
    if (!r2.ok) throw new Error();
    await supprimerEleve(db, d, r2.studentId);
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "ASSI Marie", sex: "F" }))).toMatchObject({ matricule: `CP1-002-${AA}` });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "N'GUESSAN Eric" }))).toMatchObject({ matricule: `CP1-003-${AA}` });
    const ce1 = await classe(d.schoolId!, "CE1");
    expect(await inscrireEleve(db, d, eleve(ce1, { fullName: "BAMBA Awa", sex: "F" }))).toMatchObject({ matricule: `CE1-001-${AA}` });
    const e = await db.student.findFirstOrThrow({ where: { schoolMatricule: `CP1-001-${AA}` }, include: { guardians: true } });
    expect(e.guardians.map((g) => [g.relation, g.fullName, g.phone]).sort()).toEqual([["MERE", "YAO Grâce", null], ["PERE", "YAO Konan", "0738909084"]]);
  });

  it("une division (CM1 B) garde le matricule du niveau", async () => {
    const d = await ecole();
    const cm1 = await db.level.findFirstOrThrow({ where: { schoolId: d.schoolId!, code: "CM1" } });
    const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId: d.schoolId! } });
    const b = await db.classroom.create({ data: { schoolId: d.schoolId!, academicYearId: annee.id, levelId: cm1.id, name: "CM1 B" } });
    await inscrireEleve(db, d, eleve(await classe(d.schoolId!, "CM1")));
    expect(await inscrireEleve(db, d, eleve(b.id, { fullName: "KOFFI Luc" }))).toMatchObject({ matricule: `CM1-002-${AA}` });
  });

  it("contrôles : DESPS, doublon de nom, orphelin, statut daté, listes des Paramètres", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    expect(await inscrireEleve(db, d, eleve(cp1, { despsId: "123456789" }))).toMatchObject({ ok: false, champ: "despsId" });
    expect(await inscrireEleve(db, d, eleve(cp1, { despsId: "A12345678" }))).toMatchObject({ ok: true });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "AUTRE Nom", despsId: "A12345678" }))).toMatchObject({ ok: false, champ: "despsId" });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "digbeu  ismaël kouadio" }))).toMatchObject({ ok: false, champ: "confirmerDoublon" });
    expect(await inscrireEleve(db, d, eleve(cp1, { confirmerDoublon: true }))).toMatchObject({ ok: true });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "X Y", isOrphan: "OUI", orphanOf: "" }))).toMatchObject({ ok: false, champ: "orphanOf" });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "X Y", status: "ABANDON" }))).toMatchObject({ ok: false, champ: "statusDate" });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "X Y", nationality: "MARTIENNE" }))).toMatchObject({ ok: false, champ: "nationality" });
    expect(await inscrireEleve(db, d, eleve(cp1, { fullName: "X Y", pere: { ...vide, fullName: "P", phone: "12" } }))).toMatchObject({ ok: false, champ: "pere.phone" });
  });

  it("modification : statut, parents, changement de division ; matricule figé ; historique", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    const r = await inscrireEleve(db, d, eleve(cp1));
    if (!r.ok) throw new Error();
    const cp2 = await classe(d.schoolId!, "CP2");
    expect(await modifierEleve(db, d, r.studentId, eleve(cp2, { status: "TRANSFERE", statusDate: `${anneeDebutCourante()}-11-02`, mere: vide }))).toEqual({ ok: true });
    const f = await ficheEleve(db, d, r.studentId);
    expect(f?.schoolMatricule).toBe(`CP1-001-${AA}`);
    expect(f?.courante).toMatchObject({ status: "TRANSFERE", classroom: { name: "CP2" } });
    expect(f?.guardians.map((g) => g.relation)).toEqual(["PERE"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: "Student", action: "modification" } });
    expect(JSON.stringify(log.before)).toContain("YAO Grâce");
  });

  it("changement de niveau refusé si l'élève a des notes ; suppression refusée si notes", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    const r = await inscrireEleve(db, d, eleve(cp1));
    if (!r.ok) throw new Error();
    const ins = await db.enrollment.findFirstOrThrow({ where: { studentId: r.studentId } });
    const ev = await db.assessment.findFirstOrThrow({ where: { schoolId: d.schoolId!, number: 1, track: "STANDARD" } });
    const mat = await db.subject.findFirstOrThrow({ where: { schoolId: d.schoolId!, gradeSheet: "CP", assessmentNumber: 1 } });
    await db.grade.create({ data: { assessmentId: ev.id, enrollmentId: ins.id, subjectId: mat.id, score: 7 } });
    expect(await modifierEleve(db, d, r.studentId, eleve(await classe(d.schoolId!, "CE1")))).toMatchObject({ ok: false, champ: "classroomId" });
    expect(await supprimerEleve(db, d, r.studentId)).toMatchObject({ ok: false, erreur: expect.stringContaining("statut") });
  });

  it("liste : filtres, âge à la date de référence, sur-âge", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    const a = anneeDebutCourante();
    await inscrireEleve(db, d, eleve(cp1, { birthDate: `${a - 6}-09-04` }));
    await inscrireEleve(db, d, eleve(cp1, { fullName: "GRAND Paul", birthDate: `${a - 10}-01-01` }));
    await inscrireEleve(db, d, eleve(await classe(d.schoolId!, "CE1"), { fullName: "BAMBA Awa", sex: "F", status: "ABANDON", statusDate: `${a}-12-01` }));
    const tous = await listerEleves(db, d);
    expect(tous.map((x) => [x.student.fullName, x.age, x.surAge])).toEqual([
      ["DIGBEU Ismaël Kouadio", 6, false],
      ["GRAND Paul", 10, true],
      ["BAMBA Awa", a - 2020, false],
    ]);
    expect((await listerEleves(db, d, { classroomId: cp1 })).length).toBe(2);
    expect((await listerEleves(db, d, { statut: "ABANDON" })).map((x) => x.student.fullName)).toEqual(["BAMBA Awa"]);
    expect((await listerEleves(db, d, { recherche: "cp1-002" })).map((x) => x.student.fullName)).toEqual(["GRAND Paul"]);
  });

  it("isolation : aucune lecture ni modification d'un élève d'une autre école", async () => {
    const a = await ecole();
    const b = await ecole("0101010101", "EPP-B");
    const r = await inscrireEleve(db, b, eleve(await classe(b.schoolId!, "CP1")));
    if (!r.ok) throw new Error();
    expect(await ficheEleve(db, a, r.studentId)).toBeNull();
    expect(await modifierEleve(db, a, r.studentId, eleve(await classe(a.schoolId!, "CP1")))).toMatchObject({ ok: false });
    expect(await inscrireEleve(db, a, eleve(await classe(b.schoolId!, "CP1")))).toMatchObject({ ok: false, champ: "classroomId" });
    expect(await listerEleves(db, a)).toHaveLength(0);
  });

  it("personnel complet : âge, ancienneté, classe tenue, compte ; l'enseignant ne voit que sa classe", async () => {
    const d = await ecole();
    const cp1 = await classe(d.schoolId!, "CP1");
    const a = anneeDebutCourante();
    const r = await enregistrerPersonnel(db, d, {
      matricule: "123456a", lastName: "yao", firstNames: "Aya", sex: "F", birthDate: `${a - 30}-03-12`, function: "INSTITUTEUR ADJOINT",
      grade: "IA", diploma: "CAP-CP", serviceStartDate: `${a - 5}-10-01`, arrivalDate: "", phone: "0544332211", maritalStatus: "MARIE(E)", notes: "", classroomId: cp1,
    });
    if (!r.ok || !r.compte) throw new Error("compte attendu");
    const [p] = await listerPersonnel(db, d.schoolId!);
    expect(p).toMatchObject({ matricule: "123456A", lastName: "YAO", age: 30, anciennete: 5, classeTenue: "CP1" });

    await inscrireEleve(db, d, eleve(cp1));
    await inscrireEleve(db, d, eleve(await classe(d.schoolId!, "CE1"), { fullName: "BAMBA Awa", sex: "F" }));
    const prof = await db.user.findUniqueOrThrow({ where: { phone: "0544332211" } });
    expect((await listerEleves(db, prof)).map((x) => x.student.fullName)).toEqual(["DIGBEU Ismaël Kouadio"]);
    expect(await inscrireEleve(db, prof, eleve(cp1, { fullName: "Z Z" }))).toMatchObject({ ok: false });
  });

  it("personnel : fonction de la liste, numéro obligatoire pour un enseignant, changement de numéro = nouvel identifiant", async () => {
    const d = await ecole();
    const base = { matricule: "1", lastName: "KONE", firstNames: "Ali", sex: "M", function: "INSTITUTEUR ADJOINT", phone: "0544332211" };
    expect(await enregistrerPersonnel(db, d, { ...base, function: "PILOTE" })).toMatchObject({ ok: false, champ: "function" });
    expect(await enregistrerPersonnel(db, d, { ...base, phone: "" })).toMatchObject({ ok: false, champ: "phone" });
    const gardien = await enregistrerPersonnel(db, d, { ...base, matricule: "2", function: "GARDIEN", phone: "" });
    expect(gardien.ok && gardien.compte).toBeUndefined();
    const r = await enregistrerPersonnel(db, d, base);
    if (!r.ok || !r.compte) throw new Error();
    expect(await enregistrerPersonnel(db, d, { ...base, phone: "0500000000" })).toMatchObject({ ok: false, champ: "matricule" });
    expect(await modifierPersonnel(db, d, r.staffId, { ...base, phone: "0555555555" })).toMatchObject({ ok: true, avertissement: expect.any(String) });
    expect(await connexion(db, { phone: "0555555555", password: r.compte.motDePasse }, { ip: "1.1.1.1" })).toMatchObject({ ok: true });
    // Désactivation : plus de connexion possible ; suppression refusée car compte existant.
    expect(await changerActivationCompte(db, d, r.staffId, false)).toEqual({ ok: true });
    expect(await connexion(db, { phone: "0555555555", password: r.compte.motDePasse }, { ip: "1.1.1.2" })).toMatchObject({ ok: false, erreur: expect.stringContaining("désactivé") });
    expect(await supprimerPersonnel(db, d, r.staffId)).toMatchObject({ ok: false });
  });
});
