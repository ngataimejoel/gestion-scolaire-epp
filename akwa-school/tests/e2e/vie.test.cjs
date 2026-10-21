/* Vie scolaire (école de démonstration) : emploi du temps, cahier de textes, discipline,
   infirmerie et calendrier, par l'interface : création, modification, suppression et
   annulation, recherche, filtres, impression (window.print remplacé par un compteur),
   export .ics, cas limites (champs vides, valeurs invalides, accents, textes longs,
   balises, doublons), droits d'un enseignant (sa classe seulement, pas de suppression),
   largeur de téléphone (390 × 844), thème sombre et absence d'erreur JavaScript. */
const { ouvrir, demo, aller, confirmerMdp, fs } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const dlg = (page) => page.locator('dialog[open]').last();
const valider = async (page) => {
  await dlg(page).locator('[type=submit]').click();
  await page.waitForTimeout(200);
};
/** Le champ « nom » de la fenêtre du dessus est signalé en erreur (message sous le champ). */
const enErreur = (page, nom) => page.evaluate((n) => {
  const d = [...document.querySelectorAll('dialog[open]')].pop();
  const el = d && d.querySelector(`[name="${n}"]`);
  return !!el && el.getAttribute('aria-invalid') === 'true' && !!(el.closest('.champ') || el.parentElement).querySelector('.erreur-champ');
}, nom);
const nbDialogues = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').length);
const annulerToast = async (page) => {
  await page.locator('.toast .act', { hasText: 'Annuler' }).last().click();
  await page.waitForTimeout(200);
};
const P = (page, f, a) => page.evaluate(f, a);
const impressions = (page) => page.evaluate(() => window.__impressions || 0);
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.addInitScript(() => { window.print = () => { window.__impressions = (window.__impressions || 0) + 1; }; });
  await demo(page);
  const auj = await P(page, () => AK.u.aujourdhui());
  const ids = await P(page, () => {
    const X = AK.calc, S = AK.store.etat;
    return {
      ce1: X.actifsDe('CE1').sort(X.parNom).map((s) => s.id),
      cp1: X.actifsDe('CP1').sort(X.parNom).map((s) => s.id),
      allergique: (S.students.find((s) => s.allergies) || {}).id,
      classeAllergique: (S.students.find((s) => s.allergies) || {}).classe,
      nomCe1: X.nomComplet(X.actifsDe('CE1').sort(X.parNom)[0]),
      loginCe1: S.teachers.find((t) => X.clsDe(t).includes('CE1')).compte.login
    };
  });

  /* ======================= Emploi du temps ======================= */
  await aller(page, 'vie/edt?classe=CE1');
  ok('EDT : 28 cases (4 jours × 7 créneaux)', (await page.locator('#contenu .tab.edt select').count()) === 28);
  ok('EDT : chaque case a un libellé accessible', await P(page, () => [...document.querySelectorAll('#contenu .tab.edt select')].every((s) => /^(Lundi|Mardi|Jeudi|Vendredi), \d/.test(s.getAttribute('aria-label')))));
  await page.selectOption('#edt-1-0', 'MATHEMATIQUES');
  await page.waitForTimeout(250);
  ok('EDT : case enregistrée aussitôt', (await P(page, () => AK.store.etat.pro.edt.CE1['1|0'])) === 'MATHEMATIQUES');
  ok('EDT : case remplie mise en évidence et focus conservé', await P(page, () => document.querySelector('#edt-1-0').classList.contains('plein') && document.activeElement.id === 'edt-1-0'));
  ok('EDT : compteur et volume horaire à jour', /1 créneau/.test(await page.textContent('#vie-edt-compte')) && /MATHEMATIQUES[\s\S]*1 h/.test(await page.textContent('#contenu .carte')));
  // « Autre discipline… » : vide refusé, accents conservés, 40 caractères au plus
  await page.selectOption('#edt-2-1', '__autre__');
  await page.waitForSelector('dialog[open] #vie-edt-autre');
  await valider(page);
  ok('EDT autre : saisie vide refusée sous le champ', await enErreur(page, 'lib'));
  await dlg(page).locator('#vie-edt-autre').fill('Lecture silencieuse – éveil à l’été');
  await valider(page);
  ok('EDT autre : discipline libre enregistrée (majuscules, accents)', (await P(page, () => AK.store.etat.pro.edt.CE1['2|1'])) === 'LECTURE SILENCIEUSE – ÉVEIL À L’ÉTÉ');
  await page.selectOption('#edt-4-3', '__autre__');
  await page.waitForSelector('dialog[open] #vie-edt-autre');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('EDT autre : abandon sans effet (case restée vide)', (await P(page, () => AK.store.etat.pro.edt.CE1['4|3'])) === undefined && (await page.inputValue('#edt-4-3')) === '');
  // emploi du temps type : confirmation (grille non vide) puis annulation
  await page.click('[data-action="vie-edt-type"]');
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await page.waitForTimeout(250);
  ok('EDT type : grille complète (28 cases)', (await P(page, () => Object.keys(AK.store.etat.pro.edt.CE1).length)) === 28);
  await annulerToast(page);
  ok('EDT type annulé : grille d’origine rétablie', await P(page, () => { const G = AK.store.etat.pro.edt.CE1; return Object.keys(G).length === 2 && G['1|0'] === 'MATHEMATIQUES'; }));
  await page.click('[data-action="vie-edt-vider"]');
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await page.waitForTimeout(250);
  ok('EDT vider : grille vide', (await P(page, () => Object.keys(AK.store.etat.pro.edt.CE1).length)) === 0);
  await annulerToast(page);
  ok('EDT vider annulé : 2 cases rétablies', (await P(page, () => Object.keys(AK.store.etat.pro.edt.CE1).length)) === 2);
  // impression (modèle « emploi-du-temps »)
  await page.click('[data-action="vie-edt-imprimer"]');
  await page.waitForSelector('dialog[open] .feuille');
  ok('EDT impression : aperçu du modèle avec la grille', await P(page, () => { const t = document.querySelector('dialog[open] .feuille').textContent; return /EMPLOI DU TEMPS – CE1/.test(t) && /LECTURE SILENCIEUSE/.test(t); }));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(500);
  ok('EDT impression déclenchée', (await impressions(page)) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('[data-action="vie-edt-imprimer-tout"]');
  await page.waitForSelector('dialog[open] .feuille');
  ok('EDT : une page par classe ouverte', (await page.locator('dialog[open] .feuille').count()) === 6);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ======================= Cahier de textes ======================= */
  await aller(page, 'vie/cahier?classe=CE1');
  ok('Cahier : état vide explicite, pas de bouton d’impression inutile', /Cahier vide/.test(await page.textContent('#contenu')) && (await page.locator('[data-action="vie-cahier-imprimer"]').count()) === 0);
  await page.click('#contenu .page-tete [data-action="vie-seance-nouvelle"]');
  await page.waitForSelector('dialog[open] #vie-s-contenu');
  await valider(page);
  ok('Cahier : discipline obligatoire (erreur sous le champ)', await enErreur(page, 'mat'));
  await dlg(page).locator('[name=mat]').selectOption('MATHEMATIQUES');
  await valider(page);
  ok('Cahier : contenu obligatoire, saisie conservée', (await enErreur(page, 'contenu')) && (await dlg(page).locator('[name=mat]').inputValue()) === 'MATHEMATIQUES');
  await P(page, () => { const z = [...document.querySelectorAll('dialog[open]')].pop().querySelector('[name=contenu]'); z.removeAttribute('maxlength'); z.value = 'x'.repeat(1001); });
  await valider(page);
  ok('Cahier : contenu de plus de 1 000 caractères refusé', await enErreur(page, 'contenu'));
  const contenu1 = 'Leçon : « L’été à Ouaninou » — accents éèàùç. <script>alert(1)</script>';
  await dlg(page).locator('[name=contenu]').fill(contenu1);
  await dlg(page).locator('[name=travail]').fill('Apprendre la table de 7 ; exercices 1 à 4');
  await valider(page);
  ok('Cahier : séance consignée', (await P(page, () => AK.store.etat.pro.cahier.length)) === 1 && (await nbDialogues(page)) === 0);
  ok('Cahier : texte affiché tel quel (balises échappées, accents)', await P(page, (t) => !document.querySelector('#contenu tbody script') && document.querySelector('#contenu tbody').textContent.includes(t), contenu1));
  // doublon : même classe, même date, même discipline → confirmation, on revient à la saisie
  await page.click('#contenu .page-tete [data-action="vie-seance-nouvelle"]');
  await page.waitForSelector('dialog[open] #vie-s-contenu');
  await dlg(page).locator('[name=mat]').selectOption('MATHEMATIQUES');
  await dlg(page).locator('[name=contenu]').fill('Deuxième séance le même jour');
  await valider(page);
  ok('Cahier : doublon signalé avant enregistrement', /déjà consignée/.test(await dlg(page).textContent()));
  await dlg(page).locator('[data-fermer]', { hasText: 'Revenir' }).click();
  await page.waitForTimeout(200);
  ok('Cahier : retour à la saisie sans perte', (await nbDialogues(page)) === 1 && (await dlg(page).locator('[name=contenu]').inputValue()) === 'Deuxième séance le même jour');
  // séance ancienne (filtre de période) puis modification
  await dlg(page).locator('[name=date]').fill(await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), -45)));
  await dlg(page).locator('[name=mat]').selectOption('DICTEE');
  await dlg(page).locator('[name=contenu]').fill('Dictée préparée : « Le marché »');
  await valider(page);
  ok('Cahier : deuxième séance (ancienne) consignée', (await P(page, () => AK.store.etat.pro.cahier.length)) === 2);
  await page.selectOption('#contenu [data-f="per"]', 'semaine');
  await page.waitForTimeout(200);
  ok('Cahier : filtre « Cette semaine »', (await page.locator('#contenu tbody tr').count()) === 1 && /1 sur 2/.test(await page.textContent('#contenu .compte-res')));
  await page.selectOption('#contenu [data-f="per"]', 'perso');
  await page.waitForTimeout(200);
  await page.fill('#vie-cahier-du', auj);
  await page.dispatchEvent('#vie-cahier-du', 'change');
  await page.waitForTimeout(200);
  await page.fill('#vie-cahier-au', await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), -1)));
  await page.dispatchEvent('#vie-cahier-au', 'change');
  await page.waitForTimeout(200);
  ok('Cahier : période incohérente signalée', /date de fin est avant/.test(await page.textContent('#contenu')));
  await page.selectOption('#contenu [data-f="per"]', '');
  await page.waitForTimeout(200);
  await page.fill('#contenu [data-input="tab-q"]', 'marche');
  await page.waitForTimeout(300);
  ok('Cahier : recherche sans accents ni casse', (await page.locator('#contenu tbody tr').count()) === 1 && /Dictée préparée/.test(await page.textContent('#contenu tbody')));
  await page.fill('#contenu [data-input="tab-q"]', '');
  await page.waitForTimeout(300);
  const idDictee = await P(page, () => AK.store.etat.pro.cahier.find((x) => x.mat === 'DICTEE').id);
  await page.click(`[data-action="vie-seance-modifier"][data-id="${idDictee}"]`);
  await page.waitForSelector('dialog[open] #vie-s-contenu');
  await dlg(page).locator('[name=travail]').fill('Revoir les mots invariables');
  await valider(page);
  ok('Cahier : séance modifiée', (await P(page, (id) => AK.store.etat.pro.cahier.find((x) => x.id === id).travail, idDictee)) === 'Revoir les mots invariables');
  // texte très long sans espace : pas de débordement de la page
  await P(page, () => AK.pro.seance({ classe: 'CE1', date: AK.u.ajouterJours(AK.u.aujourdhui(), -2), mat: 'EVEIL AU MILIEU', contenu: 'a'.repeat(1000), travail: 'b'.repeat(300) }));
  await page.waitForTimeout(200);
  ok('Cahier : texte de 1 000 caractères sans espace contenu dans la page', (await debordement(page)) <= 0);
  // impression du cahier
  await page.click('[data-action="vie-cahier-imprimer"]');
  await page.waitForSelector('dialog[open] .feuille');
  ok('Cahier : aperçu du cahier de textes (toutes les séances)', await P(page, () => { const t = [...document.querySelectorAll('dialog[open] .feuille')].map((f) => f.textContent).join(' '); return /CAHIER DE TEXTES – CE1/.test(t) && /Dictée préparée/.test(t) && /L’été à Ouaninou/.test(t); }));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(500);
  ok('Cahier : impression déclenchée', (await impressions(page)) === 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // suppression puis annulation
  await page.click(`[data-action="vie-seance-supprimer"][data-id="${idDictee}"]`);
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await page.waitForTimeout(250);
  ok('Cahier : séance supprimée après confirmation', (await P(page, () => AK.store.etat.pro.cahier.length)) === 2);
  await annulerToast(page);
  ok('Cahier : suppression annulée (séance rétablie)', (await P(page, () => AK.store.etat.pro.cahier.some((x) => x.mat === 'DICTEE' && x.travail === 'Revoir les mots invariables'))));

  /* ======================= Discipline ======================= */
  await aller(page, 'vie/discipline');
  await page.click('#contenu .page-tete [data-action="vie-incident-nouveau"]');
  await page.waitForSelector('dialog[open] #vie-f-sid');
  await valider(page);
  ok('Discipline : élève obligatoire', await enErreur(page, 'sid'));
  await dlg(page).locator('[name=classe]').selectOption('CE1');
  ok('Discipline : liste des élèves limitée à la classe choisie', await P(page, (n) => { const o = [...[...document.querySelectorAll('dialog[open]')].pop().querySelectorAll('[name=sid] option')].filter((x) => x.value); return o.length === n; }, ids.ce1.length));
  await dlg(page).locator('[name=sid]').selectOption(ids.ce1[0]);
  await dlg(page).locator('[name=fait]').selectOption('Autre');
  await valider(page);
  ok('Discipline : « Autre » exige une précision', await enErreur(page, 'detail'));
  await dlg(page).locator('[name=fait]').selectOption('Bagarre dans la cour');
  await dlg(page).locator('[name=detail]').fill('Pendant la récréation, près du préau');
  await dlg(page).locator('[name=sanction]').selectOption('Convocation des parents');
  await dlg(page).locator('[name=date]').fill(await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), 1)));
  await valider(page);
  ok('Discipline : date future refusée', await enErreur(page, 'date'));
  await dlg(page).locator('[name=date]').fill(auj);
  await valider(page);
  ok('Discipline : fait enregistré (3 points, en cours)', await P(page, () => { const x = AK.store.etat.pro.incidents[0]; return AK.store.etat.pro.incidents.length === 1 && x.pts === 3 && x.statut === 'En cours'; }));
  await page.locator('.toast .act', { hasText: 'Imprimer la convocation' }).last().click();
  await page.waitForSelector('dialog[open] .feuille');
  ok('Discipline : convocation des parents (élève, motif, mesure)', await P(page, (nom) => { const t = document.querySelector('dialog[open] .feuille').textContent; return /CONVOCATION DES PARENTS/.test(t) && t.includes(nom) && /Bagarre dans la cour/.test(t) && /Convocation des parents/.test(t); }, ids.nomCe1));
  await page.click('dialog[open] [data-imprimer]');
  await page.waitForTimeout(500);
  ok('Discipline : impression de la convocation', (await impressions(page)) === 3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // doublon accepté explicitement
  await page.click('#contenu .page-tete [data-action="vie-incident-nouveau"]');
  await page.waitForSelector('dialog[open] #vie-f-sid');
  await dlg(page).locator('[name=classe]').selectOption('CE1');
  await dlg(page).locator('[name=sid]').selectOption(ids.ce1[0]);
  await dlg(page).locator('[name=fait]').selectOption('Bagarre dans la cour');
  await valider(page);
  ok('Discipline : doublon signalé', /déjà enregistré/.test(await dlg(page).textContent()));
  await dlg(page).locator('[type=submit]').click();
  await page.waitForTimeout(250);
  ok('Discipline : doublon enregistré sur confirmation', (await P(page, () => AK.store.etat.pro.incidents.length)) === 2 && (await nbDialogues(page)) === 0);
  await P(page, (sid) => AK.pro.incident({ sid, date: AK.u.aujourdhui(), fait: 'Bavardage en classe', detail: '', sanction: 'Avertissement oral', statut: 'En cours' }), ids.cp1[0]);
  await page.waitForTimeout(200);
  ok('Discipline : élèves à suivre (6 points cumulés en tête)', await P(page, (nom) => { const c = document.querySelector('#contenu .vie-suivi'); return !!c && c.firstElementChild.textContent.includes(nom) && /6\s*points/.test(c.firstElementChild.textContent); }, ids.nomCe1));
  ok('Discipline : indicateurs (3 en cours, 2 convocations)', await P(page, () => { const k = [...document.querySelectorAll('#contenu .kpi')].map((x) => x.querySelector('.kpi-v').textContent); return k[1] === '3' && k[2] === '2'; }));
  ok('Discipline : nombre de faits en cours sur l’onglet', /Discipline\s*3/.test(await page.textContent('#contenu .onglets')));
  const idInc = await P(page, () => AK.store.etat.pro.incidents[0].id);
  await page.click(`[data-action="vie-incident-clore"][data-id="${idInc}"]`);
  await page.waitForTimeout(200);
  ok('Discipline : fait clos', (await P(page, (id) => AK.store.etat.pro.incidents.find((x) => x.id === id).statut, idInc)) === 'Traité');
  await annulerToast(page);
  ok('Discipline : clôture annulée (de nouveau en cours)', (await P(page, (id) => AK.store.etat.pro.incidents.find((x) => x.id === id).statut, idInc)) === 'En cours');
  await page.click(`[data-action="vie-incident-clore"][data-id="${idInc}"]`);
  await page.waitForTimeout(200);
  await page.selectOption('#contenu [data-f="statut"]', 'Traité');
  await page.waitForTimeout(200);
  ok('Discipline : filtre par statut', (await page.locator('#contenu tbody tr').count()) === 1);
  await page.click(`[data-action="vie-incident-rouvrir"][data-id="${idInc}"]`);
  await page.waitForTimeout(200);
  ok('Discipline : fait rouvert', (await P(page, (id) => AK.store.etat.pro.incidents.find((x) => x.id === id).statut, idInc)) === 'En cours');
  await aller(page, 'vie/discipline');
  await page.fill('#contenu [data-input="tab-q"]', 'bavardage');
  await page.waitForTimeout(300);
  ok('Discipline : recherche', (await page.locator('#contenu tbody tr').count()) === 1);
  await page.fill('#contenu [data-input="tab-q"]', '');
  await page.waitForTimeout(300);
  await page.click(`[data-action="vie-incident-supprimer"][data-id="${idInc}"]`);
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(300);
  ok('Discipline : suppression (confirmation + mot de passe du directeur)', (await P(page, (id) => !AK.store.etat.pro.incidents.some((x) => x.id === id), idInc)) && (await P(page, () => AK.store.etat.pro.incidents.length)) === 2);
  await annulerToast(page);
  ok('Discipline : suppression annulée (fait rétabli)', (await P(page, () => AK.store.etat.pro.incidents.length)) === 3);

  /* ======================= Infirmerie ======================= */
  await aller(page, 'vie/sante');
  ok('Infirmerie : avertissement de confidentialité', /Données de santé confidentielles/.test(await page.textContent('#contenu')));
  ok('Infirmerie : pas d’export des données de santé', (await page.locator('#contenu [data-action="tab-csv"]').count()) === 0);
  ok('Infirmerie : allergies issues des fiches', /Asthme/.test(await page.textContent('#contenu')));
  await page.click('#contenu .page-tete [data-action="vie-soin-nouveau"]');
  await page.waitForSelector('dialog[open] #vie-f-sid');
  await dlg(page).locator('[name=classe]').selectOption(ids.classeAllergique);
  await dlg(page).locator('[name=sid]').selectOption(ids.allergique);
  await page.waitForTimeout(100);
  ok('Infirmerie : allergie et contact du parent rappelés à la saisie', /Allergies : Asthme/.test(await dlg(page).locator('#vie-soin-info').textContent()) && (await dlg(page).locator('#vie-soin-info a[href^="tel:"]').count()) === 1);
  await valider(page);
  ok('Infirmerie : motif obligatoire', await enErreur(page, 'motif'));
  await dlg(page).locator('[name=motif]').selectOption('Fièvre');
  await dlg(page).locator('[name=suite]').selectOption('Parents prévenus');
  await dlg(page).locator('[name=soin]').fill('Repos à l’ombre, eau fraîche ; appel à la mère');
  await dlg(page).locator('[name=heure]').fill('10:15');
  await valider(page);
  ok('Infirmerie : passage enregistré', await P(page, () => AK.store.etat.pro.soins.length === 1 && AK.store.etat.pro.soins[0].heure === '10:15'));
  ok('Infirmerie : journal sans nom ni motif médical', await P(page, (sid) => { const s = AK.eleves.trouver(sid); const j = AK.store.etat.pro.journal.find((x) => /Infirmerie/.test(x.m)).m; return !j.includes(s.nom) && !/Fièvre/.test(j); }, ids.allergique));
  ok('Infirmerie : ligne affichée (heure, suite)', /10 h 15/.test(await page.textContent('#contenu tbody')) && /Parents prévenus/.test(await page.textContent('#contenu tbody')));
  const idSoin = await P(page, () => AK.store.etat.pro.soins[0].id);
  await page.click(`[data-action="vie-soin-supprimer"][data-id="${idSoin}"]`);
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await page.waitForTimeout(300);
  if (await page.$('dialog[open] #mdp-admin')) await confirmerMdp(page, 'Demo2026');
  await page.waitForTimeout(300);
  ok('Infirmerie : passage supprimé', (await P(page, () => AK.store.etat.pro.soins.length)) === 0);
  await annulerToast(page);
  ok('Infirmerie : suppression annulée', (await P(page, () => AK.store.etat.pro.soins.length)) === 1);
  await P(page, (sid) => AK.pro.soin({ sid, date: AK.u.aujourdhui(), heure: '09:00', motif: 'Toux', suite: 'Retour en classe', soin: '' }), ids.cp1[1]);

  /* ======================= Calendrier ======================= */
  await aller(page, 'vie/calendrier');
  ok('Calendrier : mois courant, aujourd’hui repéré', (await page.locator('#contenu .cal-j.auj').count()) === 1);
  await page.click(`#contenu .vie-jour[data-date="${auj}"]`);
  await page.waitForSelector('dialog[open] #vie-e-titre');
  ok('Calendrier : date du jour cliqué reprise', (await dlg(page).locator('[name=date]').inputValue()) === auj);
  await valider(page);
  ok('Calendrier : intitulé obligatoire', await enErreur(page, 'titre'));
  await dlg(page).locator('[name=type]').selectOption('g');
  ok('Calendrier : congé saisi ici = simple information (renvoi vers Paramètres)', await dlg(page).locator('[data-vie-aide-conge]').isVisible());
  await dlg(page).locator('[name=type]').selectOption('acc');
  await dlg(page).locator('[name=titre]').fill('Fête de l’école « Kermesse » & remise des prix');
  await valider(page);
  ok('Calendrier : événement ajouté', (await P(page, () => AK.store.etat.pro.events.length)) === 1);
  ok('Calendrier : visible dans la case et dans « À venir »', await P(page, (d) => { const c = document.querySelector(`.vie-jour[data-date="${d}"]`).closest('.cal-j'); return /Kermesse/.test(c.textContent) && /Kermesse/.test(document.querySelectorAll('#contenu .carte')[1].textContent); }, auj));
  await page.click('#contenu .page-tete [data-action="vie-ev-nouveau"]');
  await page.waitForSelector('dialog[open] #vie-e-titre');
  await dlg(page).locator('[name=titre]').fill('fete de l’ecole « KERMESSE » & remise des prix');
  await valider(page);
  ok('Calendrier : doublon détecté (casse et accents ignorés)', /figure déjà/.test(await dlg(page).textContent()));
  await dlg(page).locator('[data-fermer]', { hasText: 'Revenir' }).click();
  await page.waitForTimeout(150);
  const loin = await P(page, () => AK.u.ajouterJours(AK.u.aujourdhui(), 70));
  await dlg(page).locator('[name=date]').fill(loin);
  await dlg(page).locator('[name=type]').selectOption('b');
  await dlg(page).locator('[name=titre]').fill('Visite de l’inspecteur');
  await valider(page);
  ok('Calendrier : la vue suit le mois de l’événement ajouté', (await P(page, () => AK.shell.params().mois)) === loin.slice(0, 7) && /Visite de l’inspecteur/.test(await page.textContent('#contenu .cal')));
  await page.click('#contenu [data-action="vie-cal-mois"]:has-text("Aujourd’hui")');
  await page.waitForTimeout(200);
  ok('Calendrier : retour au mois courant', (await page.locator('#contenu .cal-j.auj').count()) === 1);
  await page.click('#contenu [data-action="vie-cal-mois"][aria-label="Mois suivant"]');
  await page.waitForTimeout(200);
  ok('Calendrier : mois suivant', (await page.locator('#contenu .cal-j.auj').count()) === 0);
  // modification par le menu de l'événement
  const idEv = await P(page, () => AK.store.etat.pro.events.find((e) => /Kermesse/.test(e.titre)).id);
  await aller(page, 'vie/calendrier?vue=liste');
  ok('Calendrier liste : événements, congés et évaluations', await P(page, () => { const t = document.querySelector('#contenu tbody').textContent; return /Kermesse/.test(t) && /Toussaint/.test(t) && /1re composition/.test(t); }));
  await page.selectOption('#contenu [data-f="type"]', 'w');
  await page.waitForTimeout(200);
  ok('Calendrier liste : filtre par type (évaluations)', await P(page, () => [...document.querySelectorAll('#contenu tbody tr')].every((tr) => /Évaluation/.test(tr.textContent))));
  await page.selectOption('#contenu [data-f="type"]', '');
  await page.waitForTimeout(200);
  await page.click(`#contenu [data-action="vie-ev-menu"][data-id="${idEv}"]`);
  await page.click('.menu button:has-text("Modifier")');
  await page.waitForSelector('dialog[open] #vie-e-titre');
  await dlg(page).locator('[name=titre]').fill('Kermesse de fin de trimestre');
  await valider(page);
  ok('Calendrier : événement modifié', (await P(page, (id) => AK.store.etat.pro.events.find((e) => e.id === id).titre, idEv)) === 'Kermesse de fin de trimestre');
  await page.click(`#contenu [data-action="vie-ev-menu"][data-id="${idEv}"]`);
  await page.click('.menu button:has-text("Supprimer")');
  await page.waitForSelector('dialog[open] .btn-dng-plein');
  await dlg(page).locator('.btn-dng-plein').click();
  await page.waitForTimeout(250);
  ok('Calendrier : événement supprimé', (await P(page, () => AK.store.etat.pro.events.length)) === 1);
  await annulerToast(page);
  ok('Calendrier : suppression annulée', (await P(page, () => AK.store.etat.pro.events.some((e) => e.titre === 'Kermesse de fin de trimestre'))));
  // export iCalendar
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="vie-cal-ics"]')]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  const lignes = ics.split('\r\n').filter(Boolean);
  ok('Export .ics : fichier iCalendar valide', /^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics) && (ics.match(/BEGIN:VEVENT/g) || []).length === (ics.match(/END:VEVENT/g) || []).length && /\.ics$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('Export .ics : textes échappés, lignes ≤ 75 octets', /SUMMARY:Kermesse de fin de trimestre/.test(ics) && /DTSTART;VALUE=DATE:\d{8}/.test(ics) && lignes.every((l) => Buffer.byteLength(l, 'utf8') <= 75));

  /* ======================= Enseignant (sa classe seulement) ======================= */
  await page.evaluate(() => AK.app.deconnecter());
  await page.waitForSelector('.ep-profil');
  await page.click(`.ep-profil[data-v="${ids.loginCe1}"]`);
  await page.fill('#ep-mdp', 'Classe2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu h1');
  await page.waitForTimeout(300);
  if (await page.$('dialog[open]')) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  ok('Enseignant connecté', await P(page, () => AK.session.estEnseignant() && AK.session.classes().join() === 'CE1'));
  await aller(page, 'vie/edt');
  ok('Enseignant EDT : sa classe seulement', await P(page, () => [...document.querySelectorAll('#contenu .pilule')].map((b) => b.textContent.trim()).join() === 'CE1'));
  await page.selectOption('#edt-5-6', 'EPS');
  await page.waitForTimeout(200);
  ok('Enseignant EDT : saisie dans sa classe', (await P(page, () => AK.store.etat.pro.edt.CE1['5|6'])) === 'EPS');
  ok('Enseignant EDT : autre classe refusée par la fonction métier', await P(page, () => { try { AK.pro.caseEdt('CP1', '1|0', 'X'); return false; } catch (e) { return e.name === 'ErreurDroits'; } }));
  await aller(page, 'vie/cahier');
  ok('Enseignant cahier : séances de sa classe, sans export', (await page.locator('#contenu tbody tr').count()) === 3 && (await page.locator('#contenu [data-action="tab-csv"]').count()) === 0);
  await aller(page, 'vie/discipline');
  ok('Enseignant discipline : faits de sa classe seulement', await P(page, () => document.querySelectorAll('#contenu tbody tr').length === 2 && !/Bavardage/.test(document.querySelector('#contenu tbody').textContent)));
  ok('Enseignant discipline : pas de bouton de suppression', (await page.locator('[data-action="vie-incident-supprimer"]').count()) === 0);
  ok('Enseignant discipline : suppression refusée par la fonction métier', await P(page, () => { try { AK.pro.supprimerIncident(AK.store.etat.pro.incidents[0].id); return false; } catch (e) { return e.name === 'ErreurDroits'; } }));
  ok('Enseignant discipline : élève d’une autre classe refusé', await P(page, (sid) => { try { AK.pro.incident({ sid, date: AK.u.aujourdhui(), fait: 'Tricherie', sanction: 'Avertissement oral' }); return false; } catch (e) { return /pas dans votre classe/.test(e.message); } }, ids.cp1[0]));
  await page.click('#contenu .page-tete [data-action="vie-incident-nouveau"]');
  await page.waitForSelector('dialog[open] #vie-f-sid');
  ok('Enseignant discipline : formulaire limité à ses élèves', await P(page, (n) => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d.querySelectorAll('[name=classe] option').length === 1 && [...d.querySelectorAll('[name=sid] option')].filter((o) => o.value).length === n; }, ids.ce1.length));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await aller(page, 'vie/sante');
  ok('Enseignant infirmerie : aucun passage d’une autre classe, aucune allergie d’une autre classe', await P(page, () => !document.querySelector('#contenu tbody .qui') && !/Asthme/.test(document.querySelector('#contenu').textContent)));
  ok('Enseignant infirmerie : pas de suppression', (await page.locator('[data-action="vie-soin-supprimer"]').count()) === 0);
  await aller(page, 'vie/calendrier');
  ok('Enseignant calendrier : consultation et ajout, ni modification ni suppression', (await page.locator('#contenu [data-action="vie-ev-menu"]').count()) === 0 && (await page.locator('#contenu .page-tete [data-action="vie-ev-nouveau"]').count()) === 1);
  ok('Enseignant calendrier : modification refusée par la fonction métier', await P(page, () => { try { AK.vie.modifierEvenement(AK.store.etat.pro.events[0].id, { date: AK.u.aujourdhui(), titre: 'x' }); return false; } catch (e) { return e.name === 'ErreurDroits'; } }));

  /* ======================= Thème sombre ======================= */
  await P(page, () => { AK.store.etat.school.theme = 'dark'; AK.ui.appliquerTheme(); });
  await page.waitForTimeout(150);
  ok('Thème sombre : cases du calendrier sur fond sombre', await P(page, () => { const c = getComputedStyle(document.querySelector('#contenu .cal-j:not(.hors)')).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] < 200; }));
  await P(page, () => { AK.store.etat.school.theme = 'auto'; AK.ui.appliquerTheme(); });

  ok('Aucune erreur JavaScript (bureau)', erreurs.length === 0, erreurs.join(' | '));
  await navigateur.close();

  /* ======================= Téléphone 390 × 844 ======================= */
  const m = await ouvrir({ largeur: 390, hauteur: 844 });
  await demo(m.page);
  await P(m.page, () => {
    const s = AK.calc.actifsDe('CE1')[0], auj = AK.u.aujourdhui();
    AK.pro.edtType('CE1');
    AK.pro.seance({ classe: 'CE1', date: auj, mat: 'DICTEE', contenu: 'Un texte assez long pour vérifier le retour à la ligne dans le tableau du cahier de textes.', travail: '' });
    AK.pro.incident({ sid: s.id, date: auj, fait: 'Tricherie', detail: '', sanction: 'Mot aux parents', statut: 'En cours' });
    AK.pro.soin({ sid: s.id, date: auj, heure: '11:00', motif: 'Maux de tête', suite: 'Retour en classe', soin: '' });
    AK.pro.evenement({ date: auj, type: 'acc', titre: 'Réunion des parents d’élèves de toutes les classes' });
  });
  const debords = [];
  for (const r of ['vie/edt?classe=CE1', 'vie/cahier?classe=CE1', 'vie/discipline', 'vie/sante', 'vie/calendrier', 'vie/calendrier?vue=liste']) {
    await aller(m.page, r);
    await m.page.waitForTimeout(200);
    const d = await debordement(m.page);
    if (d > 0) debords.push(`${r} : ${d} px`);
  }
  ok('Téléphone : aucun débordement horizontal sur les 5 écrans', debords.length === 0, debords.join(', '));
  await aller(m.page, 'vie/discipline');
  await m.page.click('#contenu .page-tete [data-action="vie-incident-nouveau"]');
  await m.page.waitForSelector('dialog[open] #vie-f-sid');
  ok('Téléphone : formulaire contenu dans l’écran', await P(m.page, () => { const r = document.querySelector('dialog[open]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && (await debordement(m.page)) <= 0);
  await m.page.keyboard.press('Escape');
  ok('Aucune erreur JavaScript (téléphone)', m.erreurs.length === 0, m.erreurs.join(' | '));
  await m.navigateur.close();

  for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom}${r.ok ? '' : ' → ' + r.detail}`);
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  process.exit(res.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('ARRÊT', e); for (const r of res) console.log(`${r.ok ? 'OK   ' : 'ÉCHEC'} ${r.nom} ${r.ok ? '' : r.detail}`); process.exit(2); });
