/* Parcours de toutes les routes déclarées (démonstration, directeur) : aucune erreur JS,
   aucun écran « indisponible », aucune requête réseau. Option : ROUTES=a,b pour limiter. */
const { ouvrir, demo, aller } = require('./outils.cjs');
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  if (process.env.PROFIL === 'ens') {
    // premier compte enseignant de la démonstration
    await page.goto(require('./outils.cjs').URL);
    await page.waitForSelector('[data-ep="demo"]');
    await page.click('[data-ep="demo"]');
    await page.waitForSelector('.ep-profil[data-v]:not([data-v=""])');
    await page.click('.ep-profil[data-v]:not([data-v=""])');
    await page.fill('[name=mdp]', 'Classe2026');
    await page.click('.ep-contenu .btn-pri');
    await page.waitForSelector('#contenu .accueil-tete');
  } else await demo(page);
  const routes = process.env.ROUTES ? process.env.ROUTES.split(',') : await page.evaluate(() => AK.ecrans.SECTIONS.filter((s) => s.id).flatMap((s) => (s.onglets ? s.onglets.map((o) => o[0]) : [s.id])));
  const res = [];
  for (const r of routes) {
    const avant = erreurs.length;
    await aller(page, r);
    await page.waitForTimeout(150);
    const etat = await page.evaluate((r) => ({
      existe: AK.ecrans.existe(r),
      courant: AK.shell.routeCourante(),
      indispo: !!document.querySelector('#contenu .encadre.erreur') && /n’a pas pu s’afficher/.test(document.querySelector('#contenu').textContent),
      titre: (document.querySelector('#contenu h1') || {}).textContent || '',
      detail: (document.querySelector('#contenu .encadre.erreur') || {}).textContent || ''
    }), r);
    // enseignant : un écran interdit doit être refusé (redirection), jamais afficher une erreur
    const autorise = await page.evaluate((r) => { const e = AK.ecrans.SECTIONS; return !!AK.shell && AK.shell.routeCourante() === r; }, r);
    const ok = process.env.PROFIL === 'ens' ? etat.existe && !etat.indispo && erreurs.length === avant : etat.existe && etat.courant === r && !etat.indispo && erreurs.length === avant;
    etat.refuse = process.env.PROFIL === 'ens' && !autorise;
    res.push({ r, ok, ...etat, err: erreurs.slice(avant).join(' | ') });
  }
  for (const x of res) console.log(`${x.ok ? 'OK   ' : x.existe ? 'ÉCHEC' : 'ABSENT'} ${x.r.padEnd(26)} ${x.refuse ? '(refusé → ' + x.courant + ')' : x.titre.slice(0, 40)} ${x.ok ? '' : (x.detail + ' ' + x.err).slice(0, 300)}`);
  const absents = res.filter((x) => !x.existe).length, ko = res.filter((x) => x.existe && !x.ok).length;
  console.log(`${res.length - absents - ko} OK, ${ko} en échec, ${absents} écran(s) non encore écrit(s) ; erreurs globales : ${erreurs.length}`);
  await navigateur.close();
  process.exit(ko ? 1 : 0);
})();
