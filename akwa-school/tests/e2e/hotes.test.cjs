/* Hôtes d'exécution simulés : application Android existante (pont AkwaNative de Pont.java),
   emballage générique (AkwaNatif : Electron…), application Windows PySide6 (QWebChannel « pont »).
   Les ponts sont imités fidèlement d'après leur code Java / Python ; l'APK et l'exécutable
   eux-mêmes ne sont PAS exécutés ici (voir docs/TESTS.md). */
const { chromium, URL } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });

const PONT_ANDROID = () => {
  // fichiers privés persistants entre deux chargements (comme getFilesDir)
  const F = JSON.parse(sessionStorage.getItem('__fichiers') || '{}');
  const garder = () => sessionStorage.setItem('__fichiers', JSON.stringify(F));
  const NOM = /^[a-z0-9_]{1,40}\.json$/;
  const resultats = {};
  window.__enregistres = [];
  window.__impressions = [];
  window.AkwaNative = {
    infos: () => JSON.stringify({ version: '2.0.0-test', modele: 'Simulé' }),
    lire: (n) => { if (!NOM.test(n)) return null; return n in F ? F[n] : null; },
    ecrire: (n, c) => { if (!NOM.test(n)) return false; F[n] = String(c); garder(); return true; },
    supprimer: (n) => { if (!NOM.test(n)) return false; delete F[n]; garder(); return true; },
    resultat: (id) => { const r = resultats[id]; delete resultats[id]; return r == null ? 'null' : r; },
    enregistrerFichier: (id, nom, type, contenu) => {
      window.__enregistres.push({ nom, type, contenu });
      setTimeout(() => { resultats[id] = nom.includes('annuler') ? '{"ok":false,"annule":true,"message":"Annulé."}' : '{"ok":true}'; window.akwaRetour(id); }, 20);
    },
    imprimerPage: (p) => window.__impressions.push(p)
  };
  window.__F = F;
};

async function android(navigateur) {
  const ctx = await navigateur.newContext({ viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(PONT_ANDROID);
  await page.goto(URL);
  await page.waitForSelector('[data-ep="creer"]');
  ok('Android : hôte détecté', (await page.evaluate(() => AK.hote.type)) === 'android');
  ok('Android : stockage dans les fichiers de l’application', /Android/.test(await page.evaluate(() => AK.stockage.description())));
  // création de l'école (assistant complet)
  await page.click('[data-ep="creer"]');
  await page.fill('[name=name]', 'EPP TELEPHONE');
  await page.fill('[name=drenaet]', 'Touba');
  await page.fill('[name=director]', 'KONE Ali');
  await page.click('.btn-pri');
  await page.waitForSelector('[name=year]');
  await page.click('.btn-pri');
  await page.fill('[name=mdp]', 'Telephone2026');
  await page.fill('[name=mdp2]', 'Telephone2026');
  await page.click('.btn-pri');
  await page.waitForSelector('.code-secours', { timeout: 20000 });
  await page.check('dialog [name=note]');
  await page.click('dialog [type=submit]');
  await page.waitForSelector('#contenu .accueil-tete');
  await page.waitForTimeout(600);
  const fichiers = await page.evaluate(() => Object.keys(window.__F));
  ok('Android : état écrit dans akwa2_etat.json', fichiers.includes('akwa2_etat.json'), fichiers.join(','));
  ok('Android : aucun mot de passe en clair dans le fichier', await page.evaluate(() => !/Telephone2026/.test(window.__F['akwa2_etat.json'])));
  // copie de sécurité
  await page.evaluate(() => AK.store.copieAvant('test'));
  ok('Android : copie de sécurité (index + fichier)', await page.evaluate(async () => (await AK.stockage.actif.listeCopies()).length >= 1 && Object.keys(window.__F).some((k) => /^akwa2_c_\d+\.json$/.test(k))));
  // photo : image rangée à part
  await page.evaluate(() => AK.store.modifier('logo', (s) => (s.school.logoEcole = 'data:image/png;base64,' + 'iVBORw0KGgo'.padEnd(600, 'A'))));
  await page.evaluate(() => AK.store.maintenant());
  ok('Android : image rangée dans son propre fichier', await page.evaluate(() => Object.keys(window.__F).some((k) => /^i_[0-9a-f]{16}_[0-9a-z]+\.json$/.test(k)) && !/iVBORw0KGgoAAAA/.test(window.__F['akwa2_etat.json'])));
  // fichier enregistré par le sélecteur d'Android (CSV : indicateur UTF-8 retiré, le pont l'ajoute)
  const r = await page.evaluate(() => AK.hote.fichier('liste.csv', '\ufeffNom;Prénom\nKONÉ;Awa', 'text/csv'));
  const e1 = await page.evaluate(() => window.__enregistres[0]);
  ok('Android : fichier enregistré via enregistrerFichier', r === 'liste.csv' && e1 && e1.contenu.charCodeAt(0) !== 0xfeff && /KONÉ/.test(e1.contenu));
  ok('Android : annulation par l’utilisateur sans erreur', (await page.evaluate(() => AK.hote.fichier('annuler.json', '{}', 'application/json'))) === '');
  const sauv = await page.evaluate(() => AK.sauvegarde.exporter().then(() => window.__enregistres.slice(-1)[0]));
  ok('Android : sauvegarde exportée (format et intégrité)', sauv && /akwa-school-sauvegarde/.test(sauv.contenu) && !/Telephone2026/.test(sauv.contenu));
  // impression par le service d'Android
  await page.evaluate(() => AK.docs.ouvrir('registre-eleves', [{}]));
  await page.waitForSelector('dialog[open] [data-imprimer]');
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(500);
  ok('Android : impression confiée à imprimerPage (paysage)', (await page.evaluate(() => window.__impressions)).join() === 'true');
  // rechargement : données retrouvées, connexion. On attend la fin de l'enregistrement : avec une écriture
  // en cours, l'application retient volontairement la fermeture de la page (beforeunload).
  ok('Android : enregistrement terminé avant le redémarrage', await page.evaluate(() => AK.store.maintenant()));
  await page.reload();
  await page.waitForSelector('#ep-mdp');
  await page.fill('#ep-mdp', 'Telephone2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
  ok('Android : données retrouvées après redémarrage', (await page.evaluate(() => AK.store.etat.school.name)) === 'EPP TELEPHONE');
  ok('Android : aucune erreur JS', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();
}

async function androidAncien(navigateur) {
  // téléphone qui contient les données de l'application Android 1.x (etat_v8.json, sans mot de passe)
  const ctx = await navigateur.newContext({ viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(() => {
    const ancien = { v: 5, school: { name: 'EPP ANCIENNE', year: '2025-2026', director: 'M. KONE', niveaux: ['CP1', 'CE1'], evalCourante: 2 }, students: [{ id: 'e1', nom: 'TRAORE', prenoms: 'Moussa', sexe: 'Masculin', classe: 'CE1', statut: 'Inscrit', naissance: '2017-02-03', mat: 'AK-25001' }], teachers: [], grades: { 'e1|1|DICTÉE': 8 }, compAbs: {}, att: {}, appel: {}, auth: [], conges: [] };
    sessionStorage.setItem('__fichiers', JSON.stringify({ 'etat_v8.json': JSON.stringify(ancien) }));
  });
  await page.addInitScript(PONT_ANDROID);
  await page.goto(URL);
  await page.waitForSelector('[data-ep="ancien"]');
  ok('Android 1.x : reprise proposée', true);
  await page.click('[data-ep="ancien"]');
  await page.click('dialog[open] [type=submit]');
  await page.waitForSelector('#ep-mdp2', { timeout: 10000 });
  ok('Android 1.x : mot de passe du directeur demandé (absent des données)', true);
  await page.fill('#ep-mdp', 'Directeur2026');
  await page.fill('#ep-mdp2', 'Directeur2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('.code-secours', { timeout: 20000 });
  await page.check('dialog [name=note]');
  await page.click('dialog [type=submit]');
  await page.waitForSelector('#ep-mdp');
  await page.fill('#ep-mdp', 'Directeur2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
  const etat = await page.evaluate(() => ({ nom: AK.store.etat.school.name, eleves: AK.store.etat.students.length, note: AK.store.etat.grades['e1|1|DICTÉE'], ancienGarde: !!window.__F['etat_v8.json'] }));
  ok('Android 1.x : élèves et notes repris, ancien fichier conservé', etat.nom === 'EPP ANCIENNE' && etat.eleves === 1 && etat.note === 8 && etat.ancienGarde, JSON.stringify(etat));
  ok('Android 1.x : aucune erreur JS', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();
}

async function natif(navigateur) {
  const ctx = await navigateur.newContext();
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(() => {
    window.__natif = { fichiers: [], pdf: [], impressions: [] };
    window.AkwaNatif = {
      version: () => '2.0.0-electron-test',
      enregistrerFichier: (nom, b64, mime) => { window.__natif.fichiers.push({ nom, texte: decodeURIComponent(escape(atob(b64))), mime }); return Promise.resolve('C:\\Users\\Ecole\\Documents\\' + nom); },
      imprimer: (p) => { window.__natif.impressions.push(p); },
      exporterPdf: (nom, p) => { window.__natif.pdf.push({ nom, p, feuilles: document.querySelectorAll('#impression .feuille').length }); return Promise.resolve('C:\\Users\\Ecole\\Documents\\' + nom); }
    };
  });
  await page.goto(URL);
  await page.waitForSelector('[data-ep="demo"]');
  ok('Natif : hôte détecté', (await page.evaluate(() => AK.hote.type)) === 'natif');
  await page.click('[data-ep="demo"]');
  await page.waitForSelector('.ep-profil');
  await page.fill('[name=mdp]', 'Demo2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
  const chemin = await page.evaluate(() => AK.hote.fichier('essai.csv', 'Nom;Classe\nKONÉ Awa;CE1', 'text/csv'));
  const f = await page.evaluate(() => window.__natif.fichiers[0]);
  ok('Natif : fichier transmis en base64 et décodé à l’identique', /Documents/.test(chemin) && f.texte === 'Nom;Classe\nKONÉ Awa;CE1', JSON.stringify(f));
  await page.evaluate(() => AK.docs.ouvrir('liste-classe', [{ classe: 'CE1' }]));
  await page.waitForSelector('dialog[open] [data-pdf]');
  await page.click('dialog[open] [data-pdf]');
  await page.waitForTimeout(600);
  const pdf = await page.evaluate(() => window.__natif.pdf[0]);
  ok('Natif : vrai export PDF par l’emballage (pas la boîte d’impression)', pdf && /\.pdf$/.test(pdf.nom) && pdf.feuilles >= 1, JSON.stringify(pdf));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(300);
  ok('Natif : impression confiée à l’emballage', (await page.evaluate(() => window.__natif.impressions.length)) === 1);
  ok('Natif : aucune erreur JS', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();
}

async function bureau(navigateur) {
  const ctx = await navigateur.newContext();
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(() => {
    window.__py = { enregistre: [], fichiers: [], impressions: [] };
    const pont = {
      enregistrer: (t, cb) => { window.__py.enregistre.push(t); cb(''); },
      verifierAdmin: (m, cb) => cb(m === 'Bureau2026'),
      telecharger: (n, t, ty, cb) => { window.__py.fichiers.push({ n, t, ty }); cb('C:/Ecole/' + n); },
      imprimer: (p, cb) => { window.__py.impressions.push(p); if (cb) cb(); },
      deconnexion: (cb) => cb && cb()
    };
    window.qt = { webChannelTransport: {} };
    window.QWebChannel = function (transport, cb) { setTimeout(() => cb({ objects: { pont } }), 10); };
    window.APP_DATA = { etat: null, session: { role: 'dir' }, licence: null, version: '8.0.0' };
  });
  await page.goto(URL);
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => AK.hote.type);
  ok('Bureau : hôte détecté', t === 'bureau', t);
  // données de démonstration chargées par l'application Windows : on simule une école existante
  await page.evaluate(() => { const D = AK.demo.creer(); AK.store.installer(D); return AK.store.maintenant(); });
  await page.waitForTimeout(400);
  const env = await page.evaluate(() => window.__py.enregistre.slice(-1)[0] || '');
  ok('Bureau : enregistrement par le pont sans les secrets (securite)', env.length > 1000 && !/"securite"/.test(env), env.slice(0, 80));
  const ch = await page.evaluate(() => AK.hote.fichier('export.json', '{"a":1}', 'application/json'));
  ok('Bureau : fichier par la boîte de dialogue Windows', ch === 'C:/Ecole/export.json');
  ok('Bureau : vérification du mot de passe par l’application', (await page.evaluate(() => AK.auth.verifierAdmin('Bureau2026'))) === true && (await page.evaluate(() => AK.auth.verifierAdmin('faux'))) === false);
  ok('Bureau : aucune erreur JS', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();
}

(async () => {
  const navigateur = await chromium.launch();
  for (const f of [android, androidAncien, natif, bureau]) {
    try {
      await f(navigateur);
    } catch (e) {
      ok(`${f.name} : déroulé complet`, false, e.message.split('\n')[0]);
    }
  }
  await navigateur.close();
  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})();
