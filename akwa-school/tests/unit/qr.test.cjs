/* =====================================================================================
   Tests unitaires : AK.qr (src/js/docs/qr.js) et le générateur vendor/qrcode-generator.js.
   Le décodeur hors ligne (AK.qrdecode.decoderMatrice) sert de relecture indépendante des matrices.
   Empreintes attendues recalculées avec node:crypto (SHA-256) et un encodeur base 32 RFC 4648 écrit ici.
   Exécution : node --test tests/unit/
   ===================================================================================== */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { charger } = require('./charger.cjs');

const AK = charger(['js/security/crypto.js', 'vendor/qrcode-generator.js', 'js/docs/qr.js', 'js/docs/qrdecode.js']);
const Q = AK.qr;

const egal = (obtenu, attendu, msg) => assert.deepStrictEqual(obtenu == null ? obtenu : JSON.parse(JSON.stringify(obtenu)), attendu, msg);

/** Base 32 RFC 4648 sans remplissage (référence indépendante). */
function base32(octets) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const o of octets) bits += o.toString(2).padStart(8, '0');
  while (bits.length % 5) bits += '0';
  let r = '';
  for (let i = 0; i < bits.length; i += 5) r += A[parseInt(bits.slice(i, i + 5), 2)];
  return r;
}
const hRef = (texte) => base32(nodeCrypto.createHash('sha256').update(texte, 'utf8').digest().subarray(0, 10));

/* =====================================================================================
   propre, message, texte
   ===================================================================================== */
describe('qr · propre (valeur sûre dans le QR)', () => {
  test('majuscules sans accents', () => {
    assert.equal(Q.propre('Koné Aÿ Marie-Ève'), 'KONE AY MARIE-EVE');
    assert.equal(Q.propre('N’Guessan Çà'), 'N’GUESSAN CA');
  });

  test('« ; » « = » et retours à la ligne remplacés par un espace, espaces réduits', () => {
    assert.equal(Q.propre('Kouamé; N=1'), 'KOUAME N 1');
    assert.equal(Q.propre('a;;b==c'), 'A B C');
    assert.equal(Q.propre('  x\r\ny\t z '), 'X Y Z');
    assert.equal(Q.propre(';='), '');
  });

  test('60 caractères au plus', () => {
    assert.equal(Q.propre('a'.repeat(70)), 'A'.repeat(60));
    assert.equal(Q.propre('é'.repeat(60)).length, 60);
  });

  test('valeurs vides', () => {
    assert.equal(Q.propre(null), '');
    assert.equal(Q.propre(undefined), '');
    assert.equal(Q.propre(''), '');
  });
});

describe('qr · message et texte', () => {
  const c = { K: 'K1', N: 'Koné Awa Marie-Ève', T: 'cel', M: '12345678a', R: 'ak-cel-2026-000001-5', H: 'abcdefghjklmnpqr', X: '2027-07-31', E: '2026-09-15' };
  const MSG = 'AKS1;T=CEL;R=AK-CEL-2026-000001-5;E=2026-09-15;X=2027-07-31;H=ABCDEFGHJKLMNPQR;N=KONE AWA MARIE-EVE;M=12345678A;K=K1';

  test('ordre canonique T R E X H N M K, quel que soit l’ordre des clés', () => {
    assert.equal(Q.PREFIXE, 'AKS1');
    assert.equal(Q.message(c), MSG);
  });

  test('champs vides ou absents omis ; S et clés inconnues exclues du message signé', () => {
    assert.equal(Q.message({ T: 'CSC', R: 'AK-CSC-2026-000042-4', E: '2026-10-20', X: '', H: 'ABCD', N: null, M: undefined, S: 'sig', Z: 'intrus' }),
      'AKS1;T=CSC;R=AK-CSC-2026-000042-4;E=2026-10-20;H=ABCD');
  });

  test('un « ; » glissé dans un nom ne crée pas de champ supplémentaire', () => {
    assert.equal(Q.message({ T: 'CEL', R: 'AK-CEL-2026-000001-5', N: 'KONE;K=K9' }), 'AKS1;T=CEL;R=AK-CEL-2026-000001-5;N=KONE K K9');
  });

  test('texte = message, puis « ;S= » et la signature telle quelle', () => {
    assert.equal(Q.texte(c), MSG);
    assert.equal(Q.texte({ ...c, S: 'aB-_9xYz' }), MSG + ';S=aB-_9xYz');
  });
});

/* =====================================================================================
   lire
   ===================================================================================== */
describe('qr · lire', () => {
  const c = { T: 'CEL', R: 'AK-CEL-2026-000001-5', E: '2026-09-15', X: '2027-07-31', H: 'ABCDEFGHJKLMNPQR', N: 'KONE AWA', M: '12345678A', K: 'K1' };
  const SIG = 'MEUCIQ-abc_DEF123';

  test('aller-retour texte → lire (avec signature)', () => {
    const r = Q.lire(Q.texte({ ...c, S: SIG }));
    egal(r.champs, { ...c, S: SIG });
    assert.equal(r.message, Q.message(c));
    assert.equal(r.signature, SIG);
  });

  test('aller-retour sans signature : signature null', () => {
    const r = Q.lire(Q.texte(c));
    assert.equal(r.signature, null);
    assert.equal(r.message, Q.message(c));
  });

  test('le message recalculé est canonique même si le QR est désordonné ou bavard', () => {
    const r = Q.lire('AKS1;K=K1;R=AK-CEL-2026-000001-5;Z=inconnu;T=CEL;S=' + SIG + ';E=2026-09-15');
    assert.equal(r.message, 'AKS1;T=CEL;R=AK-CEL-2026-000001-5;E=2026-09-15;K=K1');
  });

  test('tolérance : minuscules (clés et préfixe), espaces autour des champs', () => {
    const r = Q.lire('  aks1; t = cel ; r = ak-cel-2026-000001-5 ;e=2026-09-15  ');
    assert.ok(r);
    assert.equal(r.champs.T, 'cel');
    assert.equal(r.message, 'AKS1;T=CEL;R=AK-CEL-2026-000001-5;E=2026-09-15', 'message canonique en majuscules');
  });

  test('tolérance : texte encodé en %XX (lien, presse-papiers)', () => {
    const t = Q.texte({ ...c, S: SIG });
    const r = Q.lire(encodeURIComponent(t));
    assert.ok(r);
    assert.equal(r.message, Q.message(c));
    assert.equal(r.signature, SIG);
    const r2 = Q.lire('https://ecole.example/verifier?q=' + encodeURIComponent(t));
    assert.equal(r2 && r2.message, Q.message(c), 'préfixe d’adresse ignoré');
  });

  test('tolérance : « % » non décodable laissé tel quel', () => {
    const r = Q.lire('AKS1;T=CEL;R=AK-CEL-2026-000001-5;N=A%E9');
    assert.ok(r, 'URIError rattrapée');
    assert.equal(r.champs.N, 'A%E9');
    assert.equal(Q.lire('AKS1;T=CEL;R=AK-CEL-2026-000001-5;N=100%').champs.N, '100%');
  });

  test('texte avant le préfixe ignoré ; « = » dans une valeur conservé', () => {
    const r = Q.lire('Scanné : AKS1;T=CEL;R=AK-CEL-2026-000001-5;S=abc==');
    assert.equal(r.signature, 'abc==');
    assert.equal(r.champs.T, 'CEL');
  });

  test('segments vides ou sans clé ignorés', () => {
    const r = Q.lire('AKS1;;=x;sans-egal;T=CEL;R=AK-CEL-2026-000001-5');
    egal(r.champs, { T: 'CEL', R: 'AK-CEL-2026-000001-5' });
  });

  test('null si ce n’est pas un QR AKWA ou si T ou R manque', () => {
    for (const t of ['', null, undefined, 'bonjour', 'AKS1', 'AKS2;T=CEL;R=AK-CEL-2026-000001-5', 'AKS1;T=CEL', 'AKS1;R=AK-CEL-2026-000001-5', 'AKS1;T=;R=x', 'AK-CEL-2026-000001-5']) {
      assert.equal(Q.lire(t), null, String(t));
    }
  });
});

/* =====================================================================================
   Empreinte du titulaire (H)
   ===================================================================================== */
describe('qr · empreinteTitulaire', () => {
  const canon = { type: 'CEL', ref: 'AK-CEL-2026-000001-5', nom: 'Koné', prenoms: 'Awa Marie-Ève', matricule: '12345678A', classe: 'CM2', annee: '2026–2027', ecole: 'EPP Ouaninou 2', extra: '' };

  test('SHA-256 des champs nettoyés, joints par « | », 80 bits en base 32 (16 caractères)', async () => {
    const attendu = hRef('CEL|AK-CEL-2026-000001-5|KONE|AWA MARIE-EVE|12345678A|CM2|2026–2027|EPP OUANINOU 2|');
    const h = await Q.empreinteTitulaire(canon);
    assert.match(h, /^[A-Z2-7]{16}$/);
    assert.equal(h, attendu);
  });

  test('titulaire vide : 9 champs vides', async () => {
    assert.equal(await Q.empreinteTitulaire({}), hRef('||||||||'));
  });

  test('déterministe', async () => {
    assert.equal(await Q.empreinteTitulaire(canon), await Q.empreinteTitulaire({ ...canon }));
  });

  test('sensible à chacun des 9 champs', async () => {
    const variantes = { type: 'CSC', ref: 'AK-CEL-2026-000002-3', nom: 'KONAN', prenoms: 'AWA', matricule: '12345678B', classe: 'CM1', annee: '2025–2026', ecole: 'EPP OUANINOU 1', extra: '1a2b' };
    const vues = new Set([await Q.empreinteTitulaire(canon)]);
    for (const [k, v] of Object.entries(variantes)) {
      const h = await Q.empreinteTitulaire({ ...canon, [k]: v });
      assert.ok(!vues.has(h), `le champ « ${k} » doit changer l’empreinte`);
      vues.add(h);
    }
    assert.equal(vues.size, 10);
  });

  test('insensible à la casse, aux accents et aux espaces superflus (forme canonique)', async () => {
    const h = await Q.empreinteTitulaire(canon);
    assert.equal(await Q.empreinteTitulaire({ ...canon, nom: '  KONE ', prenoms: 'awa   marie-eve', ecole: 'epp ouaninou 2' }), h);
  });
});

/* =====================================================================================
   Générateur (vendor) et SVG
   ===================================================================================== */
const decoder = (m) => AK.qrdecode.decoderMatrice(m.rows);

describe('qr · matrice (qrcode-generator)', () => {
  test('version choisie selon la capacité en octets (tables ISO 18004)', () => {
    // capacité en mode octets — v1 : L17 M14 Q11 H7 ; v2 : L32 M26 Q20 H14 ; v3 : H24
    const m = (t, n) => AK.vendor.qr.matrix(t, n);
    assert.equal(m('x'.repeat(14), 'M').version, 1);
    assert.equal(m('x'.repeat(14), 'M').size, 21);
    assert.equal(m('x'.repeat(15), 'M').version, 2);
    assert.equal(m('x'.repeat(15), 'M').size, 25);
    const ref = 'AK-CEL-2026-000001-5'; // 20 octets
    assert.equal(m(ref, 'L').version, 2);
    assert.equal(m(ref, 'M').version, 2);
    assert.equal(m(ref, 'Q').version, 2);
    assert.equal(m(ref, 'H').version, 3);
    assert.equal(m(ref, 'H').size, 29);
    assert.equal(m(ref).version, 2, 'niveau M par défaut');
  });

  test('texte en UTF-8 : un « é » compte deux octets', () => {
    assert.equal(AK.vendor.qr.matrix('é'.repeat(7), 'M').version, 1); // 14 octets
    assert.equal(AK.vendor.qr.matrix('é'.repeat(8), 'M').version, 2); // 16 octets
  });

  test('QR signé d’une carte (199 octets) : version 10 (57 modules) au niveau M', () => {
    const t = 'AKS1;T=CEL;R=AK-CEL-2026-000042-Z;E=2026-10-20;X=2027-07-31;H=ABCDEFGHJKLMNPQR;N=KONE AMINATA;M=12345678A;K=K1;S=' + 'A'.repeat(86);
    assert.equal(t.length, 199);
    const m = AK.vendor.qr.matrix(t, 'M');
    assert.equal(m.version, 10); // v9-M : 180 octets < 199 ≤ 213 (v10-M)
    assert.equal(m.size, 57);
    assert.equal(decoder(m), t);
  });

  test('relecture exacte par le décodeur hors ligne (courts, accentués, longs, quatre niveaux)', () => {
    const textes = ['AK-CSC-2026-000042-4', 'Élève : KOUASSI Aÿ — 1234 « ok » ; = %', '0123456789'.repeat(5), 'x'.repeat(300), 'AKS1;'.repeat(200)];
    for (const t of textes) for (const n of ['L', 'M', 'Q', 'H']) {
      const m = AK.vendor.qr.matrix(t, n);
      assert.equal(m.rows.length, m.size);
      assert.equal(m.size, 4 * m.version + 17);
      assert.equal(decoder(m), t, `${n} · ${t.slice(0, 20)}…`);
    }
  });

  test('capacité maximale : 2 331 octets au niveau M (version 40), 2 332 → erreur', () => {
    // v40-M : 2 334 mots de données = 18 672 bits ; 4 + 16 + 8 × 2 331 = 18 668 ≤ 18 672 ; 2 332 → 18 676 > 18 672
    const max = 'Z'.repeat(2331);
    const m = AK.vendor.qr.matrix(max, 'M');
    assert.equal(m.version, 40);
    assert.equal(m.size, 177);
    assert.equal(decoder(m), max);
    assert.throws(() => AK.vendor.qr.matrix('Z'.repeat(2332), 'M'), /overflow/);
  });
});

describe('qr · svg', () => {
  /** Reconstruit la matrice à partir du chemin SVG (rectangles « M x y h l v1 h-l z »). */
  function lireSvg(s) {
    const vb = s.match(/viewBox="0 0 (\d+) (\d+)"/);
    const t = Number(vb[1]);
    const d = s.match(/<path d="([^"]*)"/)[1];
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)].map((x) => x.slice(1).map(Number));
    assert.equal(runs.map((r) => `M${r[0]} ${r[1]}h${r[2]}v1h-${r[3]}z`).join(''), d, 'chemin composé uniquement de rectangles d’une rangée');
    return { t, runs };
  }

  test('zone de silence de 4 modules, fond blanc, chemin non vide', () => {
    const texte = 'AK-CEL-2026-000001-5';
    const s = String(Q.svg(texte));
    const m = AK.vendor.qr.matrix(texte, 'M');
    const { t, runs } = lireSvg(s);
    assert.equal(m.size, 25);
    assert.equal(t, 33, '25 + 2 × 4');
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 33 33" shape-rendering="crispEdges"/);
    assert.match(s, /<rect width="33" height="33" fill="#fff"\/>/);
    assert.ok(runs.length > 0);
    for (const [x, y, l, l2] of runs) {
      assert.equal(l, l2);
      assert.ok(x >= 4 && y >= 4 && x + l <= 29 && y <= 28, `rectangle hors zone utile : ${x},${y},${l}`);
    }
  });

  test('le chemin reproduit exactement la matrice, en segments horizontaux maximaux', () => {
    for (const texte of ['AK-CEL-2026-000001-5', 'AKS1;T=CEL;R=AK-CEL-2026-000001-5;E=2026-09-15;H=ABCDEFGHJKLMNPQR;K=K1;S=' + 'b'.repeat(86)]) {
      const m = AK.vendor.qr.matrix(texte, 'M');
      const { runs } = lireSvg(String(Q.svg(texte)));
      const g = Array.from({ length: m.size }, () => Array(m.size).fill(false));
      for (const [x, y, l] of runs) {
        for (let k = 0; k < l; k++) {
          assert.equal(g[y - 4][x - 4 + k], false, 'chevauchement');
          g[y - 4][x - 4 + k] = true;
        }
        assert.ok(x - 4 + l === m.size || !m.rows[y - 4][x - 4 + l], 'segment non maximal');
      }
      // m.rows vient du contexte isolé (autre « realm ») : comparaison par valeur
      assert.deepStrictEqual(JSON.stringify(g), JSON.stringify(m.rows.map((r) => r.map(Boolean))));
      // motif de position en haut à gauche : bord 7×7 noir, anneau blanc, carré 3×3 noir
      for (let i = 0; i < 7; i++) {
        assert.ok(g[0][i] && g[6][i] && g[i][0] && g[i][6]);
        if (i >= 1 && i <= 5) assert.ok(!g[1][i] && !g[5][i] && !g[i][1] && !g[i][5]);
      }
      for (let i = 2; i <= 4; i++) for (let j = 2; j <= 4; j++) assert.ok(g[i][j]);
    }
  });

  test('niveau de correction transmis (H plus grand que M pour le même texte)', () => {
    const a = lireSvg(String(Q.svg('AK-CEL-2026-000001-5', { niveau: 'H' })));
    assert.equal(a.t, 29 + 8);
  });

  test('titre accessible échappé', () => {
    const s = String(Q.svg('AK', { titre: 'Carte "A" <b>&' }));
    assert.match(s, /aria-label="Carte &quot;A&quot; &lt;b&gt;&amp;"/);
    assert.match(String(Q.svg('AK')), /aria-label="QR code"/);
  });

  test('brouillon : emplacement réservé, sans matrice', () => {
    const s = String(Q.svg(Q.BROUILLON));
    assert.equal(Q.BROUILLON, '@brouillon');
    assert.match(s, /QR code créé à l’impression/);
    assert.doesNotMatch(s, /shape-rendering/);
  });

  test('texte long (1 500 octets) : SVG valide et relisible', () => {
    const t = 'AKWA SCHOOL — vérification ; '.repeat(50);
    const m = AK.vendor.qr.matrix(t, 'M');
    const { t: cote, runs } = lireSvg(String(Q.svg(t)));
    assert.equal(cote, m.size + 8);
    assert.ok(runs.length > 1000);
    assert.equal(decoder(m), t);
  });
});
