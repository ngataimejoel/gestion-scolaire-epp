/* Parcours de toutes les routes déclarées (démonstration, directeur) : aucune erreur JS,
   aucun écran « indisponible », aucune requête réseau. Option : ROUTES=a,b pour limiter. */
const { ouvrir, demo, aller } = require('./outils.cjs');
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await demo(page);
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
    const ok = etat.existe && etat.courant === r && !etat.indispo && erreurs.length === avant;
    res.push({ r, ok, ...etat, err: erreurs.slice(avant).join(' | ') });
  }
  for (const x of res) console.log(`${x.ok ? 'OK   ' : x.existe ? 'ÉCHEC' : 'ABSENT'} ${x.r.padEnd(26)} ${x.titre.slice(0, 40)} ${x.ok ? '' : (x.detail + ' ' + x.err).slice(0, 300)}`);
  const absents = res.filter((x) => !x.existe).length, ko = res.filter((x) => x.existe && !x.ok).length;
  console.log(`${res.length - absents - ko} OK, ${ko} en échec, ${absents} écran(s) non encore écrit(s) ; erreurs globales : ${erreurs.length}`);
  await navigateur.close();
  process.exit(ko ? 1 : 0);
})();
