/* Chaîne documentaire complète, école réelle (non démo) :
   clé de signature → inscription d'un élève → certificat (aperçu brouillon : rien au registre)
   → impression (émission, signature) → registre → vérification par référence et par QR
   → falsification du QR détectée → annulation → vérification « annulé » → copie → duplicata de carte. */
const { ouvrir, creerEcole, aller, confirmerMdp } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const onglet = (page, lib) => page.click(`dialog[open] [role=tab]:has-text("${lib}")`);
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.addInitScript(() => { window.print = () => { window.__impressions = (window.__impressions || 0) + 1; }; });
  const { mdp } = await creerEcole(page);
  await page.evaluate((m) => AK.cles.creer(m), mdp);
  ok('clé de signature créée', await page.evaluate(() => !!AK.cles.active() && AK.cles.disponible()));

  // inscription par le formulaire
  await aller(page, 'eleves/liste');
  await page.click('[data-action="eleve-nouveau"]');
  await page.fill('dialog[open] [name=nom]', 'kouassi');
  await page.fill('dialog[open] [name=prenoms]', 'aya marie');
  ok('nom en majuscules à la frappe', (await page.inputValue('dialog[open] [name=nom]')) === 'KOUASSI');
  ok('prénoms capitalisés', (await page.inputValue('dialog[open] [name=prenoms]')) === 'Aya Marie');
  await page.check('dialog[open] [name=sexe][value="Féminin"]');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] .erreur-champ');
  ok('erreur ciblée sur la classe (onglet ouvert automatiquement) sans perte de saisie', (await page.inputValue('dialog[open] [name=nom]')) === 'KOUASSI' && (await page.isVisible('dialog[open] [name=classe]')), await page.textContent('dialog[open] .erreur-champ'));
  await onglet(page, 'Naissance');
  await page.fill('dialog[open] [name=age]', '8');
  await onglet(page, 'Parents');
  await page.fill('dialog[open] [name=pere_nom]', 'KOUASSI');
  await page.fill('dialog[open] [name=pere_prenoms]', 'Jean');
  await onglet(page, 'Scolarité');
  await page.selectOption('dialog[open] [name=classe]', 'CE2');
  await page.fill('dialog[open] [name=entree]', '2025-09-15');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(300);
  const nbEleves = await page.evaluate(() => AK.store.etat.students.length);
  ok('élève inscrit', nbEleves === 1, 'élèves : ' + nbEleves + ' ' + (await page.evaluate(() => (document.querySelector('dialog[open] .erreur-champ, dialog[open] .erreur-form') || {}).textContent || '')));
  // doublon
  await page.click('[data-action="eleve-nouveau"]');
  await page.fill('dialog[open] [name=nom]', 'KOUASSI');
  await page.fill('dialog[open] [name=prenoms]', 'Aya Marie');
  await page.check('dialog[open] [name=sexe][value="Féminin"]');
  await onglet(page, 'Naissance');
  await page.fill('dialog[open] [name=age]', '8');
  await onglet(page, 'Parents');
  await page.fill('dialog[open] [name=mere_nom]', 'BAMBA');
  await page.fill('dialog[open] [name=mere_prenoms]', 'Awa');
  await onglet(page, 'Scolarité');
  await page.selectOption('dialog[open] [name=classe]', 'CE2');
  await page.fill('dialog[open] [name=entree]', '2025-09-15');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(250);
  ok('doublon signalé avant inscription', await page.evaluate(() => [...document.querySelectorAll('dialog[open] h2')].some((h) => /déjà inscrit/.test(h.textContent))));
  await page.click('dialog[open]:last-of-type [data-fermer]');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await page.$('dialog[open]')) { await page.click('dialog[open] .btn-dng-plein').catch(() => {}); }
  ok('doublon non inscrit', (await page.evaluate(() => AK.store.etat.students.length)) === 1);

  // certificat : aperçu = brouillon
  const sid = await page.evaluate(() => AK.store.etat.students[0].id);
  await page.evaluate((id) => AK.docs.ouvrir('certificat-scolarite', [{ eleve: AK.eleves.trouver(id) }]), sid);
  await page.waitForSelector('dialog[open] .feuille');
  ok('aperçu sans inscription au registre', (await page.evaluate(() => AK.store.etat.docs.items.length)) === 0);
  ok('aperçu : QR réservé', await page.evaluate(() => /attribués/.test(document.querySelector('dialog[open] .doc-verif').textContent)));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(800);
  const doc = await page.evaluate(() => AK.store.etat.docs.items[0]);
  ok('émission à l’impression', !!doc && /^AK-CSC-\d{4}-000001-[0-9A-Z]$/.test(doc.ref), doc && doc.ref);
  ok('document signé', doc && doc.signe && /;S=/.test(doc.qr));
  ok('impression déclenchée', (await page.evaluate(() => window.__impressions)) === 1);
  ok('aperçu remplacé par la version définitive', await page.evaluate((r) => document.querySelector('dialog[open] .doc-verif .ref') && document.querySelector('dialog[open] .doc-verif .ref').textContent === r, doc.ref));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(400);
  ok('réimpression dans le même aperçu : pas de 2e référence', (await page.evaluate(() => AK.store.etat.docs.items.length)) === 1);
  await page.keyboard.press('Escape');

  // vérification
  const v1 = await page.evaluate((r) => AK.verif.verifier(r, AK.docsUi.sourceLocale()), doc.ref);
  ok('vérification par référence : valide', v1.verdict === 'valide', JSON.stringify(v1.points.map((p) => p.etat + ':' + p.titre)));
  const v2 = await page.evaluate((q) => AK.verif.verifier(q, AK.docsUi.sourceLocale()), doc.qr);
  ok('vérification du QR signé : valide', v2.verdict === 'valide', JSON.stringify(v2.points.map((p) => p.etat + ':' + p.detail)));
  const falsifie = doc.qr.replace(/E=\d{4}-\d{2}-\d{2}/, 'E=2020-01-01');
  const v3 = await page.evaluate((q) => AK.verif.verifier(q, AK.docsUi.sourceLocale()), falsifie);
  ok('QR falsifié : invalide', v3.verdict === 'invalide' && v3.points.some((p) => p.cle === 'integrite' && p.etat === 'ko'));
  const mauvaiseCle = doc.ref.slice(0, -1) + (doc.ref.slice(-1) === 'A' ? 'B' : 'A');
  const v4 = await page.evaluate((q) => AK.verif.verifier(q, AK.docsUi.sourceLocale()), mauvaiseCle);
  ok('référence à clé de contrôle fausse : invalide', v4.verdict === 'invalide');
  // via l'écran (saisie)
  await aller(page, 'documents/verifier');
  await page.fill('#verif-texte', doc.ref);
  await page.click('#contenu form [type=submit]');
  await page.waitForSelector('#verif-resultat .verif-res');
  ok('écran de vérification : verdict affiché', await page.evaluate(() => document.querySelector('#verif-resultat .verif-res').classList.contains('valide')));

  // lecture d'une photo du QR (fichier image)
  const png = await page.evaluate(async (q) => {
    const svg = String(AK.qr.svg(q));
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas'); c.width = c.height = 700;
    const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0, 0, 700, 700); g.translate(350, 350); g.rotate(0.3); g.drawImage(img, -260, -260, 520, 520);
    return c.toDataURL('image/png').split(',')[1];
  }, doc.qr);
  const fs = require('fs'), path = require('path'), tmp = path.join(require('os').tmpdir(), 'akwa-qr-test.png');
  fs.writeFileSync(tmp, Buffer.from(png, 'base64'));
  await page.setInputFiles('[data-change="verif-photo"]', tmp);
  await page.waitForTimeout(1500);
  ok('photo du QR lue et vérifiée', await page.evaluate(() => !!document.querySelector('#verif-resultat .verif-res.valide')));

  // annulation
  await aller(page, 'documents/registre');
  await page.click(`[data-action="doc-actions"][data-ref="${doc.ref}"]`);
  await page.click('.menu button:has-text("Annuler le document")');
  await page.fill('dialog[open] [name=motif]', 'Erreur de saisie');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(300);
  if (await page.$('dialog[open] #mdp-admin')) await confirmerMdp(page, mdp);
  await page.waitForTimeout(300);
  ok('document annulé', (await page.evaluate(() => AK.store.etat.docs.items[0].statut)) === 'annule');
  const v5 = await page.evaluate((q) => AK.verif.verifier(q, AK.docsUi.sourceLocale()), doc.qr);
  ok('vérification après annulation : invalide (statut annulé)', v5.verdict === 'invalide' && v5.points.some((p) => p.cle === 'statut' && p.etat === 'ko'));

  // carte + duplicata
  await page.evaluate((id) => AK.docsUi.cartes('carte-eleve', [id]), sid);
  await page.waitForSelector('dialog[open] [name=mode]');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] .planche, dialog[open] .carte-seule', { timeout: 5000 });
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(700);
  const carte = await page.evaluate(() => AK.store.etat.docs.items.find((d) => d.type === 'CEL'));
  ok('carte émise avec QR identité', carte && /;N=KOUASSI AYA MARIE;/.test(carte.qr) && !/tel|TEL=/.test(carte.qr), carte && carte.qr);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const diag = await page.evaluate(() => ({ dialogs: document.querySelectorAll('dialog[open]').length, route: AK.shell.routeCourante() }));
  if (diag.dialogs) console.log('diagnostic : fenêtres encore ouvertes', JSON.stringify(diag));
  // duplicata via l'action du registre
  await aller(page, 'documents/registre');
  await page.waitForTimeout(200);
  await page.click(`[data-action="doc-actions"][data-ref="${carte.ref}"]`);
  await page.click('.menu button:has-text("Duplicata")');
  await page.waitForSelector('dialog[open] [name=mode]');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] [data-imprimer]');
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(800);
  const apres = await page.evaluate((r) => ({ orig: AK.store.etat.docs.items.find((d) => d.ref === r), dup: AK.store.etat.docs.items.find((d) => d.duplicataDe === r) }), carte.ref);
  ok('duplicata émis, original remplacé', apres.dup && apres.orig.statut === 'remplace' && apres.orig.remplacePar === apres.dup.ref);
  const v6 = await page.evaluate((q) => AK.verif.verifier(q, AK.docsUi.sourceLocale()), carte.qr);
  ok('ancienne carte refusée à la vérification', v6.verdict === 'invalide');

  ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  await navigateur.close();
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
