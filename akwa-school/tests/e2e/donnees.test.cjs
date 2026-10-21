/* Données & sauvegarde (école de démonstration), par l'interface :
   sauvegarde exportée (fichier, empreinte SHA-256, date), vérification d'un fichier, refus d'un
   fichier altéré, illisible, vide ou d'une transmission, aperçu d'une sauvegarde 1.x, restauration
   complète (confirmation tapée, mot de passe refusé puis accepté, copie préalable, reconnexion),
   copies locales (copie à la demande, enregistrement en fichier relu et vérifié, restauration),
   contrôle d'intégrité (anomalies, fiche, export), rattachement d'un espace enseignant, export 1.x,
   exports CSV (contenu, accents, critères invalides), journal (recherche sans accents, filtres,
   export), corbeille (restauration, suppression définitive, vidage avec copie préalable),
   droits d'un enseignant, téléphone 390 × 844, thème sombre, absence d'erreur JavaScript. */
const { ouvrir, demo, aller, confirmerMdp, fs } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const dlg = (page) => page.locator('dialog[open]').last();
const P = (page, f, a) => page.evaluate(f, a);
const nbDialogues = (page) => P(page, () => document.querySelectorAll('dialog[open]').length);
const valider = async (page) => {
  await dlg(page).locator('[type=submit]').click();
  await page.waitForTimeout(250);
};
const enErreur = (page, nom) => P(page, (n) => {
  const d = [...document.querySelectorAll('dialog[open]')].pop();
  const el = d && d.querySelector(`[name="${n}"]`);
  return !!el && el.getAttribute('aria-invalid') === 'true' && !!(el.closest('.champ') || el.parentElement).querySelector('.erreur-champ');
}, nom);
const enErreurExport = (page, type, nom) => P(page, ([t, n]) => {
  const el = document.querySelector(`form[data-type="${t}"] [name="${n}"]`);
  return !!el && el.getAttribute('aria-invalid') === 'true' && !!el.closest('.champ').querySelector('.erreur-champ');
}, [type, nom]);
/** Téléchargement déclenché par une action : nom proposé et contenu. */
async function telecharger(page, action) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), action()]);
  return { nom: d.suggestedFilename(), texte: fs.readFileSync(await d.path(), 'utf8') };
}
const fichier = (nom, texte) => ({ name: nom, mimeType: 'application/json', buffer: Buffer.from(texte, 'utf8') });
const lignesCsv = (t) => t.replace(/^﻿/, '').split('\r\n').filter(Boolean);
/** Éléments qui dépassent à droite de l'écran (hors tableaux défilants et barre d'onglets). */
const depassements = (page) => P(page, () => [...document.querySelectorAll('#contenu *')].filter((el) => !el.closest('.tab-cadre') && !el.closest('.onglets') && el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.tagName + '.' + el.className).slice(0, 4));
async function connecter(page, mdp, login) {
  await page.waitForSelector('.ep-profil');
  if (login) await page.click(`.ep-profil[data-v="${login}"]`);
  await page.fill('#ep-mdp', mdp);
  await page.click('.ep-contenu .btn-pri');
  await page.waitForFunction(() => AK.session.ouverte() && !document.querySelector('#ecran-plein:not([hidden])'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  while (await page.$('dialog[open]')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}
const oublierMdp = (page) => P(page, () => AK.auth.oublierConfirmation());

(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.addInitScript(() => { window.print = () => { window.__impressions = (window.__impressions || 0) + 1; }; });
  await demo(page);
  const auj = await P(page, () => AK.u.aujourdhui());

  /* ======================= Écran Sauvegarde : état initial ======================= */
  await aller(page, 'donnees/sauvegarde');
  await page.waitForTimeout(800);
  const txt0 = await page.textContent('#contenu');
  ok('Sauvegarde : écran affiché avec ses indicateurs', /Sauvegarde et restauration/.test(txt0) && /Jamais/.test(txt0) && /Enregistrement automatique/.test(txt0));
  ok('Sauvegarde : alerte « aucune sauvegarde sur clé USB »', (await page.locator('#contenu .encadre.erreur', { hasText: 'Aucune sauvegarde sur clé USB' }).count()) === 1);
  ok('Sauvegarde : copie quotidienne listée', (await page.locator('#tr-donnees-copies tbody tr', { hasText: 'Copie quotidienne automatique' }).count()) >= 1);
  ok('Sauvegarde : contrôle d’intégrité sans anomalie', /Aucune incohérence détectée/.test(txt0));
  ok('Sauvegarde : plan de sauvegarde avec états lisibles sans couleur', await P(page, () => [...document.querySelectorAll('.donnees-plan li')].every((li) => li.querySelector('svg') && /\((Fait|À faire|À surveiller|Information)\)/.test(li.textContent))));
  const [choix] = await Promise.all([page.waitForEvent('filechooser'), page.click('#contenu .page-tete [data-action="donnees-choisir"][data-usage="restaurer"]')]);
  ok('Sauvegarde : « Restaurer… » ouvre le choix d’un fichier (bouton accessible au clavier)', !!choix && (await page.locator('#contenu .page-tete button[data-action="donnees-choisir"]').count()) === 1);
  await choix.setFiles([]);

  /* ======================= Exporter une sauvegarde ======================= */
  const nEleves = await P(page, () => AK.store.etat.students.length);
  const sauv = await telecharger(page, () => page.click('#contenu .page-tete [data-action="donnees-exporter"]'));
  await page.waitForTimeout(400);
  let env = null;
  try { env = JSON.parse(sauv.texte); } catch (e) { /* vérifié ci-dessous */ }
  ok('Export : fichier .akwa.json daté', /^akwa-school-.+-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.akwa\.json$/.test(sauv.nom), sauv.nom);
  ok('Export : format, empreinte SHA-256 et contenu annoncé', !!env && env.format === 'akwa-school-sauvegarde' && env.empreinte && env.empreinte.algo === 'SHA-256' && /^[0-9a-f]{64}$/.test(env.empreinte.valeur) && env.contenu.eleves === nEleves);
  ok('Export : aucun mot de passe en clair dans le fichier', !/Demo2026|Classe2026/.test(sauv.texte));
  ok('Export : date de dernière sauvegarde enregistrée', (await P(page, () => AK.store.etat.lastBackup)) === auj);
  ok('Export : indicateur « Aujourd’hui » et alerte retirée', /Aujourd’hui/.test(await page.textContent('#contenu .donnees-kpis')) && (await page.locator('#contenu .encadre.erreur', { hasText: 'Aucune sauvegarde sur clé USB' }).count()) === 0);
  ok('Export : inscrit au journal', await P(page, () => AK.store.etat.pro.journal.some((e) => e.m === 'Sauvegarde complète exportée')));

  /* ======================= Vérifier un fichier ======================= */
  await page.setInputFiles('#donnees-f-verifier', fichier(sauv.nom, sauv.texte));
  await page.waitForSelector('dialog[open] .encadre');
  let t = await dlg(page).textContent();
  ok('Vérification : intégrité vérifiée, école et contenu affichés', /Intégrité vérifiée/.test(t) && /EPP OUANINOU 2/.test(t) && /AKWA SCHOOL 2/.test(t) && (await dlg(page).locator('#donnees-saisie').count()) === 0);
  ok('Vérification : comparaison sans écart avec les données actuelles', await P(page, () => [...document.querySelectorAll('dialog[open] tbody tr')].slice(0, 5).every((tr) => tr.lastElementChild.textContent.trim() === '=')));
  await valider(page);
  ok('Vérification : fenêtre refermée, rien de modifié', (await nbDialogues(page)) === 0 && (await P(page, () => AK.store.etat.students.length)) === nEleves);

  /* ======================= Fichiers refusés ======================= */
  const altere = JSON.parse(sauv.texte);
  altere.donnees.school.name = 'ÉCOLE PIRATÉE';
  await page.setInputFiles('#donnees-f-restaurer', fichier('altere.akwa.json', JSON.stringify(altere)));
  await page.waitForSelector('dialog[open] .encadre.erreur');
  t = await dlg(page).textContent();
  ok('Fichier altéré : ALTÉRÉ signalé, restauration refusée (pas de confirmation)', /ALTÉRÉ/.test(t) && /restauration refusée/.test(t) && (await dlg(page).locator('#donnees-saisie').count()) === 0 && (await dlg(page).locator('[type=submit]').textContent()).trim() === 'Fermer');
  await valider(page);
  ok('Fichier altéré : données intactes', (await P(page, () => AK.store.etat.school.name)) === 'EPP OUANINOU 2 (DÉMONSTRATION)');
  for (const [nom, contenu, motif] of [['texte.json', 'pas du json {', /pas une sauvegarde/], ['transmission.json', JSON.stringify({ format: 'akwa-school-transmission-iepp', x: 1 }), /transmission/], ['vide.json', '', /vide/], ['tableau.json', '[1,2]', /pas une sauvegarde/]]) {
    await page.setInputFiles('#donnees-f-restaurer', fichier(nom, contenu));
    await page.waitForSelector('dialog[open]');
    t = await dlg(page).textContent();
    ok(`Fichier refusé (${nom}) : message clair, rien de modifié`, /Fichier refusé/.test(t) && motif.test(t), t.slice(0, 160));
    await valider(page);
  }
  // sauvegarde 1.x : aperçu (format, absence d'empreinte, autre école), puis abandon
  const v1 = { v: 5, school: { name: 'EPP ANCIENNE « 1.x »', year: '2024–2025', adminPwd: 'admin' }, students: [{ id: 'x1', nom: 'KONÉ', prenoms: 'Aïcha Ève', classe: 'CE1', sexe: 'Féminin', statut: 'Inscrit' }], teachers: [], grades: { 'x1|1|DICTEE': 7 } };
  await page.setInputFiles('#donnees-f-restaurer', fichier('ancienne.json', JSON.stringify(v1)));
  await page.waitForSelector('dialog[open] #donnees-saisie');
  t = await dlg(page).textContent();
  ok('Sauvegarde 1.x : format, absence d’empreinte, autre école et conversion signalés', /AKWA SCHOOL 1\.x/.test(t) && /Pas d’empreinte/.test(t) && /Autre école/.test(t) && /EPP ANCIENNE « 1\.x »/.test(t) && /Conversion/.test(t));
  await dlg(page).locator('[data-fermer]', { hasText: 'Annuler' }).click();
  await page.waitForTimeout(250);
  ok('Sauvegarde 1.x : abandon sans effet', (await nbDialogues(page)) === 0 && (await P(page, () => AK.store.etat.students.length)) === nEleves);

  /* ======================= Restauration complète ======================= */
  const supprime = await P(page, () => {
    const s = AK.calc.actifsDe('CM1')[0];
    AK.eleves.supprimer(s.id);
    return { id: s.id, nom: AK.calc.nomComplet(s) };
  });
  await page.waitForTimeout(200);
  await page.setInputFiles('#donnees-f-restaurer', fichier(sauv.nom, sauv.texte));
  await page.waitForSelector('dialog[open] #donnees-saisie');
  ok('Restauration : écart « +1 » élève par rapport aux données actuelles', await P(page, () => document.querySelector('dialog[open] tbody tr').lastElementChild.textContent.trim() === '+1'));
  ok('Restauration : avertissement (remplacement, copie préalable, reconnexion)', /seront remplacées/.test(await dlg(page).textContent()) && /copie de sécurité de l’état actuel/.test(await dlg(page).textContent()));
  await valider(page);
  ok('Restauration : confirmation tapée obligatoire (erreur sous le champ)', (await enErreur(page, 'saisie')) && (await nbDialogues(page)) === 1);
  await dlg(page).locator('#donnees-saisie').fill('restaurer');
  await valider(page);
  await page.waitForSelector('dialog[open] #mdp-admin');
  ok('Restauration : mot de passe du directeur demandé', (await nbDialogues(page)) === 2);
  await dlg(page).locator('#mdp-admin').fill('mauvais-mot');
  await valider(page);
  await page.waitForTimeout(700);
  ok('Restauration : mauvais mot de passe refusé, rien de remplacé', (await enErreur(page, 'pwd')) && (await P(page, () => AK.store.etat.students.length)) === nEleves - 1);
  await dlg(page).locator('#mdp-admin').fill('Demo2026');
  await valider(page);
  await page.waitForSelector('.ep-profil', { timeout: 15000 });
  ok('Restauration : retour à l’écran de connexion avec un message de résultat', /Données restaurées/.test(await page.textContent('.toasts')) && !(await P(page, () => AK.session.ouverte())));
  await connecter(page, 'Demo2026');
  ok('Restauration : élève supprimé revenu, effectif d’origine', await P(page, (a) => AK.store.etat.students.length === a.n && !!AK.eleves.trouver(a.id), { n: nEleves, id: supprime.id }));
  ok('Restauration : inscrite au journal', await P(page, () => AK.store.etat.pro.journal.some((e) => /^Sauvegarde restaurée \(fichier du /.test(e.m))));
  ok('Restauration : copie de sécurité préalable faite', await P(page, async () => (await AK.sauvegarde.copies()).some((c) => c.motif === 'avant-restauration')));

  /* ======================= Copies de sécurité locales ======================= */
  await aller(page, 'donnees/sauvegarde');
  await page.waitForTimeout(800);
  ok('Copies : copie « Avant une restauration » listée', (await page.locator('#tr-donnees-copies tbody tr', { hasText: 'Avant une restauration' }).count()) === 1);
  const nCopies = await page.locator('#tr-donnees-copies tbody tr').count();
  await page.click('[data-action="donnees-copie-creer"]');
  await page.waitForTimeout(900);
  ok('Copies : copie faite à la demande ajoutée', (await page.locator('#tr-donnees-copies tbody tr').count()) === nCopies + 1 && (await page.locator('#tr-donnees-copies tbody tr', { hasText: 'Copie faite à la demande' }).count()) === 1);
  const copieF = await telecharger(page, () => page.click('#tr-donnees-copies tbody tr:has-text("Copie faite à la demande") [data-action="donnees-copie-fichier"]'));
  ok('Copie en fichier : nom daté', /-copie-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.akwa\.json$/.test(copieF.nom), copieF.nom);
  ok('Copie en fichier : relue comme une sauvegarde valide (empreinte vérifiée)', await P(page, async (x) => { const a = await AK.sauvegarde.analyser(x); return a.valide && a.integrite === 'ok' && a.infos.contenu.eleves === AK.store.etat.students.length; }, copieF.texte));
  // restaurer la copie faite à la demande après une modification
  await P(page, () => AK.store.modifier(null, (s) => (s.school.name = 'ÉCOLE MODIFIÉE PAR ERREUR')));
  await page.waitForTimeout(300);
  await page.click('#tr-donnees-copies tbody tr:has-text("Copie faite à la demande") [data-action="donnees-copie-restaurer"]');
  await page.waitForSelector('dialog[open] #donnees-saisie');
  t = await dlg(page).textContent();
  ok('Copie : aperçu « copie locale », autre nom d’école signalé', /Copie de sécurité locale/.test(t) && /Copie faite à la demande/.test(t) && /Autre école/.test(t));
  await dlg(page).locator('#donnees-saisie').fill('RESTAURER');
  await valider(page);
  await confirmerMdp(page, 'Demo2026');
  await page.waitForSelector('.ep-profil', { timeout: 15000 });
  await connecter(page, 'Demo2026');
  ok('Copie restaurée : nom d’origine rétabli', (await P(page, () => AK.store.etat.school.name)) === 'EPP OUANINOU 2 (DÉMONSTRATION)');
  ok('Copie restaurée : journal explicite (date de la copie)', await P(page, () => AK.store.etat.pro.journal.some((e) => /^Copie de sécurité locale restaurée \(fichier du /.test(e.m))));

  /* ======================= Contrôle d'intégrité ======================= */
  const anomalie = await P(page, () => {
    const s = AK.calc.actifsDe('CE2')[0], s2 = AK.calc.actifsDe('CE2')[1];
    AK.store.modifier(null, () => { s.classe = 'ZZZ'; s2.sexe = ''; });
    return { id: s.id, id2: s2.id, cl2: 'CE2' };
  });
  await aller(page, 'donnees/sauvegarde');
  await page.waitForTimeout(500);
  t = await page.textContent('#contenu');
  ok('Intégrité : erreur et point à vérifier signalés', /1 erreur/.test(t) && /1 point à vérifier/.test(t) && /classe « ZZZ »/.test(t) && /sexe non renseigné/.test(t));
  ok('Intégrité : pas de bouton « fiche » inopérant pour un élève d’une classe non ouverte', (await page.locator('.donnees-problemes li:has-text("ZZZ") [data-action="fiche-eleve"]').count()) === 0);
  await page.click('.donnees-problemes li:has-text("sexe non renseigné") [data-action="fiche-eleve"]');
  await page.waitForTimeout(300);
  ok('Intégrité : « Ouvrir la fiche » ouvre la fiche de l’élève', (await page.locator('#tiroir').count()) === 1);
  await page.click('#tiroir [data-action="fermer-tiroir"]');
  const integ = await telecharger(page, () => page.click('[data-action="donnees-integrite-csv"]'));
  ok('Intégrité : liste exportée (CSV)', /^controle-integrite-/.test(integ.nom) && /ZZZ/.test(integ.texte) && lignesCsv(integ.texte).length === 3);
  await P(page, (a) => AK.store.modifier(null, (s) => { s.students.find((x) => x.id === a.id).classe = a.cl2; s.students.find((x) => x.id === a.id2).sexe = 'Féminin'; }), anomalie);
  await page.waitForTimeout(300);
  ok('Intégrité : retour à « aucune incohérence » après correction', /Aucune incohérence détectée/.test(await page.textContent('#contenu')));

  /* ======================= Rattachement d'un espace enseignant ======================= */
  const solo = await P(page, async () => {
    const X = AK.calc, ex = X.actifsDe('CE1')[0];
    const d = {
      v: 5, meta: { schema: 6 }, school: { name: 'Espace de M. KOUAKOU', year: AK.store.etat.school.year, solo: { tid: 'ens1' }, niveaux: ['CE1'] },
      teachers: [{ id: 'ens1', nom: 'M. KOUAKOU Éric', classes: ['CE1'], fonction: 'Instituteur' }],
      students: [
        { id: 'n1', nom: 'GNÉPA', prenoms: 'Désirée Ève', classe: 'CE1', sexe: 'Féminin', statut: 'Inscrit', naissance: '2018-03-02' },
        { id: 'n2', nom: ex.nom, prenoms: ex.prenoms, classe: 'CE1', sexe: ex.sexe, statut: 'Inscrit', naissance: ex.naissance }
      ],
      grades: { 'n1|1|DICTEE': 8, 'n1|1|MATHEMATIQUES': 31.5 }, att: {}
    };
    const texte = JSON.stringify(d);
    const h = AK.crypto.hex(await AK.crypto.sha256(texte));
    return JSON.stringify({ format: 'akwa-school-sauvegarde', version: 2, application: 'AKWA SCHOOL 2.0.0', creeLe: new Date().toISOString(), ecole: { nom: d.school.name, annee: d.school.year }, contenu: { eleves: 2 }, empreinte: { algo: 'SHA-256', valeur: h }, donnees: d });
  });
  await page.setInputFiles('#donnees-f-rattacher', fichier('espace-kouakou.akwa.json', sauv.texte));
  await page.waitForSelector('dialog[open]');
  ok('Rattachement : sauvegarde d’école refusée (pas un espace enseignant)', /n’est pas la sauvegarde d’un espace enseignant/.test(await dlg(page).textContent()));
  await valider(page);
  await page.setInputFiles('#donnees-f-rattacher', fichier('espace-kouakou.akwa.json', solo));
  await page.waitForSelector('dialog[open] .kv');
  t = await dlg(page).textContent();
  ok('Rattachement : aperçu (enseignant, classe, élève déjà présent, classe retirée à la titulaire)', /M\. KOUAKOU Éric/.test(t) && /dont 1 déjà présent/.test(t) && /Mme BAMBA Mariam \(CE1\)/.test(t) && /Intégrité vérifiée/.test(t));
  const nAvant = await P(page, () => AK.store.etat.students.length);
  await oublierMdp(page);
  await valider(page);
  await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(600);
  ok('Rattachement : 1 élève ajouté sans doublon, notes reprises', await P(page, (n) => {
    const S = AK.store.etat, g = S.students.find((s) => s.nom === 'GNÉPA');
    return S.students.length === n + 1 && !!g && S.grades[g.id + '|1|DICTEE'] === 8;
  }, nAvant));
  ok('Rattachement : la classe passe au nouvel enseignant', await P(page, () => { const S = AK.store.etat, k = S.teachers.find((x) => x.nom === 'M. KOUAKOU Éric'), b = S.teachers.find((x) => x.nom === 'Mme BAMBA Mariam'); return !!k && AK.calc.clsDe(k).includes('CE1') && !AK.calc.clsDe(b).includes('CE1'); }));
  ok('Rattachement : message de résultat et copie préalable', /1 élève ajouté/.test(await page.textContent('.toasts')) && (await P(page, async () => (await AK.sauvegarde.copies()).some((c) => c.motif === 'avant-rattachement'))));

  /* ======================= Export compatible 1.x ======================= */
  const f1x = await telecharger(page, () => page.click('[data-action="donnees-export1x"]'));
  const o1x = JSON.parse(f1x.texte);
  ok('Export 1.x : format v5 sans secrets ni rubriques nouvelles', o1x.v === 5 && Array.isArray(o1x.students) && !o1x.securite && !o1x.corbeille && !o1x.docs && /format-1x/.test(f1x.nom));

  /* ======================= Exports CSV ======================= */
  await aller(page, 'donnees/export');
  const inscrits = await P(page, () => AK.calc.actifs().length);
  let f = await telecharger(page, () => page.click('form[data-type="eleves-national"] [type=submit]'));
  let L = lignesCsv(f.texte);
  ok('CSV élèves (national) : BOM, séparateur « ; », en-tête national, une ligne par inscrit', f.texte.charCodeAt(0) === 0xfeff && /^"codedren";"codeiep"/.test(L[0]) && L.length === inscrits + 1, `${L.length} / ${inscrits + 1}`);
  ok('CSV élèves : accents conservés', /GNÉPA/.test(f.texte) && /Désirée Ève/.test(f.texte));
  f = await telecharger(page, () => page.click('form[data-type="eleves-liste"] [type=submit]'));
  ok('CSV liste détaillée : données de santé exclues', lignesCsv(f.texte).length === inscrits + 1 && !/Asthme/.test(f.texte) && /Téléphone du père/.test(f.texte));
  const annonce = Number(((await page.textContent('#donnees-n-notes')).match(/(\d+) ligne/) || [])[1]);
  f = await telecharger(page, () => page.click('form[data-type="notes"] [type=submit]'));
  L = lignesCsv(f.texte);
  ok('CSV notes : une ligne par note, nombre annoncé respecté', /"Matière";"Note";"Sur"/.test(L[0]) && L.length - 1 === annonce && annonce > 100, `${L.length - 1} / ${annonce}`);
  await page.check('#donnees-x-notes-format-tableau');
  await page.waitForTimeout(250);
  ok('CSV notes (tableau) : critère manquant expliqué avant l’export', /Choisissez une classe/.test(await page.textContent('#donnees-n-notes')));
  await page.click('form[data-type="notes"] [type=submit]');
  await page.waitForTimeout(250);
  ok('CSV notes (tableau) : classe exigée, erreur sous le champ', await enErreurExport(page, 'notes', 'classe'));
  await page.selectOption('#donnees-x-notes-classe', 'CE1');
  await page.waitForTimeout(250);
  ok('CSV notes : choix conservés après actualisation', (await page.isChecked('#donnees-x-notes-format-tableau')) && (await page.inputValue('#donnees-x-notes-classe')) === 'CE1');
  f = await telecharger(page, () => page.click('form[data-type="notes"] [type=submit]'));
  L = lignesCsv(f.texte);
  ok('CSV notes (tableau CE1) : matières avec barème, moyenne, rang', /EXPLOITATION DE TEXTE \(sur 50\)/.test(L[0]) && /"Rang"$/.test(L[0]) && L.length - 1 === (await P(page, () => AK.calc.actifsDe('CE1').length)) && /-ce1-/.test(f.nom));
  await page.fill('#donnees-x-absences-du', auj);
  await page.dispatchEvent('#donnees-x-absences-du', 'change');
  await page.waitForTimeout(200);
  await page.fill('#donnees-x-absences-au', await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), -3)));
  await page.dispatchEvent('#donnees-x-absences-au', 'change');
  await page.waitForTimeout(250);
  await page.click('form[data-type="absences"] [type=submit]');
  await page.waitForTimeout(250);
  ok('CSV absences : période inversée refusée sous le champ', await enErreurExport(page, 'absences', 'au'));
  await page.fill('#donnees-x-absences-du', await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), -40)));
  await page.dispatchEvent('#donnees-x-absences-du', 'change');
  await page.fill('#donnees-x-absences-au', auj);
  await page.dispatchEvent('#donnees-x-absences-au', 'change');
  await page.waitForTimeout(250);
  f = await telecharger(page, () => page.click('form[data-type="absences"] [type=submit]'));
  const nAbs = await P(page, () => Object.values(AK.store.etat.att).reduce((k, j) => k + Object.keys(j).length, 0));
  ok('CSV absences (détail) : une ligne par absence', lignesCsv(f.texte).length - 1 === nAbs && /Non justifiée|Justifiée/.test(f.texte), `${lignesCsv(f.texte).length - 1} / ${nAbs}`);
  await page.check('#donnees-x-absences-format-recap');
  await page.waitForTimeout(250);
  f = await telecharger(page, () => page.click('form[data-type="absences"] [type=submit]'));
  ok('CSV absences (total par élève) : tous les inscrits, colonnes justifiées / non justifiées', lignesCsv(f.texte).length - 1 >= inscrits && /"dont justifiés";"dont non justifiés"/.test(lignesCsv(f.texte)[0]));
  f = await telecharger(page, () => page.click('form[data-type="personnel"] [type=submit]'));
  ok('CSV personnel : une ligne par membre', lignesCsv(f.texte).length - 1 === (await P(page, () => AK.store.etat.teachers.length)) && /"Identifiant de connexion"/.test(f.texte));
  ok('CSV versements : sans versement, pas de bouton inutile', (await page.locator('form[data-type="paiements"] [type=submit]').count()) === 0 && /Aucune donnée pour l’instant/.test(await page.textContent('form[data-type="paiements"]')));
  await P(page, () => {
    const s = AK.calc.actifsDe('CP1')[0];
    AK.pro.encaisser({ sid: s.id, montant: '2000', date: AK.u.aujourdhui(), mode: 'Mobile Money', objet: 'Cotisation COGES', payeur: 'Mère : Aïssata « Tantie » N’GUESSAN ' + 'é'.repeat(40) });
  });
  await page.waitForTimeout(250);
  f = await telecharger(page, () => page.click('form[data-type="paiements"] [type=submit]'));
  ok('CSV versements : reçu, montant, payeur avec accents et guillemets', lignesCsv(f.texte).length === 2 && /"REC-\d{4}-\d{5}"/.test(f.texte) && /"2000"/.test(f.texte) && /« Tantie » N’GUESSAN/.test(f.texte));
  await P(page, async () => {
    AK.pro.ajouterDepense({ libelle: 'Craies et cahiers « Clairefontaine » – réparation de l’armoire', montant: '15500', date: AK.u.aujourdhui(), cat: 'Fournitures scolaires', fournisseur: 'Librairie N’Zi', justif: 'Facture n° 12' });
    const s = AK.calc.actifsDe('CE2')[0], X = AK.calc, sc = AK.store.etat.school;
    await AK.registre.emettre({ type: 'CSC', modele: 'certificat-scolarite', version: 1, sujet: { type: 'eleve', id: s.id, libelle: X.nomComplet(s) + ' (' + s.classe + ')' }, canon: { nom: s.nom, prenoms: s.prenoms, matricule: X.matOf(s), classe: s.classe, annee: sc.year, ecole: sc.name, extra: '' } });
  });
  await aller(page, 'donnees/export');
  f = await telecharger(page, () => page.click('form[data-type="depenses"] [type=submit]'));
  ok('CSV dépenses : libellé avec guillemets et accents, montant', lignesCsv(f.texte).length === 2 && /« Clairefontaine » – réparation de l’armoire/.test(f.texte) && /"15500"/.test(f.texte));
  f = await telecharger(page, () => page.click('form[data-type="documents"] [type=submit]'));
  ok('CSV documents émis : référence, type, titulaire, état (spécimen en démonstration)', lignesCsv(f.texte).length === 2 && /"Certificat de scolarité"/.test(f.texte) && /En vigueur \(spécimen\)/.test(f.texte));
  f = await telecharger(page, () => page.click('form[data-type="modele-import"] [type=submit]'));
  L = lignesCsv(f.texte);
  ok('CSV modèle d’import : colonnes nationales et ligne d’exemple', f.nom === 'modele-import-eleves.csv' && L.length === 2 && /"niveau"$/.test(L[0]) && /EXEMPLE/.test(L[1]));
  ok('Exports : chacun inscrit au journal', await P(page, () => ['élèves (format national)', 'notes', 'absences des élèves', 'personnel', 'versements', 'dépenses', 'registre des documents', 'modèle d’import des élèves'].every((l) => AK.store.etat.pro.journal.some((e) => e.m === 'Export : ' + l))));

  /* ======================= Journal des opérations ======================= */
  await aller(page, 'donnees/journal');
  const total = await P(page, () => AK.store.etat.pro.journal.length);
  ok('Journal : toutes les opérations comptées', new RegExp(`${total} opérations`).test(await page.textContent('#tc-donnees-journal')));
  await page.fill('[data-input="tab-q"][data-tab="donnees-journal"]', 'restauree');
  await page.waitForTimeout(400);
  const lignesJ = await page.locator('#tr-donnees-journal tbody tr').allTextContents();
  ok('Journal : recherche sans accents (« restauree » → « restaurée »)', lignesJ.length >= 2 && lignesJ.every((l) => /restaurée/i.test(l)));
  ok('Journal : focus conservé dans la recherche', await P(page, () => document.activeElement && document.activeElement.dataset.tab === 'donnees-journal'));
  await page.fill('[data-input="tab-q"][data-tab="donnees-journal"]', '');
  await page.waitForTimeout(300);
  await page.selectOption('#donnees-j-c', 'donnees');
  await page.waitForTimeout(300);
  ok('Journal : filtre catégorie (adresse et lignes)', /c=donnees/.test(await P(page, () => location.hash)) && (await page.locator('#tr-donnees-journal tbody tr').allTextContents()).every((l) => /Données et sauvegardes/.test(l)));
  await page.selectOption('#donnees-j-qui', 'Direction');
  await page.selectOption('#donnees-j-per', 'jour');
  await page.waitForTimeout(300);
  const nFiltre = Number(((await page.textContent('#tc-donnees-journal')).match(/^(\d+)/) || [])[1]);
  f = await telecharger(page, () => page.click('[data-action="tab-csv"][data-tab="donnees-journal"]'));
  ok('Journal : export CSV des seules lignes filtrées', /^journal-des-operations-/.test(f.nom) && lignesCsv(f.texte).length - 1 === nFiltre && nFiltre > 0, `${lignesCsv(f.texte).length - 1} / ${nFiltre}`);
  await page.click('[data-action="donnees-journal-tout"]');
  await page.waitForTimeout(300);
  ok('Journal : « Effacer les filtres »', !/c=|qui=|per=/.test(await P(page, () => location.hash)) && (await page.inputValue('#donnees-j-c')) === '');

  /* ======================= Corbeille ======================= */
  const cible = await P(page, () => {
    const a = AK.calc.actifsDe('CM2')[0], b = AK.calc.actifsDe('CM2')[1];
    AK.store.modifier(null, () => (a.prenoms = 'Marie-Ève Aïcha Clémentine Joséphine ' + 'Éléonore '.repeat(6).trim()));
    AK.eleves.supprimer(a.id);
    AK.eleves.supprimer(b.id);
    return { a: a.id, b: b.id, nomB: AK.calc.nomComplet(b) };
  });
  await aller(page, 'donnees/corbeille');
  ok('Corbeille : éléments supprimés listés (type, date, auteur) et compteur d’onglet', (await page.locator('#tr-donnees-corbeille tbody tr').count()) === 2 && /par Direction/.test(await page.textContent('#tr-donnees-corbeille')) && (await page.textContent('.onglets a[href="#donnees/corbeille"] .compte')).trim() === '2');
  await page.fill('[data-input="tab-q"][data-tab="donnees-corbeille"]', 'eleonore');
  await page.waitForTimeout(400);
  ok('Corbeille : recherche (nom long, accents)', (await page.locator('#tr-donnees-corbeille tbody tr').count()) === 1);
  await page.fill('[data-input="tab-q"][data-tab="donnees-corbeille"]', '');
  await page.waitForTimeout(300);
  await page.click(`#tr-donnees-corbeille tbody tr:has-text("${cible.nomB}") [data-action="donnees-corbeille-restaurer"]`);
  await page.waitForSelector('dialog[open]');
  await valider(page);
  ok('Corbeille : élève restauré', await P(page, (id) => !!AK.eleves.trouver(id) && AK.store.etat.corbeille.length === 1, cible.b));
  await oublierMdp(page);
  await page.click('#tr-donnees-corbeille tbody tr [data-action="donnees-corbeille-supprimer"]');
  await page.waitForSelector('dialog[open] #cf-saisie');
  await dlg(page).locator('#cf-saisie').fill('SUPP');
  await valider(page);
  ok('Corbeille : suppression définitive exige le mot tapé', (await enErreur(page, 'saisie')) && (await P(page, () => AK.store.etat.corbeille.length)) === 1);
  await dlg(page).locator('#cf-saisie').fill('supprimer');
  await valider(page);
  await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(400);
  ok('Corbeille : suppression définitive après mot de passe', (await P(page, () => AK.store.etat.corbeille.length)) === 0 && /La corbeille est vide/.test(await page.textContent('#contenu')));
  ok('Corbeille : suppression tracée au journal', await P(page, () => AK.store.etat.pro.journal.some((e) => /^Supprimé définitivement de la corbeille/.test(e.m))));
  // membre du personnel : retiré puis restauré
  await P(page, () => AK.personnel.retirer(AK.store.etat.teachers.find((x) => x.nom === 'M. GNAHORE Bertin').id));
  await page.waitForTimeout(250);
  ok('Corbeille : membre du personnel listé avec son type', (await page.locator('#tr-donnees-corbeille tbody tr', { hasText: 'Personnel' }).count()) === 1);
  await page.click('#tr-donnees-corbeille tbody tr [data-action="donnees-corbeille-restaurer"]');
  await page.waitForSelector('dialog[open]');
  ok('Corbeille : avertissement sur les classes reprises par d’autres', /ne lui sont rendues que si personne/.test(await dlg(page).textContent()));
  await valider(page);
  ok('Corbeille : membre restauré', await P(page, () => AK.store.etat.teachers.some((x) => x.nom === 'M. GNAHORE Bertin')));
  // vider la corbeille : confirmation tapée, mot de passe, copie préalable
  await P(page, () => { AK.eleves.supprimer(AK.calc.actifsDe('CP2')[0].id); AK.eleves.supprimer(AK.calc.actifsDe('CP2')[1].id); });
  await page.waitForTimeout(250);
  await oublierMdp(page);
  await page.click('[data-action="donnees-corbeille-vider"]');
  await page.waitForSelector('dialog[open] #cf-saisie');
  ok('Corbeille : vidage annoncé (nombre, copie préalable, irréversible)', /2 éléments seront supprimés/.test(await dlg(page).textContent()) && /copie de sécurité locale/.test(await dlg(page).textContent()));
  await dlg(page).locator('#cf-saisie').fill('VIDER');
  await valider(page);
  await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(600);
  ok('Corbeille : vidée, copie « avant vidage » faite, journal', await P(page, async () => AK.store.etat.corbeille.length === 0 && (await AK.sauvegarde.copies()).some((c) => c.motif === 'avant-vidage-corbeille') && AK.store.etat.pro.journal.some((e) => /^Corbeille vidée : 2 éléments supprimés/.test(e.m))));
  ok('Aucune impression déclenchée par ces écrans', (await P(page, () => window.__impressions || 0)) === 0);

  /* ======================= Droits d'un enseignant ======================= */
  const login = await P(page, () => AK.store.etat.teachers.find((x) => x.compte && x.compte.actif).compte.login);
  await P(page, () => AK.app.deconnecter());
  await connecter(page, 'Classe2026', login);
  ok('Enseignant connecté', await P(page, () => AK.session.estEnseignant()));
  ok('Enseignant : section Données absente du menu', await P(page, () => ![...document.querySelectorAll('#side a')].some((a) => /^#donnees/.test(a.getAttribute('href') || ''))));
  for (const r of ['donnees/sauvegarde', 'donnees/export', 'donnees/journal', 'donnees/corbeille']) {
    await aller(page, r);
    ok(`Enseignant : ${r} inaccessible`, (await P(page, () => AK.shell.routeCourante())) !== r);
  }
  ok('Enseignant : fonctions métier refusées (copie, export, corbeille, sauvegarde, restauration)', await P(page, async () => {
    const refus = async (f) => { try { await f(); return false; } catch (e) { return e.name === 'ErreurDroits'; } };
    return (await refus(() => AK.donnees.copieManuelle())) && (await refus(() => AK.donnees.exporter('notes', {}))) && (await refus(() => AK.donnees.exporter('personnel', {})))
      && (await refus(() => AK.donnees.viderCorbeille(['x']))) && (await refus(() => AK.sauvegarde.exporter())) && (await refus(() => AK.sauvegarde.restaurer({ valide: true, etat: {} })))
      && (await refus(() => AK.donnees.controler())) && (await refus(() => AK.imports.rattacher({})));
  }));
  ok('Aucune erreur JavaScript (bureau)', erreurs.length === 0, erreurs.join(' | '));
  await navigateur.close();

  /* ======================= Téléphone 390 × 844, thème sombre ======================= */
  const m = await ouvrir({ largeur: 390, hauteur: 844 });
  await demo(m.page);
  await P(m.page, () => { AK.eleves.supprimer(AK.calc.actifsDe('CE1')[0].id); });
  const deb = [];
  for (const r of ['donnees/sauvegarde', 'donnees/export', 'donnees/journal', 'donnees/corbeille']) {
    await aller(m.page, r);
    await m.page.waitForTimeout(700);
    const d = await depassements(m.page);
    if (d.length) deb.push(`${r} : ${d.join(', ')}`);
  }
  ok('Téléphone : aucun débordement horizontal sur les 4 écrans', deb.length === 0, deb.join(' ; '));
  await aller(m.page, 'donnees/sauvegarde');
  await m.page.waitForTimeout(500);
  await m.page.setInputFiles('#donnees-f-restaurer', fichier(sauv.nom, sauv.texte));
  await m.page.waitForSelector('dialog[open] #donnees-saisie');
  ok('Téléphone : aperçu de restauration contenu dans l’écran', await P(m.page, () => { const d = document.querySelector('dialog[open]'), r = d.getBoundingClientRect(), c = d.querySelector('.dlg-corps'); return r.left >= 0 && r.right <= innerWidth && c.scrollWidth <= c.clientWidth + 1; }));
  await m.page.keyboard.press('Escape');
  await m.page.waitForTimeout(200);
  await P(m.page, () => { AK.store.etat.school.theme = 'dark'; AK.ui.appliquerTheme(); });
  for (const r of ['donnees/sauvegarde', 'donnees/export', 'donnees/journal', 'donnees/corbeille']) {
    await aller(m.page, r);
    await m.page.waitForTimeout(300);
  }
  ok('Thème sombre : cartes sur fond sombre', await P(m.page, () => { const c = getComputedStyle(document.querySelector('#contenu .carte, #contenu .tab-cadre')).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 300; }));
  ok('Aucune erreur JavaScript (téléphone)', m.erreurs.length === 0, m.erreurs.join(' | '));
  await m.navigateur.close();

  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
