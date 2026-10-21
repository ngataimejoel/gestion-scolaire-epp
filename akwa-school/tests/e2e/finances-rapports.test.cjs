/* Finances (versements et reçus, annulation, dépenses, cantine) et Rapports (officiels,
   générateur, statistiques, transmission IEPP). */
const { ouvrir, demo, aller, confirmerMdp } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const D = 'dialog[open]';
const fermerApercu = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); };
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.addInitScript(() => { window.print = () => (window.__impressions = (window.__impressions || 0) + 1); });
  await demo(page);

  /* ---------- Versement ---------- */
  await aller(page, 'finances/paiements');
  const s = await page.evaluate(() => { const s = AK.calc.actifs().find((x) => AK.pro.duDe(x) - AK.pro.payeDe(x) > 0); return { id: s.id, du: AK.pro.duDe(s), paye: AK.pro.payeDe(s) }; });
  await page.click(`[data-action="fin-encaisser"][data-id="${s.id}"]`);
  await page.fill(`${D} [name=montant]`, '0');
  await page.click(`${D} [type=submit]`);
  await page.waitForSelector(`${D} .erreur-champ, ${D} .erreur-form`);
  ok('montant nul refusé avec message', true);
  await page.fill(`${D} [name=montant]`, '1500');
  await page.fill(`${D} [name=payeur]`, 'KONÉ Ismaël « père »');
  const nRec = await page.evaluate(() => AK.store.etat.pro.paiements.length);
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(600);
  const rec = await page.evaluate(() => AK.store.etat.pro.paiements.slice(-1)[0]);
  ok('versement enregistré avec numéro de reçu', (await page.evaluate(() => AK.store.etat.pro.paiements.length)) === nRec + 1 && /^REC-\d{4}-\d{5}$/.test(rec.ref), JSON.stringify(rec));
  ok('reste à payer mis à jour', (await page.evaluate((id) => AK.pro.payeDe(AK.eleves.trouver(id)), s.id)) === s.paye + 1500);
  // aperçu du reçu (souvent proposé juste après l'encaissement)
  if (!(await page.$(`${D} .feuille`))) {
    if (await page.$(D)) await fermerApercu(page);
    await aller(page, 'finances/paiements?vue=historique');
    await page.click(`[data-action="fin-recu-imprimer"][data-id="${rec.id}"]`);
  }
  await page.waitForSelector(`${D} .feuille`, { timeout: 8000 });
  ok('reçu : aperçu A5 avec la référence', await page.evaluate((r) => { const f = document.querySelector('dialog[open] .feuille'); return !!f && f.classList.contains('a5') && f.textContent.includes(r); }, rec.ref));
  await fermerApercu(page);
  // annulation
  await aller(page, 'finances/paiements?vue=historique');
  await page.click(`[data-action="fin-recu-annuler"][data-id="${rec.id}"]`);
  await page.waitForSelector(D);
  if (await page.$(`${D} [name=motif]`)) await page.fill(`${D} [name=motif]`, 'Erreur de montant');
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(300);
  if (await page.$(`${D} #mdp-admin`)) await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(400);
  const ann = await page.evaluate((id) => AK.store.etat.pro.paiements.find((p) => p.id === id), rec.id);
  ok('reçu annulé, conservé, motif tracé', ann && ann.annule && /Erreur/.test(ann.annule.motif), JSON.stringify(ann && ann.annule));
  ok('versement annulé exclu du payé', (await page.evaluate((id) => AK.pro.payeDe(AK.eleves.trouver(id)), s.id)) === s.paye);

  /* ---------- Dépenses ---------- */
  await aller(page, 'finances/depenses');
  await page.click('[data-action="fin-depense-nouvelle"]');
  await page.fill(`${D} [name=libelle]`, 'Craies et cahiers');
  await page.fill(`${D} [name=montant]`, '12500');
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(300);
  const dep = await page.evaluate(() => AK.store.etat.pro.depenses.slice(-1)[0]);
  ok('dépense enregistrée (montant entier)', dep && dep.montant === 12500 && dep.libelle === 'Craies et cahiers');
  ok('total des dépenses = AK.pro.depense()', await page.evaluate(() => AK.pro.depense() === AK.store.etat.pro.depenses.reduce((a, d) => a + d.montant, 0)));
  await page.click(`[data-action="fin-depense-supprimer"][data-id="${dep.id}"]`);
  await page.waitForSelector(D);
  await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(300);
  if (await page.$(`${D} #mdp-admin`)) await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(300);
  ok('dépense supprimée après confirmation', await page.evaluate((id) => !AK.store.etat.pro.depenses.some((d) => d.id === id), dep.id));
  await page.evaluate(() => AK.docs.ouvrir('journal-caisse', [{}]));
  await page.waitForSelector(`${D} .feuille`);
  ok('journal de caisse imprimable', (await page.$$(`${D} .feuille`)).length >= 1);
  await fermerApercu(page);

  /* ---------- Cantine ---------- */
  await aller(page, 'finances/cantine');
  await page.click('[data-action="fin-cantine-classe"]:has-text("CE1")');
  await page.waitForTimeout(250);
  await page.click('[data-action="fin-cantine-tous"][data-classe="CE1"]');
  await page.waitForTimeout(200);
  if (await page.$(D)) await page.click(`${D} [type=submit]`);
  await page.waitForTimeout(300);
  const ins = await page.evaluate(() => AK.calc.actifsDe('CE1').filter((s) => AK.store.etat.pro.cantine.inscrits[s.id]).length);
  ok('cantine : classe entière inscrite', ins === (await page.evaluate(() => AK.calc.actifsDe('CE1').length)));

  /* ---------- Rapports ---------- */
  await aller(page, 'rapports/officiels');
  ok('rapports officiels : écran affiché', (await page.textContent('#contenu h1')).length > 0);
  await page.click('[data-action="rap-off-imprimer"]');
  await page.waitForSelector(`${D} .feuille`, { timeout: 10000 });
  ok('rapport officiel : aperçu avant impression', (await page.$$(`${D} .feuille`)).length >= 1);
  await page.click(`${D} [data-imprimer]`);
  await page.waitForTimeout(400);
  ok('rapport officiel : impression lancée', (await page.evaluate(() => window.__impressions)) >= 1);
  await fermerApercu(page);
  await aller(page, 'rapports/generateur');
  const nRep = await page.evaluate(() => AK.store.etat.persoReps.length);
  await page.click('[data-action="rap-gen-nouveau"]');
  await page.waitForTimeout(300);
  if (await page.$(D)) {
    const t = await page.$(`${D} [name=titre]`);
    if (t) await t.fill('Rapport du conseil des maîtres');
    await page.click(`${D} [type=submit]`);
    await page.waitForTimeout(400);
  }
  ok('générateur : rapport personnalisé créé', (await page.evaluate(() => AK.store.etat.persoReps.length)) === nRep + 1);
  const rid = await page.evaluate(() => AK.store.etat.persoReps.slice(-1)[0].id);
  const nb0 = await page.evaluate((id) => AK.store.etat.persoReps.find((r) => r.id === id).blocs.length, rid);
  await page.click(`[data-action="rap-gen-imprimer"][data-id="${rid}"]`);
  await page.waitForSelector(`${D} .feuille`, { timeout: 10000 });
  ok(`générateur : aperçu du rapport (${nb0} bloc(s))`, (await page.$$(`${D} .feuille`)).length >= 1);
  await fermerApercu(page);
  await aller(page, 'rapports/stats');
  ok('statistiques : affichées sans erreur', !(await page.$('#contenu .encadre.erreur')));
  await aller(page, 'rapports/liaison');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-action="rap-liaison-fichier"]')]);
  let paquet = null;
  if (dl) try { paquet = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8')); } catch (e) { paquet = null; }
  ok('transmission IEPP : fichier JSON valide sans téléphone du personnel', paquet && paquet.effectifs && !JSON.stringify(paquet.personnel || []).match(/\+225|\d{2} \d{2} \d{2}/), dl ? dl.suggestedFilename() : 'aucun fichier');
  ok('transmission notée dans l’historique', await page.evaluate(() => AK.store.etat.pro.transmis.length >= 1));

  ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  await navigateur.close();
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e.message.split('\n')[0]); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
