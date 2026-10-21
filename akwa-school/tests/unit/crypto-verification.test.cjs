/* Cryptographie (empreintes de mots de passe, chiffrement de la clé, signatures ECDSA) et moteur
   de vérification des documents : chaque branche du verdict. Valeurs attendues tirées des règles
   (docs/SECURITE.md), jamais de la sortie du code testé. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger.cjs');

const AK = charger(['vendor/qrcode-generator.js', 'js/security/crypto.js', 'js/docs/qr.js', 'js/docs/verification.js']);
const K = AK.crypto;
const AUJ = '2026-10-21';

test.describe('crypto · secrets', () => {
  test('empreinte PBKDF2 : bon secret accepté, mauvais refusé, sel aléatoire', async () => {
    const a = await K.empreinteSecret('Ecole2026a'), b = await K.empreinteSecret('Ecole2026a');
    assert.equal(await K.verifierSecret('Ecole2026a', a), true);
    assert.equal(await K.verifierSecret('Ecole2026b', a), false);
    assert.equal(await K.verifierSecret('', a), false);
    assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'deux empreintes du même secret diffèrent (sel)');
    assert.ok(!JSON.stringify(a).includes('Ecole2026a'), 'le secret n’apparaît pas dans l’empreinte');
  });
  test('chiffrement AES-GCM : aller-retour, mauvais mot de passe et données altérées → null', async () => {
    const donnees = new TextEncoder().encode('clé privée PKCS8 simulée');
    const c = await K.chiffrer(donnees, 'Directeur2026');
    assert.equal(new TextDecoder().decode(await K.dechiffrer(c, 'Directeur2026')), 'clé privée PKCS8 simulée');
    assert.equal(await K.dechiffrer(c, 'Directeur2027'), null);
    const altere = { ...c, donnees: c.donnees.slice(0, -4) + (c.donnees.slice(-4, -3) === 'A' ? 'B' : 'A') + c.donnees.slice(-3) };
    assert.equal(await K.dechiffrer(altere, 'Directeur2026'), null);
  });
  test('code de secours lisible : format, alphabet sans ambiguïté, normalisation', () => {
    for (let i = 0; i < 50; i++) {
      const code = K.codeLisible(3);
      assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      assert.equal(K.normCode(code.toLowerCase().replace(/-/g, ' ')), K.normCode(code));
    }
  });
  test('base 32 et base64url : aller-retour sur des octets quelconques', () => {
    const o = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    assert.deepEqual([...K.deB64url(K.b64url(o))], [...o]);
    assert.match(K.b32(o), /^[A-Z2-7]+$/);
  });
});

test.describe('crypto · signatures ECDSA P-256', () => {
  test('signature valide ; message, signature ou clé différents → refus', async () => {
    const p1 = await K.nouvellePaire(), p2 = await K.nouvellePaire();
    const priv = await K.importerPrivee(p1.priv);
    const msg = 'AKS1;T=CSC;R=AK-CSC-2026-000001-0;E=2026-10-21';
    const sig = await K.signer(priv, msg);
    assert.equal(await K.verifierSignature(p1.pub, msg, sig), true);
    assert.equal(await K.verifierSignature(p1.pub, msg + 'X', sig), false);
    assert.equal(await K.verifierSignature(p2.pub, msg, sig), false);
    const sigAlt = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    assert.equal(await K.verifierSignature(p1.pub, msg, sigAlt), false);
    assert.equal(await K.verifierSignature(p1.pub, msg, 'pas-une-signature'), false);
  });
  test('empreinte lisible de la clé publique : XXXX-XXXX-XXXX-XXXX, stable', async () => {
    const p = await K.nouvellePaire();
    const e = await K.empreinteCle(p.pub);
    assert.match(e, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    assert.equal(await K.empreinteCle(JSON.parse(JSON.stringify(p.pub))), e);
  });
});

/* ---------- Moteur de vérification ---------- */
const ref = (n, type = 'CSC') => AK.valid.reference(type, 2026, n);
async function monde() {
  const paires = { K1: await K.nouvellePaire(), K2: await K.nouvellePaire(), K3: await K.nouvellePaire() };
  const cles = [
    { id: 'K1', pub: paires.K1.pub, empreinte: await K.empreinteCle(paires.K1.pub), statut: 'retiree', retireeLe: '2026-06-30T00:00:00Z', ecole: 'EPP TEST' },
    { id: 'K2', pub: paires.K2.pub, empreinte: await K.empreinteCle(paires.K2.pub), statut: 'active', ecole: 'EPP TEST' },
    { id: 'K3', pub: paires.K3.pub, empreinte: await K.empreinteCle(paires.K3.pub), statut: 'compromise', compromiseLe: '2026-09-01T00:00:00Z', ecole: 'EPP TEST' }
  ];
  const registre = new Map();
  const source = { cles, trouver: (r) => registre.get(r) || null, aujourdhui: AUJ };
  async function qr(c, kid) {
    const champs = { T: 'CSC', E: '2026-10-01', H: 'ABCDEFGHJKLMNPQR', ...c };
    if (!kid) return AK.qr.texte(champs);
    champs.K = kid;
    const sig = await K.signer(await K.importerPrivee(paires[kid].priv), AK.qr.message(champs));
    return AK.qr.texte({ ...champs, S: sig });
  }
  return { cles, registre, source, qr };
}
const point = (R, cle) => R.points.find((p) => p.cle === cle) || {};

test.describe('vérification · références saisies', () => {
  test('clé de contrôle fausse → invalide', async () => {
    const { source } = await monde();
    const r = ref(12), faux = r.slice(0, -1) + (r.slice(-1) === '0' ? '1' : '0');
    const R = await AK.verif.verifier(faux, source);
    assert.equal(R.verdict, 'invalide');
    assert.equal(point(R, 'format').etat, 'ko');
  });
  test('référence correcte absente du registre → inconnu', async () => {
    const { source } = await monde();
    const R = await AK.verif.verifier(ref(13), source);
    assert.equal(R.verdict, 'inconnu');
    assert.equal(point(R, 'registre').etat, 'av');
  });
  test('en vigueur au registre → valide (sans prétendre à une signature)', async () => {
    const { source, registre } = await monde();
    registre.set(ref(14), { e: '2026-10-01', h: 'H', v: [], s: 'valide', x: null });
    const R = await AK.verif.verifier(ref(14), source);
    assert.equal(R.verdict, 'valide');
    assert.equal(point(R, 'integrite').etat, 'info');
    assert.match(R.titre, /Référence/);
  });
  test('annulé, remplacé → invalide ; expiré → douteux', async () => {
    const { source, registre } = await monde();
    registre.set(ref(15), { e: '2026-10-01', h: 'H', v: [], s: 'annule', a: '2026-10-10', motif: 'erreur', x: null });
    registre.set(ref(16), { e: '2026-10-01', h: 'H', v: [], s: 'remplace', remplacePar: ref(17), x: null });
    registre.set(ref(18), { e: '2025-10-01', h: 'H', v: [], s: 'valide', x: '2026-07-31' });
    assert.equal((await AK.verif.verifier(ref(15), source)).verdict, 'invalide');
    assert.equal((await AK.verif.verifier(ref(16), source)).verdict, 'invalide');
    const R = await AK.verif.verifier(ref(18), source);
    assert.equal(R.verdict, 'douteux');
    assert.equal(point(R, 'statut').etat, 'av');
  });
  test('document de démonstration → jamais valide', async () => {
    const { source, registre } = await monde();
    registre.set(ref(19), { e: '2026-10-01', h: 'H', v: [], s: 'valide', x: null, demo: true });
    assert.notEqual((await AK.verif.verifier(ref(19), source)).verdict, 'valide');
  });
  test('douchette en QWERTY sur un clavier AZERTY : référence reconstituée', async () => {
    const r = ref(20); // ex. AK-CSC-2026-000020-?
    const azerty = { 1: '&', 2: 'é', 3: '"', 4: "'", 5: '(', 6: '§', 7: 'è', 8: '!', 9: 'ç', 0: 'à', '-': ')' };
    const tape = [...r].map((c) => azerty[c] || c).join('');
    assert.equal(AK.verif.lireReference(tape), r);
    assert.equal(AK.verif.lireReference('  ' + r.toLowerCase() + ' '), r);
  });
  test('texte quelconque → contenu non reconnu', async () => {
    const { source } = await monde();
    const R = await AK.verif.verifier('bonjour', source);
    assert.equal(R.verdict, 'inconnu');
    assert.equal(point(R, 'format').etat, 'ko');
  });
});

test.describe('vérification · QR codes', () => {
  test('QR signé par la clé active, empreinte identique au registre → valide', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(30), { e: '2026-10-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    const R = await AK.verif.verifier(await qr({ R: ref(30) }, 'K2'), source);
    assert.equal(R.verdict, 'valide');
    assert.equal(point(R, 'integrite').etat, 'ok');
    assert.equal(point(R, 'emetteur').etat, 'ok');
    assert.equal(R.titre, 'Document authentique et en vigueur');
  });
  test('QR modifié après signature (date) → signature invalide', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(31), { e: '2026-10-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    const t = (await qr({ R: ref(31) }, 'K2')).replace('E=2026-10-01', 'E=2026-10-02');
    const R = await AK.verif.verifier(t, source);
    assert.equal(R.verdict, 'invalide');
    assert.equal(point(R, 'integrite').etat, 'ko');
  });
  test('clé inconnue de l’appareil → signature non vérifiable, pas de « valide »', async () => {
    const { source, registre, qr } = await monde();
    const t = (await qr({ R: ref(32) }, 'K2')).replace(';K=K2;', ';K=K9;');
    const R = await AK.verif.verifier(t, source);
    assert.notEqual(R.verdict, 'valide');
    assert.equal(point(R, 'integrite').etat, 'av');
  });
  test('clé retirée : document antérieur accepté, postérieur refusé', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(33), { e: '2026-05-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    registre.set(ref(34), { e: '2026-08-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    const avant = await AK.verif.verifier(await qr({ R: ref(33), E: '2026-05-01' }, 'K1'), source);
    const apres = await AK.verif.verifier(await qr({ R: ref(34), E: '2026-08-01' }, 'K1'), source);
    assert.equal(avant.verdict, 'valide');
    assert.equal(apres.verdict, 'invalide');
    assert.equal(point(apres, 'emetteur').etat, 'ko');
  });
  test('clé compromise → émetteur refusé', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(35), { e: '2026-10-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    const R = await AK.verif.verifier(await qr({ R: ref(35) }, 'K3'), source);
    assert.equal(R.verdict, 'invalide');
    assert.equal(point(R, 'emetteur').etat, 'ko');
  });
  test('empreinte différente du registre → falsifié ou mal copié', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(36), { e: '2026-10-01', h: 'ZZZZZZZZZZZZZZZZ', v: [], s: 'valide', x: null });
    const R = await AK.verif.verifier(await qr({ R: ref(36) }, 'K2'), source);
    assert.equal(R.verdict, 'invalide');
    assert.equal(point(R, 'registre').etat, 'ko');
  });
  test('version ancienne (bulletin réédité) → douteux', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(37, 'BUL'), { e: '2026-10-01', h: 'NOUVELLEVERSIONX', v: ['ABCDEFGHJKLMNPQR'], s: 'valide', x: null });
    const R = await AK.verif.verifier(await qr({ T: 'BUL', R: ref(37, 'BUL') }, 'K2'), source);
    assert.equal(R.verdict, 'douteux');
    assert.match(point(R, 'registre').detail, /ANCIENNE/);
  });
  test('QR non signé inscrit au registre → valide « non signé » ; absent → inconnu', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(38), { e: '2026-10-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: null });
    const R = await AK.verif.verifier(await qr({ R: ref(38) }), source);
    assert.equal(R.verdict, 'valide');
    assert.match(R.titre, /non signé/);
    assert.equal((await AK.verif.verifier(await qr({ R: ref(39) }), source)).verdict, 'inconnu');
  });
  test('fin de validité inscrite dans le QR dépassée (hors registre) → signalée', async () => {
    const { source, qr } = await monde();
    const R = await AK.verif.verifier(await qr({ R: ref(40), X: '2026-07-31' }, 'K2'), source);
    assert.equal(point(R, 'statut').etat, 'av');
    assert.notEqual(R.verdict, 'valide');
  });
  test('identité du QR rappelée pour comparaison, sans autre donnée personnelle', async () => {
    const { source, registre, qr } = await monde();
    registre.set(ref(41, 'CEL'), { e: '2026-10-01', h: 'ABCDEFGHJKLMNPQR', v: [], s: 'valide', x: '2027-07-31' });
    const t = await qr({ T: 'CEL', R: ref(41, 'CEL'), X: '2027-07-31', N: 'KONE AMINATA', M: '12345678A' }, 'K2');
    assert.ok(!/TEL|SANG|ACTE/i.test(t.replace(/;S=.*$/, '')), 'aucun champ sensible dans le QR');
    const R = await AK.verif.verifier(t, source);
    assert.equal(R.verdict, 'valide');
    assert.match(point(R, 'identite').detail, /KONE AMINATA/);
  });
});
