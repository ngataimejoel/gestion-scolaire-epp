/* Services (bibliothèque, CEPE, parents) et Paramètres (école, calendrier, apparence, diagnostic). */
const { ouvrir, demo, aller, confirmerMdp } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const D = 'dialog[open]';
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await demo(page);

  /* ---------- Bibliothèque ---------- */
  await aller(page, 'services/biblio');
  await page.click('[data-action="biblio-ouvrage"]');
  await page.click(`${D} [type=submit]`);
  await page.waitForSelector(`${D} .erreur-champ`);
  ok('ouvrage sans titre : erreur sous le champ', await page.isVisible(`${D} [name=titre][aria-invalid=true]`));
  await page.fill(`${D} [name=titre]`, 'Lecture CE1 « Les aventures d’Akissi »');
  await page.fill(`${D} [name=ex]`, '1');
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(250);
  const livre = await page.evaluate(() => AK.store.etat.pro.livres.slice(-1)[0]);
  ok('ouvrage ajouté (accents et guillemets conservés)', livre && /Akissi/.test(livre.titre) && livre.cote, JSON.stringify(livre));
  await page.click(`[data-action="biblio-pret"][data-livre="${livre.id}"]`);
  const sid = await page.evaluate(() => AK.calc.actifs()[0].id);
  await page.selectOption(`${D} [name=sid]`, sid);
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(250);
  ok('prêt enregistré', await page.evaluate((id) => AK.store.etat.pro.prets.some((p) => p.livre === id && !p.rendu), livre.id));
  ok('plus d’exemplaire disponible : bouton Prêter désactivé', await page.isDisabled(`[data-action="biblio-pret"][data-livre="${livre.id}"]`));
  await page.waitForTimeout(300);
  await page.click(`[data-action="biblio-retirer"][data-id="${livre.id}"]`);
  await page.waitForTimeout(300);
  if (await page.$(D)) await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(300);
  ok('retrait refusé tant qu’un exemplaire est prêté', await page.evaluate((id) => AK.store.etat.pro.livres.some((b) => b.id === id), livre.id));
  await page.click('[data-action="biblio-vue"][data-v="prets"]');
  await page.waitForTimeout(200);
  const pret = await page.evaluate((id) => AK.store.etat.pro.prets.find((p) => p.livre === id).id, livre.id);
  await page.click(`[data-action="biblio-retour"][data-id="${pret}"]`);
  await page.waitForTimeout(200);
  ok('retour enregistré', await page.evaluate((id) => !!AK.store.etat.pro.prets.find((p) => p.id === id).rendu, pret));

  /* ---------- CEPE ---------- */
  await aller(page, 'services/cepe');
  const cm2 = await page.evaluate(() => AK.calc.actifsDe('CM2')[0].id);
  const avant = await page.evaluate((id) => AK.pro.dossierCepe(AK.eleves.trouver(id)).n, cm2);
  await page.check(`#cepe-${cm2}-photos`);
  await page.waitForTimeout(150);
  ok('pièce du CEPE cochée', (await page.evaluate((id) => AK.pro.dossierCepe(AK.eleves.trouver(id)).n, cm2)) === avant + 1);

  /* ---------- Parents ---------- */
  await aller(page, 'services/parents');
  await page.selectOption('#sms-dest', 'classe');
  await page.waitForTimeout(150);
  await page.selectOption('#sms-classe', 'CE1');
  await page.waitForTimeout(150);
  const nb = await page.evaluate(() => AK.pro.cibleSms('classe', 'CE1').length);
  ok('destinataires d’une classe comptés', (await page.textContent('#contenu')).includes(`${nb} élève`));
  await page.fill('#sms-texte', 'Chers parents, réunion le 12 novembre à 15 h. La Direction.');
  await page.click('[data-action="sms-noter"]');
  await page.waitForTimeout(250);
  ok('envoi noté avec le nombre de destinataires', await page.evaluate((n) => AK.store.etat.pro.sms[0] && AK.store.etat.pro.sms[0].n === n, nb));
  ok('lien SMS proposé seulement avec des numéros', (await page.$('[data-action="sms-ouvrir"]')) !== null || nb === 0);
  await page.click('[data-action="annonce-nouvelle"]');
  await page.fill(`${D} [name=titre]`, 'Journée pédagogique');
  await page.fill(`${D} [name=corps]`, 'Pas de cours le vendredi 14.');
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(250);
  ok('annonce publiée', await page.evaluate(() => AK.store.etat.pro.annonces.some((a) => a.titre === 'Journée pédagogique')));

  /* ---------- Paramètres › École ---------- */
  await page.evaluate(() => AK.store.modifier(null, (s) => (s.school.idLock = true))); // comme une école créée par l'assistant
  await aller(page, 'parametres/ecole');
  ok('identité verrouillée (nom désactivé)', await page.isDisabled('#form-ecole [name=name]'));
  await page.click('[role=tab]:has-text("Année")');
  await page.fill('#form-ecole [name=year]', '2026-2028');
  await page.click('#form-ecole [type=submit]');
  await page.waitForSelector('#form-ecole .erreur-champ');
  ok('année incohérente refusée sous le champ', /2026–2027/.test(await page.textContent('#form-ecole .erreur-champ')));
  await page.fill('#form-ecole [name=year]', '2026-2027');
  await page.uncheck('#form-ecole [name=niveaux][value=CE1]');
  await page.click('#form-ecole [type=submit]');
  await page.waitForSelector('#form-ecole .erreur-champ');
  ok('fermeture d’un niveau occupé refusée', /CE1/.test(await page.textContent('#form-ecole .erreur-champ')));
  await page.check('#form-ecole [name=niveaux][value=CE1]');
  await page.click('[role=tab]:has-text("Direction")');
  await page.fill('#form-ecole [name=telephone]', '0102');
  await page.click('#form-ecole [type=submit]');
  await page.waitForSelector('#form-ecole .erreur-champ');
  ok('téléphone invalide refusé', await page.isVisible('#form-ecole [name=telephone][aria-invalid=true]'));
  await page.fill('#form-ecole [name=telephone]', '+225 07 08 09 10 11');
  await page.fill('#form-ecole [name=localite]', 'Ouaninou');
  await page.click('#form-ecole [type=submit]');
  await page.waitForTimeout(300);
  ok('paramètres enregistrés (localité en majuscules)', (await page.evaluate(() => AK.store.etat.school.localite)) === 'OUANINOU');
  await page.click('[data-action="ecole-deverrouiller"]');
  await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(250);
  ok('identité déverrouillée après mot de passe', !(await page.isDisabled('#form-ecole [name=name]')));
  await page.fill('#form-ecole [name=name]', 'ECOLE SANS EPP');
  await page.click('#form-ecole [type=submit]');
  await page.waitForSelector('#form-ecole .erreur-champ');
  ok('école publique sans « EPP » refusée', /EPP/.test(await page.textContent('#form-ecole .erreur-champ')));

  /* ---------- Calendrier, apparence, diagnostic ---------- */
  await aller(page, 'parametres/calendrier');
  const nC = await page.evaluate(() => AK.store.etat.conges.length);
  await page.click('[data-action="conge-nouveau"]');
  await page.fill(`${D} [name=lib]`, 'Congés de Noël');
  await page.fill(`${D} [name=du]`, '2026-12-21');
  await page.fill(`${D} [name=au]`, '2027-01-02');
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(250);
  ok('congé ajouté', (await page.evaluate(() => AK.store.etat.conges.length)) === nC + 1);
  ok('jours de Noël exclus des jours de classe', await page.evaluate(() => !AK.calc.estJourClasse('2026-12-22')));
  await aller(page, 'parametres/apparence');
  await page.check('[name=theme][value=dark]');
  await page.waitForTimeout(200);
  ok('thème sombre appliqué', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.check('[name=theme][value=auto]');
  await aller(page, 'parametres/diagnostic');
  await page.waitForTimeout(300);
  await page.click('[data-action="diag-controle"]');
  await page.waitForTimeout(250);
  ok('contrôle d’intégrité affiché', /incohérence|Erreur|Avertissement/.test(await page.textContent('#contenu')));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('[data-action="diag-exporter"]')]);
  let rapport = '';
  if (dl) rapport = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('rapport de diagnostic sans nom d’élève', rapport && !rapport.includes(await page.evaluate(() => AK.calc.actifs()[0].nom + ' ' + AK.calc.actifs()[0].prenoms)), rapport.slice(0, 80));

  /* ---------- Téléphone ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of ['services/biblio', 'services/parents', 'parametres/ecole', 'parametres/diagnostic']) {
    await aller(page, r);
    await page.waitForTimeout(200);
    const deb = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth + (document.querySelector('#principal').scrollWidth - document.querySelector('#principal').clientWidth));
    ok(`390 px sans débordement : ${r}`, deb <= 1, String(deb));
  }
  ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  await navigateur.close();
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e.message.split('\n')[0]); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
