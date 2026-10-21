/* =====================================================================================
   Tests unitaires : schéma, assainissement, migration 1.x → 2.0, contrôle d'intégrité
   (src/js/data/schema.js).
   Le jeu de données reproduit la structure « v: 5 » d'AKWA SCHOOL 1.7.0 (fonction seed() et
   ensure8() de l'original) : school.adminPwd = 'admin' en clair, school.secours, élèves avec
   pere/mere/acte/parcours, enseignants à classe unique avec compte {login, actif, cree},
   notes « id|évaluation|matière », compAbs, att, appel, auth, messages, attente, saisie,
   session, pro (cantine, paiements…).
   ===================================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger.cjs');

const j = (x) => JSON.parse(JSON.stringify(x));
const TOUS = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ==';
const SVG = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+';

function chargerSchema() {
  return charger(['js/data/schema.js'], { etat: null });
}

/** Données AKWA SCHOOL 1.x réalistes (format v: 5), en texte JSON comme dans le stockage. */
function donnees1x() {
  return {
    v: 5,
    school: {
      ministere: "MINISTERE DE L'EDUCATION NATIONALE, DE L'ALPHABETISATION ET DE L'ENSEIGNEMENT TECHNIQUE",
      republique: "REPUBLIQUE DE CÔTE D'IVOIRE", devise: 'Union – Discipline – Travail',
      name: 'EPP OUANINOU 2', statut: 'publique', iepp: 'OUANINOU', drenaet: 'DRENAET DE TOUBA', localite: 'Ouaninou',
      year: '2026–2027', director: 'M. OUATTARA Siaka', evalCourante: 2, adminPwd: 'admin', secours: 'K7QM-4XRT-9PWD',
      codedren: '0215', codeiep: '021503', codeecole: '0215030112', accent: 'green', theme: 'auto',
      logoEcole: PNG, logoIepp: '', armoiries: '', niveaux: TOUS.slice(), validation: true, idLock: true,
      licence: { type: 'essai', debut: '2026-10-01' }
    },
    students: [
      {
        id: 'k3j9x0a1b2c3', nom: 'KOUASSI', prenoms: 'Mamadou', mat: 'AK-26001', classe: 'CE2', sexe: 'Masculin', naissance: '2017-03-14',
        lieu: 'Ouaninou', nationalite: 'IVOIRIENNE', redoublant: false, parent: 'M. Traoré', tel: '07 01 02 03 04',
        pere: { nom: 'KOUASSI', prenoms: 'Yao', profession: 'Cultivateur', tel: '07 11 22 33 44', domicile: 'Ouaninou, quartier Commerce' },
        mere: { nom: 'BAMBA', prenoms: 'Aminata', profession: 'Commerçante', tel: '05 12 34 56 78', domicile: 'Ouaninou' },
        sang: 'O+', allergies: '', entree: '2023-09-14', motifDepart: '',
        parcours: [{ annee: '2025–2026', niveau: 'CE1', moy: '6,25', eff: '38' }],
        extrait: true, acte: { num: '127', date: '2017-03-24', centre: 'Centre d’état civil de Ouaninou', sp: 'Sous-préfecture de Ouaninou' },
        statut: 'Inscrit', photo: PNG, decision: ''
      },
      {
        id: 'm4n5p6q7r8s9', nom: 'TRAORE', prenoms: 'Aïcha', mat: '12345678A', classe: 'CM2', sexe: 'Féminin', naissance: '2014-06-02',
        lieu: 'Touba', nationalite: 'burkinabe', redoublant: true, parent: '', tel: '',
        pere: { nom: 'TRAORE', prenoms: 'Lassina', profession: 'Commerçant', tel: '', domicile: 'Touba' },
        mere: { nom: 'DIALLO', prenoms: 'Fatou', profession: 'Ménagère', tel: '', domicile: 'Touba' },
        sang: '', allergies: 'Asthme', entree: '2021-09-14', motifDepart: '', parcours: [],
        extrait: true, acte: { num: '45', date: '2014-06-12', centre: 'Centre d’état civil de Touba', sp: 'Sous-préfecture de Touba' },
        statut: 'Inscrit', photo: JPEG, decision: ''
      },
      {
        // ancien élève sans extrait ni parents détaillés (champs ajoutés plus tard absents)
        id: 'z1y2x3w4v5u6', nom: 'YAO', prenoms: 'Serge', mat: 'AK-26003', classe: 'CP1', sexe: 'M', naissance: '2020-01-01', ageEstime: true,
        nationalite: '', statut: 'Abandon', photo: '', decision: ''
      }
    ],
    teachers: [
      { id: 't1a2b3c4d5e6', nom: 'Mme AKA Adjoua Rose', fonction: 'Institutrice', classe: 'CE2', grade: 'Instituteur ordinaire', matricule: '300 000-A', tel: '05 07 00 09 03', fonct: 'simple', photo: '', compte: { login: 'aaka', actif: true, cree: '2026-10-10' }, actif: true },
      { id: 't9f8e7d6c5b4', nom: 'M. GNAHORE Bertin', fonction: 'Instituteur', classe: 'CM2', grade: 'Instituteur adjoint', matricule: '337 113-B', tel: '05 48 00 22 32', fonct: 'simple', photo: '' },
      { id: 'tdir00000001', nom: 'M. OUATTARA Siaka', fonction: 'Directeur', classe: '', grade: 'Instituteur principal', matricule: '374 226-C', tel: '', fonct: '', photo: '' }
    ],
    grades: {
      'k3j9x0a1b2c3|1|EXPLOITATION DE TEXTE': 35, 'k3j9x0a1b2c3|1|EVEIL AU MILIEU': 30, 'k3j9x0a1b2c3|1|MATHEMATIQUES': 41.5, 'k3j9x0a1b2c3|1|DICTEE': 0,
      'm4n5p6q7r8s9|1|EXPLOITATION DE TEXTE': 44, 'm4n5p6q7r8s9|1|DICTEE': 18
    },
    compAbs: { 'm4n5p6q7r8s9|2': true },
    att: { '2026-10-12': { k3j9x0a1b2c3: 'A', m4n5p6q7r8s9: 'J' }, '2026-10-13': { k3j9x0a1b2c3: 'J' } },
    appel: { '2026-10-12': { CE2: true, CM2: true }, '2026-10-13': { CE2: true } },
    auth: [
      { id: 'a1', ref: 'AUT-2026-001', qui: 'personnel', pid: 't1a2b3c4d5e6', nom: 'Mme AKA Adjoua Rose', du: '2026-10-22', au: '2026-10-22', motif: 'Formation', precision: 'Atelier IEPP', statut: 'En attente', cree: '2026-10-20' },
      { ref: 'AUT-2026-002', qui: 'eleve', pid: 'k3j9x0a1b2c3', nom: 'KOUASSI Mamadou', du: '2026-10-15', au: '2026-10-16', motif: 'Maladie', precision: 'Certificat médical fourni', statut: 'Accordée', cree: '2026-10-14' }
    ],
    conges: [{ id: 'c1', du: '2026-11-01', au: '', lib: 'Toussaint' }, { du: '2026-12-19', au: '2027-01-04', motif: 'Congés de Noël' }],
    redac: { 'rentree|obs': 'Rentrée sans incident.' }, persoReps: [], archives: {}, lastBackup: '2026-10-01',
    log: [{ t: 1792000000000, m: 'Données de démonstration chargées' }],
    messages: [{ id: 'msg1', t: 1792000000000, dest: '', titre: 'Conseil des maîtres', texte: 'Conseil des maîtres vendredi à 15 h.', lus: { t1a2b3c4d5e6: 1792000100000 } }, { id: 'msg2', t: 1792000200000, dest: '', titre: 'Sans lecture', texte: '…' }],
    attente: { 'k3j9x0a1b2c3|2|MATHEMATIQUES': 40 },
    saisie: { 'CE2|2': { fermee: false, fin: '2026-10-25' } },
    session: { role: 'ens', tid: 't1a2b3c4d5e6' },
    cpMat: {}, cpExtra: [],
    pro: {
      edt: {}, cahier: [], incidents: [{ id: 'i1', sid: 'k3j9x0a1b2c3', date: '2026-10-14', fait: 'Bavardage en classe', sanction: 'Avertissement oral' }],
      soins: [], events: [], frais: { CE2: 5000 },
      paiements: [{ id: 'p1', ref: 'REC-2026-0007', sid: 'k3j9x0a1b2c3', montant: 2000, objet: 'Cotisation COGES', date: '2026-10-05' }],
      depenses: [], cantine: { inscrits: { k3j9x0a1b2c3: true }, prix: 150, menu: [{ j: 'Lundi', p: 'Riz sauce graine' }], repas: {} },
      livres: [], prets: [], cepe: {}, sms: [], annonces: [], transmis: [], seq: { rec: 3 }
    }
  };
}

/* ======================================================================== migration 1.x */
test.describe('Migration de données AKWA SCHOOL 1.x (v: 5)', () => {
  test('aucune donnée métier perdue : élèves, personnel et comptes, notes, absences, appels, demandes, congés, messages', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    const { etat } = AK.schema.migrer(src);
    // élèves (y compris les partis), dossiers complets
    assert.deepEqual(j(etat.students.map((s) => s.id)), ['k3j9x0a1b2c3', 'm4n5p6q7r8s9', 'z1y2x3w4v5u6']);
    const k = etat.students[0];
    assert.equal(k.nom, 'KOUASSI');
    assert.equal(k.classe, 'CE2');
    assert.equal(k.naissance, '2017-03-14');
    assert.deepEqual(j(k.pere), src.students[0].pere);
    assert.deepEqual(j(k.mere), src.students[0].mere);
    assert.deepEqual(j(k.acte), src.students[0].acte);
    assert.deepEqual(j(k.parcours), src.students[0].parcours);
    assert.equal(k.sang, 'O+');
    assert.equal(etat.students[2].statut, 'Abandon', 'un élève parti reste dans les données');
    // personnel et comptes enseignants
    assert.equal(etat.teachers.length, 3);
    assert.deepEqual(j(etat.teachers[0].compte), { login: 'aaka', actif: true, cree: '2026-10-10' });
    assert.equal(etat.teachers[0].matricule, '300 000-A');
    // notes, notes en attente, absences aux évaluations, appels et absences du jour
    assert.deepEqual(j(etat.grades), src.grades, 'toutes les notes, y compris 0 et les demi-points');
    assert.deepEqual(j(etat.attente), src.attente);
    assert.deepEqual(j(etat.compAbs), src.compAbs);
    assert.deepEqual(j(etat.att), src.att);
    assert.deepEqual(j(etat.appel), src.appel);
    assert.deepEqual(j(etat.saisie), src.saisie);
    // demandes, calendrier, messages, rédactions, finances
    assert.equal(etat.auth.length, 2);
    assert.equal(etat.auth[0].id, 'a1');
    assert.ok(etat.auth[1].id, 'une demande sans identifiant en reçoit un');
    assert.equal(etat.auth[1].ref, 'AUT-2026-002');
    assert.deepEqual(j(etat.conges.map((c) => [c.du, c.au, c.lib])), [['2026-11-01', '', 'Toussaint'], ['2026-12-19', '2027-01-04', 'Congés de Noël']]);
    assert.ok(etat.conges.every((c) => c.id), 'chaque congé a un identifiant');
    assert.equal(etat.messages.length, 2);
    assert.deepEqual(j(etat.messages[0].lus), { t1a2b3c4d5e6: 1792000100000 });
    assert.deepEqual(j(etat.messages[1].lus), {}, 'message sans « lus » complété');
    assert.deepEqual(j(etat.redac), src.redac);
    assert.deepEqual(j(etat.log), src.log);
    assert.equal(etat.pro.paiements.length, 1);
    assert.equal(etat.pro.incidents.length, 1);
    assert.deepEqual(j(etat.pro.frais), { CE2: 5000 });
    assert.deepEqual(j(etat.pro.cantine.inscrits), { k3j9x0a1b2c3: true });
    assert.equal(etat.pro.cantine.prix, 150);
    // école
    assert.equal(etat.school.name, 'EPP OUANINOU 2');
    assert.equal(etat.school.year, '2026–2027');
    assert.equal(etat.school.evalCourante, 2);
    assert.equal(etat.school.accent, 'green');
    assert.deepEqual(j(etat.school.licence), { type: 'essai', debut: '2026-10-01' });
  });

  test('mot de passe en clair retiré de school et transmis à _mdpEnClair ; code de secours et session supprimés', () => {
    const AK = chargerSchema();
    const { etat, notes } = AK.schema.migrer(donnees1x());
    assert.equal(etat._mdpEnClair, 'admin');
    assert.ok(!('adminPwd' in etat.school), 'adminPwd retiré');
    assert.ok(!('secours' in etat.school), 'secours retiré');
    assert.ok(!('session' in etat), 'la session 1.x n’est pas reprise');
    const sansMdp = JSON.stringify({ ...j(etat), _mdpEnClair: undefined });
    assert.ok(!sansMdp.includes('K7QM-4XRT-9PWD'), 'le code de secours n’apparaît plus nulle part');
    assert.ok(!sansMdp.includes('adminPwd'));
    assert.equal(etat.securite.admin, null, 'l’empreinte sera calculée par AK.auth.migrerSecrets()');
    assert.ok(notes.some((n) => /1\.x/.test(n)), 'note : conversion 1.x');
    assert.ok(notes.some((n) => /Mot de passe administrateur converti/.test(n)), 'note : mot de passe converti');
    assert.ok(notes.some((n) => /code de secours/i.test(n)), 'note : code de secours retiré');
  });

  test('schéma 6, format v: 5 conservé, origine « 1.x » notée, rubriques nouvelles créées', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    assert.equal(AK.schema.SCHEMA, 6);
    assert.equal(etat.meta.schema, 6);
    assert.equal(etat.v, 5);
    assert.equal(etat.meta.migreDe, '1.x');
    assert.equal(etat.meta.app, AK.VERSION);
    assert.ok(etat.meta.installId && etat.meta.installId.length >= 12);
    assert.deepEqual(j(etat.docs), { seq: {}, items: [] });
    assert.deepEqual(j(etat.cles), { liste: [], active: null });
    assert.deepEqual(j(etat.corbeille), []);
    assert.deepEqual(j(etat.securite.comptes), {});
  });

  test('compléments : enseignant à classe unique → classes [classe], compte absent → null, actif par défaut', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    const [aka, gna, dir] = etat.teachers;
    assert.deepEqual(j(aka.classes), ['CE2']);
    assert.equal(aka.classe, 'CE2');
    assert.deepEqual(j(gna.classes), ['CM2']);
    assert.equal(gna.compte, null);
    assert.equal(gna.actif, true);
    assert.deepEqual(j(dir.classes), []);
    assert.equal(dir.classe, '');
  });

  test('compléments élèves : nationalité officielle, sexe normalisé, matricule national, parents et acte vides', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    const [k, t, y] = etat.students;
    assert.equal(t.nationalite, 'BURKINABE', '« burkinabe » → libellé officiel');
    assert.equal(y.nationalite, 'IVOIRIENNE', 'nationalité vide → IVOIRIENNE (défaut)');
    assert.equal(y.sexe, 'Masculin', '« M » → Masculin');
    assert.equal(k.matNat, '', 'matricule école AK-… : pas de matricule national');
    assert.equal(t.matNat, '12345678A', 'ancien matricule national repris');
    assert.deepEqual(j(y.pere), { nom: '', prenoms: '', profession: '', tel: '', domicile: '' });
    assert.deepEqual(j(y.acte), { num: '', date: '', centre: '', sp: '' });
    assert.deepEqual(j(y.parcours), []);
    assert.equal(y.extrait, false);
    assert.equal(t.redoublant, true);
  });

  test('numéro de reçu suivant jamais en dessous du plus grand reçu existant (REC-2026-0007 → 8) ; menu de cantine incomplet remplacé', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    assert.equal(etat.pro.seq.rec, 8);
    assert.equal(etat.pro.cantine.menu.length, 4, 'un menu par jour de classe (lundi, mardi, jeudi, vendredi)');
  });

  test('les données d’origine ne sont pas modifiées par la migration', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    const avant = JSON.stringify(src);
    AK.schema.migrer(src);
    assert.equal(JSON.stringify(src), avant);
    assert.equal(src.school.adminPwd, 'admin');
  });

  test('idempotence : migrer deux fois donne le même résultat (et la 2e migration ne signale plus rien de 1.x)', () => {
    const AK = chargerSchema();
    const r1 = AK.schema.migrer(donnees1x());
    const r2 = AK.schema.migrer(r1.etat);
    assert.deepEqual(j(r2.etat), j(r1.etat));
    assert.ok(!r2.notes.some((n) => /1\.x/.test(n)));
    const r3 = AK.schema.migrer(r2.etat);
    assert.deepEqual(j(r3.etat), j(r1.etat));
  });

  test('chaîne complète : AK.auth.migrerSecrets() remplace le mot de passe en clair par une empreinte et force son changement', async () => {
    const AK = charger(['js/data/schema.js', 'js/security/crypto.js', 'js/security/auth.js'], { etat: null });
    AK.hote = { type: 'navigateur' };
    AK.cfg.SECU.PBKDF2_ITER = 1000; // test rapide : le nombre d'itérations n'est pas l'objet du test
    const { etat } = AK.schema.migrer(donnees1x());
    await AK.auth.migrerSecrets(etat);
    assert.ok(!('_mdpEnClair' in etat), 'plus aucun mot de passe en clair');
    assert.equal(etat.securite.admin.algo, 'PBKDF2-SHA256');
    const valeurs = [];
    (function parcourir(v) {
      if (typeof v === 'string') valeurs.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(parcourir);
    })(j(etat));
    assert.ok(!valeurs.includes('admin'), 'la valeur « admin » n’apparaît plus dans aucun champ');
    assert.equal(await AK.crypto.verifierSecret('admin', etat.securite.admin), true, 'l’ancien mot de passe reste utilisable une dernière fois');
    assert.equal(etat.securite.forcerChangement, true, '« admin » est trop faible : changement forcé');
    assert.equal(etat.securite.aSecourir, true, 'un nouveau code de secours sera créé');
  });
});

/* ======================================================================== assainissement */
test.describe('Assainissement des données venues d’ailleurs', () => {
  test('photos : PNG et JPEG intégrés acceptés ; « javascript: », SVG, adresse distante refusés', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    src.students[0].photo = PNG;
    src.students[1].photo = JPEG;
    src.students[2].photo = 'javascript:alert(1)';
    src.students[2].extraitPhoto = SVG;
    src.teachers[0].photo = 'https://exemple.invalid/espion.png';
    src.school.logoIepp = SVG;
    src.school.armoiries = 'data:image/png;base64,AAA<script>';
    const { etat } = AK.schema.migrer(src);
    assert.equal(etat.students[0].photo, PNG);
    assert.equal(etat.students[1].photo, JPEG);
    assert.equal(etat.students[2].photo, '');
    assert.equal(etat.students[2].extraitPhoto, '');
    assert.equal(etat.teachers[0].photo, '');
    assert.equal(etat.school.logoIepp, '');
    assert.equal(etat.school.armoiries, '');
    assert.equal(etat.school.logoEcole, PNG);
  });

  test('assainir directement : seules les images PNG, JPEG, GIF et WebP en base64 passent', () => {
    const AK = chargerSchema();
    const a = AK.schema.assainir;
    assert.equal(a(PNG, 'photo'), PNG);
    assert.equal(a(JPEG, 'avis'), JPEG);
    assert.equal(a('data:image/gif;base64,R0lGODlh', 'signatureImg'), 'data:image/gif;base64,R0lGODlh');
    assert.equal(a(SVG, 'photo'), '');
    assert.equal(a('data:text/html;base64,PHNjcmlwdD4=', 'photo'), '');
    assert.equal(a('javascript:alert(1)', 'logoEcole'), '');
    assert.equal(a('javascript:alert(1)', 'remarque'), 'javascript:alert(1)', 'un texte ordinaire est gardé tel quel (échappé à l’affichage)');
  });

  test('clés __proto__, constructor et prototype ignorées, sans pollution de prototype', () => {
    const AK = chargerSchema();
    const texte = JSON.stringify(donnees1x())
      .replace('"v":5,', '"v":5,"__proto__":{"pollue":"racine"},"constructor":{"prototype":{"pollue":"ctor"}},')
      .replace('"id":"k3j9x0a1b2c3",', '"id":"k3j9x0a1b2c3","__proto__":{"pollue":"eleve","statut":"Exclu"},"prototype":{"x":1},');
    const src = JSON.parse(texte);
    assert.ok(Object.prototype.hasOwnProperty.call(src.students[0], '__proto__'), 'préalable : la clé dangereuse est bien présente dans la source');
    const { etat } = AK.schema.migrer(src);
    const k = etat.students[0];
    assert.ok(!Object.prototype.hasOwnProperty.call(k, '__proto__'));
    assert.ok(!Object.prototype.hasOwnProperty.call(k, 'prototype'));
    assert.equal(k.pollue, undefined);
    assert.equal(k.statut, 'Inscrit', 'le statut ne vient pas d’un prototype piégé');
    assert.ok(!Object.prototype.hasOwnProperty.call(etat, 'constructor'));
    assert.equal(etat.pollue, undefined);
    assert.equal(AK.schema.vierge().pollue, undefined, 'aucun objet du contexte n’hérite de la pollution');
    assert.equal({}.pollue, undefined);
  });

  test('identifiants invalides nettoyés (lettres, chiffres, - et _ ; 64 caractères au plus)', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    src.students[0].id = 'k3j9"><img src=x onerror=alert(1)>';
    src.teachers[0].id = 'a b/c\\d;e';
    src.auth[0].pid = 'p<script>id';
    src.pro.paiements[0].sid = 'x'.repeat(100);
    const { etat } = AK.schema.migrer(src);
    assert.equal(etat.students[0].id, 'k3j9imgsrcxonerroralert1');
    assert.equal(etat.teachers[0].id, 'abcde');
    assert.equal(etat.auth[0].pid, 'pscriptid');
    assert.equal(etat.pro.paiements[0].sid, 'x'.repeat(64));
  });

  test('valeurs non numériques ou non finies écartées des notes ; classes inconnues retirées ; accent et évaluation courante corrigés', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    src.grades['k3j9x0a1b2c3|3|DICTEE'] = 'douze';
    src.grades['k3j9x0a1b2c3|3|MATHEMATIQUES'] = { v: 1 };
    src.teachers[0].classes = ['CE2', 'CM3', 'TERMINALE'];
    src.school.accent = 'rose-fluo';
    src.school.evalCourante = 9;
    src.school.niveaux = ['CM2', 'CP1', '6EME'];
    const { etat } = AK.schema.migrer(src);
    assert.ok(!('k3j9x0a1b2c3|3|DICTEE' in etat.grades));
    assert.ok(!('k3j9x0a1b2c3|3|MATHEMATIQUES' in etat.grades));
    assert.equal(Object.keys(etat.grades).length, 6, 'les 6 vraies notes restent');
    assert.deepEqual(j(etat.teachers[0].classes), ['CE2']);
    assert.equal(etat.school.accent, 'navy');
    assert.equal(etat.school.evalCourante, 1);
    assert.deepEqual(j(etat.school.niveaux), ['CP1', 'CM2']);
  });
});

/* ======================================================================== refus */
test.describe('Fichiers refusés', () => {
  test('données d’une version plus récente (schéma 7) refusées avec un message clair', () => {
    const AK = chargerSchema();
    const src = donnees1x();
    src.meta = { schema: 7, app: '3.0.0' };
    assert.throws(() => AK.schema.migrer(src), (e) => e instanceof AK.ErreurMetier && /version plus récente/.test(e.message) && /schéma 7/.test(e.message));
  });

  test('fichier sans liste d’élèves refusé (objet vide, students absent ou non tableau, null, texte)', () => {
    const AK = chargerSchema();
    const refus = (x) => assert.throws(() => AK.schema.migrer(x), (e) => e instanceof AK.ErreurMetier && /liste d’élèves/.test(e.message), JSON.stringify(x));
    refus({});
    refus({ v: 5, school: { name: 'EPP X' }, teachers: [] });
    refus({ v: 5, students: { a: 1 } });
    refus(null);
    refus('{"students": []}');
  });

  test('élève corrompu (null ou texte) dans la liste : refus par une erreur métier, pas une erreur technique', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    const AK = chargerSchema();
    for (const mauvais of [null, 'texte']) {
      const src = donnees1x();
      src.students.push(mauvais);
      let erreur = null;
      try {
        const { etat } = AK.schema.migrer(src);
        assert.equal(etat.students.length, 3, 'l’entrée corrompue est ignorée');
      } catch (e) {
        erreur = e;
      }
      if (erreur) assert.ok(erreur instanceof AK.ErreurMetier, `attendu : ErreurMetier ; obtenu : ${erreur.name} — ${erreur.message}`);
    }
  });
});

/* ======================================================================== contrôle d'intégrité */
test.describe('Contrôle d’intégrité (verifier)', () => {
  test('données saines (migration 1.x) : aucun problème', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    assert.deepEqual(j(AK.schema.verifier(etat)), []);
  });

  test('école vierge : aucun problème', () => {
    const AK = chargerSchema();
    assert.deepEqual(j(AK.schema.verifier(AK.schema.vierge())), []);
  });

  test('incohérences fabriquées : chacune détectée avec son code et sa gravité, sans rien supprimer', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    const [k, t] = etat.students;
    // 1. identifiant en double
    etat.students.push({ ...j(k), nom: 'DOUBLON', prenoms: 'Copie' });
    // 2. classe absente des niveaux ouverts (élève inscrit)
    etat.school.niveaux = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1'];
    // 3. matricule national attribué à deux élèves
    etat.students.push({ id: 'autre000001', nom: 'SORO', prenoms: 'Ali', classe: 'CE2', statut: 'Inscrit', sexe: 'Masculin', matNat: '12345678a' });
    // 4. sexe manquant
    etat.students.push({ id: 'sanssexe001', nom: 'KONE', prenoms: 'Ina', classe: 'CP1', statut: 'Inscrit', sexe: '', matNat: '' });
    // 5. notes orphelines (2 notes d'un élève supprimé)
    etat.grades['fantome0001|1|DICTEE'] = 12;
    etat.grades['fantome0001|1|MATHEMATIQUES'] = 30;
    // 6. demande orpheline (agent introuvable)
    etat.auth.push({ id: 'a9', ref: 'AUT-2026-009', qui: 'personnel', pid: 'parti000001', statut: 'En attente' });
    // 7. référence documentaire en double
    etat.docs.items.push({ ref: 'AK-CSC-2026-000001-X' }, { ref: 'AK-CSC-2026-000001-X' });
    const nb = { eleves: etat.students.length, notes: Object.keys(etat.grades).length, auth: etat.auth.length };

    const P = AK.schema.verifier(etat);
    const codes = j(P.map((p) => [p.code, p.gravite]));
    assert.deepEqual(codes.sort(), [
      ['classe-invalide', 'erreur'],
      ['demande-orpheline', 'avert'],
      ['id-double', 'erreur'],
      ['matricule-double', 'avert'],
      ['notes-orphelines', 'avert'],
      ['reference-double', 'erreur'],
      ['sexe-manquant', 'avert']
    ]);
    assert.ok(P.find((p) => p.code === 'classe-invalide').message.includes('TRAORE'));
    assert.deepEqual(j(P.find((p) => p.code === 'matricule-double').ids), [t.id, 'autre000001']);
    assert.match(P.find((p) => p.code === 'notes-orphelines').message, /^2 notes/);
    assert.deepEqual(j(P.find((p) => p.code === 'demande-orpheline').ids), ['a9']);
    // rien n'est supprimé
    assert.equal(etat.students.length, nb.eleves);
    assert.equal(Object.keys(etat.grades).length, nb.notes);
    assert.equal(etat.auth.length, nb.auth);
  });

  test('un élève parti dans une classe non ouverte n’est pas signalé (seuls les inscrits comptent)', () => {
    const AK = chargerSchema();
    const { etat } = AK.schema.migrer(donnees1x());
    etat.school.niveaux = ['CE2', 'CM2']; // l'élève YAO (CP1) a abandonné
    assert.deepEqual(j(AK.schema.verifier(etat)), []);
  });
});
