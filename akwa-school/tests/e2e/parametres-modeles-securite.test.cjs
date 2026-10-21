/* Paramètres › Modèles de documents et Sécurité & signature (démonstration, directeur) :
   liste (recherche, catégories), éditeur (aperçu en direct, champs dynamiques, erreurs sous le
   champ sans perte de saisie, signatures, filigrane, carte, papier/orientation, brouillon
   conservé, annulation, révisions, spécimen imprimé sans émission, rétablissement + annulation),
   sécurité (verrouillage, clés : création, rotation, compromission, export JSON, mot de passe,
   code de secours, verrouillage immédiat), droits d'un enseignant, version bureau, école vide,
   largeur 390 px, aucune erreur JavaScript. */
const { ouvrir, demo, aller, confirmerMdp, creerEcole, URL, chromium, fs } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const onglet = (page, lib) => page.click(`#pm-form [role=tab]:text-is("${lib}")`);
const erreurChamp = (page) => page.evaluate(() => {
  const e = document.querySelector('#pm-form .erreur-champ');
  if (!e) return null;
  const c = e.closest('.champ'), i = c && c.querySelector('[name]');
  return { texte: e.textContent, champ: i ? i.name : '' };
});
const apercuPret = (page) => page.waitForFunction(() => {
  const z = document.querySelector('#pm-apercu');
  return z && z.getAttribute('aria-busy') === 'false' && (z.querySelector('.feuille') || z.querySelector('.encadre') || z.querySelector('.vide'));
}, null, { timeout: 15000 });
const enregistrer = async (page) => {
  await page.click('button[form="pm-form"]');
  await page.waitForTimeout(250);
};
const MODELE = 'certificat-scolarite';

(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.addInitScript(() => { window.print = () => { window.__impressions = (window.__impressions || 0) + 1; }; });
  await demo(page);

  /* ================= Liste des modèles ================= */
  await aller(page, 'parametres/modeles');
  await page.waitForSelector('#tr-pm-modeles tbody tr');
  const nbModeles = await page.evaluate(() => AK.modeles.liste().length);
  ok('liste : tous les modèles affichés', (await page.$$eval('#tr-pm-modeles tbody tr', (L) => L.length)) === nbModeles, nbModeles);
  await page.fill('input[data-tab="pm-modeles"]', 'certif');
  await page.waitForTimeout(300);
  const certifs = await page.$$eval('#tr-pm-modeles tbody tr', (L) => L.map((tr) => tr.textContent));
  ok('liste : recherche', certifs.length >= 2 && certifs.every((t) => /certif/i.test(t)), certifs.length);
  await page.fill('input[data-tab="pm-modeles"]', '');
  await page.click('.pilule[data-action="pm-cat"][data-v="carte"]');
  await page.waitForTimeout(250);
  ok('liste : filtre par catégorie (cartes)', (await page.$$eval('#tr-pm-modeles tbody tr', (L) => L.length)) === 2 && (await page.evaluate(() => AK.shell.params().cat)) === 'carte');
  await page.click('.pilule[data-action="pm-cat"][data-v=""]');
  await page.waitForTimeout(200);
  await page.click(`#tr-pm-modeles a.btn[href="#parametres/modeles?modele=${MODELE}"]`);
  await page.waitForSelector('#pm-form');
  await apercuPret(page);

  /* ================= Éditeur : aperçu en direct ================= */
  const ap0 = await page.evaluate(() => ({ feuilles: document.querySelectorAll('#pm-apercu .feuille').length, specimen: !!document.querySelector('#pm-apercu .filigrane.statut'), titre: (document.querySelector('#pm-apercu .doc-titre h1') || {}).textContent }));
  ok('éditeur : aperçu réduit avec filigrane SPÉCIMEN', ap0.feuilles === 1 && ap0.specimen && /CERTIFICAT/.test(ap0.titre), JSON.stringify(ap0));
  const avantDocs = await page.evaluate(() => AK.store.etat.docs.items.length);
  await page.fill('#pm-titre', 'CERTIFICAT DE SCOLARITÉ – ÉDITION SPÉCIALE');
  await page.waitForFunction(() => /ÉDITION SPÉCIALE/.test((document.querySelector('#pm-apercu .doc-titre h1') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  ok('éditeur : l’aperçu suit la saisie (accents)', /ÉDITION SPÉCIALE/.test(await page.textContent('#pm-apercu .doc-titre h1')));
  ok('éditeur : bouton « Annuler les modifications » apparu', !!(await page.$('[data-action="pm-annuler"]')));
  ok('éditeur : focus conservé dans le titre après le redessin', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'pm-titre');
  // champ dynamique inséré au curseur
  await page.click('#pm-texte');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nMatricule rappelé : ');
  await page.click('[data-action="pm-jeton"][data-k="eleve.matricule"]');
  const texte1 = await page.inputValue('#pm-texte');
  ok('jeton inséré au curseur', /Matricule rappelé : \{eleve\.matricule\}$/.test(texte1), texte1.slice(-60));
  const matricule = await page.evaluate(() => AK.calc.matOf(AK.calc.actifs().slice().sort(AK.calc.parClasse)[0]));
  await page.waitForFunction((m) => document.querySelector('#pm-apercu .doc-texte') && document.querySelector('#pm-apercu .doc-texte').textContent.includes('Matricule rappelé : ' + m), matricule, { timeout: 5000 }).catch(() => {});
  ok('jeton remplacé dans l’aperçu par la donnée de l’élève d’exemple', (await page.textContent('#pm-apercu .doc-texte')).includes('Matricule rappelé : ' + matricule), matricule);

  /* ---------- Erreurs sous le champ, sans perte de saisie ---------- */
  await page.fill('#pm-texte', texte1 + '\n\n<b>gras</b>');
  await enregistrer(page);
  let e = await erreurChamp(page);
  ok('HTML refusé : erreur sous le texte', e && e.champ === 'texte' && /HTML/.test(e.texte), JSON.stringify(e));
  ok('saisie conservée après l’erreur', (await page.inputValue('#pm-titre')) === 'CERTIFICAT DE SCOLARITÉ – ÉDITION SPÉCIALE');
  ok('rien d’enregistré tant qu’il y a une erreur', !(await page.evaluate((id) => AK.store.etat.modeles[id], MODELE)));
  await page.fill('#pm-texte', texte1 + '\n\nNé à {eleve.inconnu}');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('champ dynamique inconnu refusé sous le texte', e && e.champ === 'texte' && /inconnu/.test(e.texte), JSON.stringify(e));
  await page.waitForFunction(() => /Aperçu en attente/.test(document.querySelector('#pm-apercu').textContent), null, { timeout: 5000 }).catch(() => {});
  ok('aperçu en attente avec le message', /Aperçu en attente/.test(await page.textContent('#pm-apercu')));
  await page.fill('#pm-texte', texte1);
  await page.fill('#pm-titre', 'Titre {eleve.nom}');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('champ dynamique refusé dans le titre (non remplacé)', e && e.champ === 'titre', JSON.stringify(e));
  await page.fill('#pm-titre', '   ');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('titre vide refusé', e && e.champ === 'titre' && /titre/i.test(e.texte), JSON.stringify(e));
  await page.fill('#pm-titre', 'CERTIFICAT DE SCOLARITÉ – ÉDITION SPÉCIALE');
  // marges hors bornes : l'erreur ouvre l'onglet « Page »
  await onglet(page, 'Page');
  await page.fill('#pm-page-marges-h', '50');
  await onglet(page, 'Contenu');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('marge hors bornes : erreur sous le champ, onglet ouvert', e && e.champ === 'page.marges.h' && /5 à 35/.test(e.texte) && (await page.isVisible('#pm-page-marges-h')), JSON.stringify(e));
  await page.fill('#pm-page-marges-h', '');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('marge vide refusée', e && e.champ === 'page.marges.h', JSON.stringify(e));
  await page.fill('#pm-page-marges-h', '18');
  await page.uncheck('#pm-entete-officiel');
  await page.waitForTimeout(250);
  ok('en-tête simplifié : logos et armoiries masqués', !(await page.$('#pm-entete-armoiries')));
  await page.check('#pm-entete-officiel');
  await page.waitForTimeout(250);
  await page.fill('#pm-pied-texte', 'Rue des Écoles, BP 12 – Ouaninou');

  /* ---------- Signatures ---------- */
  await onglet(page, 'Signatures');
  const nbSig0 = await page.$$eval('#pm-form .pm-sig', (L) => L.length);
  await page.click('[data-action="pm-sig-ajouter"]');
  await page.waitForTimeout(250);
  ok('signature ajoutée (focus sur le rôle)', (await page.$$eval('#pm-form .pm-sig', (L) => L.length)) === nbSig0 + 1 && (await page.evaluate(() => document.activeElement && document.activeElement.name)) === `sig.${nbSig0}.role`);
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('signature sans rôle refusée', e && e.champ === `sig.${nbSig0}.role`, JSON.stringify(e));
  await page.fill(`#pm-sig-${nbSig0}-role`, 'Le Secrétaire général');
  await page.fill(`#pm-sig-${nbSig0}-nom`, '{secretaire}');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('nom de signataire : champ dynamique inconnu refusé', e && e.champ === `sig.${nbSig0}.nom`, JSON.stringify(e));
  await page.fill(`#pm-sig-${nbSig0}-nom`, 'KOUADIO Éric');
  await page.check(`#pm-sig-${nbSig0}-cadre`);
  await page.click(`[data-action="pm-sig-monter"][data-i="${nbSig0}"]`);
  await page.waitForTimeout(250);
  ok('signature remontée', (await page.inputValue('#pm-sig-0-role')) === 'Le Secrétaire général');
  for (let i = nbSig0 + 1; i < 4; i++) {
    await page.click('[data-action="pm-sig-ajouter"]');
    await page.waitForTimeout(150);
    await page.fill(`#pm-sig-${i}-role`, 'Rôle ' + i);
  }
  ok('quatre signatures au plus : bouton d’ajout remplacé par un message', !(await page.$('[data-action="pm-sig-ajouter"]')) && (await page.$$eval('#pm-form .pm-sig', (L) => L.length)) === 4);
  await page.click('[data-action="pm-sig-retirer"][data-i="3"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="pm-sig-retirer"][data-i="2"]');
  await page.waitForTimeout(250);
  ok('signatures retirées du brouillon', (await page.$$eval('#pm-form .pm-sig', (L) => L.length)) === 2);
  await page.waitForFunction(() => document.querySelectorAll('#pm-apercu .doc-sig').length === 2, null, { timeout: 5000 }).catch(() => {});
  ok('aperçu : deux zones de signature vides, cadre dessiné', await page.evaluate(() => document.querySelectorAll('#pm-apercu .doc-sig').length === 2 && !!document.querySelector('#pm-apercu .doc-sig .espace.cadre')));

  /* ---------- Filigrane et QR ---------- */
  await onglet(page, 'Filigrane & QR');
  await page.focus('#pm-filigrane-type');
  await page.selectOption('#pm-filigrane-type', 'texte');
  await page.waitForSelector('#pm-filigrane-texte');
  ok('focus conservé sur le type de filigrane après le redessin', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'pm-filigrane-type');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('filigrane texte vide refusé', e && e.champ === 'filigrane.texte', JSON.stringify(e));
  await page.fill('#pm-filigrane-texte', 'CONFIDENTIEL ÉCOLE');
  await page.fill('#pm-filigrane-opacite', '99');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('opacité hors bornes refusée', e && e.champ === 'filigrane.opacite' && /2 à 30/.test(e.texte), JSON.stringify(e));
  await page.fill('#pm-filigrane-opacite', '9');
  await page.fill('#pm-filigrane-rotation', '-45');
  await page.selectOption('#pm-filigrane-position', 'haut');
  await page.check('#pm-filigrane-repetition');
  await page.uncheck('#pm-filigrane-ecran');
  await page.check('#pm-qr-identite');
  await page.fill('#pm-qr-taille', '30');

  /* ---------- Enregistrement : révision 1 ---------- */
  await enregistrer(page);
  const enr1 = await page.evaluate((id) => AK.store.etat.modeles[id], MODELE);
  ok('enregistrement : révision 1', enr1 && enr1.rev === 1 && enr1.reglages.titre === 'CERTIFICAT DE SCOLARITÉ – ÉDITION SPÉCIALE', JSON.stringify(enr1 && { rev: enr1.rev, titre: enr1.reglages.titre }));
  const r1 = await page.evaluate((id) => AK.modeles.reglages(id), MODELE);
  ok('réglages enregistrés (marge, pied, signatures, filigrane, QR)', r1.page.marges.h === 18 && r1.pied.texte === 'Rue des Écoles, BP 12 – Ouaninou' && r1.signatures.length === 2 && r1.signatures[0].role === 'Le Secrétaire général' && r1.signatures[0].cadre === true
    && r1.filigrane.type === 'texte' && r1.filigrane.texte === 'CONFIDENTIEL ÉCOLE' && r1.filigrane.opacite === 9 && r1.filigrane.rotation === -45 && r1.filigrane.position === 'haut' && r1.filigrane.repetition === true && r1.filigrane.ecran === false && r1.qr.identite === true && r1.qr.taille === 30 && /\{eleve\.matricule\}/.test(r1.texte), JSON.stringify(r1).slice(0, 400));
  ok('après enregistrement : plus de brouillon', !(await page.$('[data-action="pm-annuler"]')) && /Aucune modification/.test(await page.textContent('#pm-etat')));
  ok('journal : modèle enregistré', await page.evaluate(() => AK.store.etat.pro.journal.some((j) => /Modèle « Certificat de scolarité » enregistré/.test(j.m) && j.c === 'modeles')));
  ok('aucun document émis par l’aperçu', (await page.evaluate(() => AK.store.etat.docs.items.length)) === avantDocs);
  await enregistrer(page);
  ok('enregistrer sans changement : pas de nouvelle révision', (await page.evaluate((id) => AK.store.etat.modeles[id].rev, MODELE)) === 1);
  // le document réel utilise le modèle personnalisé
  const g = await page.evaluate(async (id) => { const s = AK.calc.actifs()[0]; const r = await AK.docs.generer(id, [{ eleve: s }], { apercu: true }); return String(r.feuilles[0]); }, MODELE);
  ok('les documents utilisent la révision enregistrée', /ÉDITION SPÉCIALE/.test(g) && /Le Secrétaire général/.test(g) && /Rue des Écoles/.test(g));

  /* ---------- Chaîne longue ---------- */
  const long = 'TITRE TRÈS LONG '.repeat(12);
  ok('onglet actif conservé après l’enregistrement', (await page.isVisible('#pm-filigrane-type')) && !(await page.isVisible('#pm-titre')));
  await onglet(page, 'Contenu');
  await page.fill('#pm-titre', long);
  await enregistrer(page);
  const t2 = await page.evaluate((id) => AK.modeles.reglages(id).titre, MODELE);
  ok('chaîne longue : titre borné à 90 caractères (révision 2)', t2.length <= 90 && (await page.evaluate((id) => AK.store.etat.modeles[id].rev, MODELE)) === 2, t2.length);

  /* ---------- Brouillon conservé hors de l'écran, puis annulé ---------- */
  await page.fill('#pm-titre', 'BROUILLON EN COURS');
  await aller(page, 'parametres/securite');
  await aller(page, 'parametres/modeles');
  await page.waitForSelector('#tr-pm-modeles tbody tr');
  ok('liste : brouillon non enregistré signalé', /Brouillon non enregistré/.test(await page.textContent('#contenu')));
  ok('liste : modèle personnalisé (révision 2)', await page.evaluate((id) => { const a = [...document.querySelectorAll('#tr-pm-modeles tbody tr')].find((tr) => tr.querySelector(`a[href$="${id}"]`)); return !!a && /Personnalisé/.test(a.textContent) && /révision 2/.test(a.textContent); }, MODELE));
  await aller(page, 'parametres/modeles?modele=' + MODELE);
  await page.waitForSelector('#pm-form');
  ok('brouillon retrouvé intact', (await page.inputValue('#pm-titre')) === 'BROUILLON EN COURS');
  await page.click('[data-action="pm-annuler"]');
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await page.click('dialog[open] .btn-dng-plein');
  await page.waitForTimeout(300);
  ok('annuler les modifications : réglages enregistrés rétablis', (await page.inputValue('#pm-titre')) === t2);

  /* ---------- Spécimen imprimé (aucune émission) ---------- */
  await page.click('[data-action="pm-specimen"]');
  await page.waitForSelector('dialog[open] .feuille');
  ok('spécimen : aperçu avant impression avec SPÉCIMEN', await page.evaluate(() => !!document.querySelector('dialog[open] .feuille .filigrane.statut')));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(600);
  ok('spécimen imprimé', (await page.evaluate(() => window.__impressions)) === 1);
  ok('spécimen : rien inscrit au registre', (await page.evaluate(() => AK.store.etat.docs.items.length)) === avantDocs);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---------- Rétablir le modèle d'origine, puis annuler ---------- */
  await page.click('[data-action="pm-retablir"]');
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await page.click('dialog[open] .btn-dng-plein');
  await page.waitForTimeout(300);
  ok('modèle d’origine rétabli', !(await page.evaluate((id) => AK.modeles.estPersonnalise(id), MODELE)) && (await page.inputValue('#pm-titre')) === 'CERTIFICAT DE SCOLARITÉ');
  await page.click('.toast .act');
  await page.waitForTimeout(300);
  ok('rétablissement annulé : personnalisation revenue (révision 1, nouvelle)', await page.evaluate((a) => AK.modeles.estPersonnalise(a.id) && AK.modeles.reglages(a.id).titre === a.t && AK.store.etat.modeles[a.id].rev === 1, { id: MODELE, t: t2 }));

  /* ---------- Carte : format personnalisé, validité, couleurs ---------- */
  await aller(page, 'parametres/modeles?modele=carte-eleve');
  await page.waitForSelector('#pm-form');
  await apercuPret(page);
  ok('carte : recto et verso en aperçu', (await page.$$eval('#pm-apercu .carte-seule', (L) => L.length)) === 2);
  ok('carte : pas d’onglet Signatures ni Page', !(await page.$('#pm-form [role=tab]:text-is("Signatures")')) && !(await page.$('#pm-form [role=tab]:text-is("Page")')));
  await onglet(page, 'Carte');
  await page.selectOption('#pm-carte-format', 'perso');
  await page.waitForSelector('#pm-carte-l');
  await page.fill('#pm-carte-l', '30');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('carte : largeur hors bornes refusée', e && e.champ === 'carte.l', JSON.stringify(e));
  await page.fill('#pm-carte-l', '90');
  await page.fill('#pm-carte-h', '60');
  await page.check('#pm-carte-expiration-date');
  await page.waitForSelector('#pm-carte-dateExpiration');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('carte : date de validité obligatoire', e && e.champ === 'carte.dateExpiration', JSON.stringify(e));
  await page.fill('#pm-carte-dateExpiration', '2020-01-01');
  await enregistrer(page);
  e = await erreurChamp(page);
  ok('carte : date passée refusée', e && e.champ === 'carte.dateExpiration' && /passée/.test(e.texte), JSON.stringify(e));
  await page.fill('#pm-carte-dateExpiration', '2031-07-31');
  await page.evaluate(() => { const i = document.querySelector('#pm-carte-bande'); i.value = '#0a7a3f'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.uncheck('#pm-carte-verso');
  await page.waitForFunction(() => document.querySelectorAll('#pm-apercu .carte-seule').length === 1, null, { timeout: 5000 }).catch(() => {});
  ok('carte : sans verso, une seule face en aperçu', (await page.$$eval('#pm-apercu .carte-seule', (L) => L.length)) === 1);
  ok('carte : dimensions personnalisées dans l’aperçu', await page.evaluate(() => { const f = document.querySelector('#pm-apercu .carte-seule'); return f && f.dataset.l === '90' && f.dataset.h === '60'; }));
  await enregistrer(page);
  const rc = await page.evaluate(() => AK.modeles.reglages('carte-eleve').carte);
  ok('carte : réglages enregistrés', rc.format === 'perso' && rc.l === 90 && rc.h === 60 && rc.expiration === 'date' && rc.dateExpiration === '2031-07-31' && rc.bande === '#0a7a3f' && rc.verso === false, JSON.stringify(rc));

  /* ---------- Papier A5/A4 (reçu), orientation (registre) ---------- */
  await aller(page, 'parametres/modeles?modele=recu');
  await page.waitForSelector('#pm-form');
  await apercuPret(page);
  ok('reçu : aperçu A5', await page.evaluate(() => !!document.querySelector('#pm-apercu .feuille.a5')));
  await onglet(page, 'Page');
  await page.selectOption('#pm-page-papier', 'A4');
  await page.waitForFunction(() => document.querySelector('#pm-apercu .feuille') && !document.querySelector('#pm-apercu .feuille.a5'), null, { timeout: 5000 }).catch(() => {});
  ok('reçu : passage en A4 visible dans l’aperçu', await page.evaluate(() => !!document.querySelector('#pm-apercu .feuille') && !document.querySelector('#pm-apercu .feuille.a5')));
  ok('reçu : orientation imposée (pas de choix inactif)', !(await page.$('[name="page.orientation"]')));
  await page.click('[data-action="pm-annuler"]');
  await page.click('dialog[open] .btn-dng-plein');
  await page.waitForTimeout(200);
  await aller(page, 'parametres/modeles?modele=registre-eleves');
  await page.waitForSelector('#pm-form');
  await apercuPret(page);
  await onglet(page, 'Page');
  ok('registre : paysage par défaut', await page.evaluate(() => !!document.querySelector('#pm-apercu .feuille.paysage')));
  await page.check('#pm-page-orientation-portrait');
  await page.waitForFunction(() => document.querySelector('#pm-apercu .feuille') && !document.querySelector('#pm-apercu .feuille.paysage'), null, { timeout: 8000 }).catch(() => {});
  ok('registre : orientation portrait dans l’aperçu', await page.evaluate(() => !!document.querySelector('#pm-apercu .feuille') && !document.querySelector('#pm-apercu .feuille.paysage')));
  await page.click('[data-action="pm-annuler"]');
  await page.click('dialog[open] .btn-dng-plein');
  await page.waitForTimeout(200);
  // réglages réellement utilisés par chaque modèle
  await aller(page, 'parametres/modeles?modele=demande-absence-personnel');
  await page.waitForSelector('#pm-form');
  ok('demande d’absence (personnel) : pas de signatures ni de titre proposés (non utilisés)', !(await page.$('#pm-form [role=tab]:text-is("Signatures")')) && !(await page.$('#pm-titre')) && !!(await page.$('#pm-texte')));
  await aller(page, 'parametres/modeles?modele=bulletin');
  await page.waitForSelector('#pm-form');
  ok('bulletin : pas de texte rédigé proposé, éléments optionnels présents', !(await page.$('#pm-texte')) && !!(await page.$('#pm-champs-moyClasse')));
  await aller(page, 'parametres/modeles?modele=inexistant');
  ok('modèle inconnu : message et liste', /Modèle introuvable/.test(await page.textContent('#contenu')) && !!(await page.$('#tr-pm-modeles')));
  // validation métier toujours appliquée, même appelée directement
  const direct = await page.evaluate(() => { try { AK.modeles.enregistrer('attestation-service', { texte: '<script>alert(1)</script>' }); return 'accepté'; } catch (x) { return x.message; } });
  ok('AK.modeles.enregistrer refuse le HTML (appel direct)', /HTML/.test(direct), direct);

  /* ================= Sécurité & signature ================= */
  await aller(page, 'parametres/securite');
  await page.waitForSelector('#ps-verrou');
  ok('sécurité : aucune clé au départ', /Aucune clé/.test(await page.textContent('#contenu .ps-kpis')) && !!(await page.$('[data-action="ps-cle-creer"]')));
  // verrouillage automatique
  await page.fill('#ps-verrou-min', '-5');
  await page.click('#ps-verrou [type=submit]');
  await page.waitForTimeout(150);
  ok('verrouillage : valeur négative refusée sous le champ', /nombre entier/.test((await page.textContent('#ps-verrou .erreur-champ').catch(() => '')) || ''));
  await page.fill('#ps-verrou-min', '500');
  await page.click('#ps-verrou [type=submit]');
  await page.waitForTimeout(150);
  ok('verrouillage : valeur trop grande refusée', /240 minutes/.test((await page.textContent('#ps-verrou .erreur-champ').catch(() => '')) || ''));
  ok('verrouillage : décimale refusée (appel direct)', /entier/.test(await page.evaluate(() => { try { AK.reglagesSecurite.verrouillage('2.5'); return ''; } catch (x) { return x.message; } })));
  await page.fill('#ps-verrou-min', '0');
  await page.click('#ps-verrou [type=submit]');
  await page.waitForTimeout(250);
  ok('verrouillage désactivé (0) avec avertissement', (await page.evaluate(() => AK.store.etat.securite.verrouMin)) === 0 && /désactivé/.test(await page.textContent('#ps-verrou')));
  await page.fill('#ps-verrou-min', '20');
  await page.click('#ps-verrou [type=submit]');
  await page.waitForTimeout(250);
  ok('verrouillage : 20 min enregistré et journalisé', (await page.evaluate(() => AK.store.etat.securite.verrouMin)) === 20 && (await page.evaluate(() => AK.store.etat.pro.journal.some((j) => /après 20 min/.test(j.m)))));

  // création de la première clé
  await page.click('[data-action="ps-cle-creer"]');
  await page.waitForSelector('dialog[open] #ps-mdp');
  await page.fill('dialog[open] #ps-mdp', 'Mauvais99');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] .erreur-champ');
  ok('clé : mot de passe incorrect refusé sous le champ', /incorrect/.test(await page.textContent('dialog[open] .erreur-champ')));
  await page.fill('dialog[open] #ps-mdp', 'Demo2026');
  await page.click('dialog[open] [type=submit]');
  await page.waitForFunction(() => AK.cles.active() && !document.querySelector('dialog[open]'), null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const k1 = await page.evaluate(() => ({ id: AK.cles.active().id, emp: AK.cles.active().empreinte }));
  ok('clé K1 créée, empreinte lisible affichée', k1.id === 'K1' && /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/.test(k1.emp) && (await page.textContent('.ps-empreinte')) === k1.emp, JSON.stringify(k1));
  ok('tableau des clés : K1 active', /K1/.test(await page.textContent('#tr-ps-cles')) && /Active/.test(await page.textContent('#tr-ps-cles')));
  // rotation
  await page.click('[data-action="ps-cle-rotation"]');
  await page.waitForSelector('dialog[open] #ps-mdp');
  ok('rotation : conséquences expliquées', /retirée/.test(await page.textContent('dialog[open]')));
  await page.fill('dialog[open] #ps-mdp', 'Demo2026');
  await page.click('dialog[open] [type=submit]');
  await page.waitForFunction(() => AK.cles.active() && AK.cles.active().id === 'K2' && !document.querySelector('dialog[open]'), null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const cles = await page.evaluate(() => AK.cles.liste().map((c) => [c.id, c.statut]));
  ok('rotation : K2 active, K1 retirée (vérifie toujours)', JSON.stringify(cles) === JSON.stringify([['K1', 'retiree'], ['K2', 'active']]), JSON.stringify(cles));
  ok('tableau : deux clés, statuts en texte', (await page.$$eval('#tr-ps-cles tbody tr', (L) => L.length)) === 2 && /Retirée/.test(await page.textContent('#tr-ps-cles')));
  // compromission de K1 : cause, motif, confirmation tapée, mot de passe
  await page.click('[data-action="ps-cle-compromise"][data-id="K1"]');
  await page.waitForSelector('dialog[open] #ps-saisie');
  await page.waitForTimeout(120);
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] .erreur-champ');
  ok('compromission : cause obligatoire', /cause/.test(await page.textContent('dialog[open] .erreur-champ')));
  await page.selectOption('dialog[open] #ps-motif-type', 'Autre');
  await page.fill('dialog[open] #ps-motif', 'abc');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(150);
  ok('compromission : motif trop court refusé', /5 caractères/.test(await page.textContent('dialog[open] .erreur-champ')));
  await page.fill('dialog[open] #ps-motif', 'Clé USB de sauvegarde égarée à l’IEPP');
  await page.fill('dialog[open] #ps-saisie', 'compromis');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(150);
  ok('compromission : confirmation tapée exigée', /COMPROMISE/.test(await page.textContent('dialog[open] .erreur-champ')) && (await page.evaluate(() => AK.cles.liste()[0].statut)) === 'retiree');
  await page.fill('dialog[open] #ps-saisie', 'compromise');
  await page.click('dialog[open] [type=submit]');
  await confirmerMdp(page, 'Demo2026');
  await page.waitForFunction(() => AK.cles.liste()[0].statut === 'compromise', null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(250);
  const c1 = await page.evaluate(() => AK.cles.liste()[0]);
  ok('K1 déclarée compromise avec son motif ; K2 reste active', c1.statut === 'compromise' && c1.motif === 'Clé USB de sauvegarde égarée à l’IEPP' && (await page.evaluate(() => AK.cles.active().id)) === 'K2', JSON.stringify({ s: c1.statut, m: c1.motif }));
  ok('compromission : plus de bouton pour K1', !(await page.$('[data-action="ps-cle-compromise"][data-id="K1"]')));
  ok('déjà compromise : refus (appel direct)', /déjà/.test(await page.evaluate(() => { try { AK.reglagesSecurite.declarerCompromise('K1', 'motif valable'); return ''; } catch (x) { return x.message; } })));
  // export des clés publiques
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="ps-cles-export"]')]);
  const json = JSON.parse(fs.readFileSync(await telechargement.path(), 'utf8'));
  ok('export JSON : clés publiques sans secret', json.format === 'akwa-cles-publiques' && json.cles.length === 2 && json.active === 'K2' && !JSON.stringify(json).includes('prive') && json.cles.every((c) => c.pub && c.empreinte) && /\.json$/.test(telechargement.suggestedFilename()), telechargement.suggestedFilename());
  // mot de passe administrateur (action existante) : la clé est rechiffrée
  await page.click('#contenu [data-action="changer-mdp-admin"]');
  await page.waitForSelector('dialog[open] #cm-old');
  await page.waitForTimeout(120); // la fenêtre place le focus sur le premier champ après 30 ms
  await page.fill('dialog[open] #cm-old', 'Faux2026x');
  await page.fill('dialog[open] #cm-nw', 'Nouveau2027');
  await page.fill('dialog[open] #cm-nw2', 'Nouveau2027');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('dialog[open] .erreur-champ');
  ok('changement de mot de passe : ancien incorrect refusé', /incorrect/.test(await page.textContent('dialog[open] .erreur-champ')), await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.textContent.replace(/\s+/g, ' ').slice(0, 200)).join(' || ')));
  await page.fill('dialog[open] #cm-old', 'Demo2026');
  await page.click('dialog[open] [type=submit]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 15000 });
  ok('mot de passe changé, clé active rechiffrée', (await page.evaluate(() => AK.auth.verifierAdmin('Nouveau2027'))) && (await page.evaluate(() => AK.cles.deverrouiller('Nouveau2027'))));
  // code de secours (action existante)
  await page.click('#contenu [data-action="nouveau-secours"]');
  await confirmerMdp(page, 'Nouveau2027');
  await page.waitForSelector('dialog[open] .code-secours', { timeout: 15000 });
  const code = (await page.textContent('dialog[open] .code-secours')).trim();
  await page.check('dialog[open] [name=note]');
  await page.click('dialog[open] [type=submit]');
  await page.waitForTimeout(250);
  ok('nouveau code de secours affiché une fois et journalisé', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) && /Nouveau code de secours créé/.test(await page.textContent('#contenu')), code);
  // verrouillage immédiat, puis déverrouillage de la clé pour la session
  await page.click('[data-action="ps-verrouiller"]');
  await page.waitForSelector('#ecran-plein [name=mdp]');
  ok('verrouiller maintenant : écran verrouillé, clé oubliée', !(await page.evaluate(() => AK.cles.disponible())));
  await page.fill('#ecran-plein [name=mdp]', 'Nouveau2027');
  await page.click('#ecran-plein .btn-pri');
  await page.waitForFunction(() => !document.querySelector('#ecran-plein'), null, { timeout: 15000 });
  await page.evaluate(() => AK.cles.oublier());
  await aller(page, 'parametres/securite');
  await page.click('[data-action="ps-cle-deverrouiller"]');
  await confirmerMdp(page, 'Nouveau2027');
  await page.waitForFunction(() => AK.cles.disponible(), null, { timeout: 15000 }).catch(() => {});
  ok('clé déverrouillée pour la session', await page.evaluate(() => AK.cles.disponible()));
  ok('événements de sécurité récents listés', /Rotation des clés/.test(await page.textContent('#contenu')) && /déclarée compromise/.test(await page.textContent('#contenu')));

  /* ================= Largeur 390 px ================= */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of ['parametres/modeles', `parametres/modeles?modele=${MODELE}`, 'parametres/securite']) {
    await aller(page, r);
    await page.waitForTimeout(400);
    if (r.includes('modele=')) await apercuPret(page);
    const larg = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, contenu: document.querySelector('#contenu').scrollWidth, vue: innerWidth }));
    ok(`390 px sans débordement : ${r}`, larg.doc <= larg.vue && larg.contenu <= larg.vue, JSON.stringify(larg));
  }
  await page.setViewportSize({ width: 1366, height: 860 });

  /* ================= Droits d'un enseignant ================= */
  await page.evaluate(() => AK.app.deconnecter());
  await page.waitForSelector('.ep-profil');
  const ens = (await page.$$eval('.ep-profil', (L) => L.map((b) => b.dataset.v))).find(Boolean);
  await page.click(`.ep-profil[data-v="${ens}"]`);
  await page.fill('[name=mdp]', 'Classe2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
  for (const r of ['parametres/modeles', 'parametres/securite']) {
    await page.evaluate((x) => (location.hash = x), r);
    await page.waitForTimeout(300);
    ok(`enseignant : ${r} inaccessible`, (await page.evaluate(() => AK.shell.routeCourante())) !== r.split('?')[0]);
  }
  const refus = await page.evaluate(async () => {
    const essai = async (f) => { try { await f(); return 'accepté'; } catch (x) { return x.name; } };
    return {
      enregistrer: await essai(() => AK.modeles.enregistrer('bulletin', { titre: 'PIRATÉ' })),
      reinitialiser: await essai(() => AK.modeles.reinitialiser('certificat-scolarite')),
      verrou: await essai(() => AK.reglagesSecurite.verrouillage(1)),
      compromise: await essai(() => AK.reglagesSecurite.declarerCompromise('K2', 'tentative enseignant')),
      export: await essai(() => AK.reglagesSecurite.exporterClesPubliques()),
      cle: await essai(() => AK.cles.creer('Classe2026'))
    };
  });
  ok('enseignant : opérations refusées par les fonctions métier', Object.values(refus).every((v) => v === 'ErreurDroits'), JSON.stringify(refus));
  ok('enseignant : rien n’a changé', await page.evaluate(() => AK.cles.active().id === 'K2' && AK.store.etat.securite.verrouMin === 20 && !AK.modeles.estPersonnalise('bulletin')));
  ok('aucune erreur JavaScript (démonstration)', erreurs.length === 0, erreurs.join(' | '));
  await navigateur.close();

  /* ================= École réelle vide : pas d'exemple ================= */
  {
    const { navigateur: n2, page: p2, erreurs: e2 } = await ouvrir();
    await creerEcole(p2);
    await aller(p2, `parametres/modeles?modele=${MODELE}`);
    await p2.waitForSelector('#pm-form');
    await apercuPret(p2);
    ok('école vide : aperçu indisponible expliqué', /Aucun élève inscrit/.test(await p2.textContent('#pm-apercu')));
    ok('école vide : réglages proposés avec avertissement, pas de bouton spécimen', /Sans donnée d’exemple/.test(await p2.textContent('#pm-form')) && !(await p2.$('[data-action="pm-specimen"]')));
    await p2.fill('#pm-titre', 'CERTIFICAT');
    await p2.click('button[form="pm-form"]');
    await p2.waitForTimeout(250);
    ok('école vide : enregistrement possible', (await p2.evaluate((id) => AK.modeles.reglages(id).titre, MODELE)) === 'CERTIFICAT');
    await aller(p2, 'parametres/securite');
    ok('école réelle : code de secours créé, verrouillage 15 min', /Créé/.test(await p2.textContent('.ps-kpis')) && (await p2.inputValue('#ps-verrou-min')) === '15');
    ok('aucune erreur JavaScript (école vide)', e2.length === 0, e2.join(' | '));
    await n2.close();
  }

  /* ================= Version bureau (application Windows) ================= */
  {
    const n3 = await chromium.launch();
    const ctx = await n3.newContext();
    const p3 = await ctx.newPage();
    const e3 = [];
    p3.on('pageerror', (x) => e3.push(x.message));
    p3.on('console', (m) => { if (m.type() === 'error') e3.push(m.text()); });
    await p3.addInitScript(() => {
      const pont = {
        enregistrer: (t, cb) => cb(''), verifierAdmin: (m, cb) => cb(m === 'Bureau2026'),
        telecharger: (n, t, ty, cb) => cb('C:/Ecole/' + n), imprimer: (p, cb) => cb && cb(), deconnexion: (cb) => cb && cb()
      };
      window.qt = { webChannelTransport: {} };
      window.QWebChannel = function (transport, cb) { setTimeout(() => cb({ objects: { pont } }), 10); };
      window.APP_DATA = { etat: null, session: { role: 'dir' }, licence: null, version: '8.0.0' };
    });
    await p3.goto(URL);
    await p3.waitForTimeout(800);
    await p3.evaluate(() => { AK.store.installer(AK.demo.creer()); AK.app.connexion(); });
    await p3.waitForTimeout(500);
    await aller(p3, 'parametres/securite');
    await p3.waitForTimeout(300);
    const txt = await p3.textContent('#contenu');
    ok('bureau : mots de passe gérés par l’application Windows', AK_ok(txt) && !(await p3.$('#contenu [data-action="changer-mdp-admin"]')) && !(await p3.$('#ps-verrou')), txt.slice(0, 200));
    ok('bureau : clés de signature gérables', !!(await p3.$('[data-action="ps-cle-creer"]')));
    ok('aucune erreur JavaScript (bureau)', e3.length === 0, e3.join(' | '));
    await n3.close();
  }

  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });

function AK_ok(txt) {
  return /Version Windows/.test(txt) && /application Windows AKWA SCHOOL/.test(txt);
}
