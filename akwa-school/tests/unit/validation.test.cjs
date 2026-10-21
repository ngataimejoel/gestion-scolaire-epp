/* =====================================================================================
   Tests unitaires : AK.valid (src/js/core/validate.js) et AK.u (src/js/core/util.js).
   Valeurs attendues calculées à la main à partir des règles (config.js, règles de la v1.7.0),
   jamais recopiées depuis la sortie du code testé.
   Exécution : node --test tests/unit/
   ===================================================================================== */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { charger } = require('./charger.cjs');

const AK = charger([]);
const V = AK.valid, u = AK.u, C = AK.cfg;

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Oracle indépendant (forme « validation » de Luhn mod N) : la clé est le caractère qui annule
    la somme pondérée 1, 2, 1, 2… lue de droite à gauche, chaque produit étant replié (a div 36 + a mod 36). */
function cleOracle(base) {
  const t = base.replace(/-/g, '');
  for (const k of B36) {
    let somme = 0;
    [...(t + k)].reverse().forEach((c, i) => {
      const p = B36.indexOf(c) * (i % 2 ? 2 : 1);
      somme += Math.floor(p / 36) + (p % 36);
    });
    if (somme % 36 === 0) return k;
  }
  throw new Error('aucune clé');
}
const TYPES = ['CEL', 'CPE', 'CSC', 'ATF', 'CTR', 'FIS', 'FII', 'FIN', 'BUL', 'BUA', 'ATS', 'REC'];
const refOracle = (type, an, n) => { const b = `AK-${type}-${an}-${String(n).padStart(6, '0')}`; return `${b}-${cleOracle(b)}`; };
const sansEspaces = (s) => String(s).replace(/[\s\u202f\u00a0]/g, ' ');
/** Les objets créés dans le contexte isolé ont leur propre prototype : comparaison structurelle après copie. */
const egal = (obtenu, attendu, msg) => assert.deepStrictEqual(obtenu == null ? obtenu : JSON.parse(JSON.stringify(obtenu)), attendu, msg);

/* =====================================================================================
   Références AK-XXX-AAAA-NNNNNN-C (clé Luhn mod 36)
   ===================================================================================== */
describe('validate · références documentaires (clé Luhn mod 36)', () => {
  test('clé d’un seul caractère calculée à la main', () => {
    // '0' : somme 0 → 0 ; '1' : 2 → 36-2 = 34 = Y ; 'H'(17) : 34 → 2 ; 'I'(18) : 36 → 1+0 = 1 → 35 = Z ; 'Z'(35) : 70 → 1+34 = 35 → 1
    assert.equal(V.cleLuhn36(''), '0');
    assert.equal(V.cleLuhn36('0'), '0');
    assert.equal(V.cleLuhn36('1'), 'Y');
    assert.equal(V.cleLuhn36('H'), '2');
    assert.equal(V.cleLuhn36('I'), 'Z');
    assert.equal(V.cleLuhn36('Z'), '1');
    // '10' : 0×2 + 1×1 = 1 → 35 = Z ; '01' : 1×2 + 0 = 2 → 34 = Y
    assert.equal(V.cleLuhn36('10'), 'Z');
    assert.equal(V.cleLuhn36('01'), 'Y');
  });

  test('références complètes calculées à la main', () => {
    // AKCSC2026000042 : 4+4+0+0+0+0+12+2+0+2+24+28+24+20+20 = 140 ; 140 mod 36 = 32 → clé 4
    assert.equal(V.reference('CSC', 2026, 42), 'AK-CSC-2026-000042-4');
    // AKCEL2026000042 : L(21)×2 = 42 → 1+6 = 7 ; somme 109 ; 109 mod 36 = 1 → 35 = Z
    assert.equal(V.reference('CEL', 2026, 42), 'AK-CEL-2026-000042-Z');
    // AKBUL2025000001 : somme 115 ; 115 mod 36 = 7 → 29 = T
    assert.equal(V.reference('BUL', 2025, 1), 'AK-BUL-2025-000001-T');
    // AKCEL2026000001 : somme 103 ; 103 mod 36 = 31 → 5
    assert.equal(V.reference('CEL', 2026, 1), 'AK-CEL-2026-000001-5');
  });

  test('la clé ignore les tirets et la casse', () => {
    assert.equal(V.cleLuhn36('ak-csc-2026-000042'), '4');
    assert.equal(V.cleLuhn36('AKCSC2026000042'), '4');
  });

  test('V.reference concorde avec l’oracle indépendant (12 types × 3 années × 400 numéros)', () => {
    for (const t of TYPES) for (const an of [2025, 2026, 2027]) for (let n = 0; n < 400; n++) {
      const attendu = refOracle(t, an, n);
      assert.equal(V.reference(t, an, n), attendu);
      assert.equal(V.refValide(attendu), true, attendu);
    }
  });

  test('refValide accepte minuscules et espaces autour, refuse les formats déviants', () => {
    assert.equal(V.refValide('AK-CSC-2026-000042-4'), true);
    assert.equal(V.refValide('  ak-csc-2026-000042-4 '), true);
    assert.equal(V.refValide('AK-CSC-2026-000042-5'), false);
    assert.equal(V.refValide('AK-CSC-2026-42-4'), false, 'numéro sur 6 chiffres');
    assert.equal(V.refValide('AK-CS-2026-000042-4'), false, 'type sur 3 lettres');
    assert.equal(V.refValide('AK-CSC-26-000042-4'), false, 'année sur 4 chiffres');
    assert.equal(V.refValide('AKCSC2026000042-4'), false, 'tirets obligatoires');
    assert.equal(V.refValide('AK-CSC-2026-000042'), false, 'clé absente');
    assert.equal(V.refValide('AK-CSC-2026-000042-44'), false);
    assert.equal(V.refValide('XAK-CSC-2026-000042-4'), false);
    assert.equal(V.refValide(''), false);
    assert.equal(V.refValide(null), false);
    assert.equal(V.refValide(undefined), false);
  });

  test('toute substitution d’un caractère est détectée (toutes positions, tous caractères)', () => {
    const refs = [];
    for (const t of TYPES) for (const n of [0, 1, 42, 999999, 123456, 70000]) refs.push(refOracle(t, 2026, n));
    refs.push(refOracle('CEL', 2025, 7), refOracle('BUL', 2030, 10));
    let essais = 0, detectees = 0;
    for (const ref of refs) {
      for (let i = 0; i < ref.length; i++) {
        const alphabet = ref[i] === '-' ? B36 + '_ .' : B36;
        for (const c of alphabet) {
          if (c === ref[i]) continue;
          const faux = ref.slice(0, i) + c + ref.slice(i + 1);
          essais++;
          if (!V.refValide(faux)) detectees++;
          else assert.fail(`substitution non détectée : ${ref} → ${faux}`);
        }
      }
    }
    assert.equal(detectees, essais);
    assert.ok(essais > 40000, `${essais} substitutions essayées`);
  });

  test('transpositions adjacentes : seules 0↔Z échappent à la clé (1258/1260 ≈ 99,84 %)', () => {
    // Démonstration : en position (×2, ×1), a b ↔ b a passe inaperçu ssi f(a) − a ≡ f(b) − b (mod 36),
    // avec f(a) = 2a si a ≤ 17, 2a − 35 sinon ; g(a) = a (a ≤ 17), a + 1 (a ≥ 18) mod 36 → seul g(0) = g(Z) = 0.
    for (const [avant, apres] of [['K7', 'M3'], ['K7', 'M'], ['', ''], ['Q', '']]) {
      const ratees = [];
      let n = 0;
      for (const a of B36) for (const b of B36) {
        if (a === b) continue;
        n++;
        if (V.cleLuhn36(avant + a + b + apres) === V.cleLuhn36(avant + b + a + apres)) ratees.push(a + b);
      }
      assert.equal(n, 1260);
      assert.deepEqual(ratees.sort(), ['0Z', 'Z0'], `contexte « ${avant}·${apres} »`);
    }
  });

  test('transpositions adjacentes dans une vraie référence : 100 % détectées (format + clé)', () => {
    let essais = 0, ratees = [];
    for (const t of TYPES) for (const n of [1, 42, 120, 4567, 98765, 100200, 909090]) {
      const ref = refOracle(t, 2026, n);
      const pos = [...ref].map((c, i) => (c === '-' ? -1 : i)).filter((i) => i >= 0);
      for (let k = 0; k + 1 < pos.length; k++) {
        const i = pos[k], j = pos[k + 1];
        if (ref[i] === ref[j]) continue;
        const a = [...ref];
        [a[i], a[j]] = [a[j], a[i]];
        essais++;
        if (V.refValide(a.join(''))) ratees.push(a.join(''));
      }
    }
    assert.deepEqual(ratees, []);
    assert.ok(essais > 500);
  });

  test('normRef : majuscules, espaces retirés partout', () => {
    assert.equal(V.normRef(' ak-csc-2026-000042-4 '), 'AK-CSC-2026-000042-4');
    assert.equal(V.normRef('AK - CSC - 2026 - 000042 - 4'), 'AK-CSC-2026-000042-4');
    assert.equal(V.normRef('ak-csc-2026-\t000042-4\n'), 'AK-CSC-2026-000042-4');
    assert.equal(V.normRef(null), '');
    assert.equal(V.normRef(undefined), '');
  });
});

/* =====================================================================================
   Notes
   ===================================================================================== */
describe('validate · note(brut, max)', () => {
  test('saisies valides : virgule ou point, espaces, borne incluse', () => {
    egal(V.note('12,5', 20), { v: 12.5 });
    egal(V.note('12.5', 20), { v: 12.5 });
    egal(V.note(' 7 ', 10), { v: 7 });
    egal(V.note('0', 10), { v: 0 });
    egal(V.note('20', 20), { v: 20 }, 'le barème lui-même est accepté');
    egal(V.note('50', 50), { v: 50 });
    egal(V.note('12,25', 20), { v: 12.25 });
    egal(V.note('9,75', 10), { v: 9.75 });
    egal(V.note('0,5', 10), { v: 0.5 });
    egal(V.note('007', 10), { v: 7 });
  });

  test('vide → null (note effacée)', () => {
    egal(V.note('', 20), { v: null });
    egal(V.note('   ', 20), { v: null });
    egal(V.note(null, 20), { v: null });
    egal(V.note(undefined, 20), { v: null });
  });

  test('au-delà du barème : message avec virgule décimale', () => {
    egal(V.note('21', 20), { err: 'Note invalide : 21 dépasse le barème (20).' });
    egal(V.note('20,5', 20), { err: 'Note invalide : 20,5 dépasse le barème (20).' });
    egal(V.note('10.01', 10), { err: 'Note invalide : 10,01 dépasse le barème (10).' });
    egal(V.note('51', 50), { err: 'Note invalide : 51 dépasse le barème (50).' });
  });

  test('négatif, texte, notation scientifique, séparateurs multiples → refusés', () => {
    const err = (max) => ({ err: `Note invalide : entrez un nombre entre 0 et ${max}.` });
    egal(V.note('-1', 20), err(20));
    egal(V.note('-0,5', 10), err(10));
    egal(V.note('abc', 20), err(20));
    egal(V.note('12a', 20), err(20));
    egal(V.note('1e1', 20), err(20));
    egal(V.note('12,5,3', 20), err(20));
    egal(V.note('12,', 20), err(20));
    egal(V.note(',5', 20), err(20));
    egal(V.note('+5', 20), err(20));
    egal(V.note('Infinity', 20), err(20));
    egal(V.note('ABS', 20), err(20));
  });

  test('plus de deux décimales → refusé', () => {
    const e = { err: 'Note invalide : deux décimales au plus.' };
    egal(V.note('12,345', 20), e);
    egal(V.note('0,001', 10), e);
    egal(V.note('9.999', 10), e);
  });

  test('toutes les demi-notes de 0 au barème sont acceptées (barèmes 10, 20, 40, 50)', () => {
    for (const max of [10, 20, 40, 50]) for (let k = 0; k <= max * 2; k++) {
      const s = String(k / 2).replace('.', ',');
      egal(V.note(s, max), { v: k / 2 }, `${s} / ${max}`);
    }
  });

  test('toute note à UNE décimale entre 0 et le barème est acceptée (ex. 8,7 / 10)', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    const refusees = [];
    for (const max of [10, 20, 40, 50]) for (let k = 0; k <= max * 10; k++) {
      const s = (k / 10).toFixed(1).replace('.', ',');
      const r = V.note(s, max);
      if (!r || r.v !== Number(s.replace(',', '.'))) refusees.push(`${s}/${max}`);
    }
    assert.deepEqual(refusees.slice(0, 12), [], `${refusees.length} notes valides refusées, dont : ${refusees.slice(0, 12).join(' ')}`);
  });

  test('toute note à DEUX décimales entre 0 et 20 est acceptée (ex. 0,29)', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    const refusees = [];
    for (let k = 0; k <= 2000; k++) {
      const s = (k / 100).toFixed(2).replace('.', ',');
      const r = V.note(s, 20);
      if (!r || r.v !== k / 100) refusees.push(s);
    }
    assert.deepEqual(refusees.slice(0, 12), [], `${refusees.length} notes valides refusées sur 2001, dont : ${refusees.slice(0, 12).join(' ')}`);
  });

  test('note numérique 0 (et non la chaîne « 0 ») → 0, pas « vide »', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    egal(V.note(0, 10), { v: 0 });
  });
});

/* =====================================================================================
   Noms, civilités
   ===================================================================================== */
describe('validate · nom de personne', () => {
  const ERR_LETTRES = 'Nom : lettres uniquement, 2 au moins par mot (ex. KOFFI KOUADIO).';
  const ERR_COMPLET = 'Nom : nom et prénoms en entier (ex. KOFFI KOUADIO).';

  test('noms ivoiriens courants acceptés (accents, apostrophes, traits d’union)', () => {
    for (const n of ['KOFFI KOUADIO', 'N’GUESSAN Kouamé', "N'DRI Aya", 'KONAN Marie-Laure', 'KOUASSI Aÿ', 'ÉHOUMAN Éloïse',
      'BAMBA Fatoumata Ançà', 'Mme KONE Awa', 'DR TOURE Ibrahim', 'M. KOFFI Jean-Baptiste', 'YAO   Ange']) {
      assert.equal(V.nom(n, 'Nom'), '', n);
    }
  });

  test('chiffres, symboles et lettres hors alphabet latin refusés', () => {
    assert.equal(V.nom('KOFFI K2', 'Nom'), ERR_LETTRES);
    assert.equal(V.nom('KOFFI KOUADIO3', 'Nom'), ERR_LETTRES);
    assert.equal(V.nom('KOFFI KOU@DIO', 'Nom'), ERR_LETTRES);
    assert.equal(V.nom('KOFFI A×B', 'Nom'), ERR_LETTRES, '× (U+00D7) n’est pas une lettre');
    assert.equal(V.nom('KOFFI A÷B', 'Nom'), ERR_LETTRES, '÷ (U+00F7) n’est pas une lettre');
    assert.equal(V.nom('KOFFI -AYA', 'Nom'), ERR_LETTRES, 'un mot commence par une lettre');
    assert.equal(V.nom("KOFFI 'AYA", 'Nom'), ERR_LETTRES);
  });

  test('mots d’une lettre ou d’une seule lettre répétée refusés', () => {
    assert.equal(V.nom('KOFFI K', 'Nom'), ERR_LETTRES);
    assert.equal(V.nom('KOFFI KK', 'Nom'), ERR_LETTRES);
    assert.equal(V.nom('KOFFI Kk', 'Nom'), ERR_LETTRES, 'insensible à la casse');
    assert.equal(V.nom("KOFFI K'K", 'Nom'), ERR_LETTRES, 'l’apostrophe ne compte pas');
    assert.equal(V.nom('KOFFI KO', 'Nom'), '');
  });

  test('nombre de mots minimal (civilités non comptées)', () => {
    assert.equal(V.nom('KOFFI', 'Nom'), ERR_COMPLET);
    assert.equal(V.nom('Mme KONE', 'Nom'), ERR_COMPLET);
    assert.equal(V.nom('M. MR. KONE', 'Nom'), ERR_COMPLET);
    assert.equal(V.nom('KOFFI', 'Nom', 1), '');
    assert.equal(V.nom('', 'Nom', 1), 'Nom : à renseigner.');
    assert.equal(V.nom('   ', 'Nom', 1), 'Nom : à renseigner.');
    assert.equal(V.nom(null, 'Nom'), ERR_COMPLET);
  });

  test('longueur maximale (80 par défaut, paramétrable)', () => {
    const n80 = 'KOFFI ' + 'AB'.repeat(37); // 6 + 74 = 80
    assert.equal(n80.length, 80);
    assert.equal(V.nom(n80, 'Nom'), '');
    assert.equal(V.nom(n80 + 'C', 'Nom'), 'Nom : 80 caractères au maximum.');
    assert.equal(V.nom('KOFFI KOUADIO', 'Nom', 2, 10), 'Nom : 10 caractères au maximum.');
    assert.equal(V.nom('  KOFFI KOUADIO  ', 'Nom', 2, 13), '', 'espaces extérieurs non comptés');
  });

  test('civilités : détection, retrait, ajout', () => {
    assert.equal(V.civ.de('MME KONE Awa'), 'Mme');
    assert.equal(V.civ.de('Mlle. ADJOUA Ama'), 'Mlle');
    assert.equal(V.civ.de('M. KOFFI'), 'M.');
    assert.equal(V.civ.de('MR KOFFI'), 'M.');
    assert.equal(V.civ.de('M KOFFI'), 'M.');
    assert.equal(V.civ.de('MADAME KONE'), '');
    assert.equal(V.civ.de('KONE Awa'), '');
    assert.equal(V.civ.sans('Mme KONE Awa'), 'KONE Awa');
    assert.equal(V.civ.sans('MARIE KONE'), 'MARIE KONE');
    assert.equal(V.civ.avec('Mme', 'mme kone awa marie-ève'), 'Mme KONE Awa Marie-Ève');
    assert.equal(V.civ.avec('M.', "n'guessan kouamé"), "M. N'GUESSAN Kouamé");
    assert.equal(V.civ.avec('Dr', 'yao ange'), 'YAO Ange', 'civilité inconnue ignorée');
    egal(C.CIVS, ['M.', 'Mme', 'Mlle']);
  });
});

/* =====================================================================================
   Téléphones de Côte d'Ivoire (10 chiffres, 01 Moov · 05 MTN · 07 Orange, +225 facultatif)
   ===================================================================================== */
describe('validate · téléphones de Côte d’Ivoire', () => {
  test('formats acceptés et forme normalisée « +225 07 07 07 07 07 »', () => {
    const cas = {
      '0707070707': '+225 07 07 07 07 07',
      '0102030405': '+225 01 02 03 04 05',
      '0544556677': '+225 05 44 55 66 77',
      '+225 07 08 09 10 11': '+225 07 08 09 10 11',
      '+2250708091011': '+225 07 08 09 10 11',
      '2250708091011': '+225 07 08 09 10 11',
      '00225 0708091011': '+225 07 08 09 10 11',
      '(07) 08.09.10.11': '+225 07 08 09 10 11',
      '07-08-09-10-11': '+225 07 08 09 10 11',
      '07/08/09/10/11': '+225 07 08 09 10 11',
      ' +225 (05) 44 55 66 77 ': '+225 05 44 55 66 77'
    };
    for (const [e, s] of Object.entries(cas)) assert.equal(V.telCI(e), s, e);
  });

  test('formats refusés : préfixe, longueur, indicatif étranger, fixe', () => {
    for (const e of ['0807070707', '0207070707', '0907070707', '2722445566', '070707070', '07070707071', '07070707',
      '+33 6 12 34 56 78', '+2250807070707', '+225 0707 0707 077', '7070707070', 'abcdefghij', '', null, '+225']) {
      assert.equal(V.telCI(e), null, String(e));
    }
  });

  test('V.tel : vide accepté, sinon message de la configuration', () => {
    assert.equal(C.TEL_ERR, '10 chiffres commençant par 07 (Orange), 05 (MTN) ou 01 (Moov), indicatif +225 facultatif.');
    assert.equal(V.tel('', 'Téléphone'), '');
    assert.equal(V.tel('   ', 'Téléphone'), '');
    assert.equal(V.tel('0707070707', 'Téléphone'), '');
    assert.equal(V.tel('0807070707', 'Téléphone'), 'Téléphone : ' + C.TEL_ERR);
  });

  test('V.telPropre : forme normalisée si valide, sinon texte nettoyé', () => {
    assert.equal(V.telPropre('07 07 07 07 07'), '+225 07 07 07 07 07');
    assert.equal(V.telPropre('  1234 '), '1234');
    assert.equal(V.telPropre(null), '');
  });
});

/* =====================================================================================
   Dates, période, naissance, année scolaire
   ===================================================================================== */
describe('validate · dates', () => {
  test('format et calendrier (années bissextiles)', () => {
    assert.equal(V.date('2026-09-01', 'Date'), '');
    assert.equal(V.date('2024-02-29', 'Date'), '', '2024 est bissextile');
    assert.equal(V.date('2000-02-29', 'Date'), '', '2000 est bissextile (divisible par 400)');
    for (const d of ['2025-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-09-00',
      '2026-9-1', '01/09/2026', '2026/09/01', '20260901', 'demain', '2026-09-01T00:00']) {
      assert.equal(V.date(d, 'Date'), 'Date : date invalide.', d);
    }
  });

  test('vide : accepté sauf si requise', () => {
    assert.equal(V.date('', 'Date'), '');
    assert.equal(V.date(null, 'Date'), '');
    assert.equal(V.date('', 'Date', { requise: true }), 'Date : date à renseigner.');
  });

  test('bornes min et max incluses', () => {
    const o = { min: '2026-09-01', max: '2027-07-31' };
    assert.equal(V.date('2026-09-01', 'Date', o), '');
    assert.equal(V.date('2027-07-31', 'Date', o), '');
    assert.equal(V.date('2026-08-31', 'Date', o), 'Date : la date doit être postérieure au 01/09/2026.');
    assert.equal(V.date('2027-08-01', 'Date', o), 'Date : la date ne peut pas dépasser le 31/07/2027.');
  });

  test('période : fin avant début', () => {
    assert.equal(V.periode('2026-09-10', '2026-09-01'), 'La date de fin est avant la date de début.');
    assert.equal(V.periode('2026-09-01', '2026-09-01'), '');
    assert.equal(V.periode('2026-09-01', '2026-09-10'), '');
    assert.equal(V.periode('', '2026-09-01'), '');
  });

  test('naissance d’un élève du primaire : 2 à 20 ans à la rentrée', () => {
    const IMPROBABLE = 'Date de naissance improbable pour un élève du primaire (âge entre 2 et 20 ans).';
    assert.equal(V.naissanceEleve('2020-03-01', 2026), '');
    assert.equal(V.naissanceEleve('2024-12-31', 2026), '', '2 ans : borne basse');
    assert.equal(V.naissanceEleve('2006-01-01', 2026), '', '20 ans : borne haute');
    assert.equal(V.naissanceEleve('2025-01-01', 2026), IMPROBABLE);
    assert.equal(V.naissanceEleve('2005-12-31', 2026), IMPROBABLE);
    assert.equal(V.naissanceEleve('', 2026), 'Date de naissance : date à renseigner.');
    assert.equal(V.naissanceEleve('2020-02-30', 2026), 'Date de naissance : date invalide.');
    assert.match(V.naissanceEleve('2999-01-01', 2026), /^Date de naissance : la date ne peut pas dépasser le \d\d\/\d\d\/\d{4}\.$/);
  });

  test('année scolaire : AAAA–AAAA+1 (tiret court ou trait d’union)', () => {
    const ERR = 'Année scolaire au format 2026–2027.';
    assert.equal(V.anneeScolaire('2026–2027'), '');
    assert.equal(V.anneeScolaire('2026-2027'), '');
    assert.equal(V.anneeScolaire('2026 - 2027'), '');
    assert.equal(V.anneeScolaire(' 2026–2027 '.trim()), '');
    for (const a of ['2026–2028', '2027–2026', '2026/2027', '26-27', '2026—2027', '2026', '', null]) assert.equal(V.anneeScolaire(a), ERR, String(a));
    assert.equal(V.normAnnee('2026-2027'), '2026–2027');
    assert.equal(V.normAnnee('2026 – 2027'), '2026–2027');
    assert.equal(V.normAnnee('n’importe'), 'n’importe');
    assert.equal(V.normAnnee(null), '');
  });
});

/* =====================================================================================
   Mot de passe, matricules, divers
   ===================================================================================== */
describe('validate · mot de passe', () => {
  test('règles : 8 à 128 caractères, lettres + chiffre, pas trivial', () => {
    assert.equal(C.SECU.MDP_MIN, 8);
    assert.equal(V.motDePasse('Abc1234'), 'Mot de passe : 8 caractères au moins.');
    assert.equal(V.motDePasse(''), 'Mot de passe : 8 caractères au moins.');
    assert.equal(V.motDePasse(null, 'Nouveau mot de passe'), 'Nouveau mot de passe : 8 caractères au moins.');
    assert.equal(V.motDePasse('a1'.repeat(64)), '', '128 caractères acceptés');
    assert.equal(V.motDePasse('a1'.repeat(64) + 'b'), 'Mot de passe : 128 caractères au maximum.');
    for (const p of ['aaaaaaaa', '11111111', '        ', '12345678', '123456789', '0123456789', '12345678ab', 'password1', 'PASSWORD2026',
      'azertyuiop1', 'Azertyui9', 'motdepasse1', 'MotDePasse2026', 'admin1234', 'Admin123x']) {
      assert.equal(V.motDePasse(p), 'Mot de passe : trop facile à deviner.', p);
    }
    for (const p of ['abcdefgh', 'Kouadio!', '98765432', '2026-2027', '!!!!!!!?']) {
      assert.equal(V.motDePasse(p), 'Mot de passe : mélangez des lettres et au moins un chiffre.', p);
    }
    for (const p of ['Kouadio2026', 'école-ouaninou-7', 'ÉléphantS1', 'k0ffi.k0uadio']) assert.equal(V.motDePasse(p), '', p);
  });

  test('force du mot de passe (0 à 4)', () => {
    assert.equal(V.forceMotDePasse(''), 0);
    assert.equal(V.forceMotDePasse('abc'), 0);
    assert.equal(V.forceMotDePasse('abcdefgh'), 1);
    assert.equal(V.forceMotDePasse('Abcdefgh'), 2);
    assert.equal(V.forceMotDePasse('Abcdefgh1'), 3);
    assert.equal(V.forceMotDePasse('Abcdefgh1!'), 4);
    assert.equal(V.forceMotDePasse('Abcdefghijk1!'), 4, 'plafonné à 4');
  });
});

describe('validate · matricules, école, DRENAET, texte, montant, classe', () => {
  test('matricule national DESPS : 6 à 12 lettres ou chiffres', () => {
    const ERR = 'Matricule national : 6 à 12 lettres ou chiffres, sans espace (ex. 12345678A).';
    assert.equal(V.matNat(''), '');
    assert.equal(V.matNat('12345678A'), '');
    assert.equal(V.matNat('12345678a'), '');
    assert.equal(V.matNat('1234 5678 A'), '', 'espaces ignorés');
    assert.equal(V.matNat('123456'), '');
    assert.equal(V.matNat('123456789012'), '');
    assert.equal(V.matNat('12345'), ERR);
    assert.equal(V.matNat('1234567890123'), ERR);
    assert.equal(V.matNat('1234-5678'), ERR);
    assert.equal(V.matNat('12345678É'), ERR);
  });

  test('matricule d’agent : 3 à 20 caractères, commence par une lettre ou un chiffre', () => {
    const ERR = 'Matricule : 3 à 20 caractères (lettres, chiffres, espaces, - / .).';
    assert.equal(V.matriculeAgent(''), '');
    assert.equal(V.matriculeAgent('123456A'), '');
    assert.equal(V.matriculeAgent('123 456-B/7.'), '');
    assert.equal(V.matriculeAgent('A12'), '');
    assert.equal(V.matriculeAgent('AB'), ERR);
    assert.equal(V.matriculeAgent('-123'), ERR);
    assert.equal(V.matriculeAgent('A'.repeat(20)), '');
    assert.equal(V.matriculeAgent('A'.repeat(21)), ERR);
    assert.equal(V.matriculeAgent('123_456'), ERR);
  });

  test('nom d’école : EPP obligatoire en public, 3 caractères en privé', () => {
    assert.equal(V.ecoleNom('epp ouaninou   2'), 'EPP OUANINOU 2');
    assert.equal(V.ecoleNom('EPP'), null);
    assert.equal(V.ecoleNom('École Les Anges'), null);
    assert.equal(V.ecoleNom('École Les Anges', true), 'ÉCOLE LES ANGES');
    assert.equal(V.ecoleNom('ab', true), null);
    assert.equal(V.ecoleNom('EPP ' + 'A'.repeat(76)), 'EPP ' + 'A'.repeat(76));
    assert.equal(V.ecoleNom('EPP ' + 'A'.repeat(77)), null, '80 caractères au plus');
    assert.match(V.ECOLE_ERR(false), /EPP/);
  });

  test('DRENAET : libellé et direction régionale (DE / D’)', () => {
    const dir = C.ENTETE.direction;
    egal(V.drenaetDe('Touba'), { drenaet: 'DRENAET DE TOUBA', direction: dir + ' DE TOUBA' });
    egal(V.drenaetDe('DRENAET DE TOUBA'), { drenaet: 'DRENAET DE TOUBA', direction: dir + ' DE TOUBA' });
    egal(V.drenaetDe('drena  man'), { drenaet: 'DRENAET DE MAN', direction: dir + ' DE MAN' });
    egal(V.drenaetDe("drenaet d'Odienné"), { drenaet: "DRENAET D'ODIENNÉ", direction: dir + " D'ODIENNÉ" });
    egal(V.drenaetDe('Abidjan 1'), { drenaet: "DRENAET D'ABIDJAN 1", direction: dir + " D'ABIDJAN 1" });
    assert.equal(V.drenaetDe(''), null);
    assert.equal(V.drenaetDe('DRENAET'), null);
  });

  test('DRENAET : « DRENAET DE » sans localité est refusé', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    assert.equal(V.drenaetDe('DRENAET DE'), null);
    assert.equal(V.drenaetDe('drenaet du '), null);
  });

  test('texte, montant, classe', () => {
    assert.equal(V.texte('', 'Motif'), '');
    assert.equal(V.texte(' ', 'Motif', { requis: true }), 'Motif : à renseigner.');
    assert.equal(V.texte('x'.repeat(200), 'Motif'), '');
    assert.equal(V.texte('x'.repeat(201), 'Motif'), 'Motif : 200 caractères au maximum.');
    assert.equal(V.texte('abcd', 'Motif', { max: 3 }), 'Motif : 3 caractères au maximum.');
    assert.equal(V.montant('1500', 'Montant'), '');
    assert.equal(V.montant(0, 'Montant'), '');
    assert.equal(V.montant(100000000, 'Montant'), '');
    assert.equal(sansEspaces(V.montant(100000001, 'Montant')), 'Montant : montant entre 0 et 100 000 000 F.');
    assert.equal(sansEspaces(V.montant(-1, 'Montant')), 'Montant : montant entre 0 et 100 000 000 F.');
    assert.notEqual(V.montant('abc', 'Montant'), '');
    assert.notEqual(V.montant(Infinity, 'Montant'), '');
    assert.equal(V.classe('CP1'), '');
    assert.equal(V.classe('CM2'), '');
    assert.equal(V.classe('CP3'), 'Classe inconnue : choisissez un niveau ouvert dans l’école.');
    assert.notEqual(V.classe('CP1', ['CM1', 'CM2']), '');
  });
});

/* =====================================================================================
   util : dates (fuseau, fin de mois, bissextiles)
   ===================================================================================== */
describe('util · dates', () => {
  test('pad, iso, parseISO (heure locale, minuit)', () => {
    assert.equal(u.pad(5), '05');
    assert.equal(u.pad(42, 6), '000042');
    assert.equal(u.pad(1234567, 6), '1234567');
    const d = u.parseISO('2026-03-01');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 2, 1, 0, 0]);
    assert.equal(u.iso(new Date(2026, 0, 31, 23, 59)), '2026-01-31');
  });

  test('estISO : calendrier réel', () => {
    for (const s of ['2026-01-31', '2024-02-29', '2000-02-29', '2026-12-31']) assert.equal(u.estISO(s), true, s);
    for (const s of ['2026-02-29', '1900-02-29', '2026-06-31', '2026-1-01', '2026-01-1', '', null, undefined, '2026-01-01 ', 'aaaa-bb-cc']) assert.equal(u.estISO(s), false, String(s));
  });

  test('ajouterJours : fins de mois, années bissextiles, changements d’année', () => {
    const cas = [
      ['2026-01-31', 1, '2026-02-01'], ['2024-02-28', 1, '2024-02-29'], ['2025-02-28', 1, '2025-03-01'],
      ['2026-12-31', 1, '2027-01-01'], ['2026-03-01', -1, '2026-02-28'], ['2024-03-01', -1, '2024-02-29'],
      ['2027-01-01', -1, '2026-12-31'], ['2026-01-31', 30, '2026-03-02'], ['2024-01-01', 366, '2025-01-01'],
      ['2026-09-01', 0, '2026-09-01'], ['2026-09-15', -365, '2025-09-15'], ['2100-02-28', 1, '2100-03-01']
    ];
    for (const [d, n, r] of cas) assert.equal(u.ajouterJours(d, n), r, `${d} + ${n}`);
  });

  test('ecartJours : différence en jours civils', () => {
    assert.equal(u.ecartJours('2026-01-01', '2026-12-31'), 364);
    assert.equal(u.ecartJours('2024-01-01', '2025-01-01'), 366);
    assert.equal(u.ecartJours('2026-02-28', '2026-03-01'), 1);
    assert.equal(u.ecartJours('2026-09-10', '2026-09-01'), -9);
  });

  test('fmtDate, fmtDateLongue, fmtJour, versISO', () => {
    assert.equal(u.fmtDate('2026-09-01'), '01/09/2026');
    assert.equal(u.fmtDate(''), '—');
    assert.equal(u.fmtDate(null), '—');
    assert.equal(u.fmtDate('texte libre'), 'texte libre');
    assert.equal(u.fmtDateLongue('2026-09-01'), '1 septembre 2026');
    assert.equal(u.fmtDateLongue('2024-02-29'), '29 février 2024');
    assert.equal(u.fmtDateLongue(''), '—');
    assert.equal(u.fmtJour('2026-09-01'), 'mar. 1 sept.', 'le 1er septembre 2026 est un mardi');
    assert.equal(u.versISO('14/05/2018'), '2018-05-14');
    assert.equal(u.versISO('4-5-2018'), '2018-05-04');
    assert.equal(u.versISO('14.05.2018'), '2018-05-14');
    assert.equal(u.versISO(' 2018-05-14 '), '2018-05-14');
    assert.equal(u.versISO('31/02/2018'), '');
    assert.equal(u.versISO('29/02/2024'), '2024-02-29');
    assert.equal(u.versISO('2018-5-14'), '');
    assert.equal(u.versISO(''), '');
  });

  test('aujourdhui : date locale AAAA-MM-JJ', () => {
    const a = u.aujourdhui();
    const d = new Date();
    const attendu = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(a, attendu);
  });

  test('indépendance du fuseau horaire (DST à minuit, UTC+14, UTC−11)', () => {
    const script = `
      const { charger } = require(${JSON.stringify(path.join(__dirname, 'charger.cjs'))});
      const u = charger([]).u;
      const r = {
        a: [['2026-03-28', 1], ['2026-03-29', 1], ['2026-10-24', 1], ['2026-10-25', 1], ['2026-09-05', 1], ['2026-09-06', 1],
            ['2026-09-06', -1], ['2018-11-03', 1], ['2018-11-04', -1], ['2026-12-31', 1], ['2024-02-28', 1]].map(([d, n]) => u.ajouterJours(d, n)),
        e: [u.ecartJours('2026-03-28', '2026-03-30'), u.ecartJours('2026-10-24', '2026-10-26'), u.ecartJours('2026-09-05', '2026-09-07'), u.ecartJours('2026-01-01', '2027-01-01')],
        i: ['2026-03-29', '2026-09-06', '2018-11-04', '2026-10-25'].map(u.estISO),
        h: u.fmtHorodatage(Date.UTC(2026, 9, 21, 14, 5)),
        f: u.fmtDate('2026-03-29')
      };
      process.stdout.write(JSON.stringify(r));`;
    const attendu = {
      a: ['2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26', '2026-09-06', '2026-09-07', '2026-09-05', '2018-11-04', '2018-11-03', '2027-01-01', '2024-02-29'],
      e: [2, 2, 2, 365],
      i: [true, true, true, true],
      f: '29/03/2026'
    };
    // Heure de l'horodatage : 14:05 UTC, affichée dans le fuseau local
    const heures = { UTC: '14:05', 'Africa/Abidjan': '14:05', 'Europe/Paris': '16:05', 'America/Sao_Paulo': '11:05', 'America/Santiago': '11:05', 'Pacific/Kiritimati': '04:05', 'Pacific/Pago_Pago': '03:05' };
    const jours = { 'Pacific/Kiritimati': '22/10/2026' };
    for (const tz of Object.keys(heures)) {
      const r = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
      const { h, ...reste } = r;
      assert.deepEqual(reste, attendu, `fuseau ${tz}`);
      assert.equal(sansEspaces(h), `${jours[tz] || '21/10/2026'} ${heures[tz]}`, `horodatage, fuseau ${tz}`);
    }
  });
});

/* =====================================================================================
   util : nombres
   ===================================================================================== */
describe('util · nombres', () => {
  test('arrondi au centième (cas représentables sans ambiguïté)', () => {
    assert.equal(u.arrondi(12.344), 12.34);
    assert.equal(u.arrondi(12.346), 12.35);
    assert.equal(u.arrondi(1.005), 1.01);
    assert.equal(u.arrondi(2.675), 2.68);
    assert.equal(u.arrondi(12.345), 12.35);
    assert.equal(u.arrondi(19.995), 20);
    assert.equal(u.arrondi(10 / 3), 3.33);
    assert.equal(u.arrondi(20 / 3), 6.67);
    assert.equal(u.arrondi(10 / 3, 1), 3.3);
    assert.equal(u.arrondi(7.25, 0), 7);
    assert.equal(u.arrondi(7.5, 0), 8);
    assert.equal(u.arrondi(0), 0);
  });

  test('arrondi au centième : demi-centième toujours vers le haut (9,995 → 10 ; 10,075 → 10,08)', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    const ratees = [];
    for (let c = 0; c < 2000; c++) {
      const x = Number(((c * 10 + 5) / 1000).toFixed(3)); // 0,005 ; 0,015 ; … ; 19,995
      const attendu = (c + 1) / 100;
      if (u.arrondi(x) !== attendu) ratees.push(`${x}→${u.arrondi(x)}`);
    }
    assert.equal(u.arrondi(9.995), 10, 'CM2 : seuil d’admission 10/20');
    assert.equal(u.arrondi(10.075), 10.08);
    assert.equal(u.arrondi(u.moyenne([10.01, 10])), 10.01);
    assert.deepEqual(ratees.slice(0, 8), [], `${ratees.length}/2000 demi-centièmes mal arrondis`);
  });

  test('moyenne, fmtNote, fmtSaisie, pct', () => {
    assert.equal(u.moyenne([]), null);
    assert.equal(u.moyenne([10, 12, 14]), 12);
    assert.equal(u.moyenne([12.5, 13]), 12.75);
    assert.equal(u.moyenne([0]), 0);
    assert.equal(u.fmtNote(12.5), '12,50');
    assert.equal(u.fmtNote(0), '0,00');
    assert.equal(u.fmtNote(10), '10,00');
    assert.equal(u.fmtNote(7.456), '7,46');
    assert.equal(u.fmtNote(null), '—');
    assert.equal(u.fmtNote(undefined), '—');
    assert.equal(u.fmtNote(NaN), '—');
    assert.equal(u.fmtNote(Infinity), '—');
    assert.equal(u.fmtSaisie(12.5), '12,5');
    assert.equal(u.fmtSaisie(0), '0');
    assert.equal(u.fmtSaisie(null), '');
    assert.equal(u.pct(1, 3), '33 %');
    assert.equal(u.pct(2, 3), '67 %');
    assert.equal(u.pct(5, 0), '—');
  });

  test('fcfa : séparateur des milliers français, arrondi à l’unité', () => {
    assert.equal(sansEspaces(u.fcfa(1500)), '1 500 F');
    assert.equal(sansEspaces(u.fcfa(1234567.6)), '1 234 568 F');
    assert.equal(sansEspaces(u.fcfa(100000000)), '100 000 000 F');
    assert.equal(u.fcfa(0), '0 F');
    assert.equal(u.fcfa(null), '0 F');
    assert.equal(u.fcfa(undefined), '0 F');
    assert.equal(u.fcfa(999), '999 F');
    assert.equal(u.fcfa(0.5), '1 F');
    assert.equal(sansEspaces(u.fcfa(-2500)), '-2 500 F');
    assert.match(u.fcfa(1500), /^1[\u202f\u00a0]500 F$/, 'espace insécable (pas de coupure de ligne)');
  });

  test('fcfa : un montant arrondi à zéro ne s’affiche pas « -0 F »', {
    /* corrigé en 2.0.0 */ todo: false
  }, () => {
    assert.equal(u.fcfa(-0.4), '0 F');
  });

  test('pluriel, entier', () => {
    assert.equal(u.pluriel(0, 'élève'), '0 élève');
    assert.equal(u.pluriel(1, 'élève'), '1 élève');
    assert.equal(u.pluriel(2, 'élève'), '2 élèves');
    assert.equal(u.pluriel(3, 'travail', 'travaux'), '3 travaux');
    assert.equal(u.pluriel(-2, 'point'), '-2 points');
    assert.equal(u.entier(''), null);
    assert.equal(u.entier(null), null);
    assert.equal(u.entier('12'), 12);
    assert.equal(u.entier('7.9'), 7);
    assert.equal(u.entier('-3'), 0);
    assert.equal(u.entier('abc'), 0);
  });
});

/* =====================================================================================
   util : textes
   ===================================================================================== */
describe('util · textes', () => {
  test('norm : minuscules sans accents ni ponctuation', () => {
    assert.equal(u.norm('Kouamé N’Guessan'), 'kouamenguessan');
    assert.equal(u.norm('ÉLÈVE-Ça va ?'), 'elevecava');
    assert.equal(u.norm('  CP1 / A '), 'cp1a');
    assert.equal(u.norm('Aÿ Ïa Ñ'), 'ayian');
    assert.equal(u.norm(null), '');
    assert.equal(u.norm(0), '');
    assert.equal(u.norm('Ivoirienne'), u.norm('IVOIRIENNE'));
  });

  test('sansAccents : garde la casse et la ponctuation', () => {
    assert.equal(u.sansAccents('Kouamé Aÿ Ç, « élève »'), 'Kouame Ay C, « eleve »');
    assert.equal(u.sansAccents('école'), 'ecole', 'forme décomposée');
    assert.equal(u.sansAccents(null), '');
  });

  test('majNom, majPrenoms, majNomComplet (accents, prénoms composés, apostrophes)', () => {
    assert.equal(u.majNom('kouamé n’guessan'), 'KOUAMÉ N’GUESSAN');
    assert.equal(u.majNom(null), '');
    assert.equal(u.majPrenoms('aya marie-laure'), 'Aya Marie-Laure');
    assert.equal(u.majPrenoms('ÉLODIE ÈVE'), 'Élodie Ève');
    assert.equal(u.majPrenoms("n'guessan"), "N'Guessan");
    assert.equal(u.majPrenoms('l’éa'), 'L’Éa');
    assert.equal(u.majPrenoms('  jean   paul'), '  Jean   Paul');
    assert.equal(u.majPrenoms('JEAN-BAPTISTE ÿves'), 'Jean-Baptiste Ÿves');
    assert.equal(u.majNomComplet('koffi kouadio jean-marc'), 'KOFFI Kouadio Jean-Marc');
    assert.equal(u.majNomComplet("n'guessan aya"), "N'GUESSAN Aya");
    assert.equal(u.majNomComplet('  koné  awa'), '  KONÉ  Awa');
    assert.equal(u.majNomComplet('kone'), 'KONE');
    assert.equal(u.majNomComplet(''), '');
    assert.equal(u.majNomComplet(null), '');
  });

  test('capitale, tronquer', () => {
    assert.equal(u.capitale('jean-paul DE la fontaine'), 'Jean-Paul De La Fontaine');
    assert.equal(u.tronquer('abcdef', 4), 'abc…');
    assert.equal(u.tronquer('abcd', 4), 'abcd');
    assert.equal(u.tronquer(null, 4), '');
  });

  test('csv : BOM, « ; », guillemets doublés, retours à la ligne, CRLF', () => {
    assert.equal(u.csv([]), '\uFEFF');
    assert.equal(u.csv([['a;b', 'c"d'], ['e\nf', null]]), '\uFEFF"a;b";"c""d"\r\n"e\nf";""');
    assert.equal(u.csv([[1, 0, false, undefined, 'é']]), '\uFEFF"1";"0";"false";"";"é"');
    assert.equal(u.csv([['""']]), '\uFEFF""""""');
    // relecture indépendante : un analyseur CSV minimal (RFC 4180, séparateur « ; ») retrouve les cellules
    const lignes = [['Nom', 'Prénoms', 'Note'], ['KONE; fils', 'Awa "Mimi"', '12,5'], ['YAO', 'Ange\r\nMarie', '']];
    const lire = (t) => {
      const res = [[]];
      let cell = '', q = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true;
        else if (c === ';') { res[res.length - 1].push(cell); cell = ''; }
        else if (c === '\r' && t[i + 1] === '\n') { res[res.length - 1].push(cell); cell = ''; res.push([]); i++; }
        else cell += c;
      }
      res[res.length - 1].push(cell);
      return res;
    };
    const t = u.csv(lignes);
    assert.equal(t[0], '\uFEFF');
    assert.deepEqual(lire(t.slice(1)), lignes);
  });
});

/* =====================================================================================
   util : HTML sûr, empreintes, identifiants
   ===================================================================================== */
describe('util · HTML sûr et identifiants', () => {
  test('esc et html`…` échappent tout sauf les fragments sûrs', () => {
    assert.equal(u.esc(`<a href="x" onclick='y'>\`&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&#96;&amp;');
    assert.equal(u.html`<p>${'<b>'}</p>`.toString(), '<p>&lt;b&gt;</p>');
    assert.equal(u.html`<p>${u.raw('<b>ok</b>')}</p>`.toString(), '<p><b>ok</b></p>');
    assert.equal(u.html`<p>${u.html`<i>${'&'}</i>`}</p>`.toString(), '<p><i>&amp;</i></p>', 'pas de double échappement');
    assert.equal(u.html`${['<', u.raw('<br>'), 3]}`.toString(), '&lt;<br>3');
    assert.equal(u.html`${null}${undefined}${false}${NaN}${0}`.toString(), '0');
    assert.equal(u.joindre(['a<', 'b'], u.raw('<br>')).toString(), 'a&lt;<br>b');
  });

  test('empreinte rapide : déterministe, sensible, longueur en base 36', () => {
    assert.equal(u.empreinte('abc'), u.empreinte('abc'));
    assert.notEqual(u.empreinte('abc'), u.empreinte('abd'));
    assert.notEqual(u.empreinte('ab'), u.empreinte('ba'));
    assert.match(u.empreinte(''), /^[0-9a-f]{16}-0$/);
    assert.match(u.empreinte('x'.repeat(100)), /^[0-9a-f]{16}-2s$/, '100 = 2×36 + 28 → « 2s »');
  });

  test('uid : 12 caractères [0-9a-z], sans doublon sur 5 000 tirages', () => {
    const vus = new Set();
    for (let i = 0; i < 5000; i++) {
      const id = u.uid();
      assert.match(id, /^[0-9a-z]{12}$/);
      vus.add(id);
    }
    assert.equal(vus.size, 5000);
  });

  test('clone : copie profonde', () => {
    const o = { a: [1, { b: 2 }] };
    const c = u.clone(o);
    c.a[1].b = 3;
    assert.equal(o.a[1].b, 2);
  });
});
