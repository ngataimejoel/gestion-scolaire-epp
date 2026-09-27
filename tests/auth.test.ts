/** Tests d'intégration des comptes (étape 4) sur une vraie base PostgreSQL. */
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import {
  changerMotDePasse,
  confirmerConnexion,
  confirmerInscription,
  connexion,
  creerCompteEnseignant,
  demanderInscription,
  demanderReinitialisation,
  reinitialiserMotDePasse,
  renvoyerCode,
} from "../src/lib/auth/service";
import { accesParent } from "../src/lib/auth/acces-parent";
import { utilisateurDeSession } from "../src/lib/auth/sessions";
import { dernierSmsSimule } from "../src/lib/sms";
import { lireSigne, signer } from "../src/lib/auth/jetons";
import { motDePasseProvisoire } from "../src/lib/auth/mot-de-passe";
import { normaliserTelephone } from "../src/lib/auth/telephone";

const TEL = "0707123456";
const MDP = "Ecole2026";
const codeRecu = (tel: string) => /(\d{6})\./.exec(dernierSmsSimule(tel)?.message ?? "")?.[1] ?? "";

describe("Outils sans base", () => {
  it("normalise les numéros ivoiriens", () => {
    expect(normaliserTelephone("+225 07 07 12 34 56")).toBe(TEL);
    expect(normaliserTelephone("07.07.12.34.56")).toBe(TEL);
    expect(normaliserTelephone("0807123456")).toBeNull();
    expect(normaliserTelephone("070712345")).toBeNull();
  });
  it("mot de passe provisoire enseignant : 4 derniers chiffres + 4 caractères", () => {
    const m = motDePasseProvisoire(TEL);
    expect(m).toMatch(/^3456[A-Za-z][A-Za-z0-9]{3}$/);
    expect(motDePasseProvisoire(TEL)).not.toBe(m);
  });
  it("données signées : falsification et expiration refusées", () => {
    const s = signer({ phone: TEL }, 60);
    expect(lireSigne<{ phone: string }>(s)?.phone).toBe(TEL);
    expect(lireSigne(s.replace(/^./, "x"))).toBeNull();
    expect(lireSigne(signer({ phone: TEL }, -1))).toBeNull();
  });
});

describe.skipIf(!baseDisponible)("Comptes et connexion", () => {
  const db = baseDeTest();
  beforeEach(() => viderBase(db));

  async function inscrireDirecteur(tel = TEL, code = "EPP-GAG-0123") {
    const r = await demanderInscription(db, {
      fullName: "KOUAME Kouadio Ernest",
      phone: tel,
      schoolName: "EPP LIGUIYO",
      schoolCode: code,
      password: MDP,
      confirm: MDP,
    });
    expect(r.ok).toBe(true);
    const c = await confirmerInscription(db, tel, codeRecu(tel));
    if (!c.ok) throw new Error(c.erreur);
    return c;
  }

  it("inscription du directeur : rien n'est créé avant le code, puis école + compte vérifié", async () => {
    await demanderInscription(db, { fullName: "KOUAME Ernest", phone: TEL, schoolName: "EPP LIGUIYO", password: MDP, confirm: MDP });
    expect(await db.user.count()).toBe(0);
    const otp = await db.otpCode.findFirstOrThrow();
    expect(JSON.stringify(otp)).not.toContain(MDP); // jamais de mot de passe en clair
    expect(otp.codeHash).not.toContain(codeRecu(TEL));
    const c = await confirmerInscription(db, TEL, codeRecu(TEL));
    expect(c.ok).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { phone: TEL }, include: { school: true } });
    expect(u).toMatchObject({ role: "DIRECTOR", fullName: "KOUAME Ernest" });
    expect(u.phoneVerifiedAt).not.toBeNull();
    expect(u.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(u.school?.code).toMatch(/^EPP-[A-Z0-9]{6}$/);
  });

  it("inscription refusée : mot de passe faible, numéro invalide, numéro ou code école déjà pris", async () => {
    expect(await demanderInscription(db, { fullName: "A B", phone: TEL, schoolName: "EPP X", password: "abc", confirm: "abc" })).toMatchObject({ ok: false, champ: "password" });
    expect(await demanderInscription(db, { fullName: "A B", phone: "123", schoolName: "EPP X", password: MDP, confirm: MDP })).toMatchObject({ ok: false, champ: "phone" });
    await inscrireDirecteur();
    expect(await demanderInscription(db, { fullName: "A B", phone: TEL, schoolName: "EPP X", password: MDP, confirm: MDP })).toMatchObject({ ok: false, champ: "phone" });
    expect(await demanderInscription(db, { fullName: "A B", phone: "0505000000", schoolName: "EPP X", schoolCode: "epp-gag-0123", password: MDP, confirm: MDP })).toMatchObject({ ok: false, champ: "schoolCode" });
  });

  it("code SMS : 3 essais au plus, usage unique, délai avant renvoi", async () => {
    await demanderInscription(db, { fullName: "KOUAME Ernest", phone: TEL, schoolName: "EPP LIGUIYO", password: MDP, confirm: MDP });
    const bon = codeRecu(TEL);
    const faux = bon === "000000" ? "111111" : "000000";
    expect(await confirmerInscription(db, TEL, faux)).toMatchObject({ ok: false, erreur: expect.stringContaining("2 essais") });
    expect(await confirmerInscription(db, TEL, faux)).toMatchObject({ ok: false, erreur: expect.stringContaining("1 essai") });
    expect(await confirmerInscription(db, TEL, faux)).toMatchObject({ ok: false, erreur: expect.stringContaining("dépassé") });
    expect(await confirmerInscription(db, TEL, bon)).toMatchObject({ ok: false }); // code annulé après 3 échecs
    expect(await renvoyerCode(db, TEL, "SIGNUP")).toMatchObject({ ok: false, erreur: expect.stringContaining("Patientez") });
    // Après le délai, le renvoi garde les données d'inscription.
    await db.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    expect(await renvoyerCode(db, TEL, "SIGNUP")).toMatchObject({ ok: true });
    expect(await confirmerInscription(db, TEL, codeRecu(TEL))).toMatchObject({ ok: true });
  });

  it("code SMS expiré refusé", async () => {
    await demanderInscription(db, { fullName: "KOUAME Ernest", phone: TEL, schoolName: "EPP LIGUIYO", password: MDP, confirm: MDP });
    await db.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await confirmerInscription(db, TEL, codeRecu(TEL))).toMatchObject({ ok: false, erreur: expect.stringContaining("expiré") });
  });

  it("connexion du directeur : mot de passe puis code SMS, session valide", async () => {
    await inscrireDirecteur();
    await db.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    const e1 = await connexion(db, { phone: "07 07 12 34 56", password: MDP }, { ip: "1.1.1.1" });
    expect(e1).toMatchObject({ ok: true, etape: "code" });
    const e2 = await confirmerConnexion(db, TEL, codeRecu(TEL), { ip: "1.1.1.1" });
    if (!e2.ok || e2.etape !== "session") throw new Error("session attendue");
    expect((await utilisateurDeSession(db, e2.jeton))?.phone).toBe(TEL);
    expect(await db.session.findUnique({ where: { id: e2.jeton } })).toBeNull(); // seul le hachage est stocké
  });

  it("mauvais mot de passe : message neutre, compte bloqué après 5 échecs", async () => {
    await inscrireDirecteur();
    const r = await connexion(db, { phone: TEL, password: "mauvais1" }, { ip: "2.2.2.2" });
    const inconnu = await connexion(db, { phone: "0505050505", password: "mauvais1" }, { ip: "2.2.2.2" });
    expect(r).toMatchObject({ ok: false });
    expect(inconnu).toEqual(r); // ne révèle pas si le numéro existe
    for (let i = 0; i < 4; i++) await connexion(db, { phone: TEL, password: "mauvais1" }, { ip: `3.3.3.${i}` });
    expect(await connexion(db, { phone: TEL, password: MDP }, { ip: "4.4.4.4" })).toMatchObject({ ok: false, erreur: expect.stringContaining("Trop de tentatives") });
  });

  it("limite par adresse IP", async () => {
    for (let i = 0; i < 10; i++) await connexion(db, { phone: `07000000${String(i).padStart(2, "0")}`, password: "x" }, { ip: "9.9.9.9" });
    expect(await connexion(db, { phone: TEL, password: MDP }, { ip: "9.9.9.9" })).toMatchObject({ ok: false, erreur: expect.stringContaining("Trop de tentatives") });
  });

  it("compte enseignant : créé par le directeur, SMS, changement obligatoire du mot de passe", async () => {
    const { user: dir } = await inscrireDirecteur();
    const staff = await db.staff.create({
      data: { schoolId: dir.schoolId!, matricule: "123456A", lastName: "YAO", firstNames: "Aya", sex: "F", function: "INSTITUTEUR ADJOINT", phone: "05 44 33 22 11" },
    });
    const c = await creerCompteEnseignant(db, dir, staff.id);
    if (!c.ok) throw new Error(c.erreur);
    expect(c.phone).toBe("0544332211");
    expect(c.motDePasse).toMatch(/^2211/);
    expect(dernierSmsSimule("0544332211")?.message).toContain(c.motDePasse);
    const u = await db.user.findUniqueOrThrow({ where: { phone: "0544332211" } });
    expect(u).toMatchObject({ role: "TEACHER", mustChangePassword: true, schoolId: dir.schoolId });
    expect(u.passwordHash).not.toContain(c.motDePasse);
    expect((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).userId).toBe(u.id);

    // Connexion directe (sans code SMS par défaut), puis changement obligatoire.
    const s = await connexion(db, { phone: "0544332211", password: c.motDePasse }, { ip: "5.5.5.5" });
    if (!s.ok || s.etape !== "session") throw new Error("session attendue");
    expect(s.user.mustChangePassword).toBe(true);
    expect(await changerMotDePasse(db, u.id, { current: c.motDePasse, password: "Nouveau2027", confirm: "Nouveau2027" }, s.jeton)).toMatchObject({ ok: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).mustChangePassword).toBe(false);

    // Nouveau mot de passe provisoire : les anciennes sessions sont fermées.
    const c2 = await creerCompteEnseignant(db, dir, staff.id);
    expect(c2).toMatchObject({ ok: true, nouveau: false });
    expect(await utilisateurDeSession(db, s.jeton)).toBeNull();
  });

  it("code SMS enseignant si l'école l'active", async () => {
    const { user: dir } = await inscrireDirecteur();
    await db.schoolSettings.update({ where: { schoolId: dir.schoolId! }, data: { teacherLoginOtp: true } });
    const staff = await db.staff.create({ data: { schoolId: dir.schoolId!, matricule: "1", lastName: "YAO", firstNames: "Aya", sex: "F", function: "INSTITUTEUR ADJOINT", phone: "0544332211" } });
    const c = await creerCompteEnseignant(db, dir, staff.id);
    if (!c.ok) throw new Error(c.erreur);
    expect(await connexion(db, { phone: "0544332211", password: c.motDePasse }, { ip: "6.6.6.6" })).toMatchObject({ ok: true, etape: "code" });
  });

  it("isolation : un directeur ne crée pas de compte pour le personnel d'une autre école", async () => {
    const { user: a } = await inscrireDirecteur(TEL, "EPP-A");
    const { user: b } = await inscrireDirecteur("0101010101", "EPP-B");
    const staffB = await db.staff.create({ data: { schoolId: b.schoolId!, matricule: "1", lastName: "KONE", firstNames: "Ali", sex: "M", function: "INSTITUTEUR ADJOINT", phone: "0544332211" } });
    expect(await creerCompteEnseignant(db, a, staffB.id)).toMatchObject({ ok: false, erreur: "Membre du personnel introuvable." });
    expect(await db.user.count({ where: { role: "TEACHER" } })).toBe(0);
  });

  it("mot de passe oublié : code SMS puis nouveau mot de passe, sessions fermées", async () => {
    const { jeton } = await inscrireDirecteur();
    await db.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    expect(await demanderReinitialisation(db, "0505050505")).toMatchObject({ ok: true }); // même réponse sans compte
    expect(await demanderReinitialisation(db, TEL)).toMatchObject({ ok: true });
    expect(await reinitialiserMotDePasse(db, { phone: TEL, code: codeRecu(TEL), password: "Autre2027x", confirm: "Autre2027x" })).toMatchObject({ ok: true });
    expect(await utilisateurDeSession(db, jeton)).toBeNull();
    expect(await connexion(db, { phone: TEL, password: "Autre2027x" }, { ip: "7.7.7.7" })).toMatchObject({ ok: true, etape: "code" });
  });

  it("accès parent : matricule école ou DESPS + date de naissance, essais limités", async () => {
    const { user: dir } = await inscrireDirecteur();
    const eleve = await db.student.create({
      data: { schoolId: dir.schoolId!, schoolMatricule: "CP1-001-26", despsId: "A12345678", fullName: "DIGBEU Ismaël", sex: "M", birthDate: new Date("2020-09-04") },
    });
    expect(await accesParent(db, { identifiant: "cp1-001-26", naissance: "2020-09-04" }, "8.8.8.8")).toEqual({ ok: true, studentId: eleve.id, schoolId: dir.schoolId });
    expect(await accesParent(db, { identifiant: "a12345678", naissance: "04/09/2020" }, "8.8.8.8")).toMatchObject({ ok: true, studentId: eleve.id });
    expect(await accesParent(db, { identifiant: "CP1-001-26", naissance: "2020-09-05" }, "8.8.8.8")).toMatchObject({ ok: false });
    for (let i = 0; i < 4; i++) await accesParent(db, { identifiant: "X", naissance: "2020-01-01" }, "8.8.8.8");
    expect(await accesParent(db, { identifiant: "CP1-001-26", naissance: "2020-09-04" }, "8.8.8.8")).toMatchObject({ ok: false, erreur: expect.stringContaining("Trop de tentatives") });
  });

  it("accès parent : même matricule dans deux écoles → choix de l'école", async () => {
    const { user: a } = await inscrireDirecteur(TEL, "EPP-A");
    const { user: b } = await inscrireDirecteur("0101010101", "EPP-B");
    for (const s of [a.schoolId!, b.schoolId!])
      await db.student.create({ data: { schoolId: s, schoolMatricule: "CP1-001-26", fullName: "X", sex: "M", birthDate: new Date("2020-09-04") } });
    const r = await accesParent(db, { identifiant: "CP1-001-26", naissance: "2020-09-04" }, "1.2.3.4");
    expect(r).toMatchObject({ ok: false, choixEcoles: expect.arrayContaining([expect.objectContaining({ schoolId: b.schoolId })]) });
    expect(await accesParent(db, { identifiant: "CP1-001-26", naissance: "2020-09-04", schoolId: b.schoolId! }, "1.2.3.4")).toMatchObject({ ok: true, schoolId: b.schoolId });
  });
});
