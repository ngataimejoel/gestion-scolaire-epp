/** Étape 8 : résultats, synthèse et tableau de bord lus en base, comparés aux valeurs du classeur. */
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ATTENDU, DONNEES, ecoleDuClasseur, enseignantDe } from "./aides/classeur";
import { resultatsEcole, resultatsVisibles } from "../src/lib/resultats";
import { statistiquesEvaluation, syntheseParNiveau, tableauDeBord } from "../src/lib/bilans";
import { bulletinEleve } from "../src/lib/bulletin";

describe.skipIf(!baseDisponible)("Résultats et bilans", () => {
  const db = baseDeTest();
  let ecole: Awaited<ReturnType<typeof ecoleDuClasseur>>;

  beforeAll(async () => {
    await viderBase(db);
    ecole = await ecoleDuClasseur(db);
  }, 60_000);

  it("RESULTATS : MGA, décision, rang et observation des 64 élèves identiques au classeur", async () => {
    const r = await resultatsEcole(db, ecole.school.id);
    const eleves = r.flatMap((c) => c.eleves);
    expect(eleves).toHaveLength(DONNEES.E.length);
    for (const e of eleves) {
      const [m1, m2, m3, m4, mga, decision, rang, observation] = ATTENDU.resultats[e.matricule];
      expect([...e.moyennes, e.mga], e.matricule).toEqual([m1, m2, m3, m4, mga]);
      expect(e.decision, e.matricule).toBe(decision ?? "");
      expect(e.rang, e.matricule).toBe(rang);
      expect(e.observation || null, e.matricule).toBe(observation || null);
    }
  });

  it("SYNTHESE FIN D'ANNEE identique au classeur", async () => {
    const r = await resultatsEcole(db, ecole.school.id);
    const s = syntheseParNiveau(r, 24);
    for (const l of s) {
      const a = ATTENDU.synthese[l.niveau];
      for (const k of ["inscrits", "presents", "abandons", "admis", "redoublants", "probable"] as const) {
        expect([l[k].M, l[k].F], `${l.niveau} ${k}`).toEqual(a[k]);
      }
    }
  });

  it("TABLEAU DE BORD identique au classeur", async () => {
    const t = await tableauDeBord(db, ecole.school.id);
    const a = ATTENDU.tableauDeBord;
    expect(t.effectif).toBe(a.effectif);
    expect(t.presents).toBe(a.presents);
    expect(t.tauxAdmission).toBeCloseTo(a.tauxAdmission, 12);
    expect(t.tauxAbandon).toBeCloseTo(a.tauxAbandon, 12);
    expect(t.enseignants).toBe(a.enseignants);
    expect(t.alertes.find((x) => x.libelle.startsWith("Élèves sans extrait"))!.nombre).toBe(a.sansExtrait);
    expect(t.alertes.find((x) => x.libelle.startsWith("Classes sans enseignant"))!.nombre).toBe(0);
    expect(t.parClasse).toHaveLength(6);
  });

  it("statistiques d'une composition : présents, absents et admis cohérents", async () => {
    const r = await resultatsEcole(db, ecole.school.id);
    const s = statistiquesEvaluation(r, 1);
    const cm2 = s.find((x) => x.classe.niveau === "CM2")!;
    expect(cm2.inscrits.M + cm2.inscrits.F).toBe(r.find((x) => x.classe.niveau === "CM2")!.eleves.length);
    for (const x of s) expect(x.presents.M + x.absents.M).toBeLessThanOrEqual(x.inscrits.M);
    // 3e évaluation du CM2 : l'élève CM2-001-26 est absent (NON dans le classeur)
    const s3 = statistiquesEvaluation(r, 3).find((x) => x.classe.niveau === "CM2")!;
    expect(s3.absents.M + s3.absents.F).toBeGreaterThanOrEqual(1);
  });

  it("l'enseignant ne voit que les résultats de sa classe", async () => {
    const ens = await enseignantDe(db, ecole.directeur, "CM1");
    const r = await resultatsVisibles(db, ens);
    expect(r.map((x) => x.classe.nom)).toEqual(["CM1"]);
  });

  it("bulletin : notes par matière, MGA, rang sur l'effectif présent, absences", async () => {
    const eleve = await db.student.findFirstOrThrow({ where: { schoolId: ecole.school.id, schoolMatricule: "CP1-001-26" } });
    const b = (await bulletinEleve(db, ecole.school.id, eleve.id))!;
    const [m1, , , m4, mga, decision, rang] = ATTENDU.resultats["CP1-001-26"];
    expect(b.resultat.moyennes[0]).toBe(m1);
    expect(b.resultat.moyennes[3]).toBe(m4);
    expect(b.resultat.mga).toBe(mga);
    expect(b.resultat.decision).toBe(decision);
    expect(b.resultat.rang).toBe(rang);
    expect(b.effectifClasse).toBe(11);
    expect(b.matieres.map((m) => m.nom)).toContain("LECTURE");
    expect(b.matieres[0].notes).toHaveLength(4);
    // Une autre école ne peut pas lire ce bulletin
    expect(await bulletinEleve(db, "autre-ecole", eleve.id)).toBeNull();
  });
});
