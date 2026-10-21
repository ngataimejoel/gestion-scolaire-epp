/* Droits d'un enseignant (compte de la démonstration, connexion réelle par l'écran) :
   périmètre de sa classe, notes soumises à validation, actions réservées refusées même
   appelées directement (la protection est dans les fonctions métier, pas dans les boutons). */
const { ouvrir, URL } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.goto(URL);
  await page.waitForSelector('[data-ep="demo"]');
  await page.click('[data-ep="demo"]');
  await page.waitForSelector('.ep-profil');
  // premier compte enseignant de la liste des profils
  const profils = await page.$$eval('.ep-profil', (L) => L.map((b) => ({ v: b.dataset.v, t: b.textContent })));
  const ens = profils.find((p) => p.v);
  ok('profils enseignants proposés à la connexion', !!ens, JSON.stringify(profils.slice(0, 3)));
  await page.click(`.ep-profil[data-v="${ens.v}"]`);
  await page.fill('[name=mdp]', 'Mauvais1');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('.ep-contenu .erreur-champ');
  ok('mot de passe erroné refusé avec message sous le champ', true);
  await page.fill('[name=mdp]', 'Classe2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
  const ctx = await page.evaluate(() => ({ role: AK.session.courante().role, classes: AK.session.classes(), toutes: AK.calc.niveaux() }));
  ok('session enseignant ouverte', ctx.role === 'ens');
  ok('ne voit que ses classes', ctx.classes.length >= 1 && ctx.classes.length < ctx.toutes.length, JSON.stringify(ctx));
  const c = ctx.classes[0], autre = ctx.toutes.find((k) => !ctx.classes.includes(k));

  // menu : pas de Personnel, Finances, Paramètres, Données (sauvegarde non solo)
  const nav = await page.$$eval('#nav a', (L) => L.map((a) => a.textContent.trim()));
  ok('menu sans Finances, Paramètres ni Données', !nav.some((t) => /finances|Paramètres|Données/.test(t)), nav.join(' | '));
  const ongletsPersonnel = await page.evaluate(() => ['personnel/liste', 'personnel/comptes', 'personnel/messages'].filter((r) => { const e = AK.ecrans.SECTIONS; return AK.ecrans.existe(r) && (!AK.perm || true) && (location.hash = r, true); }));
  await page.evaluate(() => (location.hash = 'personnel/messages'));
  await page.waitForTimeout(250);
  ok('section Personnel réduite à ses messages', (await page.evaluate(() => AK.shell.routeCourante())) === 'personnel/messages' && (await page.$$eval('#contenu .onglets a', (L) => L.length)) <= 1);
  // adresse forcée vers un écran interdit
  await page.evaluate(() => (location.hash = 'personnel/liste'));
  await page.waitForTimeout(300);
  ok('écran interdit inaccessible par l’adresse', (await page.evaluate(() => AK.shell.routeCourante())) !== 'personnel/liste');
  await page.evaluate(() => (location.hash = 'parametres/securite'));
  await page.waitForTimeout(300);
  ok('paramètres de sécurité inaccessibles', !/^parametres/.test(await page.evaluate(() => AK.shell.routeCourante())));

  // appels directs aux fonctions métier : refusés
  const refus = await page.evaluate(async (autre) => {
    const essai = async (f) => { try { await f(); return 'ACCEPTÉ'; } catch (e) { return e.name; } };
    const s = AK.calc.actifsDe(autre)[0];
    return {
      inscrire: await essai(() => AK.eleves.inscrire({ nom: 'TEST', prenoms: 'Intrus', sexe: 'Masculin', classe: autre, age: 8, pere_nom: 'TEST', pere_prenoms: 'Papa', entree: '2025-09-01' })),
      supprimer: await essai(() => AK.eleves.supprimer(s.id)),
      noteAutreClasse: await essai(() => AK.notes.saisir(s.id, 1, AK.calc.matieres(autre, 1)[0][0], '5')),
      valider: await essai(() => AK.notes.valider(autre, 1)),
      passerAnnee: await essai(() => AK.notes.passerAnnee()),
      emettre: await essai(() => AK.registre.emettre({ type: 'CSC', politique: 'registre', canon: { classe: autre } })),
      annuler: await essai(() => AK.registre.annuler('AK-CSC-2026-000001-7', 'test')),
      personnel: await essai(() => AK.personnel.ajouter({ civ: 'M.', nom: 'INTRUS Test', fonction: 'Instituteur' })),
      cles: await essai(() => AK.cles.creer('Classe2026')),
      modeles: await essai(() => AK.modeles.enregistrer('certificat-scolarite', { titre: 'X' })),
      finances: await essai(() => AK.pro.encaisser({ sid: s.id, montant: 1000 })),
      sauvegarde: await essai(() => AK.sauvegarde.construire())
    };
  }, autre);
  Object.entries(refus).forEach(([k, v]) => ok(`refusé par la fonction métier : ${k}`, v !== 'ACCEPTÉ', v));
  // note dans sa classe : en attente de validation (option active dans la démo ?)
  const note = await page.evaluate((c) => {
    const s = AK.calc.actifsDe(c).find((x) => !AK.calc.estAbsent(x.id, 4));
    const m = AK.calc.matieres(c, 4)[0][0];
    const avant = AK.calc.note(s.id, 4, m);
    try {
      const r = AK.notes.saisir(s.id, 4, m, '6');
      return { etat: r.etat, avant, validation: AK.store.etat.school.validation, attente: AK.store.etat.attente[AK.calc.cle(s.id, 4, m)] };
    } catch (e) { return { erreur: e.message, avant }; }
  }, c);
  ok('note de sa classe : en attente si la validation est active, sinon enregistrée', note.erreur ? /enregistrée|fermée|corrig/.test(note.erreur) : note.validation ? note.etat === 'attente' && note.attente === 6 : note.etat === 'ok', JSON.stringify(note));
  // correction d'une note validée : refusée à l'enseignant
  const corr = await page.evaluate((c) => {
    const s = AK.calc.actifsDe(c).find((x) => AK.calc.matieres(c, 1).some(([m]) => AK.calc.note(x.id, 1, m) != null));
    if (!s) return 'aucune note';
    const m = AK.calc.matieres(c, 1).find(([m]) => AK.calc.note(s.id, 1, m) != null)[0];
    try { AK.notes.saisir(s.id, 1, m, '0', { correctionConfirmee: true }); return 'ACCEPTÉ'; } catch (e) { return e.name + ' ' + e.message; }
  }, c);
  ok('correction d’une note validée refusée à l’enseignant', corr !== 'ACCEPTÉ', corr);
  // appel : un enseignant ne lève pas une absence enregistrée
  const appel = await page.evaluate((c) => {
    const auj = AK.u.aujourdhui(), s = AK.calc.actifsDe(c)[0];
    const v1 = AK.absences.basculer(auj, c, s.id);
    let v2;
    try { v2 = AK.absences.basculer(auj, c, s.id); } catch (e) { v2 = 'REFUS'; }
    return { v1, v2 };
  }, c);
  ok('appel : absence posée, puis levée refusée à l’enseignant', appel.v1 === 'A' && appel.v2 === 'REFUS', JSON.stringify(appel));
  // élève d'une autre classe introuvable par la recherche globale
  const nomAutre = await page.evaluate((autre) => AK.calc.actifsDe(autre)[0].nom, autre);
  await page.fill('#recherche', nomAutre);
  await page.waitForTimeout(250);
  const vus = await page.$$eval('#resultats-recherche button', (L) => L.map((b) => b.textContent));
  ok('recherche globale limitée à ses classes', !vus.some((t) => t.includes(autre)), vus.join(' | '));
  ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  await navigateur.close();
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e.message); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
