/** Étape 9 : journal des absences, fréquentation du mois, états officiels et export Excel. */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ATTENDU, ecoleDuClasseur, enseignantDe } from "./aides/classeur";
import { enregistrerEvenement, frequentationDuMois, journalEvenements, supprimerEvenement } from "../src/lib/absences";
import { construireEtat, enregistrerRedaction, ETATS, lireRedaction, type CodeEtat } from "../src/lib/etats";
import { classeurExcel } from "../src/lib/excel";

describe.skipIf(!baseDisponible)("Absences et rapports", () => {
  const db = baseDeTest();
  let ecole: Awaited<ReturnType<typeof ecoleDuClasseur>>;

  beforeAll(async () => {
    await viderBase(db);
    ecole = await ecoleDuClasseur(db);
  }, 60_000);

  it("RAPPORT MENSUEL : fréquentation d'octobre identique au classeur (journal lu en base)", async () => {
    const f = (await frequentationDuMois(db, ecole.school.id, ATTENDU.frequentation.mois))!;
    expect(f.jours).toBe(ATTENDU.frequentation.jours);
    for (const l of f.lignes) {
      const a = ATTENDU.frequentation.classes[l.nom];
      expect(l.taux.M, `${l.nom} G`).toBeCloseTo(a.M, 12);
      expect(l.taux.F, `${l.nom} F`).toBeCloseTo(a.F, 12);
      expect(l.taux.T, `${l.nom} T`).toBeCloseTo(a.T, 12);
    }
    expect(f.total.taux.T).toBeCloseTo(ATTENDU.frequentation.total.T, 12);
  });

  it("saisie d'une absence : contrôles, doublon à confirmer, droits de l'enseignant", async () => {
    const ens = await enseignantDe(db, ecole.directeur, "CE1");
    const ce1 = await db.enrollment.findFirstOrThrow({ where: { classroom: { schoolId: ecole.school.id, name: "CE1" } } });
    const cp1 = await db.enrollment.findFirstOrThrow({ where: { classroom: { schoolId: ecole.school.id, name: "CP1" } } });
    const base = { cible: "eleve" as const, personId: ce1.id, date: "2026-11-03", nature: "ABSENCE" as const, days: "1,5", reason: "Maladie", justified: "OUI" as const };
    expect(await enregistrerEvenement(db, ens, { ...base, days: "0,3" })).toMatchObject({ ok: false, champ: "days" });
    expect(await enregistrerEvenement(db, ens, { ...base, date: "2025-11-03" })).toMatchObject({ ok: false, champ: "date" });
    expect(await enregistrerEvenement(db, ens, { ...base, personId: cp1.id })).toMatchObject({ ok: false, champ: "personId" });
    expect(await enregistrerEvenement(db, ens, { ...base, cible: "personnel", personId: "x" })).toMatchObject({ ok: false });
    const r = await enregistrerEvenement(db, ens, base);
    expect(r.ok).toBe(true);
    expect(await enregistrerEvenement(db, ens, base)).toMatchObject({ ok: false, champ: "confirmerDoublon" });
    expect((await enregistrerEvenement(db, ens, { ...base, confirmerDoublon: true })).ok).toBe(true);
    // Motif libre (comme dans le classeur)
    expect((await enregistrerEvenement(db, ens, { ...base, date: "2026-11-04", reason: "Fête du village" })).ok).toBe(true);
    const journal = await journalEvenements(db, ens, "eleve", 11);
    expect(journal).toHaveLength(3);
    expect(journal.every((e) => e.enrollment?.classroom.name === "CE1")).toBe(true);
    expect(await journalEvenements(db, ens, "personnel")).toHaveLength(0);
    // Suppression : l'auteur ou le directeur
    if (!r.ok) throw new Error();
    expect((await supprimerEvenement(db, ens, r.id)).ok).toBe(true);
    const f = (await frequentationDuMois(db, ecole.school.id, 11))!;
    expect(f.lignes.find((l) => l.nom === "CE1")!.joursAbsence.M + f.lignes.find((l) => l.nom === "CE1")!.joursAbsence.F).toBe(3);
  });

  it("les six états se construisent et l'effectif total correspond au registre", async () => {
    for (const code of Object.keys(ETATS) as CodeEtat[]) {
      const e = await construireEtat(db, ecole.school.id, code, { mois: 12, numero: 1 });
      expect(e.tableaux.length, code).toBeGreaterThan(0);
    }
    const eff = await construireEtat(db, ecole.school.id, "effectifs");
    const total = eff.tableaux[0].lignes.at(-1)!.cellules;
    expect(total.slice(1, 4)).toEqual([35, 29, 64]);
    // Rapport mensuel de décembre : la 1re composition (09/12) y figure
    const dec = await construireEtat(db, ecole.school.id, "mensuel", { mois: 12 });
    expect(dec.tableaux[2].lignes).toHaveLength(6);
    const rentree = await construireEtat(db, ecole.school.id, "rentree");
    expect(rentree.tableaux[0].lignes).toHaveLength(7);
  });

  it("observations rédigées : enregistrées par période, journalisées, refusées à l'enseignant", async () => {
    const ens = await enseignantDe(db, ecole.directeur, "CE1");
    expect((await enregistrerRedaction(db, ens, "mensuel", { mois: 10 }, { conclusion: "x" })).ok).toBe(false);
    expect((await enregistrerRedaction(db, ecole.directeur, "mensuel", { mois: 10 }, { conclusion: "Bon mois.", inconnu: "ignoré" })).ok).toBe(true);
    const e = await construireEtat(db, ecole.school.id, "mensuel", { mois: 10 });
    expect(await lireRedaction(db, ecole.school.id, e)).toMatchObject({ conclusion: "Bon mois." });
    const nov = await construireEtat(db, ecole.school.id, "mensuel", { mois: 11 });
    expect(await lireRedaction(db, ecole.school.id, nov)).toEqual({});
  });

  it("export Excel : en-têtes fusionnés et pourcentages", async () => {
    const e = await construireEtat(db, ecole.school.id, "synthese");
    const buf = await classeurExcel({ ecole: "EPP LIGUIYO", code: "X", ministere: "MENA", annee: "2026-2027" }, e.titre, e.sousTitre, e.tableaux);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const valeurs: unknown[] = [];
    ws.eachRow((r) => r.eachCell((c) => valeurs.push(c.value)));
    expect(valeurs).toContain("Effectif probable année suivante");
    expect(valeurs).toContain("TOTAL");
    expect(valeurs).toContain(64);
  });
});
