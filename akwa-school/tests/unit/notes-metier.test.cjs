/* =====================================================================================
   Tests unitaires : règles métier des notes, décisions, passage d'année, élèves, absences
   (src/js/domain/notes.js, eleves.js, absences.js).

   Profils : la vraie session (AK.session, security/auth.js) et les vraies règles de droits
   (AK.perm, security/perm.js) sont chargées ; on ouvre une session « directeur »
   ({ role: 'dir' }) ou « enseignant » ({ role: 'ens', tid }) comme le fait l'écran de connexion.
   Le magasin est simulé : modifier() applique la fonction et note le libellé du journal,
   copieAvant() mémorise la copie de sécurité demandée (motif, état au moment de la copie).
   ===================================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger.cjs');

const j = (x) => JSON.parse(JSON.stringify(x));
const TOUS = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const MODULES = [
  'js/data/schema.js', 'js/security/crypto.js', 'js/security/auth.js', 'js/security/perm.js',
  'js/domain/calc.js', 'js/domain/eleves.js', 'js/domain/personnel.js', 'js/domain/notes.js', 'js/domain/absences.js'
];

function eleve(id, nom, prenoms, classe, extra = {}) {
  return {
    id, nom, prenoms, classe, statut: 'Inscrit', sexe: 'Masculin', mat: '', matNat: '', decision: '', redoublant: false, parcours: [],
    pere: { nom: '', prenoms: '', profession: '', tel: '', domicile: '' }, mere: { nom: '', prenoms: '', profession: '', tel: '', domicile: '' },
    ...extra
  };
}

/**
 * Prépare une école (état vierge du schéma complété par `remplir`) et ouvre une session.
 * role : 'dir' (directeur) | 'ens' (enseignant t1, classe CE2) | null (personne de connecté)
 */
function preparer(remplir, { role = 'dir' } = {}) {
  const AK = charger(MODULES, { etat: null });
  const etat = AK.schema.vierge();
  Object.assign(etat.school, { name: 'EPP TEST 1', year: '2026–2027', niveaux: TOUS.slice(), validation: true });
  etat.teachers.push({ id: 't1', nom: 'Mme AKA Rose', classes: ['CE2'], classe: 'CE2', actif: true, compte: { login: 'aaka', actif: true } });
  etat.students.push(
    eleve('e1', 'KOUASSI', 'Mamadou', 'CE2', { mat: 'AK-26001' }),
    eleve('e2', 'BAMBA', 'Awa', 'CE2', { sexe: 'Féminin', mat: 'AK-26002' }),
    eleve('e3', 'TRAORE', 'Ali', 'CM2', { mat: 'AK-26003' }),
    eleve('e4', 'YAO', 'Serge', 'CE1'),
    eleve('e5', 'KONE', 'Ina', 'CE2', { statut: 'Abandon', sexe: 'Féminin' })
  );
  if (remplir) remplir(etat);
  const journal = [], copies = [];
  AK.store = {
    etat,
    modifier(libelle, f, options = {}) {
      const r = f(AK.store.etat);
      if (libelle && options.journal !== false) journal.push(libelle);
      return r;
    },
    journaliser(m) {
      journal.push(m);
    },
    async copieAvant(motif) {
      const S = AK.store.etat;
      copies.push({ motif, annee: S.school.year, notes: Object.keys(S.grades).length, eleves: S.students.length });
      return { id: 'copie-' + copies.length };
    }
  };
  AK.hote = { type: 'navigateur' };
  if (role === 'dir') AK.session.ouvrir({ role: 'dir' });
  else if (role === 'ens') AK.session.ouvrir({ role: 'ens', tid: 't1', login: 'aaka' });
  return { AK, etat, journal, copies };
}
const hier = (AK) => AK.u.ajouterJours(AK.u.aujourdhui(), -1);
const metier = (AK, motif) => (e) => e instanceof AK.ErreurMetier && !(e instanceof AK.ErreurDroits) && motif.test(e.message);
const droits = (AK) => (e) => e instanceof AK.ErreurDroits;

/* ======================================================================== profils */
test.describe('Profils simulés (session et droits réels)', () => {
  test('directeur : toutes les classes, tous les droits ; enseignant : sa classe seulement', () => {
    const d = preparer(null, { role: 'dir' });
    assert.equal(d.AK.session.estDirecteur(), true);
    assert.deepEqual(j(d.AK.session.classes()), TOUS);
    assert.equal(d.AK.perm.peut('notes.valider'), true);
    const e = preparer(null, { role: 'ens' });
    assert.equal(e.AK.session.estEnseignant(), true);
    assert.deepEqual(j(e.AK.session.classes()), ['CE2']);
    assert.equal(e.AK.perm.peut('notes.saisir', { classe: 'CE2' }), true);
    assert.equal(e.AK.perm.peut('notes.saisir', { classe: 'CM2' }), false);
    assert.equal(e.AK.perm.peut('notes.valider'), false);
    assert.equal(e.AK.perm.peut('annee.passer'), false);
    assert.equal(e.AK.perm.peut('notes.corriger'), false);
  });

  test('sans session ouverte : toute saisie est refusée', () => {
    const { AK } = preparer(null, { role: null });
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '12'), droits(AK));
  });
});

/* ======================================================================== saisie */
test.describe('Saisie des notes (directeur)', () => {
  test('note valide avec virgule décimale : enregistrée (15,5 / 20 en dictée de CE2)', () => {
    const { AK, etat, journal } = preparer();
    assert.deepEqual(j(AK.notes.saisir('e1', 1, 'DICTEE', '15,5')), { etat: 'ok', v: 15.5 });
    assert.equal(etat.grades['e1|1|DICTEE'], 15.5);
    assert.deepEqual(journal, [], 'une première saisie ne charge pas le journal');
  });

  test('notes invalides refusées sans rien enregistrer : hors barème, négative, texte, trop de décimales', () => {
    const { AK, etat } = preparer();
    const refus = (brut, motif, m = 'DICTEE', sid = 'e1') => assert.throws(() => AK.notes.saisir(sid, 1, m, brut), metier(AK, motif), `« ${brut} »`);
    refus('21', /dépasse le barème \(20\)/);
    refus('20,25', /dépasse le barème/);
    refus('-2', /Note invalide/);
    refus('abc', /Note invalide/);
    refus('1e1', /Note invalide/);
    refus('12.345', /deux décimales/);
    refus('51', /dépasse le barème \(50\)/, 'MATHEMATIQUES');
    refus('10,5', /dépasse le barème \(10\)/, 'DICTEE', 'e4'); // dictée du CE1 sur 10
    assert.deepEqual(j(etat.grades), {});
    assert.equal(AK.notes.saisir('e1', 1, 'DICTEE', '20').v, 20, 'la note maximale est acceptée');
    assert.equal(AK.notes.saisir('e1', 1, 'MATHEMATIQUES', '0').v, 0, 'zéro est une vraie note');
    assert.equal(etat.grades['e1|1|MATHEMATIQUES'], 0);
  });

  test('évaluation, matière, élève inconnus ou élève parti : refus', () => {
    const { AK } = preparer();
    assert.throws(() => AK.notes.saisir('e1', 5, 'DICTEE', '10'), metier(AK, /Évaluation inconnue/));
    assert.throws(() => AK.notes.saisir('e1', 0, 'DICTEE', '10'), metier(AK, /Évaluation inconnue/));
    assert.throws(() => AK.notes.saisir('e1', 1, 'LATIN', '10'), metier(AK, /Matière inconnue/));
    assert.throws(() => AK.notes.saisir('e3', 1, 'EPREUVES PHYSIQUES', '10'), metier(AK, /Matière inconnue/), 'pas d’EPS à la 1re composition du CM2');
    assert.equal(AK.notes.saisir('e3', 3, 'EPREUVES PHYSIQUES', '17').etat, 'ok', 'EPS au 1er examen blanc du CM2');
    assert.throws(() => AK.notes.saisir('zz', 1, 'DICTEE', '10'), metier(AK, /introuvable ou non inscrit/));
    assert.throws(() => AK.notes.saisir('e5', 1, 'DICTEE', '10'), metier(AK, /introuvable ou non inscrit/));
  });

  test('élève absent à l’évaluation : saisie refusée tant que l’absence n’est pas retirée', () => {
    const { AK, etat } = preparer((S) => (S.compAbs['e1|2'] = true));
    assert.throws(() => AK.notes.saisir('e1', 2, 'DICTEE', '10'), metier(AK, /marqué absent/));
    assert.equal(etat.grades['e1|2|DICTEE'], undefined);
  });

  test('correction d’une note existante : confirmation exigée (erreur .correction), puis appliquée et journalisée', () => {
    const { AK, etat, journal } = preparer((S) => (S.grades['e1|1|DICTEE'] = 12));
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '14'), (e) => e instanceof AK.ErreurMetier && e.correction === true && /12,00 → 14,00 sur 20/.test(e.message));
    assert.equal(etat.grades['e1|1|DICTEE'], 12, 'rien n’est modifié sans confirmation');
    assert.deepEqual(j(AK.notes.saisir('e1', 1, 'DICTEE', '14', { correctionConfirmee: true })), { etat: 'ok', v: 14 });
    assert.equal(etat.grades['e1|1|DICTEE'], 14);
    assert.deepEqual(journal, ['Note corrigée : KOUASSI Mamadou, DICTEE (12,00 → 14,00)']);
  });

  test('effacer une note existante est aussi une correction : confirmation exigée', () => {
    const { AK, etat } = preparer((S) => (S.grades['e1|1|DICTEE'] = 12));
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', ''), (e) => e.correction === true && /\(vide\)/.test(e.message));
    assert.equal(etat.grades['e1|1|DICTEE'], 12);
    AK.notes.saisir('e1', 1, 'DICTEE', ' ', { correctionConfirmee: true });
    assert.ok(!('e1|1|DICTEE' in etat.grades));
  });

  test('même valeur ou case vide laissée vide : « inchangé », rien n’est écrit ni journalisé', () => {
    const { AK, journal } = preparer((S) => (S.grades['e1|1|DICTEE'] = 12));
    assert.equal(AK.notes.saisir('e1', 1, 'DICTEE', '12,00').etat, 'inchange');
    assert.equal(AK.notes.saisir('e1', 1, 'MATHEMATIQUES', '').etat, 'inchange');
    assert.deepEqual(journal, []);
  });
});

test.describe('Saisie des notes (enseignant)', () => {
  test('hors de sa classe : refus pour droits', () => {
    const { AK, etat } = preparer(null, { role: 'ens' });
    assert.throws(() => AK.notes.saisir('e3', 1, 'DICTEE', '12'), droits(AK));
    assert.deepEqual(j(etat.grades), {});
  });

  test('validation activée : la note attend la validation du directeur (ne compte pas encore)', () => {
    const { AK, etat, journal } = preparer(null, { role: 'ens' });
    assert.deepEqual(j(AK.notes.saisir('e1', 1, 'DICTEE', '13')), { etat: 'attente', v: 13 });
    assert.equal(etat.attente['e1|1|DICTEE'], 13);
    assert.ok(!('e1|1|DICTEE' in etat.grades));
    assert.equal(AK.calc.moyEval(etat.students[0], 1), null, 'une note en attente ne compte pas dans la moyenne');
    assert.match(journal[0], /en attente/);
    assert.equal(AK.notes.saisir('e1', 1, 'DICTEE', '13').etat, 'inchange');
    assert.deepEqual(j(AK.notes.saisir('e1', 1, 'DICTEE', '')), { etat: 'attente', v: null });
    assert.ok(!('e1|1|DICTEE' in etat.attente), 'vider la case retire la note en attente');
  });

  test('validation désactivée : la note de l’enseignant compte immédiatement', () => {
    const { AK, etat } = preparer((S) => (S.school.validation = false), { role: 'ens' });
    assert.equal(AK.notes.saisir('e1', 1, 'DICTEE', '13').etat, 'ok');
    assert.equal(etat.grades['e1|1|DICTEE'], 13);
  });

  test('saisie fermée par le directeur ou date limite dépassée : refus pour l’enseignant, pas pour le directeur', () => {
    let { AK } = preparer((S) => (S.saisie['CE2|1'] = { fermee: true, fin: '' }), { role: 'ens' });
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '13'), metier(AK, /saisie est fermée/));
    ({ AK } = preparer(null, { role: 'ens' }));
    AK.store.etat.saisie['CE2|1'] = { fermee: false, fin: hier(AK) };
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '13'), metier(AK, /saisie est fermée/));
    assert.equal(AK.notes.saisir('e1', 2, 'DICTEE', '13').etat, 'attente', 'les autres évaluations restent ouvertes');
    const d = preparer((S) => (S.saisie['CE2|1'] = { fermee: true, fin: '' }), { role: 'dir' });
    assert.equal(d.AK.notes.saisir('e1', 1, 'DICTEE', '13').etat, 'ok');
  });

  /* Défaut constaté sur le commit 70ae4ac (notes.js : saisir() n'exigeait jamais « notes.corriger ») ;
     corrigé depuis dans l'arbre de travail : ce test garde la correction. */
  test('note validée : l’enseignant ne peut ni la corriger ni l’effacer, même en se disant confirmé (droit notes.corriger réservé au directeur)', () => {
    const { AK, etat } = preparer((S) => (S.grades['e1|1|DICTEE'] = 12), { role: 'ens' });
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '18', { correctionConfirmee: true }), droits(AK));
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '', { correctionConfirmee: true }), droits(AK));
    assert.throws(() => AK.notes.saisir('e1', 1, 'DICTEE', '18'));
    assert.equal(etat.grades['e1|1|DICTEE'], 12, `note validée modifiée par l’enseignant : ${etat.grades['e1|1|DICTEE']}`);
  });
});

/* ======================================================================== absences aux évaluations */
test.describe('Absence à une évaluation', () => {
  test('élève sans note : marqué absent sans confirmation, moyenne 0', () => {
    const { AK, etat, journal } = preparer();
    AK.notes.marquerAbsent('e2', 1, true);
    assert.equal(etat.compAbs['e2|1'], true);
    assert.equal(AK.calc.moyEval(etat.students[1], 1), 0);
    assert.match(journal[0], /BAMBA Awa marqué\(e\) absent\(e\) \(1re composition\)/);
  });

  test('élève avec notes : confirmation exigée, puis notes et notes en attente de CETTE évaluation effacées', () => {
    const { AK, etat } = preparer((S) => {
      Object.assign(S.grades, { 'e1|1|DICTEE': 12, 'e1|1|MATHEMATIQUES': 30, 'e1|2|DICTEE': 15, 'e2|1|DICTEE': 9 });
      S.attente['e1|1|EVEIL AU MILIEU'] = 25;
    });
    assert.throws(() => AK.notes.marquerAbsent('e1', 1, true), (e) => e.correction === true && /seront effacées/.test(e.message));
    assert.equal(Object.keys(etat.grades).length, 4, 'rien n’est effacé sans confirmation');
    assert.ok(!etat.compAbs['e1|1']);
    AK.notes.marquerAbsent('e1', 1, true, { confirme: true });
    assert.deepEqual(j(etat.grades), { 'e1|2|DICTEE': 15, 'e2|1|DICTEE': 9 }, 'les autres évaluations et les autres élèves sont intacts');
    assert.deepEqual(j(etat.attente), {});
    assert.equal(etat.compAbs['e1|1'], true);
    assert.deepEqual(j(AK.calc.resultat(etat.students[0], 1)), { total: 0, moy: 0, abs: true });
  });

  test('retirer une absence : confirmation exigée, puis l’élève redevient notable', () => {
    const { AK, etat } = preparer((S) => (S.compAbs['e1|1'] = true));
    assert.throws(() => AK.notes.marquerAbsent('e1', 1, false), (e) => e.correction === true && /Annuler l’absence/.test(e.message));
    assert.equal(etat.compAbs['e1|1'], true);
    AK.notes.marquerAbsent('e1', 1, false, { confirme: true });
    assert.ok(!('e1|1' in etat.compAbs));
    assert.equal(AK.notes.saisir('e1', 1, 'DICTEE', '11').etat, 'ok');
  });

  test('enseignant : absence possible dans sa classe seulement', () => {
    const { AK, etat } = preparer(null, { role: 'ens' });
    AK.notes.marquerAbsent('e2', 1, true);
    assert.equal(etat.compAbs['e2|1'], true);
    assert.throws(() => AK.notes.marquerAbsent('e3', 1, true), droits(AK));
  });

  /* Défaut constaté sur le commit 70ae4ac (marquerAbsent() n'exigeait que « notes.saisir ») ;
     corrigé depuis dans l'arbre de travail : ce test garde la correction. */
  test('enseignant : ne peut pas effacer des notes validées en marquant l’élève absent (correction réservée au directeur)', () => {
    const { AK, etat } = preparer((S) => Object.assign(S.grades, { 'e1|1|DICTEE': 12, 'e1|1|MATHEMATIQUES': 30 }), { role: 'ens' });
    assert.throws(() => AK.notes.marquerAbsent('e1', 1, true, { confirme: true }), droits(AK));
    assert.equal(Object.keys(etat.grades).length, 2, `notes validées effacées par l’enseignant (reste ${Object.keys(etat.grades).length})`);
  });
});

/* ======================================================================== validation */
test.describe('Validation des notes en attente', () => {
  const attente = (S) => Object.assign(S.attente, {
    'e1|2|DICTEE': 15, 'e2|2|MATHEMATIQUES': 30, // CE2, 2e composition
    'e1|1|DICTEE': 10, // CE2, 1re composition
    'e3|2|DICTEE': 12 // CM2
  });

  test('enseignant : ne peut ni valider ni rejeter', () => {
    const { AK, etat } = preparer(attente, { role: 'ens' });
    assert.throws(() => AK.notes.valider('CE2', 2), droits(AK));
    assert.throws(() => AK.notes.rejeter('CE2', 2), droits(AK));
    assert.equal(Object.keys(etat.attente).length, 4);
  });

  test('directeur : valider une classe et une évaluation fait compter ces notes, et seulement elles', () => {
    const { AK, etat, journal } = preparer(attente);
    assert.equal(AK.notes.enAttenteDe('CE2').length, 3, 'toutes évaluations confondues');
    assert.equal(AK.notes.valider('CE2', 2), 2);
    assert.deepEqual(j(etat.grades), { 'e1|2|DICTEE': 15, 'e2|2|MATHEMATIQUES': 30 });
    assert.deepEqual(j(etat.attente), { 'e1|1|DICTEE': 10, 'e3|2|DICTEE': 12 });
    assert.equal(AK.calc.moyEval(etat.students[0], 2), 7.5, '15 / 20 en dictée de CE2 → 7,5 / 10');
    assert.deepEqual(journal, ['2 notes validée(s) : CE2']);
    assert.equal(AK.notes.valider('CE2', 2), 0, 'plus rien à valider');
  });

  test('directeur : rejeter supprime les notes en attente sans les enregistrer', () => {
    const { AK, etat } = preparer(attente);
    assert.equal(AK.notes.rejeter('CE2', 1), 1);
    assert.ok(!('e1|1|DICTEE' in etat.attente));
    assert.ok(!('e1|1|DICTEE' in etat.grades));
    assert.equal(Object.keys(etat.attente).length, 3);
  });
});

/* ======================================================================== décisions */
test.describe('Décision de fin d’année', () => {
  test('le directeur fixe une décision ; revenir à la proposition efface la décision manuelle', () => {
    const { AK, etat } = preparer((S) => {
      // CE2, dictée 8/20 aux 4 évaluations → moyenne 4 → MGA 4 → proposition Redoublant
      [1, 2, 3, 4].forEach((n) => (S.grades[`e1|${n}|DICTEE`] = 8));
    });
    const s = etat.students[0];
    assert.equal(AK.calc.decisionProposee(s), 'Redoublant');
    AK.notes.fixerDecision('e1', 'Admis');
    assert.equal(s.decision, 'Admis');
    assert.equal(AK.calc.decision(s), 'Admis');
    AK.notes.fixerDecision('e1', 'Redoublant');
    assert.equal(s.decision, '', 'identique à la proposition : rien n’est forcé');
    assert.throws(() => AK.notes.fixerDecision('e1', 'Promu'), metier(AK, /Décision inconnue/));
  });

  test('l’enseignant ne fixe pas les décisions', () => {
    const { AK } = preparer(null, { role: 'ens' });
    assert.throws(() => AK.notes.fixerDecision('e1', 'Admis'), droits(AK));
  });
});

/* ======================================================================== passage d'année */
test.describe('Passage à l’année suivante', () => {
  /*
   * Élèves (année 2026–2027) et MGA calculées à la main :
   *  pa ADJOUA Ama    CP1  écriture 5, 6, 7 | passage 6,5 → (6 + 13) ÷ 3 = 6,33 → Admis → CP2 (était redoublant)
   *  pb BROU Koffi    CE2  dictée 8/20 partout → 4 → MGA (4 + 8) ÷ 3 = 4 → Redoublant → reste en CE2
   *  pc COULIBALY Awa CM2  dictée 12, 14, 10, 16 (/20) → 13 → Admis → archivé « entrée en 6ème »
   *  pd DIALLO Sita   CM1  aucune note (absente à la 1re) → pas de MGA → reste, sans décision
   *  pe EHUI Marc     CE1  statut Abandon → archivé
   *  pf FOFANA Ali    CE1  inscrit, décision Transféré → archivé
   *  pg GNAGNE Luc    CM2  dictée 8, 10, 10, 10 → 9,5 < 10 → Redoublant → reste en CM2
   *  ph HIEN Paul     CP1  écriture 2 partout → MGA 2, mais décision « Admis » fixée → CP2
   * Effectifs des inscrits : CP1 2, CE1 1, CE2 1, CM1 1, CM2 2.
   */
  function ecole(S) {
    S.students = [
      eleve('pa', 'ADJOUA', 'Ama', 'CP1', { redoublant: true, sexe: 'Féminin' }),
      eleve('pb', 'BROU', 'Koffi', 'CE2'),
      eleve('pc', 'COULIBALY', 'Awa', 'CM2', { sexe: 'Féminin' }),
      eleve('pd', 'DIALLO', 'Sita', 'CM1', { sexe: 'Féminin' }),
      eleve('pe', 'EHUI', 'Marc', 'CE1', { statut: 'Abandon' }),
      eleve('pf', 'FOFANA', 'Ali', 'CE1', { decision: 'Transféré' }),
      eleve('pg', 'GNAGNE', 'Luc', 'CM2'),
      eleve('ph', 'HIEN', 'Paul', 'CP1', { decision: 'Admis' })
    ];
    const n = (id, m, notes) => notes.forEach((v, i) => (S.grades[`${id}|${i + 1}|${m}`] = v));
    n('pa', 'ECRITURE', [5, 6, 7, 6.5]);
    n('pb', 'DICTEE', [8, 8, 8, 8]);
    n('pc', 'DICTEE', [12, 14, 10, 16]);
    n('pg', 'DICTEE', [8, 10, 10, 10]);
    n('ph', 'ECRITURE', [2, 2, 2, 2]);
    S.compAbs['pd|1'] = true;
    S.att['2026-10-12'] = { pa: 'A', pb: 'J' };
    S.appel['2026-10-12'] = { CP1: true, CE2: true };
    S.attente['pb|1|MATHEMATIQUES'] = 30;
    S.saisie['CE2|1'] = { fermee: true, fin: '' };
    S.school.evalCourante = 4;
  }

  test('MGA de contrôle (calculées à la main) avant le passage', () => {
    const { AK, etat } = preparer(ecole);
    const m = Object.fromEntries(etat.students.map((s) => [s.id, AK.calc.mga(s)]));
    assert.deepEqual(m, { pa: 6.33, pb: 4, pc: 13, pd: null, pe: null, pf: null, pg: 9.5, ph: 2 });
  });

  test('bilanPassage : 2 montent, 3 restent (dont 1 sans décision), 1 sortant (CM2), 2 archivés', () => {
    const { AK } = preparer(ecole);
    assert.deepEqual(j(AK.notes.bilanPassage()), { montent: 2, restent: 3, sortants: 1, archives: 2, sansDecision: 1, niveauNonOuvert: [] });
    assert.equal(AK.notes.anneeSuivante(), '2027–2028');
  });

  test('passerAnnee : admis montent, redoublants restent, CM2 et départs archivés, compteurs cohérents avec le bilan', async () => {
    const { AK, etat } = preparer(ecole);
    const bilan = j(AK.notes.bilanPassage());
    const R = await AK.notes.passerAnnee();
    assert.deepEqual(j(R), { montent: 2, restent: 3, archives: 3 });
    assert.equal(R.montent, bilan.montent);
    assert.equal(R.restent, bilan.restent);
    assert.equal(R.archives, bilan.sortants + bilan.archives);
    assert.deepEqual(j(etat.students.map((s) => [s.id, s.classe, s.redoublant, s.decision])), [
      ['pa', 'CP2', false, ''], // admis : redoublement effacé
      ['pb', 'CE2', true, ''],
      ['pd', 'CM1', false, ''], // sans décision : reste, sans être marqué redoublant
      ['pg', 'CM2', true, ''],
      ['ph', 'CP2', false, ''] // décision manuelle respectée
    ]);
    const arch = etat.archives['2026–2027'];
    assert.deepEqual(j(arch.students.map((s) => [s.id, s.decision])), [
      ['pc', 'Admis (entrée en 6ème)'],
      ['pe', 'Abandon'],
      ['pf', 'Transféré']
    ]);
  });

  test('passerAnnee : notes, absences, appels, attentes et périodes de saisie archivés puis remis à zéro ; année suivante ouverte', async () => {
    const { AK, etat, journal } = preparer(ecole);
    const notesAvant = j(etat.grades), absAvant = j(etat.compAbs), attAvant = j(etat.att), appelAvant = j(etat.appel);
    assert.equal(Object.keys(notesAvant).length, 20);
    await AK.notes.passerAnnee();
    const arch = etat.archives['2026–2027'];
    assert.deepEqual(j(arch.grades), notesAvant, 'les 20 notes de l’année sont archivées');
    assert.deepEqual(j(arch.compAbs), absAvant);
    assert.deepEqual(j(arch.att), attAvant);
    assert.deepEqual(j(arch.appel), appelAvant);
    assert.ok(!Number.isNaN(Date.parse(arch.cloture)), 'date de clôture');
    for (const k of ['grades', 'compAbs', 'att', 'appel', 'attente', 'saisie']) assert.deepEqual(j(etat[k]), {}, k + ' remis à zéro');
    assert.equal(etat.school.year, '2027–2028');
    assert.equal(etat.school.evalCourante, 1);
    assert.ok(journal.includes('Passage à 2027–2028 : 2 admis passent, 3 restent, 3 archivés'), journal.join(' | '));
  });

  test('passerAnnee : une ligne de parcours (année, niveau, MGA, effectif) pour chaque inscrit, même archivé', async () => {
    const { AK, etat } = preparer(ecole);
    await AK.notes.passerAnnee();
    const parcours = (s) => j(s.parcours);
    const L = Object.fromEntries([...etat.students, ...etat.archives['2026–2027'].students].map((s) => [s.id, parcours(s)]));
    assert.deepEqual(L.pa, [{ annee: '2026–2027', niveau: 'CP1', moy: '6,33', eff: '2' }]);
    assert.deepEqual(L.pb, [{ annee: '2026–2027', niveau: 'CE2', moy: '4', eff: '1' }]);
    assert.deepEqual(L.pc, [{ annee: '2026–2027', niveau: 'CM2', moy: '13', eff: '2' }]);
    assert.deepEqual(L.pd, [{ annee: '2026–2027', niveau: 'CM1', moy: '', eff: '1' }]);
    assert.deepEqual(L.pf, [{ annee: '2026–2027', niveau: 'CE1', moy: '', eff: '1' }]);
    assert.deepEqual(L.pg, [{ annee: '2026–2027', niveau: 'CM2', moy: '9,5', eff: '2' }]);
    assert.deepEqual(L.ph, [{ annee: '2026–2027', niveau: 'CP1', moy: '2', eff: '2' }]);
    assert.deepEqual(L.pe, [], 'un élève déjà parti n’a pas de ligne pour cette année');
  });

  test('copie de sécurité demandée AVANT toute modification', async () => {
    const { AK, copies } = preparer(ecole);
    await AK.notes.passerAnnee();
    assert.deepEqual(copies, [{ motif: 'avant-passage-2026–2027', annee: '2026–2027', notes: 20, eleves: 8 }]);
  });

  test('admis vers un niveau non ouvert dans l’école : archivé avec la mention « à transférer »', async () => {
    const { AK, etat } = preparer((S) => {
      S.school.niveaux = ['CP1', 'CP2', 'CE1'];
      S.students = [eleve('q1', 'SORO', 'Zié', 'CE1'), eleve('q2', 'KONAN', 'Eric', 'CP2')];
      // CE1 : dictée 6/10 partout → 6 → MGA 6 → Admis ; CP2 : écriture 7 partout → MGA 7 → Admis
      [1, 2, 3, 4].forEach((n) => {
        S.grades[`q1|${n}|DICTEE`] = 6;
        S.grades[`q2|${n}|ECRITURE`] = 7;
      });
    });
    const B = j(AK.notes.bilanPassage());
    assert.deepEqual(B.niveauNonOuvert, ['SORO Zié (CE1 → CE2)']);
    assert.equal(B.sortants, 1);
    assert.equal(B.montent, 1);
    const R = await AK.notes.passerAnnee();
    assert.deepEqual(j(R), { montent: 1, restent: 0, archives: 1 });
    assert.deepEqual(j(etat.students.map((s) => [s.id, s.classe])), [['q2', 'CE1']]);
    assert.deepEqual(j(etat.archives['2026–2027'].students.map((s) => [s.id, s.classe, s.decision])), [
      ['q1', 'CE1', 'Admis en CE2 (niveau non ouvert dans l’école : à transférer)']
    ]);
  });

  test('refus : enseignant (droits) ou année en cours inconnue ; aucune copie ni modification', async () => {
    const e = preparer(ecole, { role: 'ens' });
    await assert.rejects(() => e.AK.notes.passerAnnee(), droits(e.AK));
    assert.equal(e.copies.length, 0);
    assert.equal(e.etat.students.length, 8);
    const d = preparer((S) => {
      ecole(S);
      S.school.year = '';
    });
    await assert.rejects(() => d.AK.notes.passerAnnee(), metier(d.AK, /année scolaire en cours/));
    assert.equal(d.copies.length, 0);
    assert.equal(Object.keys(d.etat.grades).length, 20);
  });
});

/* ======================================================================== élèves */
test.describe('Élèves : inscription, doublons, suppression', () => {
  const nouvel = { nom: 'koffi', prenoms: 'aya mireille', sexe: 'Féminin', classe: 'CP1', extrait: false, age: '6', pere_nom: 'KOFFI', pere_prenoms: 'Yao' };

  test('inscription sans extrait : matricule suivant, naissance estimée, nom en capitales', () => {
    const { AK, etat } = preparer();
    const s = AK.eleves.inscrire({ ...nouvel });
    assert.equal(s.mat, 'AK-26004', 'plus grand matricule AK-26003 + 1');
    assert.equal(s.nom, 'KOFFI');
    assert.equal(s.prenoms, 'Aya Mireille');
    assert.equal(s.naissance, '2020-01-01', '6 ans à la rentrée 2026');
    assert.equal(s.ageEstime, true);
    assert.equal(s.statut, 'Inscrit');
    assert.equal(etat.students.length, 6);
  });

  test('doublon (même nom et prénoms) : confirmation exigée', () => {
    const { AK, etat } = preparer();
    AK.eleves.inscrire({ ...nouvel });
    assert.throws(() => AK.eleves.inscrire({ ...nouvel }), (e) => e instanceof AK.ErreurMetier && Array.isArray(e.doublons) && e.doublons.length === 1);
    assert.equal(etat.students.length, 6);
    AK.eleves.inscrire({ ...nouvel }, { accepterDoublon: true });
    assert.equal(etat.students.length, 7);
  });

  test('contrôle du formulaire : sexe manquant, âge hors limites, classe non ouverte', () => {
    const { AK } = preparer((S) => (S.school.niveaux = ['CP1', 'CP2']));
    assert.throws(() => AK.eleves.inscrire({ ...nouvel, sexe: '' }), (e) => e.champ === 'sexe');
    assert.throws(() => AK.eleves.inscrire({ ...nouvel, age: '25' }), (e) => e.champ === 'age');
    assert.throws(() => AK.eleves.inscrire({ ...nouvel, classe: 'CM2', entree: '2026-09-14' }), (e) => e.champ === 'classe');
  });

  test('un enseignant rattaché à une école n’inscrit pas d’élève', () => {
    const { AK, etat } = preparer(null, { role: 'ens' });
    assert.throws(() => AK.eleves.inscrire({ ...nouvel, classe: 'CE2', entree: '2026-09-14' }), (e) => e instanceof AK.ErreurDroits && /réservée au directeur/.test(e.message));
    assert.equal(etat.students.length, 5);
  });

  test('suppression : l’élève, ses notes, attentes, absences d’évaluation et du jour vont à la corbeille, puis sont restaurés à l’identique', () => {
    const { AK, etat } = preparer((S) => {
      Object.assign(S.grades, { 'e1|1|DICTEE': 12, 'e1|2|DICTEE': 14, 'e2|1|DICTEE': 9 });
      S.attente['e1|3|DICTEE'] = 11;
      S.compAbs['e1|4'] = true;
      S.att['2026-10-12'] = { e1: 'A', e2: 'J' };
    });
    const avant = j(etat);
    AK.eleves.supprimer('e1');
    assert.equal(AK.eleves.trouver('e1'), null);
    assert.deepEqual(j(etat.grades), { 'e2|1|DICTEE': 9 });
    assert.deepEqual(j(etat.attente), {});
    assert.deepEqual(j(etat.compAbs), {});
    assert.deepEqual(j(etat.att), { '2026-10-12': { e2: 'J' } });
    assert.equal(etat.corbeille.length, 1);
    const c = etat.corbeille[0];
    assert.deepEqual(j(c.donnees.notes), { 'e1|1|DICTEE': 12, 'e1|2|DICTEE': 14 });
    assert.deepEqual(j(c.donnees.abs), { '2026-10-12': 'A' });
    AK.personnel.restaurer(c.id);
    assert.deepEqual(j(etat.grades), avant.grades);
    assert.deepEqual(j(etat.attente), avant.attente);
    assert.deepEqual(j(etat.compAbs), avant.compAbs);
    assert.deepEqual(j(etat.att), avant.att);
    assert.ok(AK.eleves.trouver('e1'));
    assert.equal(etat.corbeille.length, 0);
  });
});

/* ======================================================================== absences du jour */
test.describe('Appel du jour et demandes d’autorisation', () => {
  test('directeur : une case passe Présent → Absent → Absent justifié → Présent ; la classe est marquée appelée', () => {
    const { AK, etat } = preparer();
    const d = hier(AK);
    assert.equal(AK.absences.basculer(d, 'CE2', 'e1'), 'A');
    assert.equal(etat.att[d].e1, 'A');
    assert.equal(etat.appel[d].CE2, true);
    assert.equal(AK.absences.basculer(d, 'CE2', 'e1'), 'J');
    assert.equal(AK.absences.basculer(d, 'CE2', 'e1'), '');
    assert.ok(!('e1' in etat.att[d]));
  });

  test('enseignant : marque une absence mais ne peut pas la lever', () => {
    const { AK, etat } = preparer(null, { role: 'ens' });
    const d = hier(AK);
    assert.equal(AK.absences.basculer(d, 'CE2', 'e1'), 'A');
    assert.throws(() => AK.absences.basculer(d, 'CE2', 'e1'), metier(AK, /seul le directeur/));
    assert.equal(etat.att[d].e1, 'A');
    assert.throws(() => AK.absences.basculer(d, 'CM2', 'e3'), droits(AK), 'pas l’appel d’une autre classe');
  });

  test('refus : jour à venir, élève d’une autre classe', () => {
    const { AK } = preparer();
    const demain = AK.u.ajouterJours(AK.u.aujourdhui(), 1);
    assert.throws(() => AK.absences.basculer(demain, 'CE2', 'e1'), metier(AK, /jour à venir/));
    assert.throws(() => AK.absences.basculer(hier(AK), 'CM2', 'e1'), metier(AK, /introuvable dans cette classe/));
  });

  test('demande accordée pour un élève : absences justifiées sur les seuls jours de classe (lundi 19 → dimanche 25 octobre 2026, jeudi 22 férié → 3 jours)', () => {
    const { AK, etat } = preparer((S) => {
      S.auth.push({ id: 'old', ref: 'AUT-2026-007', qui: 'personnel', pid: 't1', statut: 'Refusée' });
      S.conges.push({ id: 'c1', lib: 'Férié', du: '2026-10-22', au: '' });
    });
    const a = AK.absences.demander({ qui: 'eleve', pid: 'e1', du: '2026-10-19', au: '2026-10-25', motif: 'Maladie', precision: 'Paludisme' });
    assert.equal(a.ref, 'AUT-2026-008', 'numéro suivant le plus grand existant');
    assert.equal(a.statut, 'En attente');
    assert.equal(AK.absences.joursDemande(a), 3);
    assert.equal(AK.absences.decider(a.id, true), 3);
    assert.deepEqual(j(Object.keys(etat.att).sort()), ['2026-10-19', '2026-10-20', '2026-10-23']);
    assert.ok(Object.values(etat.att).every((m) => m.e1 === 'J'));
    assert.equal(a.statut, 'Accordée');
    assert.throws(() => AK.absences.decider(a.id, false), metier(AK, /déjà reçu une décision/));
  });

  test('demande refusée : aucune absence créée ; l’enseignant ne décide pas', () => {
    const { AK, etat } = preparer();
    const a = AK.absences.demander({ qui: 'eleve', pid: 'e2', du: '2026-10-19', au: '2026-10-20', motif: 'Raison familiale' });
    assert.equal(AK.absences.decider(a.id, false), 0);
    assert.deepEqual(j(etat.att), {});
    const e = preparer(null, { role: 'ens' });
    const b = e.AK.absences.demander({ qui: 'eleve', pid: 'e1', du: '2026-10-19', au: '2026-10-20', motif: 'Maladie' });
    assert.throws(() => e.AK.absences.decider(b.id, true), droits(e.AK));
    assert.throws(() => e.AK.absences.demander({ qui: 'eleve', pid: 'e3', du: '2026-10-19', au: '2026-10-20', motif: 'Maladie' }), metier(e.AK, /pas dans votre classe/));
  });
});
