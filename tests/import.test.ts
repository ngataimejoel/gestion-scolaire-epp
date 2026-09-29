/** Étape 11 bis : lecture du classeur, import avec aperçu et doublons, export au format du classeur. */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ATTENDU, DONNEES, ecoleDuClasseur } from "./aides/classeur";
import type { Db } from "../src/lib/db";
import { lireClasseur } from "../src/lib/classeur/lecture";
import { exporterClasseur } from "../src/lib/classeur/ecriture";
import { planifier } from "../src/lib/classeur/import";
import { analyserImport, annulerImport, apercuImport, confirmerImport } from "../src/lib/classeur/service";
import { initialiserOffres } from "../src/lib/abonnement";
import { preparerEcole } from "../src/lib/parametres/service";

const XLSM = fs.readFileSync(path.join(__dirname, "fixtures/GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm"));
const FEUILLES = ["E", "N", "CFG", "P", "AE", "AP", "PAR"] as const;
/** Objets comparés sans tenir compte de l'ordre des clés. */
const trie = (o: unknown): unknown =>
  Array.isArray(o) ? o.map(trie) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, trie((o as Record<string, unknown>)[k])])) : o;

describe("Lecture du classeur", () => {
  it("le fichier .xlsm donne exactement les données de référence (élèves, notes, personnel, absences, paramètres)", async () => {
    const l = await lireClasseur(XLSM);
    expect(l.feuillesManquantes).toEqual([]);
    for (const k of FEUILLES) expect(trie(l.donnees[k]), k).toEqual(trie(DONNEES[k]));
    // Résultats du fichier (MGA, décision, rang) lus pour la comparaison après import
    expect(Object.keys(l.attendus)).toHaveLength(Object.keys(ATTENDU.resultats).length);
    for (const [mat, r] of Object.entries(ATTENDU.resultats)) expect(l.attendus[mat]?.decision ?? "", mat).toBe(r[5] ?? "");
  });

  it("refuse un fichier qui n'est pas un classeur", async () => {
    await expect(lireClasseur(Buffer.from("pas un classeur"))).rejects.toThrow();
  });
});

async function ecoleVide(db: Db, tel: string, code: string) {
  return db.$transaction(async (tx) => {
    const school = await tx.school.create({ data: { name: `EPP ${code}`, code } });
    await preparerEcole(tx, school.id, 2026);
    const directeur = await tx.user.create({ data: { schoolId: school.id, phone: tel, fullName: "DIRECTEUR TEST", role: "DIRECTOR", passwordHash: "x", phoneVerifiedAt: new Date() } });
    return { school, directeur };
  });
}

describe.skipIf(!baseDisponible)("Import et export du classeur", () => {
  const db = baseDeTest();
  let ecole: Awaited<ReturnType<typeof ecoleDuClasseur>>;

  beforeAll(async () => {
    await viderBase(db);
    await initialiserOffres(db);
    ecole = await ecoleDuClasseur(db);
  }, 60_000);

  it("export complet puis relecture : mêmes données que le classeur", async () => {
    const buf = await exporterClasseur(db, ecole.school.id, "complet");
    const l = await lireClasseur(buf);
    expect(l.feuillesManquantes).toEqual([]);
    for (const k of FEUILLES) expect(trie(l.donnees[k]), k).toEqual(trie(DONNEES[k]));
    for (const [mat, r] of Object.entries(ATTENDU.resultats)) expect(l.attendus[mat]?.decision ?? "", mat).toBe(r[5] ?? "");
  });

  it("exports partiels : seulement les feuilles demandées", async () => {
    const eleves = await lireClasseur(await exporterClasseur(db, ecole.school.id, "eleves"));
    expect(eleves.donnees.E).toHaveLength(DONNEES.E.length);
    expect(eleves.donnees.P).toHaveLength(0);
    const personnel = await lireClasseur(await exporterClasseur(db, ecole.school.id, "personnel"));
    expect(personnel.donnees.P).toHaveLength(DONNEES.P.length);
    expect(personnel.donnees.E).toHaveLength(0);
  });

  it("parcours complet dans une école neuve : aperçu, confirmation unique, résultats identiques au fichier", async () => {
    const { directeur } = await ecoleVide(db, "0711111111", "EPP-NEUVE");
    const a = await analyserImport(db, directeur, XLSM, "GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm");
    if (!a.ok) throw new Error(a.erreur);
    // Rien n'est écrit tant que le directeur n'a pas confirmé
    expect(await db.student.count({ where: { schoolId: directeur.schoolId! } })).toBe(0);
    const ap = await apercuImport(db, directeur, a.jobId);
    expect(ap!.apercu!.nouveauxEleves).toHaveLength(ATTENDU.tableauDeBord.effectif);
    expect(ap!.apercu!.nouveauxAgents).toHaveLength(DONNEES.P.length);
    expect(ap!.apercu!.doublonsEleves).toHaveLength(0);
    // Écarts avec les réglages de l'école (nom, directeur…) signalés, non appliqués par défaut
    expect(ap!.apercu!.ecartsParametres.length).toBeGreaterThan(0);

    const [c1, c2] = await Promise.all([confirmerImport(db, directeur, a.jobId, {}), confirmerImport(db, directeur, a.jobId, {})]);
    const ok = [c1, c2].filter((c) => c.ok);
    expect(ok).toHaveLength(1);
    const r = ok[0] as Extract<typeof c1, { ok: true }>;
    expect(r.rapport.eleves).toBe(ATTENDU.tableauDeBord.effectif);
    expect(r.rapport.parametres).toBe(0);
    expect(r.rapport.comparaison!.comparees).toBe(Object.keys(ATTENDU.resultats).length);
    expect(r.rapport.comparaison!.ecarts).toEqual([]);
    expect((await db.school.findUniqueOrThrow({ where: { id: directeur.schoolId! } })).name).toBe("EPP EPP-NEUVE");
    expect(await db.student.count({ where: { schoolId: directeur.schoolId! } })).toBe(ATTENDU.tableauDeBord.effectif);

    // Le fichier n'est plus conservé après l'import
    const job = await db.importJob.findUniqueOrThrow({ where: { id: a.jobId } });
    expect(job.status).toBe("COMPLETED");
    expect(JSON.stringify(job.analysis)).not.toContain("naiss");
    expect(await confirmerImport(db, directeur, a.jobId, {})).toMatchObject({ ok: false });
  }, 120_000);

  it("réimport du même fichier : tout est reconnu comme doublon, rien n'est écrasé ni ajouté", async () => {
    const eleve = await db.student.findFirstOrThrow({ where: { schoolId: ecole.school.id } });
    await db.student.update({ where: { id: eleve.id }, data: { locality: "MODIFIÉ SUR LE SITE" } });
    const avant = { eleves: await db.student.count(), notes: await db.grade.count(), abs: await db.attendanceEvent.count(), agents: await db.staff.count() };
    const a = await analyserImport(db, ecole.directeur, XLSM, "classeur.xlsm");
    if (!a.ok) throw new Error(a.erreur);
    const ap = (await apercuImport(db, ecole.directeur, a.jobId))!.apercu!;
    expect(ap.nouveauxEleves).toHaveLength(0);
    expect(ap.doublonsEleves).toHaveLength(DONNEES.E.length);
    expect(ap.nouveauxAgents).toHaveLength(0);
    expect(ap.evenements).toBe(0);
    expect(ap.ecartsParametres).toHaveLength(0);
    const c = await confirmerImport(db, ecole.directeur, a.jobId, { parametres: true });
    expect(c.ok).toBe(true);
    expect({ eleves: await db.student.count(), notes: await db.grade.count(), abs: await db.attendanceEvent.count(), agents: await db.staff.count() }).toEqual(avant);
    expect((await db.student.findUniqueOrThrow({ where: { id: eleve.id } })).locality).toBe("MODIFIÉ SUR LE SITE");
  }, 60_000);

  it("école existante : nouvel élève ajouté avec un matricule libre, doublons et erreurs signalés", async () => {
    const D = structuredClone(DONNEES);
    const modele = D.E[0];
    D.E = [
      { ...modele, n: 1, mat: modele.mat, nom: "NOUVEL ÉLÈVE Test", desps: null, naiss: "2019-05-05" },
      { ...modele, n: 2, nom: String(modele.nom).toLowerCase() }, // même élève (nom et date de naissance)
      { ...modele, n: 3, nom: "SANS SEXE", sexe: "X", desps: null },
      { ...modele, n: 4, nom: "CLASSE INCONNUE", classe: "CM9", desps: null },
    ];
    D.P = [];
    D.AE = [];
    D.AP = [];
    const p = await planifier(db, ecole.school.id, D);
    expect(p.nouveauxEleves).toHaveLength(1);
    // Le matricule du fichier est déjà pris : un nouveau sera attribué
    expect(p.nouveauxEleves[0].matricule).toBeNull();
    expect(p.doublonsEleves).toHaveLength(1);
    const pbs = p.problemes.filter((x) => x.feuille === "REGISTRE ELEVES");
    expect(pbs.map((x) => [x.message.slice(0, 26), x.ignore])).toEqual([
      ["Matricule école CP1-001-26", false],
      ["Sexe « X » : M ou F attend", true],
      ["Classe « CM9 » inconnue po", true],
    ]);
  });

  it("paramètres du fichier appliqués seulement sur demande", async () => {
    const { directeur } = await ecoleVide(db, "0722222222", "EPP-PARAM");
    const D = { ...structuredClone(DONNEES), E: [], P: [], AE: [], AP: [], N: {} };
    const a = await analyserImport(db, directeur, await exporterClasseur(db, ecole.school.id, "complet"), "sauvegarde.xlsx");
    if (!a.ok) throw new Error(a.erreur);
    await annulerImport(db, directeur, a.jobId);
    expect((await db.importJob.findUniqueOrThrow({ where: { id: a.jobId } })).status).toBe("CANCELLED");
    expect(await confirmerImport(db, directeur, a.jobId, {})).toMatchObject({ ok: false });

    const p = await planifier(db, directeur.schoolId!, D);
    const nom = p.ecartsParametres.find((e) => e.fichier === DONNEES.PAR.ecole);
    expect(nom).toBeDefined();
    const { executer } = await import("../src/lib/classeur/import");
    expect((await executer(db, directeur, D, { parametres: true })).ok).toBe(true);
    expect((await db.school.findUniqueOrThrow({ where: { id: directeur.schoolId! } })).name).toBe(DONNEES.PAR.ecole);
  });

  it("isolation : un directeur ne voit ni ne confirme l'import d'une autre école", async () => {
    const autre = await ecoleVide(db, "0733333333", "EPP-AUTRE");
    const a = await analyserImport(db, ecole.directeur, XLSM, "classeur.xlsm");
    if (!a.ok) throw new Error(a.erreur);
    expect(await apercuImport(db, autre.directeur, a.jobId)).toBeNull();
    expect(await confirmerImport(db, autre.directeur, a.jobId, {})).toMatchObject({ ok: false });
    expect(await annulerImport(db, autre.directeur, a.jobId)).toMatchObject({ ok: false });
    expect(await db.student.count({ where: { schoolId: autre.school.id } })).toBe(0);
    await annulerImport(db, ecole.directeur, a.jobId);
  });

  it("limite de l'offre respectée : rien n'est importé au-delà", async () => {
    const { directeur } = await ecoleVide(db, "0744444444", "EPP-LIMITE");
    await db.plan.update({ where: { code: "TRIAL" }, data: { maxStudents: 10 } });
    const a = await analyserImport(db, directeur, XLSM, "classeur.xlsm");
    if (!a.ok) throw new Error(a.erreur);
    const c = await confirmerImport(db, directeur, a.jobId, {});
    expect(c).toMatchObject({ ok: false, erreur: expect.stringContaining("limitée à 10 élèves") });
    expect(await db.student.count({ where: { schoolId: directeur.schoolId! } })).toBe(0);
    expect(await db.staff.count({ where: { schoolId: directeur.schoolId! } })).toBe(0);
    // L'import reste disponible (après changement d'offre)
    expect((await db.importJob.findUniqueOrThrow({ where: { id: a.jobId } })).status).toBe("ANALYZED");
  }, 60_000);

  it("refuse un fichier d'un autre format ou d'un rôle non directeur", async () => {
    expect(await analyserImport(db, ecole.directeur, XLSM, "notes.pdf")).toMatchObject({ ok: false, champ: "fichier" });
    expect(await analyserImport(db, ecole.directeur, Buffer.from("xx"), "faux.xlsx")).toMatchObject({ ok: false, champ: "fichier" });
    expect(await analyserImport(db, { ...ecole.directeur, role: "TEACHER" }, XLSM, "c.xlsm")).toMatchObject({ ok: false });
  });
});
