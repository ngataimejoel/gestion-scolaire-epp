/* Outil de vérification autonome (fichier HTML remis à l'IEPP, à un établissement, à un parent).
   Dans l'application (école réelle) : clé de signature, élèves, certificats et carte émis,
   annulation AVANT la copie, création de l'outil par l'écran Documents › Vérifier (vrai
   téléchargement), puis annulation et émission APRÈS la copie.
   Dans l'outil ouvert en file:// : référence valide, QR signé valide, QR falsifié refusé,
   référence inconnue, clé de contrôle fausse, document annulé après la copie toujours « en vigueur »
   avec l'avertissement de date (comportement attendu), annulé avant la copie refusé, document émis
   après la copie, douchette AZERTY, photo PNG du QR, image sans QR, fichier non image, caméra
   (flux simulé contenant le QR, arrêt propre), refus de caméra, historique, copie du résultat,
   thème, largeur mobile, modèle vide expliqué, données illisibles, clé altérée,
   zéro requête réseau, zéro erreur JS. */
const { chromium, ouvrir, creerEcole, aller, fs, path } = require('./outils.cjs');
const os = require('node:os');

const DOSSIER = process.env.AKWA_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 'akwa-verif-'));
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail: String(detail).slice(0, 400) });
const fichier = (nom) => path.join(DOSSIER, nom);

/* Vérifie un texte dans l'outil par le formulaire et renvoie le verdict affiché. */
async function verifier(page, texte) {
  await page.fill('#vf-texte', texte);
  await page.click('#vf-form [type=submit]');
  await page.waitForFunction((t) => {
    const z = document.querySelector('#vf-resultat .verif-res');
    return z && document.querySelector('#vf-annonce').textContent.length > 0 && window.__dernier !== z;
  }, texte, { timeout: 8000 });
  return lireResultat(page);
}
async function lireResultat(page) {
  return page.evaluate(() => {
    const z = document.querySelector('#vf-resultat .verif-res');
    window.__dernier = z;
    const points = [...z.querySelectorAll('.verif-point')].map((p) => ({ etat: p.className.replace('verif-point', '').trim(), titre: p.querySelector('b').textContent, detail: p.querySelector('span').textContent }));
    return {
      verdict: ['valide', 'douteux', 'invalide', 'inconnu'].find((v) => z.classList.contains(v)),
      titre: z.querySelector('.verif-tete b').textContent,
      points,
      texte: document.querySelector('#vf-resultat').textContent
    };
  });
}
const pt = (r, cle) => r.points.find((p) => p.titre.startsWith(cle)) || { etat: '', detail: '' };

/* Image PNG d'un QR (moteur de l'application), tournée, sur fond gris : « photo » du document. */
async function pngQR(page, texte, { rotation = 0.3, vide = false } = {}) {
  const b64 = await page.evaluate(async ({ texte, rotation, vide }) => {
    const c = document.createElement('canvas');
    c.width = c.height = 700;
    const g = c.getContext('2d');
    g.fillStyle = '#ddd';
    g.fillRect(0, 0, 700, 700);
    if (!vide) {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(AK.qr.svg(texte))); });
      g.translate(350, 350);
      g.rotate(rotation);
      g.drawImage(img, -260, -260, 520, 520);
    } else {
      g.fillStyle = '#345';
      g.fillRect(120, 160, 300, 90);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { texte, rotation, vide });
  return Buffer.from(b64, 'base64');
}

/* Vidéo Y4M (format lu par le faux périphérique de Chromium) montrant le QR : 640×480, I420. */
async function y4mQR(page, texte) {
  const rgba = await page.evaluate(async (texte) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, 640, 480);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(AK.qr.svg(texte))); });
    g.translate(320, 240);
    g.rotate(-0.12);
    g.drawImage(img, -200, -200, 400, 400);
    return Array.from(g.getImageData(0, 0, 640, 480).data);
  }, texte);
  const W = 640, H = 480;
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), Vv = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    Y[y * W + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const i = ((y * 2) * W + x * 2) * 4;
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2];
    U[y * (W / 2) + x] = Math.round(128 - 0.168736 * r - 0.331264 * gg + 0.5 * b);
    Vv[y * (W / 2) + x] = Math.round(128 + 0.5 * r - 0.418688 * gg - 0.081312 * b);
  }
  const trame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, Vv]);
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(6).fill(trame)]);
}

(async () => {
  /* =========================== 1. Dans l'application =========================== */
  const app = await ouvrir();
  const page = app.page;
  await page.addInitScript(() => { window.print = () => { window.__impressions = (window.__impressions || 0) + 1; }; });
  const { mdp } = await creerEcole(page, { nom: 'EPP Sainte-Thérèse d’Anyama' });
  await page.evaluate((m) => AK.cles.creer(m), mdp);
  const cle = await page.evaluate(() => ({ id: AK.cles.active().id, empreinte: AK.cles.active().empreinte }));
  ok('application : clé de signature créée', /^K\d+$/.test(cle.id) && /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/.test(cle.empreinte), JSON.stringify(cle));

  const ids = await page.evaluate(() => [
    AK.eleves.inscrire({ nom: 'N’GUESSAN', prenoms: 'Ésaïe Kouadio', sexe: 'Masculin', classe: 'CM1', age: 10, pere_nom: 'N’GUESSAN', pere_prenoms: 'Paul', entree: '2025-09-15' }).id,
    AK.eleves.inscrire({ nom: 'KONÉ', prenoms: 'Aminata', sexe: 'Féminin', classe: 'CE2', age: 9, mere_nom: 'TRAORÉ', mere_prenoms: 'Awa', entree: '2025-09-15' }).id
  ]);
  ok('application : deux élèves inscrits', ids.length === 2 && ids.every(Boolean));

  // A : certificat par l'aperçu puis « Imprimer » (vrai parcours d'émission)
  await page.evaluate((id) => AK.docs.ouvrir('certificat-scolarite', [{ eleve: AK.eleves.trouver(id) }]), ids[0]);
  await page.waitForSelector('dialog[open] .feuille');
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  const A = await page.evaluate(() => AK.store.etat.docs.items[0]);
  ok('application : certificat A émis à l’impression et signé', A && A.signe && /;S=/.test(A.qr) && (await page.evaluate(() => window.__impressions)) === 1, A && A.ref);

  // B, C : certificats émis directement par le générateur ; D : carte avec identité dans le QR
  const emettre = (modele, id) => page.evaluate(async ({ modele, id }) => (await AK.docs.generer(modele, [{ eleve: AK.eleves.trouver(id) }], {})).docs[0], { modele, id });
  const B = await emettre('certificat-scolarite', ids[1]);
  const C = await emettre('certificat-scolarite', ids[0]);
  const Dc = await emettre('carte-eleve', ids[1]);
  ok('application : B, C et carte D émis et signés', [B, C, Dc].every((d) => d && d.signe), [B, C, Dc].map((d) => d && d.ref).join(' '));
  ok('application : carte D avec nom dans le QR', /;N=KONE AMINATA;/.test(Dc.qr), Dc.qr);

  // C annulé AVANT la copie
  await page.evaluate((r) => AK.registre.annuler(r, 'Erreur sur la classe'), C.ref);
  ok('application : C annulé avant la copie', (await page.evaluate((r) => AK.registre.trouver(r).statut, C.ref)) === 'annule');

  // création de l'outil par l'écran Documents › Vérifier (téléchargement réel)
  await aller(page, 'documents/verifier');
  await page.click('[data-action="verificateur-exporter"]');
  await page.waitForSelector('dialog[open] [name=noms]');
  await page.check('dialog[open] [name=noms]');
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] [type=submit]')]);
  const cheminOutil = fichier('outil-rempli.html');
  await telechargement.saveAs(cheminOutil);
  const outil = fs.readFileSync(cheminOutil, 'utf8');
  ok('outil créé par l’application (nom de fichier)', /^AKWA_verification_EPP_Sainte_Therese_d_Anyama_\d{4}-\d{2}-\d{2}\.html$/.test(telechargement.suggestedFilename()), telechargement.suggestedFilename());
  ok('outil : données intégrées, marqueur remplacé', !outil.includes('/*@DONNEES*/null') && outil.includes('"format":"akwa-verification"'));
  ok('outil : aucune clé privée ni secret', !/"prive"|"d":"|"mdp"|"pwd"|"sel"/.test(outil));
  ok('outil : aucune ressource externe', !/(src|href)=["']https?:|@import|url\(\s*["']?https?:/i.test(outil));

  // APRÈS la copie : A annulé, E émis
  await page.evaluate((r) => AK.registre.annuler(r, 'Perte déclarée par la famille'), A.ref);
  const E = await emettre('certificat-scolarite', ids[1]);
  ok('application : A annulé et E émis après la copie', (await page.evaluate((r) => AK.registre.trouver(r).statut, A.ref)) === 'annule' && E && E.signe);

  // modèle vide (tel qu'intégré à l'application, identique à dist/AKWA_SCHOOL_verification_modele.html)
  const gabarit = await page.evaluate(() => AK.gabaritVerificateur);
  ok('modèle : marqueur de données présent exactement une fois', gabarit.split('/*@DONNEES*/null').length === 2);
  fs.writeFileSync(fichier('modele.html'), gabarit);
  // variantes altérées
  fs.writeFileSync(fichier('illisible.html'), gabarit.replace('/*@DONNEES*/null', () => '{"format":"autre","version":1}'));
  const donnees = JSON.parse(outil.match(/window\.AKWA_DONNEES = (\{.*?\});<\/script>/s)[1]);
  const alteree = JSON.parse(JSON.stringify(donnees));
  alteree.cles[0].pub.x = donnees.cles[0].pub.y; // clé publique remplacée, empreinte d'origine conservée
  fs.writeFileSync(fichier('cle-alteree.html'), gabarit.replace('/*@DONNEES*/null', () => JSON.stringify(alteree).replace(/</g, '\\u003c')));
  const ancienne = JSON.parse(JSON.stringify(donnees));
  ancienne.registreDate = '2020-01-15';
  fs.writeFileSync(fichier('copie-ancienne.html'), gabarit.replace('/*@DONNEES*/null', () => JSON.stringify(ancienne)));

  // images et vidéo du QR
  fs.writeFileSync(fichier('qr-A.png'), await pngQR(page, A.qr));
  fs.writeFileSync(fichier('sans-qr.png'), await pngQR(page, '', { vide: true }));
  fs.writeFileSync(fichier('pas-une-image.png.txt'), 'ceci n’est pas une image');
  fs.writeFileSync(fichier('qr-D.y4m'), await y4mQR(page, Dc.qr));
  const inconnue = await page.evaluate(() => AK.valid.reference('CSC', new Date().getFullYear(), 987654));
  ok('aucune erreur JS dans l’application', app.erreurs.length === 0, app.erreurs.join(' | '));
  await app.navigateur.close();

  /* =========================== 2. Outil rempli, en file:// =========================== */
  const t = await ouvrir();
  const p = t.page;
  await t.contexte.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.goto('file://' + cheminOutil);
  await p.waitForFunction(() => document.documentElement.dataset.pret === '1');
  const tete = await p.evaluate(() => ({ h1: document.querySelector('h1').textContent, infos: document.querySelector('.vf-infos').textContent, titre: document.title, lien: !!document.querySelector('a[href^="http"]') }));
  ok('en-tête : nom de l’école (accents, apostrophe)', tete.h1 === 'EPP Sainte-Thérèse d’Anyama' && /Sainte-Thérèse/.test(tete.titre), tete.h1);
  ok('en-tête : date de la copie et nombre de références', tete.infos.includes(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })) && /4 références/.test(tete.infos), tete.infos);
  ok('en-tête : empreinte de la clé recalculée et conforme', tete.infos.includes(cle.empreinte) && /Active/.test(tete.infos) && !(await p.$('.encadre.erreur')), tete.infos);

  // saisie vide
  await p.click('#vf-form [type=submit]');
  ok('saisie vide : message sous le champ, rien de vérifié', (await p.isVisible('#vf-texte-err')) && (await p.getAttribute('#vf-texte', 'aria-invalid')) === 'true' && !(await p.$('#vf-resultat .verif-res')), await p.textContent('#vf-texte-err'));
  await p.fill('#vf-texte', 'x');
  ok('l’erreur disparaît dès la frappe', !(await p.isVisible('#vf-texte-err')));

  let r = await verifier(p, B.ref);
  ok('référence valide (B) : « en vigueur »', r.verdict === 'valide' && pt(r, 'Statut').etat === 'ok' && /Référence inscrite au registre/.test(r.titre), JSON.stringify(r.points));
  ok('référence : nom du titulaire du registre affiché', /KONE AMINATA/.test(r.texte) && /Titulaire \(registre\)/.test(r.texte));
  ok('avertissements : registre daté, signature ≠ validité administrative, comparer la personne', /Registre daté/.test(r.texte) && /ne prouve pas la validité administrative/.test(r.texte) && /photo avec la personne/.test(r.texte));

  r = await verifier(p, '  ' + B.ref.toLowerCase().replace(/-/g, ' - ') + ' ');
  ok('référence en minuscules avec espaces : reconnue', r.verdict === 'valide', r.titre);

  const azerty = { 1: '&', 2: 'é', 3: '"', 4: "'", 5: '(', 6: '§', 7: 'è', 8: '!', 9: 'ç', 0: 'à', '-': ')' };
  r = await verifier(p, [...B.ref].map((c) => azerty[c] || c).join(''));
  ok('douchette en QWERTY sur clavier AZERTY : référence reconstituée', r.verdict === 'valide', r.titre + ' ' + JSON.stringify(r.points));

  r = await verifier(p, B.qr);
  ok('QR signé valide (B) : authentique et en vigueur', r.verdict === 'valide' && r.titre === 'Document authentique et en vigueur' && pt(r, 'Intégrité').etat === 'ok' && pt(r, 'Émetteur').etat === 'ok', JSON.stringify(r.points));
  ok('QR signé : émetteur = école et empreinte de la clé', pt(r, 'Émetteur').detail.includes('EPP Sainte-Thérèse d’Anyama') && pt(r, 'Émetteur').detail.includes(cle.empreinte), pt(r, 'Émetteur').detail);

  r = await verifier(p, B.qr.replace(/E=\d{4}-\d{2}-\d{2}/, 'E=2020-01-01'));
  ok('QR falsifié (date modifiée) : refusé', r.verdict === 'invalide' && pt(r, 'Intégrité').etat === 'ko' && /Ne vous fiez pas/.test(r.texte), JSON.stringify(r.points));
  r = await verifier(p, Dc.qr.replace('N=KONE AMINATA', 'N=KONE AWA'));
  ok('QR de carte falsifié (nom changé) : refusé', r.verdict === 'invalide' && pt(r, 'Intégrité').etat === 'ko', JSON.stringify(r.points));
  r = await verifier(p, Dc.qr);
  ok('QR de carte signé : valide, titulaire du QR à comparer', r.verdict === 'valide' && /Titulaire \(QR code\)/.test(r.texte) && /KONE AMINATA/.test(pt(r, 'Titulaire').detail), JSON.stringify(r.points));

  r = await verifier(p, inconnue);
  ok('référence inconnue (clé de contrôle correcte) : « Document inconnu »', r.verdict === 'inconnu' && r.titre === 'Document inconnu' && /Absent de la copie du registre/.test(pt(r, 'Registre').detail), JSON.stringify(r.points));
  r = await verifier(p, B.ref.slice(0, -1) + (B.ref.slice(-1) === 'A' ? 'B' : 'A'));
  ok('clé de contrôle fausse : « Référence invalide »', r.verdict === 'invalide' && r.titre === 'Référence invalide');
  r = await verifier(p, 'Bonjour, ceci n’est pas un document');
  ok('texte quelconque : « Contenu non reconnu », sans détails trompeurs', r.titre === 'Contenu non reconnu' && !(await p.$('#vf-resultat .vf-details')));
  r = await verifier(p, 'é'.repeat(1000));
  ok('chaîne très longue : traitée sans erreur', r.titre === 'Contenu non reconnu');

  r = await verifier(p, A.ref);
  ok('A annulé APRÈS la copie : encore « en vigueur » selon la copie (attendu)', r.verdict === 'valide' && pt(r, 'Statut').etat === 'ok' && /selon le registre du/.test(pt(r, 'Statut').detail), JSON.stringify(r.points));
  ok('A : avertissement de date visible', /Registre daté/.test(r.texte) && /annulé ou remplacé après cette date apparaît encore « en vigueur »/.test(r.texte));
  r = await verifier(p, C.ref);
  ok('C annulé AVANT la copie : refusé (statut ANNULÉ)', r.verdict === 'invalide' && pt(r, 'Statut').etat === 'ko' && /ANNULÉ le/.test(pt(r, 'Statut').detail), JSON.stringify(r.points));
  r = await verifier(p, C.qr);
  ok('C : QR authentique mais annulé → refusé', r.verdict === 'invalide' && pt(r, 'Intégrité').etat === 'ok' && pt(r, 'Statut').etat === 'ko');
  r = await verifier(p, E.qr);
  ok('E émis après la copie : signature valide, absent de la copie → prudence', r.verdict === 'douteux' && pt(r, 'Intégrité').etat === 'ok' && /peut-être émis après cette date/.test(pt(r, 'Registre').detail), JSON.stringify(r.points));

  // photo du QR
  await p.setInputFiles('#vf-photo', fichier('qr-A.png'));
  await p.waitForFunction((ref) => document.querySelector('#vf-annonce').textContent.includes(ref), A.ref, { timeout: 10000 });
  r = await lireResultat(p);
  ok('photo PNG du QR (tournée) : lue et vérifiée', r.verdict === 'valide' && (await p.inputValue('#vf-texte')) === A.qr && /QR code lu/.test(await p.textContent('#vf-etat-lecture')), r.titre);
  ok('photo : le focus passe au résultat', await p.evaluate(() => document.activeElement && document.activeElement.id === 'vf-res-titre'));
  await p.setInputFiles('#vf-photo', fichier('sans-qr.png'));
  await p.waitForFunction(() => /Aucun QR code lisible/.test(document.querySelector('#vf-etat-lecture').textContent), null, { timeout: 10000 });
  ok('image sans QR : message clair', true);
  await p.setInputFiles('#vf-photo', { name: 'note.txt', mimeType: 'text/plain', buffer: fs.readFileSync(fichier('pas-une-image.png.txt')) });
  await p.waitForFunction(() => /n’est pas une image/.test(document.querySelector('#vf-etat-lecture').textContent));
  ok('fichier non image : refusé avec explication', true);

  // historique de la session
  const nbHist = await p.$$eval('#vf-historique li', (l) => l.length);
  ok('historique : limité à 12 vérifications', nbHist === 12, nbHist);
  const ancienneRef = await p.evaluate(() => document.querySelectorAll('#vf-historique .vf-hist-ref')[3].textContent);
  await p.click('#vf-historique li:nth-child(4) button');
  ok('historique : « revoir » réaffiche le résultat choisi', (await p.textContent('#vf-resultat .verif-tete span')).includes(ancienneRef) && (await p.getAttribute('#vf-historique li:nth-child(4) button', 'aria-current')) === 'true', ancienneRef);

  // copie du résultat
  await p.click('[data-action="vf-copier"]');
  await p.waitForFunction(() => document.querySelector('#vf-copie-etat').textContent.length > 0);
  const copie = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('copie du résultat dans le presse-papiers', /Résultat copié/.test(await p.textContent('#vf-copie-etat')) && copie.includes(ancienneRef) && copie.includes('copie du registre du'), copie.slice(0, 200));

  // caméra absente (navigateur de test sans périphérique) : message honnête, rien d'actif
  await p.click('[data-action="vf-camera"]');
  await p.waitForFunction(() => /caméra|Caméra/.test(document.querySelector('#vf-etat-lecture').textContent) && !document.querySelector('#vf-btn-camera').classList.contains('occupe'), null, { timeout: 10000 });
  ok('caméra indisponible : explication, caméra inactive', (await p.evaluate(() => !AK.verificateur.cameraActive() && document.querySelector('#vf-camera').hidden && document.querySelector('#vf-etat-lecture').classList.contains('erreur'))), await p.textContent('#vf-etat-lecture'));

  // effacer, thème
  await p.click('[data-action="vf-effacer"]');
  ok('« Effacer » vide la saisie et y place le focus', (await p.inputValue('#vf-texte')) === '' && (await p.evaluate(() => document.activeElement.id)) === 'vf-texte');
  const avant = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('[data-action="vf-theme"]');
  const apres = await p.evaluate(() => ({ fond: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.dataset.theme, pressed: document.querySelector('[data-action="vf-theme"]').getAttribute('aria-pressed') }));
  ok('thème sombre : bascule et état annoncé', apres.theme === 'dark' && apres.pressed === 'true' && apres.fond !== avant, JSON.stringify(apres));
  await p.click('[data-action="vf-theme"]');

  // accessibilité minimale : chaque champ a un libellé, chaque bouton un nom
  const a11y = await p.evaluate(() => ({
    champs: [...document.querySelectorAll('input')].filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label')).length,
    boutons: [...document.querySelectorAll('button')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length
  }));
  ok('accessibilité : champs et boutons nommés', a11y.champs === 0 && a11y.boutons === 0, JSON.stringify(a11y));
  ok('outil rempli : aucune requête réseau, aucune erreur JS', t.erreurs.length === 0, t.erreurs.join(' | '));
  await t.navigateur.close();

  /* =========================== 3. Largeur mobile (390 × 844) =========================== */
  const m = await ouvrir({ largeur: 390, hauteur: 844 });
  await m.page.goto('file://' + cheminOutil);
  await m.page.waitForFunction(() => document.documentElement.dataset.pret === '1');
  const deb0 = await m.page.evaluate(() => document.documentElement.scrollWidth);
  r = await verifier(m.page, Dc.qr);
  const deb = await m.page.evaluate(() => ({ l: document.documentElement.scrollWidth, larges: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 391).map((e) => e.className || e.tagName).slice(0, 5) }));
  ok('mobile 390 px : aucun débordement horizontal (accueil et résultat)', deb0 <= 390 && deb.l <= 390 && deb.larges.length === 0 && r.verdict === 'valide', JSON.stringify(deb));
  ok('mobile : aucune erreur JS', m.erreurs.length === 0, m.erreurs.join(' | '));
  await m.navigateur.close();

  /* =========================== 4. Caméra (flux simulé contenant le QR) =========================== */
  const nav = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + fichier('qr-D.y4m')] });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 860 } });
  const pc = await ctx.newPage();
  const errC = [];
  pc.on('pageerror', (e) => errC.push('PAGEERROR ' + e.message));
  pc.on('console', (x) => { if (x.type() === 'error') errC.push('CONSOLE ' + x.text()); });
  pc.on('request', (q) => { if (!/^(file|data|blob):/.test(q.url())) errC.push('RESEAU ' + q.url()); });
  await pc.goto('file://' + cheminOutil);
  await pc.waitForFunction(() => document.documentElement.dataset.pret === '1');
  await pc.evaluate(() => {
    // suivi des pistes ouvertes pour vérifier leur arrêt
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__pistes = [];
    navigator.mediaDevices.getUserMedia = async (c) => { const f = await orig(c); window.__pistes.push(...f.getTracks()); return f; };
  });
  await pc.click('[data-action="vf-camera"]');
  await pc.waitForFunction((ref) => document.querySelector('#vf-annonce').textContent.includes(ref), Dc.ref, { timeout: 20000 });
  r = await lireResultat(pc);
  const cam = await pc.evaluate(() => ({ active: AK.verificateur.cameraActive(), cache: document.querySelector('#vf-camera').hidden, pistes: window.__pistes.map((x) => x.readyState), src: document.querySelector('#vf-camera video').srcObject, bouton: document.querySelector('#vf-btn-camera').getAttribute('aria-pressed') }));
  ok('caméra : QR lu dans le flux vidéo et vérifié', r.verdict === 'valide' && /Titulaire/.test(r.texte), r.titre);
  ok('caméra : arrêt propre après lecture (pistes arrêtées, vidéo libérée)', !cam.active && cam.cache && cam.pistes.length > 0 && cam.pistes.every((s) => s === 'ended') && cam.src === null && cam.bouton === 'false', JSON.stringify(cam));
  // démarrage puis arrêt manuel
  await pc.evaluate(() => { document.querySelector('#vf-texte').value = ''; });
  await pc.evaluate(() => { window.__pistes = []; });
  await pc.click('[data-action="vf-camera"]');
  await pc.waitForFunction(() => document.querySelector('#vf-btn-camera').getAttribute('aria-pressed') === 'true' || AK.verificateur.cameraActive() === false && document.querySelector('#vf-annonce').textContent, null, { timeout: 10000 });
  await pc.click('[data-action="vf-camera"]').catch(() => {});
  await pc.waitForTimeout(300);
  const cam2 = await pc.evaluate(() => ({ active: AK.verificateur.cameraActive(), pistes: window.__pistes.map((x) => x.readyState) }));
  ok('caméra : arrêt manuel (bouton) libère la caméra', !cam2.active && cam2.pistes.every((s) => s === 'ended'), JSON.stringify(cam2));
  ok('caméra : aucune requête réseau, aucune erreur JS', errC.length === 0, errC.join(' | '));
  await nav.close();

  /* =========================== 5. Modèle vide et fichiers altérés =========================== */
  const v = await ouvrir();
  await v.page.goto('file://' + fichier('modele.html'));
  await v.page.waitForFunction(() => document.documentElement.dataset.pret === '1');
  const mod = await v.page.evaluate(() => ({ h1: document.querySelector('h1').textContent, texte: document.body.textContent, saisie: !!document.querySelector('#vf-texte'), titre: document.title }));
  ok('modèle vide : expliqué, sans formulaire de vérification', mod.h1 === 'Modèle sans données' && !mod.saisie && /Documents › Vérifier/.test(mod.texte) && /Créer l’outil/.test(mod.texte) && /modèle sans données/.test(mod.titre), mod.h1);
  await v.page.click('[data-action="vf-theme"]');
  ok('modèle vide : bouton de thème actif', (await v.page.evaluate(() => document.documentElement.dataset.theme)) !== undefined);

  await v.page.goto('file://' + fichier('illisible.html'));
  await v.page.waitForFunction(() => document.documentElement.dataset.pret === '1');
  ok('données illisibles : fichier déclaré inutilisable', (await v.page.textContent('h1')) === 'Fichier inutilisable' && !(await v.page.$('#vf-texte')));

  await v.page.goto('file://' + fichier('cle-alteree.html'));
  await v.page.waitForFunction(() => document.documentElement.dataset.pret === '1');
  ok('clé altérée : alerte « Fichier altéré »', /Fichier altéré/.test(await v.page.textContent('#vf-alertes')) && /Empreinte incohérente/.test(await v.page.textContent('.vf-infos')));
  r = await verifier(v.page, B.qr);
  ok('clé altérée : la signature n’est jamais déclarée valide', r.verdict !== 'valide' && pt(r, 'Intégrité').etat !== 'ok', JSON.stringify(r.points));

  await v.page.goto('file://' + fichier('copie-ancienne.html'));
  await v.page.waitForFunction(() => document.documentElement.dataset.pret === '1');
  ok('copie ancienne : signalée dès l’ouverture', /Copie du registre ancienne/.test(await v.page.textContent('#vf-alertes')));
  r = await verifier(v.page, B.ref);
  ok('copie ancienne : avertissement de date renforcé dans le résultat', /il y a \d+ jours/.test(r.texte) && /15\/01\/2020/.test(pt(r, 'Statut').detail), pt(r, 'Statut').detail);
  ok('modèle et fichiers altérés : aucune requête réseau, aucune erreur JS', v.erreurs.length === 0, v.erreurs.join(' | '));
  await v.navigateur.close();

  for (const x of res) console.log(`${x.ok ? 'OK   ' : 'ÉCHEC'} ${x.nom}${x.ok ? '' : ' → ' + x.detail}`);
  console.log(`${res.filter((x) => x.ok).length}/${res.length} vérifications réussies (fichiers de test : ${DOSSIER})`);
  if (!process.env.AKWA_TMP) fs.rmSync(DOSSIER, { recursive: true, force: true });
  process.exit(res.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  console.error('ARRÊT', e);
  for (const x of res) console.log(`${x.ok ? 'OK   ' : 'ÉCHEC'} ${x.nom} ${x.ok ? '' : x.detail}`);
  process.exit(2);
});
