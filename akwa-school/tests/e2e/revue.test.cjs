/* Non-régression des défauts trouvés par la relecture contradictoire des écrans Élèves, Notes,
   Absences, Personnel et Documents (chaque vérification reprend le scénario qui échouait). */
const { ouvrir, demo, aller, URL } = require('./outils.cjs');
const res = [];
const ok = (nom, cond, detail = '') => res.push({ nom, ok: !!cond, detail });
const essai = async (page, f, arg) => page.evaluate(async ([src, a]) => {
  try { return { ok: await (0, eval)(src)(a) }; } catch (e) { return { err: e.name, msg: e.message, champ: e.champ }; }
}, [f.toString(), arg]);

async function enseignant(page) {
  await page.goto(URL);
  await page.waitForSelector('[data-ep="demo"]');
  await page.click('[data-ep="demo"]');
  await page.waitForSelector('.ep-profil');
  const v = await page.$$eval('.ep-profil', (L) => (L.find((b) => b.dataset.v) || {}).dataset.v);
  await page.click(`.ep-profil[data-v="${v}"]`);
  await page.fill('[name=mdp]', 'Classe2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
}

(async () => {
  /* ===================== Enseignant ===================== */
  {
    const { navigateur, page, erreurs } = await ouvrir();
    page.setDefaultTimeout(10000);
    await enseignant(page);
    const ctx = await page.evaluate(() => ({ c: AK.session.classes()[0], autre: AK.calc.niveaux().find((k) => !AK.session.classes().includes(k)) }));
    const r1 = await essai(page, (a) => AK.docs.ouvrir('classement', [{ classe: a, periode: 1 }]), ctx.autre);
    ok('enseignant : classement d’une autre classe refusé (modèle sans émission)', r1.err === 'ErreurDroits', JSON.stringify(r1));
    const r2 = await essai(page, (a) => AK.docs.ouvrir('bulletin', [{ eleve: AK.calc.actifsDe(a)[0], periode: 1 }], { apercu: true }), ctx.autre);
    ok('enseignant : aperçu du bulletin d’un élève d’une autre classe refusé', r2.err === 'ErreurDroits', JSON.stringify(r2));
    const r3 = await essai(page, () => AK.docs.ouvrir('registre-eleves', [{}]));
    ok('enseignant : registre de toute l’école refusé', r3.err === 'ErreurDroits', JSON.stringify(r3));
    const r4 = await essai(page, (c) => AK.docs.generer('liste-classe', [{ classe: c }]).then((g) => g.feuilles.length), ctx.c);
    ok('enseignant : liste de sa propre classe toujours produite', r4.ok >= 1, JSON.stringify(r4));
    await page.evaluate((a) => (location.hash = 'eleves/liste?classe=' + a), ctx.autre);
    await page.waitForTimeout(250);
    const liste = await page.evaluate(() => ({ bouton: !!document.querySelector('#contenu [data-action="doc-classe"]'), csv: !!document.querySelector('#contenu [data-action="tab-csv"]'), titre: document.querySelector('#contenu h1').textContent }));
    ok('adresse forcée vers une autre classe : ni titre de cette classe ni bouton d’impression', !liste.bouton && !/Classe de/.test(liste.titre), JSON.stringify(liste));
    ok('bouton « Excel (CSV) » absent pour l’enseignant (export refusé par le métier)', !liste.csv);
    const r5 = await essai(page, () => AK.registre.remplacer('AK-CSC-2026-000001-7', 'AK-CSC-2026-000002-5'));
    ok('enseignant : marquer un document comme remplacé est refusé', r5.err === 'ErreurDroits', JSON.stringify(r5));
    const r5b = await essai(page, () => AK.personnel.marquerLus(AK.store.etat.teachers.find((t) => t.id !== AK.session.agent().id).id));
    ok('enseignant : marquer lus les messages d’un collègue est refusé', r5b.err === 'ErreurDroits', JSON.stringify(r5b));

    // validation active : absence en attente, levée d'une absence du directeur refusée
    const abs = await page.evaluate((c) => {
      AK.store.etat.school.validation = true;
      const [a, b] = AK.calc.actifsDe(c).filter((s) => ![1, 2, 3, 4].some((n) => Object.keys(AK.store.etat.grades).some((k) => k.startsWith(s.id + '|3|'))));
      return { a: a && a.id, b: b && b.id };
    }, ctx.c);
    const r6 = await essai(page, (o) => { AK.notes.marquerAbsent(o.a, 3, true, { confirme: true }); return { compAbs: !!AK.store.etat.compAbs[o.a + '|3'], attente: AK.store.etat.attente[o.a + '|3|' + AK.notes.ABS] }; }, abs);
    ok('enseignant (validation active) : l’absence attend la validation, ne compte pas encore', r6.ok && !r6.ok.compAbs && r6.ok.attente === true, JSON.stringify(r6));
    const r7 = await essai(page, (o) => { AK.store.etat.compAbs[o.b + '|3'] = true; return AK.notes.marquerAbsent(o.b, 3, false, { confirme: true }); }, abs);
    ok('enseignant (validation active) : lever une absence enregistrée est refusé', r7.err === 'ErreurDroits', JSON.stringify(r7));

    // correction refusée : la case reprend la note validée
    await aller(page, 'notes/saisie?classe=' + ctx.c + '&ev=1');
    await page.waitForSelector('#grille-notes');
    const cel = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#grille-notes .note-in')].find((x) => x.value && !x.classList.contains('attente') && !x.disabled);
      return el ? { id: el.dataset.id, m: el.dataset.m, v: el.value } : null;
    });
    if (cel) {
      const sel = `#grille-notes .note-in[data-id="${cel.id}"][data-m="${cel.m}"]`;
      await page.fill(sel, '1');
      await page.press(sel, 'Tab');
      await page.waitForTimeout(200);
      ok('enseignant : correction refusée, la case reprend la note enregistrée', (await page.inputValue(sel)) === cel.v, await page.inputValue(sel));
    } else ok('enseignant : note validée trouvée pour l’essai de correction', false);
    // compteur : les notes en attente sont comptées
    await page.evaluate((c) => { AK.store.etat.saisie[c + '|3'] = { fermee: false, fin: '' }; }, ctx.c);
    await aller(page, 'notes/saisie?classe=' + ctx.c + '&ev=3');
    await page.waitForSelector('#grille-notes');
    const champ = await page.evaluate(() => { const el = [...document.querySelectorAll('#grille-notes .note-in')].find((x) => !x.value && !x.disabled); return el ? `#grille-notes .note-in[data-id="${el.dataset.id}"][data-m="${el.dataset.m}"]` : null; });
    const avant = await page.textContent('#notes-compte');
    await page.fill(champ, '4');
    await page.press(champ, 'Tab');
    await page.waitForTimeout(200);
    const apres = await page.textContent('#notes-compte');
    ok('compteur : une note en attente compte comme saisie', /en attente de validation/.test(apres) && parseInt(apres, 10) === parseInt(avant, 10) + 1, `${avant} → ${apres}`);
    ok('enseignant : aucune erreur JS', !erreurs.length, erreurs.join(' | '));
    await navigateur.close();
  }

  /* ===================== Directeur ===================== */
  const { navigateur, page, erreurs } = await ouvrir();
  page.setDefaultTimeout(10000);
  await demo(page);

  // Élèves : import
  const imp = await page.evaluate(async () => {
    const A = AK.imports.analyser('nom;prenoms;niveau;sexe;naissance;extrait;n acte;date acte\nKONAN;Exemple;CE1;M;43234;oui;245;43300\nFUTUR;Bebe;CE1;M;01/01/2031;;;\nDOUBLE;Fichier;CE1;F;02/02/2018;;;\nDOUBLE;Fichier;CE1;F;02/02/2018;;;');
    const ex = AK.store.etat.students.find((s) => s.mat);
    const B = AK.imports.analyser(`nom;prenoms;niveau;sexe;matricule\n${ex.nom};${ex.prenoms};${ex.classe};M;${ex.mat}`);
    return { items: A.items.map((i) => [i.etat, i.motif, i.s.naissance, i.s.acte.date]), b: B.items.map((i) => [i.etat, i.motif]) };
  });
  ok('import : date au format date d’Excel (numéro de série) convertie', imp.items[0][2] === '2018-05-14' && imp.items[0][3] === '2018-07-19', JSON.stringify(imp.items[0]));
  ok('import : colonne « date acte » reconnue', !!imp.items[0][3]);
  ok('import : naissance future refusée', imp.items[1][0] === 'erreur' && /improbable/.test(imp.items[1][1]), JSON.stringify(imp.items[1]));
  ok('import : ligne répétée dans le fichier = doublon', imp.items[2][0] === 'ok' && imp.items[3][0] === 'doublon', JSON.stringify(imp.items.slice(2)));
  ok('import : matricule école AK-… de l’export reconnu (doublon, pas « matricule national invalide »)', imp.b[0][0] === 'doublon', JSON.stringify(imp.b));
  const imp2 = await page.evaluate(async () => {
    const n0 = AK.store.etat.students.length;
    const A = AK.imports.analyser('nom;prenoms;niveau;sexe\nIMPORT;Unique;CE1;F');
    const p1 = AK.imports.importer(A), p2 = AK.imports.importer(A).catch((e) => e.message);
    const [r1, r2] = await Promise.all([p1, p2]);
    const forge = await AK.imports.importer({ items: [{ etat: 'ok', s: { id: 'x1', nom: '', classe: 'ZZZ', sexe: 'Robot' } }] }).catch((e) => e.message);
    return { r1, r2, n: AK.store.etat.students.length - n0, forge, dbl: AK.schema.verifier(AK.store.etat).filter((p) => /double/.test(p.code || p.type || JSON.stringify(p))).length };
  });
  ok('import : double clic, une seule importation', imp2.n === 1 && /déjà été importée/.test(imp2.r2), JSON.stringify(imp2));
  ok('import : analyse forgée (élève invalide) rejetée au moment d’importer', /Aucune ligne/.test(imp2.forge), imp2.forge);
  await aller(page, 'eleves/import');
  const btn = await page.evaluate(() => { const b = document.querySelector('#contenu [data-action="fichier-choisir"]'); if (!b) return null; b.focus(); return { tag: b.tagName, focus: document.activeElement === b }; });
  ok('import : « Choisir un fichier » est un bouton atteignable au clavier', btn && btn.tag === 'BUTTON' && btn.focus, JSON.stringify(btn));

  // Élèves : matricule, extrait, statut, changement de classe
  const el = await page.evaluate(async () => {
    const base = { prenoms: 'Test', sexe: 'Masculin', classe: 'CE1', age: 8, pere_nom: 'TEST', pere_prenoms: 'Papa', entree: '2025-09-01' };
    const a = AK.eleves.inscrire({ ...base, nom: 'TESTA' });
    AK.eleves.supprimer(a.id);
    const b = AK.eleves.inscrire({ ...base, nom: 'TESTB' });
    let acte = null;
    try { AK.eleves.inscrire({ ...base, nom: 'ACTE', extrait: true, naissance: '2017-03-04', mere_nom: 'ACTE', mere_prenoms: 'Mere' }); } catch (e) { acte = e.champ; }
    const s = AK.calc.actifsDe('CE2')[0];
    AK.eleves.changerStatut(s.id, 'Abandon', 'Motif personnel sensible');
    const j = AK.store.etat.pro.journal[0].m;
    AK.eleves.changerStatut(s.id, 'Inscrit', '');
    return { a: a.mat, b: b.mat, acte, j };
  });
  ok('matricule d’un élève à la corbeille jamais réattribué', el.a !== el.b, JSON.stringify(el));
  ok('avec extrait : n° d’acte obligatoire', el.acte === 'acte_num', String(el.acte));
  ok('journal du changement de statut sans le motif', !/sensible/.test(el.j), el.j);
  const cc = await page.evaluate(() => {
    const s = AK.calc.actifsDe('CE2').find((x) => Object.keys(AK.store.etat.grades).some((k) => k.startsWith(x.id + '|')));
    const d = { nom: s.nom, prenoms: s.prenoms, sexe: s.sexe, classe: 'CE1', extrait: s.extrait, naissance: s.naissance, age: AK.calc.ageDe(s) || 9, pere_nom: s.pere.nom || 'PERE', pere_prenoms: s.pere.prenoms || 'Papa', mere_nom: s.mere.nom || 'MERE', mere_prenoms: s.mere.prenoms || 'Maman', acte_num: (s.acte && s.acte.num) || '1', acte_date: (s.acte && s.acte.date) || s.naissance, entree: s.entree || '2025-09-01', matNat: s.matNat };
    let e1 = null;
    try { AK.eleves.modifier(s.id, d); } catch (e) { e1 = !!e.changementClasse; }
    AK.eleves.modifier(s.id, d, { changementConfirme: true });
    return { e1, classe: s.classe, restantes: Object.keys(AK.store.etat.grades).filter((k) => k.startsWith(s.id + '|')).length, gardees: Object.keys((s.notesAnciennes || [])[0]?.grades || {}).length };
  });
  ok('changement de classe avec notes : confirmation exigée, notes mises de côté', cc.e1 === true && cc.classe === 'CE1' && cc.restantes === 0 && cc.gardees > 0, JSON.stringify(cc));

  // Notes : absence avec notes validées → mot de passe ; note en attente vidée ; décision au clavier ; réouverture
  await aller(page, 'notes/saisie?classe=CM1&ev=1');
  await page.waitForSelector('#grille-notes');
  const sid = await page.evaluate(() => [...document.querySelectorAll('#grille-notes [data-change="note-absent"]')].find((x) => !x.checked && Object.keys(AK.store.etat.grades).some((k) => k.startsWith(x.dataset.id + '|1|'))).dataset.id);
  await page.click(`#abs-${sid}`);
  await page.waitForSelector('dialog[open]');
  ok('absence d’un élève aux notes validées : mot de passe du directeur demandé', !!(await page.$('dialog[open] #mdp-admin')));
  await page.click('dialog[open] [data-annuler], dialog[open] .btn-ghost, dialog[open] [value=annuler]').catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(250);
  ok('annulation : case décochée, notes intactes', !(await page.isChecked(`#abs-${sid}`)) && (await page.evaluate((i) => Object.keys(AK.store.etat.grades).some((k) => k.startsWith(i + '|1|')), sid)));

  const att = await page.evaluate(() => {
    const s = AK.calc.actifsDe('CM1')[1], m = AK.calc.matieres('CM1', 2)[0][0], k = AK.calc.cle(s.id, 2, m);
    delete AK.store.etat.grades[k];
    AK.store.etat.attente[k] = 12;
    return { id: s.id, m, k };
  });
  await aller(page, 'notes/saisie?classe=CM1&ev=2');
  await page.waitForSelector('#grille-notes');
  const selA = `#grille-notes .note-in[data-id="${att.id}"][data-m="${att.m}"]`;
  await page.fill(selA, '');
  await page.press(selA, 'Tab');
  await page.waitForTimeout(200);
  ok('directeur : vider une note en attente la retire (elle ne sera pas validée)', await page.evaluate((k) => !(k in AK.store.etat.attente), att.k));

  await aller(page, 'notes/fin?classe=CE2');
  const dec = await page.$eval('#contenu select[data-change="decision"]', (x) => x.id);
  await page.focus('#' + dec);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  ok('décision au clavier : le focus reste sur le menu après enregistrement', await page.evaluate((i) => document.activeElement && document.activeElement.id === i, dec), dec);

  const ro = await page.evaluate(() => {
    AK.notes.basculerSaisie('CM2', 3);
    AK.store.etat.saisie['CM2|3'].fin = '2020-01-01';
    AK.notes.basculerSaisie('CM2', 3);
    return { ouverte: AK.notes.saisieOuverte('CM2', 3), fin: AK.store.etat.saisie['CM2|3'].fin };
  });
  ok('« Rouvrir la saisie » rouvre aussi après une date limite dépassée', ro.ouverte && ro.fin === '', JSON.stringify(ro));
  const inc = await page.evaluate(() => {
    const s = AK.calc.actifsDe('CE1')[0], m = AK.calc.matieres('CE1', 1)[0][0];
    delete AK.store.etat.compAbs[s.id + '|1'];
    AK.calc.matieres('CE1', 1).forEach(([x]) => delete AK.store.etat.grades[AK.calc.cle(s.id, 1, x)]);
    AK.store.etat.grades[AK.calc.cle(s.id, 1, m)] = 5;
    return { inc: AK.calc.incomplet(s, 1), bilan: AK.notes.bilanPassage().incompletes };
  });
  ok('évaluation incomplète signalée (indicateur et bilan du passage)', inc.inc && inc.bilan >= 1, JSON.stringify(inc));

  // Absences : « Tout le monde présent » garde les absences justifiées
  const ap = await page.evaluate(() => {
    const c = 'CM1', s = AK.calc.actifsDe(c), d = AK.u.aujourdhui();
    AK.store.etat.att[d] = { [s[0].id]: 'J', [s[1].id]: 'A' };
    const g = AK.absences.tousPresents(d, c);
    return { g, j: AK.store.etat.att[d][s[0].id], a: AK.store.etat.att[d][s[1].id] };
  });
  ok('« Tout le monde présent » lève les absences mais garde les justifiées', ap.g === 1 && ap.j === 'J' && !ap.a, JSON.stringify(ap));
  const fut = await essai(page, () => AK.absences.valider('2099-01-01', 'CM1'));
  ok('valider l’appel d’un jour à venir est refusé', fut.err === 'ErreurMetier', JSON.stringify(fut));

  // Registre : remplacer un document par lui-même refusé
  const rp = await essai(page, () => { const d = AK.store.etat.docs.items.find((x) => x.statut === 'valide'); return d ? AK.registre.remplacer(d.ref, d.ref) : 'aucun'; });
  ok('registre : un document ne peut pas être « remplacé » par lui-même', rp.err === 'ErreurMetier' || rp.ok === 'aucun', JSON.stringify(rp));

  // Accueil : bouton « Inscrire un élève »
  await aller(page, 'accueil');
  const bAcc = await page.$('#contenu [data-action="eleve-nouveau"]');
  if (bAcc) {
    await bAcc.click();
    await page.waitForTimeout(250);
    ok('accueil : « Inscrire un élève » ouvre le formulaire', !!(await page.$('dialog[open] [name=nom]')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  } else ok('accueil : bouton « Inscrire un élève » présent', false);

  // Passage d'année : copie de sécurité en échec → rien n'est fait ; notes en attente archivées
  const pa = await page.evaluate(async () => {
    const annee = AK.store.etat.school.year, copie = AK.stockage.actif.copie;
    AK.stockage.actif.copie = async () => { throw new Error('disque plein'); };
    let refus = null;
    try { await AK.notes.passerAnnee(); } catch (e) { refus = e.message; }
    const inchangee = AK.store.etat.school.year === annee;
    AK.stockage.actif.copie = copie;
    const s = AK.calc.actifsDe('CE2')[0], k = AK.calc.cle(s.id, 4, AK.calc.matieres('CE2', 4)[0][0]);
    delete AK.store.etat.grades[k];
    AK.store.etat.attente[k] = 17;
    await AK.notes.passerAnnee();
    return { refus, inchangee, archive: AK.store.etat.archives[annee] && AK.store.etat.archives[annee].attente && AK.store.etat.archives[annee].attente[k] };
  });
  ok('passage d’année refusé si la copie de sécurité échoue', /copie de sécurité/.test(pa.refus || '') && pa.inchangee, JSON.stringify(pa));
  ok('passage d’année : notes en attente archivées (non perdues)', pa.archive === 17, JSON.stringify(pa));

  ok('directeur : aucune erreur JS', !erreurs.filter((e) => !/disque plein/.test(e)).length, erreurs.join(' | '));
  await navigateur.close();
  res.filter((r) => !r.ok).forEach((r) => console.log('ÉCHEC', r.nom, '→', r.detail));
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies`);
  process.exitCode = res.every((r) => r.ok) ? 0 : 1;
})().catch((e) => {
  res.filter((r) => !r.ok).forEach((r) => console.log('ÉCHEC', r.nom, '→', r.detail));
  console.log(`${res.filter((r) => r.ok).length}/${res.length} vérifications réussies avant l’arrêt`);
  console.error('ARRÊT', e.message.split('\n')[0]);
  process.exit(1);
});
