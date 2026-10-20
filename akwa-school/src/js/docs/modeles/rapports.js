/* =====================================================================================
   Rapports officiels (rentrée, composition, mensuel, fin d'année, CM2, notes par classe),
   synthèse pour l'IEPP, infrastructures, fiche de transmission et rapports personnalisés.
   ctx = { edit (zones modifiables à l'écran), ev, mois, classe, rapport (générateur) }
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const R = () => AK.rapports;
  const SIG = [{ role: 'Le Directeur', nom: '{directeur}', cachet: true }];
  const def = (d) => AK.modeles.def({ categorie: 'rapport', sujet: 'ecole', version: 1, ...d });
  const titre = (o, r, t, sous) => html`${o.entete({ ...r, entete: { ...r.entete, compact: true } })}${o.titre(t, sous)}`;
  const section = (t) => html`<div class="doc-section">${t}</div>`;
  const obsSig = (zone, r, ctx) => html`<div style="display:grid;grid-template-columns:3fr 2fr;gap:6mm;align-items:start;margin-top:2mm">${zone}<div>${AK.mise.signatures(r, ctx)}</div></div>`;
  const PAYSAGE = { page: { orientation: 'paysage', marges: { h: 9, d: 10, b: 9, g: 10 } }, signatures: SIG, qr: { actif: false }, hauteurSignature: 18 };

  def({
    id: 'rapport-rentree', lib: 'Rapport de rentrée', icone: 'book', description: 'Liste des enseignants et tableau des effectifs (non redoublants, redoublants), sur une page A4 paysage.',
    defauts: { titre: 'RAPPORT DE RENTRÉE – EFFECTIFS ET PERSONNEL', ...PAYSAGE }, orientations: ['paysage', 'portrait'],
    rendu: (ctx, r, o) => ({ ajuster: true, contenu: html`${titre(o, r, r.titre, `Année scolaire ${S().school.year}`)}${section('1. Liste des enseignants')}${R().blocEnseignants()}${section('2. Tableau des effectifs élèves')}${R().blocEffectifs()}${obsSig(R().zone('RENTREE', '', 'observations', 'OBSERVATIONS :', 3, ctx.edit), r, ctx)}` })
  });
  def({
    id: 'rapport-composition', lib: 'Rapport de composition', icone: 'book', description: 'Inscrits, présents, absents, admis par niveau et par sexe ; trois meilleurs par niveau.',
    defauts: { titre: 'RAPPORT DE COMPOSITION', ...PAYSAGE }, orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const n = Number(ctx.ev) || 1, x = X();
      return { ajuster: true, contenu: html`${titre(o, r, r.titre, `${C.EV_GEN[n - 1]} – ${u.fmtDate(x.evalDate('CP1', n))}${n >= 3 ? ` (CM2 : ${u.fmtDate(x.evalDate('CM2', n))})` : ''}`)}${R().blocCompo(n)}${section('Liste des trois meilleurs par niveau')}${R().blocTop3(n)}${obsSig(R().zone('COMPOSITION', n, 'observations', 'OBSERVATIONS DU DIRECTEUR :', 2, ctx.edit), r, ctx)}` };
    }
  });
  def({
    id: 'rapport-mensuel', lib: 'Rapport mensuel du directeur', icone: 'book', description: 'Fréquentation, assiduité du personnel, activités, relations humaines, difficultés, conclusion (A4 portrait, plusieurs pages si besoin).',
    defauts: { titre: 'RAPPORT MENSUEL DU DIRECTEUR', signatures: SIG, qr: { actif: false }, page: { orientation: 'portrait', marges: { h: 12, d: 13, b: 11, g: 13 } } },
    rendu(ctx, r, o) {
      const m = Number(ctx.mois) || X().moisCourant(), { y, jours } = X().moisInfo(m), e = ctx.edit;
      const z = (ch, t, l) => R().zone('MENSUEL', String(m), ch, t, l, e);
      return {
        blocs: [
          titre(o, r, r.titre, `École : ${S().school.name} • Période : ${C.MOIS[m - 1]} ${y} • Jours de classe : ${jours}`),
          html`${section('1. Effectifs et fréquentation')}${R().blocFreq(m)}`,
          html`${section('2. Assiduité et ponctualité du personnel enseignant')}${R().blocPersonnel(m)}`,
          html`${section('3. Activités menées')}${z('animations', 'a. Animations pédagogiques :', 2)}<b style="font-size:8.8pt">b. Évaluations du mois</b>${R().blocEvalsMois(m)}`,
          html`<b style="font-size:8.8pt;display:block;margin-top:1.4mm">c. Activités extra-scolaires</b><div class="zg3">${z('cooperatives', 'Activités coopératives', 2)}${z('bibliotheque', 'Bibliothèque', 2)}${z('cantine', 'Cantine', 2)}</div>`,
          html`${section('4. Relations humaines')}<div class="zg2">${z('relations_enseignants', 'Entre les enseignants :', 2)}${z('relations_maitres_eleves', 'Entre maîtres et élèves :', 2)}${z('relations_parents', 'Entre maîtres et parents d’élèves :', 2)}${z('relations_autorites', 'Entre maîtres et autorités :', 2)}</div>`,
          html`${section('5. Événements ayant marqué la vie de l’école')}${z('evenements', '', 2)}`,
          html`${section('6. Difficultés rencontrées au cours du mois')}<div class="zg2">${z('grossesses', 'Nombre de filles en grossesse :', 1)}${z('deces', 'Nombre d’élèves décédés :', 1)}</div>${z('difficultes', 'Autres difficultés :', 2)}`,
          html`<div class="zg2"><div>${section('7. Satisfactions')}${z('satisfactions', '', 2)}</div><div>${section('8. Conclusion')}${z('conclusion', '', 2)}</div></div>`,
          AK.mise.signatures(r, ctx)
        ],
        garder: 2,
        suite: html`<div class="doc-note">${S().school.name} · rapport mensuel de ${C.MOIS[m - 1]} ${y} (suite)</div>`
      };
    }
  });
  def({
    id: 'rapport-fin', lib: 'Rapport de fin d’année', icone: 'book', description: 'Tableau de synthèse (inscrits, présents, admis, taux, redoublants, effectif probable) et récapitulatif des décisions.',
    defauts: { titre: 'RAPPORT DE FIN D’ANNÉE – TABLEAU DE SYNTHÈSE', ...PAYSAGE }, orientations: ['paysage'],
    rendu: (ctx, r, o) => ({ ajuster: true, contenu: html`${titre(o, r, r.titre, `Année scolaire ${S().school.year}`)}${R().blocSynthese(ctx.edit)}${section('Récapitulatif des décisions')}${R().blocDecisions()}${obsSig(R().zone('FIN', '', 'observations', 'OBSERVATIONS :', 3, ctx.edit), r, ctx)}` })
  });
  def({
    id: 'rapport-cm2', lib: 'Rapport CM2', icone: 'book', description: 'Résultats des quatre évaluations du CM2, MGA, décision (entrée en 6e), rang.',
    defauts: { titre: 'RÉSULTATS DES COMPOSITIONS CM2', ...PAYSAGE }, orientations: ['paysage'],
    rendu: (ctx, r, o) => ({ ajuster: true, contenu: html`${titre(o, r, r.titre, `Classe de CM2 – année scolaire ${S().school.year}`)}${R().blocCM2()}${obsSig(R().zone('CM2', '', 'observations', 'OBSERVATIONS :', 3, ctx.edit), r, ctx)}` })
  });
  def({
    id: 'rapport-resultats', lib: 'Rapport des notes par classe', icone: 'book', sujet: 'classe', description: 'Notes par matière, total, moyenne, observation, récapitulatif par sexe.',
    defauts: { titre: 'RAPPORT DES NOTES', ...PAYSAGE }, orientations: ['paysage'],
    rendu(ctx, r, o) {
      const c = ctx.classe, n = Number(ctx.ev) || 1, x = X(), t = x.enseignantDe(c), { table, recap } = R().blocResClasse(c, n);
      return { ajuster: true, contenu: html`${titre(o, r, `${r.titre} – CLASSE DE ${c} – ${x.evalLabel(c, n).toUpperCase()}`, `Évaluation du ${u.fmtDate(x.evalDate(c, n))} • Moyenne sur ${x.echelle(c)} • Seuil ${x.info(c).seuil}/${x.echelle(c)} • Enseignant(e) : ${t ? t.nom : '—'}`)}${table}<div style="display:grid;grid-template-columns:minmax(60mm,1fr) 1.3fr 1fr;gap:5mm;align-items:start">${recap}${R().zone('RESULTATS', c + '|' + n, 'observations', 'OBSERVATIONS :', 3, ctx.edit)}<div>${AK.mise.signatures(r, ctx)}</div></div>` };
    }
  });
  def({
    id: 'synthese-iepp', lib: 'Fiche de synthèse pour l’IEPP', icone: 'send', description: 'Chiffres clés de l’école sur une page : élèves, enseignants, infrastructures.',
    defauts: { titre: 'FICHE DE SYNTHÈSE DE L’ÉCOLE', signatures: SIG, qr: { actif: false } },
    rendu(ctx, r, o) {
      const sc = S().school, x = X(), I = R().infra(), act = x.actifs(), ev = sc.evalCourante || 1, f = act.filter((s) => s.sexe === 'Féminin').length, ens = S().teachers.filter((t) => t.actif !== false && x.clsDe(t).length);
      const rs = x.niveaux().map((c) => x.reussite(c, ev)), ok = rs.reduce((a, z) => a + z.ok, 0), n = rs.reduce((a, z) => a + z.n, 0);
      const hom = ens.filter((t) => AK.valid.civ.de(t.nom) === 'M.').length, fem = ens.filter((t) => /^(Mme|Mlle)$/.test(AK.valid.civ.de(t.nom))).length;
      const sal = R().iSom(I.salles.agglo, I.salles.prov), E = I.eau, Tt = I.toil;
      const kv = (...L) => html`<table class="doc-tab serre"><tbody>${L.map(([a, b]) => html`<tr><td class="g" style="width:45%"><b>${a}</b></td><td class="g">${b}</td></tr>`)}</tbody></table>`;
      return {
        ajuster: true,
        contenu: html`${titre(o, r, r.titre, `Année scolaire ${sc.year} · à l’attention de l’IEPP`)}
          ${section('1. Identification')}${kv(['École', `${sc.name || '—'} (${sc.statut === 'privee' ? 'privée' : 'publique'})`], ['IEPP', sc.iepp || '—'], ['DRENAET', sc.drenaet || '—'], ['Directeur', `${sc.director || '—'}${sc.dirTel ? ' · ' + sc.dirTel : ''}`], ['Localité', sc.localite || '—'])}
          ${section('2. Élèves')}<table class="doc-tab serre"><thead><tr><th>Niveau</th><th>G</th><th>F</th><th>T</th><th>Réussite (${C.evCourt(ev)})</th></tr></thead><tbody>${x.niveaux().map((c, i) => html`<tr><td><b>${c}</b></td>${R().sx(x.actifsDe(c))}<td>${u.pct(rs[i].ok, rs[i].n)}</td></tr>`)}<tr class="total"><td>TOTAL</td>${R().sx(act)}<td>${u.pct(ok, n)}</td></tr></tbody></table>
          ${kv(['Part des filles', u.pct(f, act.length)], ['Dossiers avec extrait de naissance', u.pct(act.filter((s) => s.extrait).length, act.length)], ['Redoublants', act.filter((s) => s.redoublant).length], ['Abandons et départs', S().students.filter((s) => s.statut !== 'Inscrit').length])}
          ${section('3. Enseignants et classes')}${kv(['Enseignants tenant une classe', `${ens.length} (${hom} homme(s), ${fem} femme(s))`], ['Personnel total', S().teachers.filter((t) => t.actif !== false).length], ...R().fonctStats().filter((y) => y.ens.length).map((y) => [`Classes de type ${y.l.toLowerCase()}`, y.ens.length]), ['Élèves par enseignant', R().iRat(act.length, ens.length)])}
          ${section('4. Infrastructures')}${kv(['Salles de classe', sal == null ? '—' : `${sal} (${R().iT(I.salles.agglo)} en dur, ${R().iT(I.salles.prov)} provisoires) · ${R().iRat(act.length, sal)} élèves par salle`], ['Toilettes des élèves', Tt.existe !== 'oui' ? R().iL(C.ON, Tt.existe) : `${R().iT(Tt.eleves.n)} cabine(s), ${R().iT(Tt.eleves.fonct)} fonctionnelle(s)`], ['Points d’eau', E.existe !== 'oui' ? R().iL(C.ON, E.existe) : `${R().iT(R().iSom(...C.EAUX.map(([k]) => E[k].n)))}, dont ${R().iT(R().iSom(...C.EAUX.map(([k]) => E[k].fonct)))} fonctionnel(s)`], ['Électricité à l’école', R().iL(C.ON, I.elec.ecole)], ['Tables-bancs', R().iN(I.mob.tb) == null ? '—' : `${R().iT(I.mob.tb)} · ${R().iRat(act.length, R().iN(I.mob.tb))} élèves par table-banc`], ['Cantine', I.cant.existe !== 'oui' ? R().iL(C.ON, I.cant.existe) : `Oui, fonctionnelle : ${R().iL(C.ON, I.cant.fonct)}`])}
          ${I.maj ? '' : html`<p class="doc-note">Infrastructures non renseignées : complétez-les dans Rapports › Statistiques.</p>`}${AK.mise.signatures(r, ctx)}`
      };
    }
  });
  def({
    id: 'rapport-infrastructures', lib: 'Rapport d’infrastructures', icone: 'building', description: 'Bâtiments, toilettes, eau, électricité, mobilier, cantine, locaux, manuels, accès, ratios.',
    defauts: { titre: 'RAPPORT D’INFRASTRUCTURES', signatures: SIG, qr: { actif: false } },
    rendu: (ctx, r, o) => ({ blocs: [titre(o, r, r.titre, `Année scolaire ${S().school.year}`), ...R().sectionsInfra(R().infra()).map(([t, h], i) => html`${section(`${i + 1}. ${t}`)}${h}`), AK.mise.signatures(r, ctx)] })
  });
  def({
    id: 'fiche-transmission', lib: 'Fiche de transmission à l’IEPP', icone: 'send', description: 'Récapitulatif imprimé du fichier de transmission : effectifs, résultats, absences du mois.',
    defauts: { titre: 'FICHE DE TRANSMISSION À L’INSPECTION', signatures: SIG, qr: { actif: false } },
    rendu(ctx, r, o) {
      const n = Number(ctx.ev) || 1, pk = AK.pro.paquetIEPP(n);
      return {
        ajuster: true,
        contenu: html`${titre(o, r, `${r.titre} – ${C.EV_GEN[n - 1].toUpperCase()}`, `Année scolaire ${S().school.year}`)}<table class="doc-tab"><thead><tr><th>Classe</th><th>G</th><th>F</th><th>Total</th><th>Moyenne</th><th>Évalués</th><th>Seuil atteint</th><th>Taux</th></tr></thead><tbody>${pk.effectifs.map((e, i) => {
          const z = pk.resultats[i];
          return html`<tr><td>${e.classe}</td><td>${e.G}</td><td>${e.F}</td><td><b>${e.T}</b></td><td>${z.moyenne == null ? '—' : u.fmtNote(z.moyenne) + '/' + z.echelle}</td><td>${z.evalues}</td><td>${z.admis_seuil}</td><td>${z.taux == null ? '—' : String(z.taux).replace('.', ',') + ' %'}</td></tr>`;
        })}</tbody></table><p>Absences du mois : ${pk.absences_mois.non_justifiees} non justifiée(s), ${pk.absences_mois.justifiees} justifiée(s) · Personnel : ${pk.personnel.length} · Candidats au CEPE : ${pk.cepe.candidats} · Faits de discipline : ${pk.vie_scolaire.incidents}.</p>${AK.mise.signatures(r, ctx)}`
      };
    }
  });

  /* ---------- Générateur : rapports composés de blocs ---------- */
  const BLOCS = {
    enseignants: { lab: 'Liste des enseignants', titre: 'LISTE DES ENSEIGNANTS', f: () => R().blocEnseignants() },
    effectifs: { lab: 'Effectifs par classe (non redoublants / redoublants)', titre: 'TABLEAU DES EFFECTIFS ÉLÈVES', f: () => R().blocEffectifs() },
    compo: { lab: 'Résultats d’une composition', titre: 'RÉSULTATS DE LA COMPOSITION', p: 'ev', f: (b) => R().blocCompo(Number(b.ev || 1)) },
    top3: { lab: 'Trois meilleurs par niveau', titre: 'LISTE DES TROIS MEILLEURS PAR NIVEAU', p: 'ev', f: (b) => R().blocTop3(Number(b.ev || 1)) },
    frequentation: { lab: 'Effectifs et fréquentation du mois', titre: 'EFFECTIFS ET FRÉQUENTATION', p: 'mois', f: (b) => R().blocFreq(Number(b.mois || X().moisCourant())) },
    personnel: { lab: 'Assiduité du personnel (mois)', titre: 'ASSIDUITÉ DU PERSONNEL ENSEIGNANT', p: 'mois', f: (b) => R().blocPersonnel(Number(b.mois || X().moisCourant())) },
    evalsMois: { lab: 'Évaluations du mois', titre: 'ÉVALUATIONS DU MOIS', p: 'mois', f: (b) => R().blocEvalsMois(Number(b.mois || X().moisCourant())) },
    synthese: { lab: 'Synthèse de fin d’année', titre: 'TABLEAU DE SYNTHÈSE', f: (b, edit) => R().blocSynthese(edit) },
    decisions: { lab: 'Récapitulatif des décisions', titre: 'RÉCAPITULATIF DES DÉCISIONS', f: () => R().blocDecisions() },
    cm2: { lab: 'Résultats du CM2 (4 évaluations et MGA)', titre: 'RÉSULTATS DES COMPOSITIONS CM2', f: () => R().blocCM2() },
    resClasse: { lab: 'Résultats d’une classe (notes par matière)', titre: '', p: 'clsev', f: (b) => { const z = R().blocResClasse(b.cls || X().niveaux()[0], Number(b.ev || 1)); return html`${z.table}<div style="max-width:110mm">${z.recap}</div>`; } },
    ages: { lab: 'Élèves par âge, niveau et sexe', titre: 'ÉLÈVES PAR ÂGE, NIVEAU ET SEXE', f: () => R().tableAges() },
    extraits: { lab: 'Élèves avec ou sans extrait de naissance', titre: 'EXTRAITS DE NAISSANCE', f: () => R().tableExtraits() },
    fonctionnement: { lab: 'Types de fonctionnement des classes', titre: 'FONCTIONNEMENT DES CLASSES', f: () => R().blocFonct() },
    texte: { lab: 'Zone de texte à rédiger', titre: 'OBSERVATIONS', p: 'lignes', f: (b, edit, rap) => R().zone('PERSO', rap.id, b.id, '', Number(b.lignes || 3), edit) },
    signature: { lab: 'Signature du directeur', titre: '', f: (b, edit, rap, r, ctx) => AK.mise.signatures(r, ctx) }
  };
  const MODELES_PERSO = {
    rentree: () => ({ titre: 'Rapport de rentrée – effectifs et personnel', sous: `Année scolaire ${S().school.year}`, pay: true, blocs: [['enseignants', '1. LISTE DES ENSEIGNANTS'], ['effectifs', '2. TABLEAU DES EFFECTIFS ÉLÈVES'], ['texte', 'OBSERVATIONS'], ['signature', '']] }),
    compo: (p) => ({ titre: 'Rapport de composition', sous: C.EV_GEN[(Number(p.ev) || 1) - 1], pay: true, blocs: [['compo', '', { ev: String(p.ev || 1) }], ['top3', 'LISTE DES TROIS MEILLEURS PAR NIVEAU', { ev: String(p.ev || 1) }], ['texte', 'OBSERVATIONS DU DIRECTEUR'], ['signature', '']] }),
    mensuel: (p) => ({ titre: 'Rapport mensuel du directeur', sous: C.MOIS[(Number(p.mois) || 10) - 1], pay: false, blocs: [['frequentation', '1. EFFECTIFS ET FRÉQUENTATION', { mois: String(p.mois) }], ['personnel', '2. ASSIDUITÉ DU PERSONNEL', { mois: String(p.mois) }], ['texte', '3. ACTIVITÉS MENÉES'], ['evalsMois', 'Évaluations du mois', { mois: String(p.mois) }], ['texte', '4. RELATIONS HUMAINES'], ['texte', '5. ÉVÉNEMENTS'], ['texte', '6. DIFFICULTÉS'], ['texte', '7. SATISFACTIONS ET CONCLUSION'], ['signature', '']] }),
    fin: () => ({ titre: 'Rapport de fin d’année – tableau de synthèse', sous: `Année scolaire ${S().school.year}`, pay: true, blocs: [['synthese', ''], ['decisions', 'RÉCAPITULATIF DES DÉCISIONS'], ['texte', 'OBSERVATIONS'], ['signature', '']] }),
    resultats: (p) => ({ titre: `Résultats – ${p.classe || 'CM2'}`, sous: '', pay: true, blocs: [['resClasse', '', { cls: p.classe || 'CM2', ev: String(p.ev || 1) }], ['texte', 'OBSERVATIONS'], ['signature', '']] }),
    cm2: () => ({ titre: 'Résultats des compositions CM2', sous: `Année scolaire ${S().school.year}`, pay: true, blocs: [['cm2', ''], ['texte', 'OBSERVATIONS'], ['signature', '']] })
  };
  def({
    id: 'rapport-perso', lib: 'Rapport personnalisé (générateur)', icone: 'layers', description: 'Rapport composé de blocs choisis par l’école (Rapports › Générateur).',
    defauts: { titre: '', signatures: SIG, qr: { actif: false }, hauteurSignature: 18 }, orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const rap = ctx.rapport;
      const blocs = [titre(o, r, String(rap.titre || '').toUpperCase(), rap.sous), ...rap.blocs.map((b) => {
        const B = BLOCS[b.type];
        return B ? html`${b.titre ? section(b.titre) : ''}${B.f(b, ctx.edit, rap, r, ctx)}` : '';
      })];
      if (rap.ajuster !== false) return { ajuster: true, contenu: html`${blocs}` };
      return { blocs, garder: 2 };
    }
  });
  AK.rapports.BLOCS = BLOCS;
  AK.rapports.MODELES_PERSO = MODELES_PERSO;
  AK.rapports.OFFICIELS = [['rentree', 'Rapport de rentrée', 'rapport-rentree'], ['compo', 'Rapport de composition', 'rapport-composition'], ['mensuel', 'Rapport mensuel', 'rapport-mensuel'], ['fin', 'Rapport de fin d’année', 'rapport-fin'], ['cm2', 'Rapport CM2', 'rapport-cm2'], ['resultats', 'Rapport des notes par classe', 'rapport-resultats']];
})(window.AK);
