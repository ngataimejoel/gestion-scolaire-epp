/**
 * Tests « de référence » : le moteur doit redonner exactement les valeurs calculées par le classeur
 * GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm (fixtures extraites du fichier, voir tests/fixtures).
 */
import { describe, expect, it } from "vitest";
import donnees from "./fixtures/donnees-classeur.json";
import attendu from "./fixtures/attendu-classeur.json";
import {
  NIVEAUX,
  anneeDuMois,
  anneesRevolues,
  arrondi2,
  calculerRangs,
  compterParSexe,
  despsValide,
  effectifsProbables,
  estEnSurAge,
  estEnseignant,
  evaluationDuMois,
  feuilleDuNiveau,
  matriculeEcole,
  moyenneEvaluation,
  noteValide,
  resultatAnnuel,
  statistiquesComposition,
  tauxAdmission,
  tauxFrequentation,
  type FeuilleNotes,
  type MatiereCfg,
  type SaisieEvaluation,
  type Sexe,
  type Statut,
} from "../src/lib/regles";

type Ligne = (string | number | null)[];
const D = donnees as unknown as {
  E: { mat: string; nom: string; sexe: Sexe; classe: string; naiss: string; age: number; statut: Statut; redoublant: string }[];
  N: Record<string, Ligne[]>;
  CFG: Record<string, [string, number][][]>;
  P: { fonction: string; naiss: string; age: number; priseService: string; anc: number }[];
  AE: { date: string; mat: string; nature: string; jours: number | null }[];
  PAR: {
    annee: string;
    dateRefAge: string;
    dateEdition: string;
    nouveauxCP1: number;
    seuils: Record<string, [number, number]>;
    calendrier: [string, string, string][];
  };
};
const A = attendu as unknown as {
  resultats: Record<string, [number | null, number | null, number | null, number | null, number | null, string, number | null, string | null]>;
  frequentation: { mois: number; annee: number; jours: number; classes: Record<string, { M: number; F: number; T: number }>; total: { M: number; F: number; T: number } };
  synthese: Record<string, Record<"inscrits" | "presents" | "abandons" | "admis" | "redoublants" | "probable", [number, number]>>;
  tableauDeBord: { effectif: number; presents: number; tauxAdmission: number; sansExtrait: number; enseignants: number; tauxAbandon: number };
};

const CLE_CFG: Record<FeuilleNotes, string> = { CP: "CP", CE1: "CE1", CE2_CM1: "CEM", CM2: "CM2" };
const cfg = (niveau: string, k: number): MatiereCfg[] =>
  D.CFG[CLE_CFG[feuilleDuNiveau(niveau)]][k].map(([nom, poids]) => ({ nom, poids }));
const saisie = (mat: string, k: number): SaisieEvaluation | null => {
  const l = D.N[mat]?.[k];
  return l ? { present: l[0] !== "NON", notes: l.slice(1).map((x) => (typeof x === "number" ? x : null)) } : null;
};
const seuil = (c: string) => D.PAR.seuils[c][0];
const bareme = (c: string) => D.PAR.seuils[c][1];

const resultats = new Map(
  D.E.map((e) => {
    const moyennes = [0, 1, 2, 3].map((k) => moyenneEvaluation(feuilleDuNiveau(e.classe), cfg(e.classe, k), saisie(e.mat, k), bareme(e.classe)));
    return [e.mat, resultatAnnuel(e.classe, e.statut, moyennes, seuil(e.classe), bareme(e.classe))];
  }),
);
const rangs = new Map<string, number | null>();
for (const c of NIVEAUX) {
  const l = D.E.filter((e) => e.classe === c).map((e) => ({ id: e.mat, statut: e.statut, mga: resultats.get(e.mat)!.mga }));
  calculerRangs(l).forEach((v, k) => rangs.set(k, v));
}

describe("RESULTATS et RESULTATS CM2 : les 64 élèves du classeur", () => {
  it("couvre bien les 64 élèves", () => {
    expect(D.E).toHaveLength(64);
    expect(Object.keys(A.resultats)).toHaveLength(64);
  });
  for (const e of D.E) {
    it(`${e.mat} ${e.nom}`, () => {
      const [m1, m2, m3, m4, mga, dec, rang, obs] = A.resultats[e.mat];
      const r = resultats.get(e.mat)!;
      expect(r.moyennes).toEqual([m1, m2, m3, m4]);
      expect(r.mga).toBe(mga);
      expect(r.decision).toBe(dec ?? "");
      expect(rangs.get(e.mat)).toBe(rang);
      expect(r.observation).toBe(obs ?? "");
    });
  }
});

describe("TABLEAU DE BORD", () => {
  it("effectif, présents, taux d'admission, enseignants", () => {
    const presents = D.E.filter((e) => e.statut === "PRESENT");
    const admis = D.E.filter((e) => resultats.get(e.mat)!.decision === "ADMIS").length;
    expect(D.E.length).toBe(A.tableauDeBord.effectif);
    expect(presents.length).toBe(A.tableauDeBord.presents);
    expect(tauxAdmission(admis, presents.length)).toBeCloseTo(A.tableauDeBord.tauxAdmission, 12);
    expect(D.P.filter((p) => estEnseignant(p.fonction)).length).toBe(A.tableauDeBord.enseignants);
    expect(D.E.filter((e) => e.statut === "ABANDON").length / D.E.length).toBeCloseTo(A.tableauDeBord.tauxAbandon, 12);
  });
});

describe("RAPPORT MENSUEL : fréquentation d'octobre", () => {
  const F = A.frequentation;
  const eleve = new Map(D.E.map((e) => [e.mat, e]));
  const jours = (filtre: (e: (typeof D.E)[number]) => boolean) =>
    D.AE.filter((a) => {
      const d = new Date(a.date);
      const e = eleve.get(a.mat);
      return d.getUTCMonth() + 1 === F.mois && d.getUTCFullYear() === F.annee && e && filtre(e);
    }).reduce((s, a) => s + (a.jours ?? 0), 0);
  it("l'année d'octobre est l'année de début", () => expect(anneeDuMois(10, parseInt(D.PAR.annee, 10))).toBe(F.annee));
  for (const c of NIVEAUX) {
    it(c, () => {
      const l = D.E.filter((e) => e.classe === c);
      for (const s of ["M", "F"] as const) {
        const n = l.filter((e) => e.sexe === s).length;
        expect(tauxFrequentation(jours((e) => e.classe === c && e.sexe === s), n, F.jours)).toBeCloseTo(F.classes[c][s], 12);
      }
      expect(tauxFrequentation(jours((e) => e.classe === c), l.length, F.jours)).toBeCloseTo(F.classes[c].T, 12);
    });
  }
  it("total de l'école", () => {
    expect(tauxFrequentation(jours(() => true), D.E.length, F.jours)).toBeCloseTo(F.total.T, 12);
  });
});

describe("SYNTHESE FIN D'ANNEE", () => {
  const parNiveau = NIVEAUX.map((c) => {
    const l = D.E.filter((e) => e.classe === c);
    const dec = (d: string) => l.filter((e) => resultats.get(e.mat)!.decision === d);
    return {
      c,
      inscrits: compterParSexe(l),
      presents: compterParSexe(l.filter((e) => e.statut === "PRESENT")),
      admis: compterParSexe(dec("ADMIS")),
      redoublants: compterParSexe(dec("REDOUBLE")),
    };
  });
  const probables = effectifsProbables(parNiveau, D.PAR.nouveauxCP1);
  parNiveau.forEach((x, i) => {
    it(x.c, () => {
      const s = A.synthese[x.c];
      expect([x.inscrits.M, x.inscrits.F]).toEqual(s.inscrits);
      expect([x.presents.M, x.presents.F]).toEqual(s.presents);
      expect([x.inscrits.M - x.presents.M, x.inscrits.F - x.presents.F]).toEqual(s.abandons);
      expect([x.admis.M, x.admis.F]).toEqual(s.admis);
      expect([x.redoublants.M, x.redoublants.F]).toEqual(s.redoublants);
      expect([probables[i].M, probables[i].F]).toEqual(s.probable);
    });
  });
});

describe("Règles unitaires", () => {
  it("arrondi comme ROUND d'Excel", () => {
    expect(arrondi2(2.675)).toBe(2.68);
    expect(arrondi2(1.005)).toBe(1.01);
    expect(arrondi2(6.8966)).toBe(6.9);
  });
  it("absent à une évaluation = 0, aucune note = vide", () => {
    const m = cfg("CE1", 0);
    expect(moyenneEvaluation("CE1", m, { present: false, notes: [40, 30, 30, 8] }, 10)).toBe(0);
    expect(moyenneEvaluation("CE1", m, { present: true, notes: [null, null, null, null] }, 10)).toBeNull();
    expect(moyenneEvaluation("CE1", m, null, 10)).toBeNull();
  });
  it("CE1 : seules les matières notées comptent au dénominateur", () => {
    expect(moyenneEvaluation("CE1", cfg("CE1", 0), { present: true, notes: [25, null, null, null] }, 10)).toBe(5);
  });
  it("CP : coefficient 0 = matière ignorée", () => {
    const m: MatiereCfg[] = [{ nom: "A", poids: 1 }, { nom: "B", poids: 0 }];
    expect(moyenneEvaluation("CP", m, { present: true, notes: [8, 2] }, 10)).toBe(8);
  });
  it("MGA CM2 vide si une des 4 évaluations manque", () => {
    expect(resultatAnnuel("CM2", "PRESENT", [12, 12, null, 12], 10, 20).mga).toBeNull();
  });
  it("MGA CP1-CM1 vide sans composition de passage", () => {
    expect(resultatAnnuel("CE2", "PRESENT", [6, 6, 6, null], 5, 10)).toMatchObject({ mga: null, decision: "" });
  });
  it("décision au seuil exact = ADMIS, transféré conservé", () => {
    expect(resultatAnnuel("CM1", "PRESENT", [5, 5, 5, 5], 5, 10).decision).toBe("ADMIS");
    expect(resultatAnnuel("CM1", "TRANSFERE", [9, 9, 9, 9], 5, 10)).toMatchObject({ decision: "TRANSFERE", observation: "" });
  });
  it("rangs ex æquo", () => {
    const r = calculerRangs([
      { id: "a", statut: "PRESENT" as Statut, mga: 7 },
      { id: "b", statut: "PRESENT" as Statut, mga: 7 },
      { id: "c", statut: "PRESENT" as Statut, mga: 6 },
      { id: "d", statut: "ABANDON" as Statut, mga: 9 },
    ]);
    expect([...r.values()]).toEqual([1, 1, 3, null]);
  });
  it("note hors barème refusée", () => {
    expect(noteValide(51, "CE1", { nom: "EXPLOITATION DE TEXTE", poids: 50 })).toBe(false);
    expect(noteValide(10, "CP", { nom: "LECTURE", poids: 1 })).toBe(true);
    expect(noteValide(10.5, "CP", { nom: "LECTURE", poids: 1 })).toBe(false);
  });
  it("matricule école et DESPS", () => {
    expect(matriculeEcole("CP1", 1, 2026)).toBe("CP1-001-26");
    expect(despsValide("A12345678")).toBe(true);
    expect(despsValide("12345678B")).toBe(true);
    expect(despsValide("123456789")).toBe(false);
    expect(despsValide("A1234567")).toBe(false);
  });
  it("âges et ancienneté identiques au classeur", () => {
    for (const e of D.E) expect(anneesRevolues(e.naiss, D.PAR.dateRefAge)).toBe(e.age);
    for (const p of D.P) {
      expect(anneesRevolues(p.naiss, D.PAR.dateRefAge)).toBe(p.age);
      expect(anneesRevolues(p.priseService, D.PAR.dateEdition)).toBe(p.anc);
    }
  });
  it("sur-âge basé sur l'âge (écart signalé au classeur)", () => {
    expect(estEnSurAge(9, "CP1")).toBe(true);
    expect(estEnSurAge(8, "CP1")).toBe(false);
  });
  it("évaluation du mois selon le calendrier", () => {
    const cal = D.PAR.calendrier;
    expect(evaluationDuMois(cal.map((r) => r[1]), 12, 2026)).toBe(0);
    expect(evaluationDuMois(cal.map((r) => r[2]), 4, 2027)).toBe(3);
    expect(evaluationDuMois(cal.map((r) => r[1]), 10, 2026)).toBe(-1);
  });
  it("rapport de composition : présents, absents, admis", () => {
    const s = statistiquesComposition(
      [
        { sexe: "M" as Sexe, present: true, moyenne: 6 },
        { sexe: "F" as Sexe, present: false, moyenne: 0 },
        { sexe: "F" as Sexe, present: true, moyenne: 4 },
      ],
      5,
    );
    expect(s).toMatchObject({ presents: { M: 1, F: 1 }, absents: { M: 0, F: 1 }, admis: { M: 1, F: 0 } });
  });
});
