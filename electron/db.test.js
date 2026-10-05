const test = require("node:test");
const assert = require("node:assert");
const { ouvrir, creerApi } = require("./db");

function nouvelleApi() {
  return creerApi(ouvrir(":memory:"));
}

test("les matières par défaut sont créées pour chaque niveau", () => {
  const api = nouvelleApi();
  const cm2 = api.matieres("CM2");
  assert.strictEqual(cm2.length, 11);
  assert.strictEqual(cm2.reduce((s, m) => s + m.bareme, 0), 170);
  assert.ok(api.matieres("CP1").length > 0);
});

test("refuse un matricule en double", () => {
  const api = nouvelleApi();
  api.enregistrerEleve({ nom: "Kone", matricule: "123A" });
  assert.throws(() => api.enregistrerEleve({ nom: "Traore", matricule: "123a" }), /existe déjà/);
});

test("l'import ignore les doublons et les lignes sans nom", () => {
  const api = nouvelleApi();
  const c = api.enregistrerClasse({ nom: "CM2 A", niveau: "CM2" });
  api.enregistrerEleve({ nom: "Kone", matricule: "1" });
  const r = api.importerEleves(c, [
    { nom: "Ballo", prenoms: "Mariam", sexe: "F", matricule: "2" },
    { nom: "Kone", matricule: "1" },
    { nom: "", matricule: "3" },
    { nom: "Boly", prenoms: "Aminata", sexe: "F" },
  ]);
  assert.deepStrictEqual(r, { ajoutes: 2, ignores: 2 });
  assert.strictEqual(api.eleves(c).length, 2);
});

test("calcule moyennes, rangs avec ex-aequo, absents et statistiques", () => {
  const api = nouvelleApi();
  const c = api.enregistrerClasse({ nom: "CM2 A", niveau: "CM2" });
  const a = api.enregistrerEleve({ nom: "A", sexe: "F", classe_id: c });
  const b = api.enregistrerEleve({ nom: "B", sexe: "M", classe_id: c });
  const d = api.enregistrerEleve({ nom: "D", sexe: "M", classe_id: c });
  const e = api.enregistrerEleve({ nom: "E", sexe: "F", classe_id: c });
  api.enregistrerEleve({ nom: "F", sexe: "F", classe_id: c }); // aucune note : non noté
  const comp = api.enregistrerComposition({ libelle: "Composition 1" });
  const mats = api.matieres("CM2");
  const plein = (id, f) => mats.map((m) => ({ eleve_id: id, matiere_id: m.id, note: m.bareme * f }));
  api.enregistrerNotes(comp, {
    notes: [...plein(a, 0.8), ...plein(b, 0.8), ...plein(d, 0.3)],
    absences: { [e]: true },
  });

  const r = api.resultats(comp, c);
  const parNom = Object.fromEntries(r.lignes.map((l) => [l.nom, l]));
  assert.strictEqual(parNom.A.moyenne, 8);
  assert.strictEqual(parNom.A.total, 136);
  assert.strictEqual(parNom.A.rang, 1);
  assert.strictEqual(parNom.B.rang, 1);
  assert.strictEqual(parNom.D.rang, 3);
  assert.strictEqual(parNom.D.admis, false);
  assert.strictEqual(parNom.E.absent, true);
  assert.strictEqual(parNom.E.rang, null);
  assert.strictEqual(parNom.F.appreciation, "Non noté");
  assert.strictEqual(parNom.F.rang, null);

  const s = api.rapport(comp);
  assert.deepStrictEqual(s.total.inscrits, { G: 2, F: 3, T: 5 });
  assert.deepStrictEqual(s.total.presents, { G: 2, F: 1, T: 3 });
  assert.deepStrictEqual(s.total.admis, { G: 1, F: 1, T: 2 });
  assert.strictEqual(s.total.taux.T, 66.67);

  const m = api.meilleurs(comp, "math", 1);
  assert.strictEqual(m[0].eleves.length, 2);
});

test("refuse une note au-dessus du barème", () => {
  const api = nouvelleApi();
  const c = api.enregistrerClasse({ nom: "CP1", niveau: "CP1" });
  const el = api.enregistrerEleve({ nom: "A", classe_id: c });
  const comp = api.enregistrerComposition({ libelle: "C1" });
  const m = api.matieres("CP1")[0];
  assert.throws(
    () => api.enregistrerNotes(comp, { notes: [{ eleve_id: el, matiere_id: m.id, note: m.bareme + 1 }] }),
    /Note invalide/
  );
});
