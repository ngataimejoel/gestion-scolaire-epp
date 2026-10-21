/* =====================================================================================
   Tests unitaires : calculs scolaires (src/js/domain/calc.js).
   Toutes les valeurs attendues sont calculées à la main à partir des règles officielles
   reprises d'AKWA SCHOOL 1.7.0 (src/js/core/config.js) :
     - CP1/CP2 (grille CP, mode COEF) : moyenne = Σ note×coef ÷ Σ coef, notes sur 10 ;
     - CE1 (BARÈME 50/40/40/10) et CE2/CM1 (BARÈME 50/50/50/20) : Σ notes ÷ Σ barèmes × 10 ;
     - CM2 (BARÈME 50/50/50/20 + EPS 20 aux évaluations 3 et 4) : Σ notes ÷ Σ barèmes × 20 ;
     - absent à une évaluation : moyenne 0 ; notes manquantes : seules les notes saisies comptent ;
     - MGA CP1→CM1 : (moyenne des 3 compositions + 2 × composition de passage) ÷ 3 ;
       MGA CM2 (MOYENNE4) : moyenne des 4 évaluations, toutes nécessaires ;
     - seuil d'admission : 5/10 (CP1→CM1), 10/20 (CM2) ; arrondi au centième (demi vers le haut).
   Exécution : node --test tests/unit/
   ===================================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger.cjs');

const TOUS = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
/** Copie « neutre » (objets du contexte isolé → objets ordinaires) pour comparer en profondeur. */
const j = (x) => JSON.parse(JSON.stringify(x));

function etatVide(extra = {}) {
  return {
    school: { year: '2026–2027', niveaux: TOUS.slice() },
    students: [], teachers: [], grades: {}, compAbs: {}, att: {}, conges: [], cpMat: {}, cpExtra: [],
    ...extra
  };
}
function eleve(id, classe, extra = {}) {
  return { id, nom: 'NOM' + id.toUpperCase(), prenoms: 'Prénom', classe, statut: 'Inscrit', sexe: 'Masculin', decision: '', ...extra };
}
/** Enregistre les notes d'une évaluation : { matière: note } */
function noter(etat, id, n, notes) {
  for (const [m, v] of Object.entries(notes)) etat.grades[`${id}|${n}|${m}`] = v;
}
/* Répartitions de notes réutilisées (totaux vérifiés à la main) */
const CE = (et, ev, ma, di) => ({ 'EXPLOITATION DE TEXTE': et, 'EVEIL AU MILIEU': ev, MATHEMATIQUES: ma, DICTEE: di });
const CM2_34 = (et, ev, ma, di, eps) => ({ ...CE(et, ev, ma, di), 'EPREUVES PHYSIQUES': eps });

function charge(etat) {
  const AK = charger(['js/domain/calc.js'], { etat });
  return { AK, X: AK.calc };
}

/* ======================================================================== grilles */
test.describe('Moyenne d’une évaluation selon la grille', () => {
  test('CP1 (mode COEF) : 8 matières de coefficient 1, notes sur 10, total 59 → moyenne 7,38 (59 ÷ 8 = 7,375 arrondi au centième supérieur)', () => {
    const etat = etatVide({ students: [eleve('cp', 'CP1')] });
    noter(etat, 'cp', 1, {
      ECRITURE: 8, 'E.D.H.C': 7, 'EXPRESSION ECRITE': 6, MATHEMATIQUE: 9, ORTHOGRAPHE: 5, DESSIN: 10, 'CHANT ET POESIE': 7.5, LECTURE: 6.5
    });
    const { X } = charge(etat);
    assert.equal(X.grille('CP1').mode, 'COEF');
    assert.equal(X.echelle('CP1'), 10);
    assert.equal(X.matieres('CP1', 1).length, 8, 'le CP compte 8 matières');
    assert.ok(X.matieres('CP1', 1).every(([, c]) => c === 1), 'toutes les matières du CP ont le coefficient 1');
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 59, moy: 7.38 });
    assert.equal(X.moyEval(etat.students[0], 1), 7.38);
  });

  test('CP2 suit la même grille que le CP1 (COEF, note maximale 10 quelle que soit la matière)', () => {
    const etat = etatVide({ students: [eleve('c2', 'CP2')] });
    noter(etat, 'c2', 2, { ECRITURE: 10, LECTURE: 4 });
    const { X } = charge(etat);
    assert.equal(X.grille('CP2').mode, 'COEF');
    assert.equal(X.noteMax('CP2', 1), 10);
    assert.equal(X.noteMax('CP2', 50), 10, 'en mode COEF le maximum est celui de la grille, pas le poids');
    assert.deepEqual(j(X.resultat(etat.students[0], 2)), { total: 14, moy: 7 });
  });

  test('CE1 (BARÈME 50/40/40/10, échelle 10) : 35 + 28 + 30 + 7 = 100 sur 140 → 7,14', () => {
    const etat = etatVide({ students: [eleve('e1', 'CE1')] });
    noter(etat, 'e1', 1, CE(35, 28, 30, 7));
    const { X } = charge(etat);
    assert.equal(X.grille('CE1').mode, 'BAREME');
    assert.deepEqual(j(X.matieres('CE1', 1)), [['EXPLOITATION DE TEXTE', 50], ['EVEIL AU MILIEU', 40], ['MATHEMATIQUES', 40], ['DICTEE', 10]]);
    assert.equal(X.noteMax('CE1', 10), 10, 'la dictée du CE1 est notée sur 10');
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 100, moy: 7.14 });
  });

  test('CE2 (BARÈME 50/50/50/20, échelle 10) : 40 + 30 + 25 + 15 = 110 sur 170 → 6,47', () => {
    const etat = etatVide({ students: [eleve('e2', 'CE2')] });
    noter(etat, 'e2', 1, CE(40, 30, 25, 15));
    const { X } = charge(etat);
    assert.deepEqual(j(X.matieres('CE2', 1)), [['EXPLOITATION DE TEXTE', 50], ['EVEIL AU MILIEU', 50], ['MATHEMATIQUES', 50], ['DICTEE', 20]]);
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 110, moy: 6.47 });
  });

  test('CM1 partage la grille du CE2 : 45 + 42 + 38 + 17 = 142 sur 170 → 8,35', () => {
    const etat = etatVide({ students: [eleve('m1', 'CM1')] });
    noter(etat, 'm1', 2, CE(45, 42, 38, 17));
    const { X } = charge(etat);
    assert.equal(X.info('CM1').grille, 'CE2-CM1');
    assert.deepEqual(j(X.resultat(etat.students[0], 2)), { total: 142, moy: 8.35 });
  });

  test('CM2 évaluations 1 et 2 (BARÈME sur 170, échelle 20) : 40 + 35 + 30 + 15 = 120 → 14,12 / 20', () => {
    const etat = etatVide({ students: [eleve('m2', 'CM2')] });
    noter(etat, 'm2', 1, CE(40, 35, 30, 15));
    const { X } = charge(etat);
    assert.equal(X.echelle('CM2'), 20);
    assert.equal(X.matieres('CM2', 1).length, 4, 'pas d’EPS aux deux premières évaluations');
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 120, moy: 14.12 });
  });

  test('CM2 évaluations 3 et 4 : l’EPS (sur 20) s’ajoute, 40 + 35 + 30 + 15 + 18 = 138 sur 190 → 14,53 / 20', () => {
    const etat = etatVide({ students: [eleve('m2', 'CM2')] });
    noter(etat, 'm2', 3, CM2_34(40, 35, 30, 15, 18));
    const { X } = charge(etat);
    assert.deepEqual(j(X.matieres('CM2', 3)).at(-1), ['EPREUVES PHYSIQUES', 20]);
    assert.equal(X.matieres('CM2', 4).length, 5);
    assert.deepEqual(j(X.resultat(etat.students[0], 3)), { total: 138, moy: 14.53 });
  });

  test('CP : seules les matières choisies pour la composition comptent (matière ajoutée comprise)', () => {
    const etat = etatVide({
      students: [eleve('cp', 'CP1')],
      cpExtra: ['CALCUL MENTAL'],
      cpMat: { CP1: { 1: ['ECRITURE', 'LECTURE', 'CALCUL MENTAL'] } }
    });
    noter(etat, 'cp', 1, { ECRITURE: 6, LECTURE: 8, 'CALCUL MENTAL': 10, DESSIN: 2 });
    const { X } = charge(etat);
    assert.deepEqual(j(X.matieres('CP1', 1)), [['ECRITURE', 1], ['LECTURE', 1], ['CALCUL MENTAL', 1]]);
    assert.equal(X.matieres('CP1', 2).length, 8, 'les autres compositions gardent la liste officielle');
    assert.equal(X.matieres('CP2', 1).length, 8, 'le choix du CP1 ne touche pas le CP2');
    // DESSIN n'est pas au programme de cette composition : (6 + 8 + 10) ÷ 3 = 8
    assert.equal(X.moyEval(etat.students[0], 1), 8);
  });
});

/* ======================================================================== absences, notes manquantes */
test.describe('Absence à une évaluation et notes manquantes', () => {
  test('élève absent : total 0, moyenne 0, même si une note traîne pour cette évaluation', () => {
    const etat = etatVide({ students: [eleve('a', 'CE2')], compAbs: { 'a|2': true } });
    noter(etat, 'a', 2, { DICTEE: 18 });
    const { X } = charge(etat);
    assert.equal(X.estAbsent('a', 2), true);
    assert.deepEqual(j(X.resultat(etat.students[0], 2)), { total: 0, moy: 0, abs: true });
    assert.equal(X.moyEval(etat.students[0], 2), 0);
    assert.equal(X.score(etat.students[0], 2), null, 'un absent n’est pas classé pour cette évaluation');
  });

  test('notes manquantes en BARÈME : seuls les barèmes des notes saisies comptent (25/50 + 5/10 = 30/60 → 5)', () => {
    const etat = etatVide({ students: [eleve('n', 'CE1')] });
    noter(etat, 'n', 1, { 'EXPLOITATION DE TEXTE': 25, DICTEE: 5 });
    const { X } = charge(etat);
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 30, moy: 5 });
  });

  test('notes manquantes en COEF : 8 + 6 + 7 sur 3 matières → 7', () => {
    const etat = etatVide({ students: [eleve('n', 'CP1')] });
    noter(etat, 'n', 1, { ECRITURE: 8, LECTURE: 6, DESSIN: 7 });
    const { X } = charge(etat);
    assert.deepEqual(j(X.resultat(etat.students[0], 1)), { total: 21, moy: 7 });
  });

  test('aucune note saisie : pas de résultat (null), différent d’un absent (0)', () => {
    const etat = etatVide({ students: [eleve('v', 'CE2')] });
    const { X } = charge(etat);
    assert.equal(X.resultat(etat.students[0], 1), null);
    assert.equal(X.moyEval(etat.students[0], 1), null);
  });

  test('notesManquantes : compte les cases vides des inscrits non absents (classe ou école entière)', () => {
    const etat = etatVide({
      students: [
        eleve('p1', 'CE2'), // 2 notes sur 4 → 2 manquantes
        eleve('p2', 'CE2'), // aucune note → 4
        eleve('p3', 'CE2'), // absent → 0
        eleve('p4', 'CE2', { statut: 'Abandon' }), // parti → ignoré
        eleve('p5', 'CE1'), // autre classe, aucune note → 4 (compte seulement pour l'école)
        eleve('p6', 'CM2') // CM2 évaluation 3 : 5 matières (EPS comprise)
      ],
      compAbs: { 'p3|1': true }
    });
    noter(etat, 'p1', 1, { DICTEE: 12, MATHEMATIQUES: 30 });
    const { X } = charge(etat);
    assert.equal(X.notesManquantes('CE2', 1), 6);
    assert.equal(X.notesManquantes('CE1', 1), 4);
    assert.equal(X.notesManquantes(null, 1), 6 + 4 + 4, 'école entière : CE2 (6) + CE1 (4) + CM2 (4)');
    assert.equal(X.notesManquantes('CM2', 3), 5);
  });
});

/* ======================================================================== MGA */
test.describe('Moyenne générale annuelle (MGA)', () => {
  /* CE2 : moyenne = total ÷ 17 ; 102 → 6, 119 → 7, 136 → 8, 85 → 5 */
  function ce2(compo, extra = {}) {
    const etat = etatVide({ students: [eleve('s', 'CE2', extra)] });
    const rep = { 102: CE(30, 30, 30, 12), 119: CE(35, 35, 35, 14), 136: CE(40, 40, 40, 16), 85: CE(25, 25, 25, 10), 68: CE(20, 20, 20, 8) };
    compo.forEach((t, i) => {
      if (t === 'abs') etat.compAbs['s|' + (i + 1)] = true;
      else if (t != null) noter(etat, 's', i + 1, rep[t]);
    });
    return etat;
  }

  test('règle « 3 compositions + 2 × passage » : compositions 6, 7, 8 et passage 5 → (7 + 2 × 5) ÷ 3 = 5,67 → Admis', () => {
    const etat = ce2([102, 119, 136, 85]);
    const { X } = charge(etat);
    const s = etat.students[0];
    assert.deepEqual(j([1, 2, 3, 4].map((n) => X.moyEval(s, n))), [6, 7, 8, 5]);
    assert.equal(X.moy3(s), 7);
    assert.equal(X.info('CE2').regle, 'STANDARD');
    assert.equal(X.mga(s), 5.67);
    assert.equal(X.decisionProposee(s), 'Admis');
    assert.equal(X.mention(X.mga(s), 'CE2'), 'Passable');
  });

  test('absent à la 2e composition (0) : moyenne des 3 compositions (6 + 0 + 8) ÷ 3 = 4,67 ; MGA (4,67 + 10) ÷ 3 = 4,89 → Redoublant', () => {
    const etat = ce2([102, 'abs', 136, 85]);
    const { X } = charge(etat);
    const s = etat.students[0];
    assert.equal(X.moy3(s), 4.67);
    assert.equal(X.mga(s), 4.89);
    assert.equal(X.decisionProposee(s), 'Redoublant');
  });

  test('composition non saisie (non absente) : la moyenne des compositions porte sur celles saisies, (6 + 8) ÷ 2 = 7 → MGA 5,67', () => {
    const etat = ce2([102, null, 136, 85]);
    const { X } = charge(etat);
    assert.equal(X.moy3(etat.students[0]), 7);
    assert.equal(X.mga(etat.students[0]), 5.67);
  });

  test('sans composition de passage, ou sans aucune des 3 compositions : pas de MGA ni de décision proposée', () => {
    const sansPassage = ce2([102, 119, 136, null]);
    let { X } = charge(sansPassage);
    assert.equal(X.mga(sansPassage.students[0]), null);
    assert.equal(X.decisionProposee(sansPassage.students[0]), '');
    const passageSeul = ce2([null, null, null, 85]);
    ({ X } = charge(passageSeul));
    assert.equal(X.mga(passageSeul.students[0]), null);
  });

  test('seuil 5/10 inclus : MGA exactement 5 → Admis ; compositions 4 partout → MGA 4 → Redoublant', () => {
    const juste = ce2([85, 85, 85, 85]);
    let { X } = charge(juste);
    assert.equal(X.mga(juste.students[0]), 5);
    assert.equal(X.decisionProposee(juste.students[0]), 'Admis');
    const faible = ce2([68, 68, 68, 68]);
    ({ X } = charge(faible));
    assert.equal(X.mga(faible.students[0]), 4);
    assert.equal(X.decisionProposee(faible.students[0]), 'Redoublant');
  });

  /* CM2 : évaluations 1-2 → total × 20 ÷ 170 ; évaluations 3-4 → total × 20 ÷ 190 */
  function cm2(evals) {
    const etat = etatVide({ students: [eleve('m', 'CM2')] });
    const rep12 = { 68: CE(20, 20, 20, 8), 85: CE(25, 25, 25, 10), 102: CE(30, 30, 30, 12), 119: CE(35, 35, 35, 14) };
    const rep34 = { 95: CM2_34(25, 25, 25, 10, 10), 152: CM2_34(40, 40, 40, 16, 16) };
    evals.forEach((t, i) => {
      if (t === 'abs') etat.compAbs['m|' + (i + 1)] = true;
      else if (t != null) noter(etat, 'm', i + 1, (i < 2 ? rep12 : rep34)[t]);
    });
    return etat;
  }

  test('règle MOYENNE4 (CM2) : 12, 14, 10, 16 → (12 + 14 + 10 + 16) ÷ 4 = 13 / 20 → Admis, mention Assez bien', () => {
    const etat = cm2([102, 119, 95, 152]);
    const { X } = charge(etat);
    const s = etat.students[0];
    assert.equal(X.info('CM2').regle, 'MOYENNE4');
    assert.deepEqual(j([1, 2, 3, 4].map((n) => X.moyEval(s, n))), [12, 14, 10, 16]);
    assert.equal(X.mga(s), 13);
    assert.equal(X.decisionProposee(s), 'Admis');
    assert.equal(X.mention(13, 'CM2'), 'Assez bien');
  });

  test('CM2 : une évaluation non saisie suffit à rendre la MGA incomplète (contrairement aux autres niveaux)', () => {
    const etat = cm2([102, 119, 95, null]);
    const { X } = charge(etat);
    assert.equal(X.mga(etat.students[0]), null);
    assert.equal(X.decisionProposee(etat.students[0]), '');
  });

  test('CM2 absent au 1er examen blanc : 0 compte, (12 + 14 + 0 + 16) ÷ 4 = 10,5 → Admis', () => {
    const etat = cm2([102, 119, 'abs', 152]);
    const { X } = charge(etat);
    assert.equal(X.mga(etat.students[0]), 10.5);
    assert.equal(X.decisionProposee(etat.students[0]), 'Admis');
  });

  test('CM2 seuil 10/20 : 8, 10, 10, 10 → 9,5 → Redoublant ; 10 partout → 10 → Admis', () => {
    const faible = cm2([68, 85, 95, 95]);
    let { X } = charge(faible);
    assert.equal(X.mga(faible.students[0]), 9.5);
    assert.equal(X.decisionProposee(faible.students[0]), 'Redoublant');
    assert.equal(X.mention(9.5, 'CM2'), 'Insuffisant');
    const juste = cm2([85, 85, 95, 95]);
    ({ X } = charge(juste));
    assert.equal(X.mga(juste.students[0]), 10);
    assert.equal(X.decisionProposee(juste.students[0]), 'Admis');
  });

  test('seuils et barèmes par classe : 5/10 du CP1 au CM1, 10/20 au CM2', () => {
    const { X } = charge(etatVide());
    for (const c of ['CP1', 'CP2', 'CE1', 'CE2', 'CM1']) {
      assert.equal(X.info(c).seuil, 5, c);
      assert.equal(X.info(c).bareme, 10, c);
    }
    assert.equal(X.info('CM2').seuil, 10);
    assert.equal(X.info('CM2').bareme, 20);
  });
});

/* ======================================================================== décision, mention */
test.describe('Décision et mention', () => {
  test('décision proposée : élève parti → son statut ; décision fixée à la main prioritaire', () => {
    const etat = etatVide({ students: [eleve('x', 'CE2', { statut: 'Transféré' }), eleve('y', 'CE2', { decision: 'Admis' })] });
    const { X } = charge(etat);
    assert.equal(X.decisionProposee(etat.students[0]), 'Transféré');
    assert.equal(X.decisionProposee(etat.students[1]), '', 'sans note, aucune proposition');
    assert.equal(X.decision(etat.students[1]), 'Admis');
  });

  test('mention (note ramenée sur 10) : seuils 8 / 7 / 6 / 5 inclus, sur 10 et sur 20', () => {
    const { X } = charge(etatVide());
    const sur10 = [[10, 'Très bien'], [8, 'Très bien'], [7.99, 'Bien'], [7, 'Bien'], [6.99, 'Assez bien'], [6, 'Assez bien'], [5, 'Passable'], [4.99, 'Insuffisant'], [0, 'Insuffisant']];
    sur10.forEach(([v, m]) => assert.equal(X.mention(v, 'CE2'), m, `${v}/10`));
    const sur20 = [[16, 'Très bien'], [15.98, 'Bien'], [14, 'Bien'], [12, 'Assez bien'], [10, 'Passable'], [9.98, 'Insuffisant']];
    sur20.forEach(([v, m]) => assert.equal(X.mention(v, 'CM2'), m, `${v}/20`));
    assert.equal(X.mention(null, 'CE2'), '—');
  });
});

/* ======================================================================== classement */
test.describe('Classement, moyenne de classe et réussite', () => {
  function classe() {
    const etat = etatVide({
      students: [
        eleve('b1', 'CE2', { nom: 'BAMBA', prenoms: 'Awa' }), // 136 → 8
        eleve('b2', 'CE2', { nom: 'KONE', prenoms: 'Ali' }), // 119 → 7
        eleve('b3', 'CE2', { nom: 'AKA', prenoms: 'Rose' }), // 119 → 7
        eleve('b4', 'CE2', { nom: 'TRAORE', prenoms: 'Inès' }), // 85 → 5
        eleve('b9', 'CE2', { nom: 'OUATTARA', prenoms: 'Zié' }), // 68 → 4
        eleve('b5', 'CE2', { nom: 'YAO', prenoms: 'Paul' }), // aucune note
        eleve('b6', 'CE2', { nom: 'DIALLO', prenoms: 'Sita' }), // absent
        eleve('b7', 'CE2', { nom: 'COULIBALY', prenoms: 'Jean', statut: 'Abandon' }), // parti
        eleve('b8', 'CE1', { nom: 'KOFFI', prenoms: 'Marc' }) // autre classe
      ],
      compAbs: { 'b6|1': true }
    });
    noter(etat, 'b1', 1, CE(40, 40, 40, 16));
    noter(etat, 'b2', 1, CE(35, 35, 35, 14));
    noter(etat, 'b3', 1, CE(35, 35, 35, 14));
    noter(etat, 'b4', 1, CE(25, 25, 25, 10));
    noter(etat, 'b9', 1, CE(20, 20, 20, 8));
    noter(etat, 'b7', 1, CE(50, 50, 50, 20));
    noter(etat, 'b8', 1, CE(50, 40, 40, 10));
    return etat;
  }

  test('ex aequo : même rang, rang suivant sauté (8 → 1er ; 7 et 7 → 2e ; 5 → 4e ; 4 → 5e), départage alphabétique de l’affichage', () => {
    const { X } = charge(classe());
    const { w, all } = X.classement('CE2', 1);
    assert.deepEqual(j(w.map((x) => [x.s.nom, x.avg, x.rank])), [
      ['BAMBA', 8, 1], ['AKA', 7, 2], ['KONE', 7, 2], ['TRAORE', 5, 4], ['OUATTARA', 4, 5]
    ]);
    assert.deepEqual(j(all.slice(w.length).map((x) => x.s.nom)), ['DIALLO', 'YAO'], 'non classés (absent, sans note) à la fin, par ordre alphabétique');
    assert.ok(!all.some((x) => x.s.nom === 'COULIBALY' || x.s.nom === 'KOFFI'), 'ni les élèves partis ni ceux d’une autre classe');
  });

  test('rangTxt : 1er, 2e, 4e ; pas de rang → —', () => {
    const { X } = charge(etatVide());
    assert.equal(X.rangTxt(1), '1er');
    assert.equal(X.rangTxt(2), '2e');
    assert.equal(X.rangTxt(4), '4e');
    assert.equal(X.rangTxt(undefined), '—');
    assert.equal(X.rangTxt(0), '—');
  });

  test('moyClasse : (8 + 7 + 7 + 5 + 4) ÷ 5 = 6,2 (absent, sans note, partis et autres classes exclus)', () => {
    const { X } = charge(classe());
    assert.equal(X.moyClasse('CE2', 1), 6.2);
    assert.equal(X.moyClasse('CM1', 1), null, 'classe sans note : pas de moyenne');
  });

  test('reussite : 4 élèves sur 5 atteignent le seuil de 5 (5 inclus, 4 non)', () => {
    const { X } = charge(classe());
    assert.deepEqual(j(X.reussite('CE2', 1)), { n: 5, ok: 4 });
  });

  test('classement annuel (MGA) d’une classe de CM2 et réussite au seuil de 10', () => {
    const etat = etatVide({
      students: [eleve('h', 'CM2', { nom: 'HAUT', prenoms: 'A' }), eleve('l', 'CM2', { nom: 'LIMITE', prenoms: 'B' }), eleve('i', 'CM2', { nom: 'INCOMPLET', prenoms: 'C' })]
    });
    // HAUT : 12, 14, 10, 16 → 13 ; LIMITE : 10 partout → 10 ; INCOMPLET : 3 évaluations seulement → pas de MGA
    noter(etat, 'h', 1, CE(30, 30, 30, 12)); noter(etat, 'h', 2, CE(35, 35, 35, 14));
    noter(etat, 'h', 3, CM2_34(25, 25, 25, 10, 10)); noter(etat, 'h', 4, CM2_34(40, 40, 40, 16, 16));
    noter(etat, 'l', 1, CE(25, 25, 25, 10)); noter(etat, 'l', 2, CE(25, 25, 25, 10));
    noter(etat, 'l', 3, CM2_34(25, 25, 25, 10, 10)); noter(etat, 'l', 4, CM2_34(25, 25, 25, 10, 10));
    noter(etat, 'i', 1, CE(50, 50, 50, 20)); noter(etat, 'i', 2, CE(50, 50, 50, 20)); noter(etat, 'i', 3, CM2_34(50, 50, 50, 20, 20));
    const { X } = charge(etat);
    const { w } = X.classement('CM2', 'A');
    assert.deepEqual(j(w.map((x) => [x.s.nom, x.avg, x.rank])), [['HAUT', 13, 1], ['LIMITE', 10, 2]]);
    assert.deepEqual(j(X.reussite('CM2', 'A')), { n: 2, ok: 2 });
    assert.equal(X.moyClasse('CM2', 'A'), 11.5);
  });
});

/* ======================================================================== âges */
test.describe('Âge à la rentrée (1er octobre de l’année scolaire)', () => {
  const age = (naissance, classe = 'CP1') => {
    const etat = etatVide({ students: [eleve('a', classe, { naissance })] });
    const { X } = charge(etat);
    return { a: X.ageDe(etat.students[0]), anormal: X.ageAnormal(etat.students[0]), X };
  };

  test('rentrée 2026–2027 : âge calculé au 1er octobre 2026', () => {
    assert.equal(age('2020-09-30').X.anneeRentree(), 2026);
    assert.equal(age('2020-09-30').a, 6, 'anniversaire avant le 1er octobre : 6 ans révolus');
    assert.equal(age('2020-10-01').a, 6, 'anniversaire le 1er octobre : compte déjà');
    assert.equal(age('2020-10-02').a, 5, 'anniversaire après le 1er octobre : pas encore 6 ans');
    assert.equal(age('2020-01-15').a, 6);
    assert.equal(age('2020-12-31').a, 5);
  });

  test('sans date de naissance : âge inconnu (null), jamais anormal', () => {
    const r = age('');
    assert.equal(r.a, null);
    assert.equal(r.anormal, false);
  });

  test('âge anormal : 3 ans ou plus au-dessus de l’âge normal du niveau (CP1 : 6 ans, CM2 : 11 ans)', () => {
    assert.equal(age('2017-10-01', 'CP1').a, 9);
    assert.equal(age('2017-10-01', 'CP1').anormal, true, 'CP1 à 9 ans : 6 + 3');
    assert.equal(age('2017-10-02', 'CP1').a, 8);
    assert.equal(age('2017-10-02', 'CP1').anormal, false, 'CP1 à 8 ans : écart de 2 seulement');
    assert.equal(age('2012-09-15', 'CM2').anormal, true, 'CM2 à 14 ans');
    assert.equal(age('2013-09-15', 'CM2').anormal, false, 'CM2 à 13 ans');
  });
});

/* ======================================================================== calendrier */
test.describe('Jours de classe (lundi, mardi, jeudi, vendredi ; congés exclus)', () => {
  test('semaine du lundi 19 au dimanche 25 octobre 2026 : 4 jours, mercredi et week-end exclus', () => {
    const { X } = charge(etatVide());
    assert.deepEqual(j(X.joursClasse('2026-10-19', '2026-10-25', [])), ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23']);
    assert.equal(X.estJourClasse('2026-10-21', []), false, 'mercredi');
    assert.equal(X.estJourClasse('2026-10-24', []), false, 'samedi');
    assert.equal(X.estJourClasse('2026-10-22', []), true, 'jeudi');
  });

  test('un congé d’un jour (jeudi 22) et une période de congés (mardi 20 → lundi 26 inclus) sont exclus', () => {
    const { X } = charge(etatVide());
    assert.deepEqual(j(X.joursClasse('2026-10-19', '2026-10-25', [{ du: '2026-10-22', au: '' }])), ['2026-10-19', '2026-10-20', '2026-10-23']);
    assert.deepEqual(j(X.joursClasse('2026-10-19', '2026-10-30', [{ du: '2026-10-20', au: '2026-10-26' }])), ['2026-10-19', '2026-10-27', '2026-10-29', '2026-10-30']);
  });

  test('sans liste fournie, les congés de l’école (état) sont utilisés ; passage d’un mois à l’autre', () => {
    const { X } = charge(etatVide({ conges: [{ id: 'c', lib: 'Férié', du: '2026-11-02', au: '' }] }));
    assert.deepEqual(j(X.joursClasse('2026-11-02', '2026-11-06')), ['2026-11-03', '2026-11-05', '2026-11-06']);
    assert.deepEqual(j(X.joursClasse('2026-10-29', '2026-11-03', [])), ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03']);
  });

  test('période vide ou inversée : aucun jour', () => {
    const { X } = charge(etatVide());
    assert.deepEqual(j(X.joursClasse('2026-10-23', '2026-10-19', [])), []);
    assert.deepEqual(j(X.joursClasse('', '2026-10-19', [])), []);
  });

  test('derniersJoursClasse : les 3 derniers jours de classe jusqu’au vendredi 23 octobre 2026', () => {
    const { X } = charge(etatVide());
    assert.deepEqual(j(X.derniersJoursClasse(3, '2026-10-23', [])), ['2026-10-20', '2026-10-22', '2026-10-23']);
  });
});

/* ======================================================================== niveaux */
test.describe('Niveaux et évaluations', () => {
  test('niveauSuivant : CP1 → CP2 → CE1 → CE2 → CM1 → CM2 → aucun', () => {
    const { X } = charge(etatVide());
    assert.deepEqual(j(TOUS.map(X.niveauSuivant)), ['CP2', 'CE1', 'CE2', 'CM1', 'CM2', null]);
  });

  test('niveauSuivant d’un niveau inconnu : aucun niveau suivant (null)', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    const { X } = charge(etatVide());
    assert.equal(X.niveauSuivant(''), null);
    assert.equal(X.niveauSuivant('CM3'), null);
  });

  test('niveaux ouverts : ordre officiel CP1 → CM2 quel que soit l’ordre enregistré ; aucun → tous', () => {
    let { X } = charge(etatVide({ school: { year: '2026–2027', niveaux: ['CM2', 'CP1', 'CE1'] } }));
    assert.deepEqual(j(X.niveaux()), ['CP1', 'CE1', 'CM2']);
    ({ X } = charge(etatVide({ school: { year: '2026–2027', niveaux: [] } })));
    assert.deepEqual(j(X.niveaux()), TOUS);
  });

  test('libellés et dates des évaluations (calendrier standard et calendrier du CM2)', () => {
    const { X } = charge(etatVide());
    assert.equal(X.evalLabel('CE1', 4), 'Composition de passage');
    assert.equal(X.evalLabel('CM2', 3), '1er examen blanc');
    assert.equal(X.evalLabel('CM2', 4), '2e examen blanc');
    assert.equal(X.evalDate('CE2', 1), '2026-12-09');
    assert.equal(X.evalDate('CE2', 4), '2027-06-16');
    assert.equal(X.evalDate('CM2', 4), '2027-04-27');
    assert.equal(X.perLabel('A'), 'Annuel (MGA)');
  });
});
