/* =====================================================================================
   Listes et états imprimables (paginés automatiquement, en-tête de tableau répété).
   Pas d'inscription au registre : ce sont des états de gestion, datés au pied de page.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const def = (d) => AK.modeles.def({ categorie: 'liste', sujet: 'ecole', version: 1, ...d });
  const sx = (L) => X().compteSexe(L).map((v, i) => html`<td${i === 2 ? html` style="font-weight:800"` : ''}>${v}</td>`);
  const suite = (r, titre) => html`<div class="doc-note" style="margin-bottom:2mm">${S().school.name} · ${titre} (suite)</div>`;
  const signer = (r, ctx) => (r.signatures && r.signatures.length ? AK.mise.signatures(r, ctx) : '');
  const SIG_DIR = [{ role: 'Le Directeur', nom: '{directeur}', cachet: true }];

  def({
    id: 'liste-classe', lib: 'Liste des élèves d’une classe', icone: 'list', sujet: 'classe',
    description: 'Ordre alphabétique, matricule, sexe, naissance, extrait. Colonnes vides facultatives pour émargement.',
    champsOptionnels: [['naissance', 'Date de naissance', true], ['extrait', 'Extrait de naissance', true], ['emargement', 'Colonne d’émargement', false], ['parents', 'Contact des parents', false]],
    defauts: { titre: 'LISTE DES ÉLÈVES', champs: { naissance: true, extrait: true, emargement: false, parents: false }, signatures: SIG_DIR, qr: { actif: false } },
    rendu(ctx, r, o) {
      const x = X(), c = ctx.classe, L = x.actifsDe(c).sort(x.parNom), t = x.enseignantDe(c);
      const tete = html`<tr><th>N°</th><th>Matricule</th><th class="g">Nom et prénoms</th><th>Sexe</th>${r.champs.naissance !== false ? html`<th>Né(e) le</th>` : ''}${r.champs.extrait !== false ? html`<th>Extrait</th>` : ''}${r.champs.parents ? html`<th>Contact parent</th>` : ''}${r.champs.emargement ? html`<th style="width:30mm">Émargement</th>` : ''}</tr>`;
      const lignes = L.map((s, i) => html`<tr><td>${i + 1}</td><td>${x.matOf(s)}</td><td class="nom">${x.nomComplet(s)}</td><td>${s.sexe ? s.sexe[0] : ''}</td>${r.champs.naissance !== false ? html`<td>${x.fmtNaissance(s)}</td>` : ''}${r.champs.extrait !== false ? html`<td>${s.extrait ? 'Oui' : 'Non'}</td>` : ''}${r.champs.parents ? html`<td>${AK.pro.telParent(s)}</td>` : ''}${r.champs.emargement ? html`<td></td>` : ''}</tr>`);
      const [g, f] = x.compteSexe(L);
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – ${c}`, `Enseignant(e) : ${t ? t.nom : '—'} · ${L.length} élèves (${g} garçons, ${f} filles)`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, `Liste ${c}`) } };
    }
  });

  def({
    id: 'registre-eleves', lib: 'Registre général des élèves', icone: 'book',
    description: 'Tous les élèves (inscrits et partis), classés par niveau : identité, naissance, extrait, statut.',
    champsOptionnels: [['parents', 'Parent et téléphone', true], ['partis', 'Inclure les élèves partis', true]],
    defauts: { titre: 'REGISTRE GÉNÉRAL DES ÉLÈVES', page: { orientation: 'paysage', marges: { h: 10, d: 10, b: 10, g: 10 } }, champs: { parents: true, partis: true }, signatures: SIG_DIR, qr: { actif: false }, entete: { compact: true } },
    orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const x = X(), L = S().students.filter((s) => r.champs.partis !== false || s.statut === 'Inscrit').slice().sort(x.parClasse);
      const tete = html`<tr><th>N°</th><th>Matricule</th><th class="g">Nom et prénoms</th><th>Sexe</th><th>Classe</th><th>Né(e) le</th><th>Âge</th><th>Nationalité</th><th>Extrait (n° / date)</th>${r.champs.parents !== false ? html`<th>Parent / tuteur</th><th>Téléphone</th>` : ''}<th>Red.</th><th>Statut</th></tr>`;
      const lignes = L.map((s, i) => {
        const p = s.parent || [s.pere && s.pere.nom, s.pere && s.pere.prenoms].filter(Boolean).join(' ') || [s.mere && s.mere.nom, s.mere && s.mere.prenoms].filter(Boolean).join(' ');
        return html`<tr><td>${i + 1}</td><td>${x.matOf(s)}</td><td class="nom">${x.nomComplet(s)}</td><td>${s.sexe ? s.sexe[0] : ''}</td><td>${s.classe}</td><td>${x.fmtNaissance(s)}</td><td>${x.ageDe(s) ?? ''}</td><td>${u.capitale(s.nationalite)}</td><td>${s.extrait ? `${(s.acte && s.acte.num) || '?'} du ${u.fmtDate(s.acte && s.acte.date)}` : 'Non'}</td>${r.champs.parents !== false ? html`<td class="g">${p}</td><td>${AK.pro.telParent(s)}</td>` : ''}<td>${s.redoublant ? 'Oui' : ''}</td><td>${s.statut}</td></tr>`;
      });
      return { liste: { avant: html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year} · ${L.length} élèves`)}`, tete, lignes, classeTab: 'doc-tab serre', apres: signer(r, ctx), suite: suite(r, 'Registre général') } };
    }
  });

  def({
    id: 'etat-classe', lib: 'État de la classe (liste et statistiques)', icone: 'grid', sujet: 'classe',
    description: 'Liste de la classe suivie des statistiques par sexe : ivoiriens, étrangers, extraits, redoublants.',
    defauts: { titre: 'ÉTAT DES ÉLÈVES', signatures: SIG_DIR, qr: { actif: false } },
    rendu(ctx, r, o) {
      const x = X(), c = ctx.classe, L = x.actifsDe(c).sort(x.parNom), t = x.enseignantDe(c);
      const tete = html`<tr><th>N°</th><th class="g">Nom et prénoms</th><th>Matricule</th><th>Sexe</th><th>Naissance</th><th>Extrait</th></tr>`;
      const lignes = L.map((s, i) => html`<tr><td>${i + 1}</td><td class="nom">${x.nomComplet(s)}</td><td>${x.matOf(s)}</td><td>${s.sexe ? s.sexe[0] : ''}</td><td>${x.fmtNaissance(s)}</td><td>${s.extrait ? 'Oui' : 'Non'}</td></tr>`);
      const stats = [['Inscrits', L], ['Ivoiriens', L.filter(x.estIvoirien)], ['Étrangers', L.filter((s) => !x.estIvoirien(s))], ['Avec extrait', L.filter((s) => s.extrait)], ['Sans extrait', L.filter((s) => !s.extrait)], ['Redoublants', L.filter((s) => s.redoublant)]];
      const apres = html`<div class="doc-section">Statistiques de la classe</div><table class="doc-tab serre" style="max-width:120mm"><thead><tr><th class="g"></th><th>G</th><th>F</th><th>T</th></tr></thead><tbody>${stats.map(([l, X2]) => html`<tr><td class="g">${l}</td>${sx(X2)}</tr>`)}</tbody></table>${signer(r, ctx)}`;
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – CLASSE DE ${c}`, `Enseignant(e) : ${t ? t.nom : '—'}`)}`, tete, lignes, apres, suite: suite(r, `État ${c}`) } };
    }
  });

  def({
    id: 'classement', lib: 'Classement d’une classe', icone: 'award', sujet: 'classe',
    description: 'Rang, moyenne et mention pour une composition ou pour l’année (MGA).',
    defauts: { titre: 'CLASSEMENT', signatures: SIG_DIR, qr: { actif: false } },
    rendu(ctx, r, o) {
      const x = X(), c = ctx.classe, per = ctx.periode, { all } = x.classement(c, per), e = x.echelle(c);
      const tete = html`<tr><th>Rang</th><th class="g">Élève</th><th>Matricule</th><th>${per === 'A' ? 'MGA' : 'Moyenne'} / ${e}</th><th>Mention</th>${per === 'A' ? html`<th>Décision</th>` : ''}</tr>`;
      const lignes = all.map((z) => html`<tr><td>${x.rangTxt(z.rank)}</td><td class="nom">${x.nomComplet(z.s)}</td><td>${x.matOf(z.s)}</td><td><b>${u.fmtNote(z.avg)}</b></td><td>${x.mention(z.avg, c)}</td>${per === 'A' ? html`<td>${x.decision(z.s) || '—'}</td>` : ''}</tr>`);
      const rs = x.reussite(c, per);
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – ${c}`, `${x.perLabel(per, c)} · moyenne de la classe ${u.fmtNote(x.moyClasse(c, per))} / ${e} · réussite ${u.pct(rs.ok, rs.n)}`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, `Classement ${c}`) } };
    }
  });

  def({
    id: 'decisions', lib: 'Décisions de fin d’année', icone: 'flag', sujet: 'classe',
    description: 'MGA, rang, proposition et décision retenue pour chaque élève de la classe.',
    defauts: { titre: 'DÉCISIONS DE FIN D’ANNÉE', signatures: SIG_DIR, qr: { actif: false } },
    rendu(ctx, r, o) {
      const x = X(), c = ctx.classe, { w } = x.classement(c, 'A'), L = x.actifsDe(c).sort(x.parNom);
      const tete = html`<tr><th>N°</th><th class="g">Élève</th><th>Matricule</th><th>MGA / ${x.echelle(c)}</th><th>Rang</th><th>Proposition</th><th>Décision retenue</th></tr>`;
      const lignes = L.map((s, i) => {
        const k = w.find((z) => z.s.id === s.id);
        return html`<tr><td>${i + 1}</td><td class="nom">${x.nomComplet(s)}</td><td>${x.matOf(s)}</td><td>${u.fmtNote(x.mga(s))}</td><td>${k ? x.rangTxt(k.rank) : '—'}</td><td>${x.decisionProposee(s) || '—'}</td><td><b>${x.decision(s) || '—'}</b></td></tr>`;
      });
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – ${c}`, `Année scolaire ${S().school.year} · seuil ${x.info(c).seuil}/${x.echelle(c)}`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, `Décisions ${c}`) } };
    }
  });

  def({
    id: 'effectifs', lib: 'Tableau des effectifs', icone: 'chart',
    description: 'Inscrits, ivoiriens, étrangers, extraits, redoublants et abandons par classe et par sexe.',
    defauts: { titre: 'TABLEAU DES EFFECTIFS DES ÉLÈVES', page: { orientation: 'paysage' }, signatures: SIG_DIR, qr: { actif: false } },
    orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const x = X(), act = x.actifs(), nv = x.niveaux();
      const M = [['Inscrits', (L) => L], ['Ivoiriens', (L) => L.filter(x.estIvoirien)], ['Étrangers', (L) => L.filter((s) => !x.estIvoirien(s))], ['Avec extrait', (L) => L.filter((s) => s.extrait)], ['Sans extrait', (L) => L.filter((s) => !s.extrait)], ['Redoublants', (L) => L.filter((s) => s.redoublant)]];
      const partis = (cls) => S().students.filter((s) => s.statut !== 'Inscrit' && cls.includes(s.classe)).length;
      const ligne = (lib, L, cls) => html`<tr><td class="g"><b>${lib}</b></td>${M.map(([, f]) => sx(f(L)))}<td>${partis(cls)}</td></tr>`;
      const cp = nv.filter((c) => c === 'CP1' || c === 'CP2');
      return {
        ajuster: true,
        contenu: html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year}`)}<table class="doc-tab serre"><thead><tr><th rowspan="2" class="g">Classe</th>${M.map(([l]) => html`<th colspan="3">${l}</th>`)}<th rowspan="2">Abandons, départs</th></tr><tr>${M.map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr></thead><tbody>${nv.map((c) => ligne(c, act.filter((s) => s.classe === c), [c]))}${cp.length ? ligne('Total CP', act.filter((s) => cp.includes(s.classe)), cp) : ''}${ligne('TOTAL', act, nv)}</tbody></table>${signer(r, ctx)}`
      };
    }
  });

  def({
    id: 'ages-extraits', lib: 'Élèves par âge, niveau et sexe', icone: 'chart',
    description: 'Âge au 1er octobre par niveau et par sexe, puis élèves avec et sans extrait de naissance.',
    defauts: { titre: 'ÉLÈVES PAR ÂGE, NIVEAU ET SEXE', page: { orientation: 'paysage' }, signatures: SIG_DIR, qr: { actif: false } },
    orientations: ['paysage'],
    rendu(ctx, r, o) {
      return { ajuster: true, contenu: html`${o.entete(r)}${o.titre(r.titre, `Âge au 1er octobre ${X().anneeRentree()}`)}${AK.rapports.tableAges('doc-tab serre')}<div class="doc-section">Élèves avec et sans extrait de naissance</div>${AK.rapports.tableExtraits('doc-tab serre')}${signer(r, ctx)}` };
    }
  });

  def({
    id: 'dossiers-regulariser', lib: 'Dossiers à régulariser', icone: 'file',
    description: 'Élèves inscrits sans extrait de naissance, par classe.',
    defauts: { titre: 'DOSSIERS À RÉGULARISER', sousTitre: 'Élèves sans extrait de naissance', signatures: SIG_DIR, qr: { actif: false } },
    rendu(ctx, r, o) {
      const x = X(), L = x.actifs().filter((s) => !s.extrait).sort(x.parClasse);
      const tete = html`<tr><th>N°</th><th class="g">Nom et prénoms</th><th>Classe</th><th>Sexe</th><th>Âge déclaré</th><th>Parent / tuteur</th><th>Téléphone</th></tr>`;
      const lignes = L.map((s, i) => html`<tr><td>${i + 1}</td><td class="nom">${x.nomComplet(s)}</td><td>${s.classe}</td><td>${s.sexe ? s.sexe[0] : ''}</td><td>${x.ageDe(s) ?? '—'} ans</td><td class="g">${s.parent || [s.pere && s.pere.nom, s.pere && s.pere.prenoms].filter(Boolean).join(' ')}</td><td>${AK.pro.telParent(s)}</td></tr>`);
      return { liste: { avant: html`${o.entete(r)}${o.titre(r.titre, `${r.sousTitre} · ${L.length} élève(s)`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, 'Dossiers à régulariser') } };
    }
  });

  def({
    id: 'liste-personnel', lib: 'Liste du personnel', icone: 'brief',
    description: 'Nom, matricule, fonction, emploi, classe tenue, fonctionnement, contact.',
    champsOptionnels: [['contacts', 'Téléphones', true]],
    defauts: { titre: 'LISTE DU PERSONNEL', page: { orientation: 'paysage' }, champs: { contacts: true }, signatures: SIG_DIR, qr: { actif: false } },
    orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const x = X(), L = S().teachers.filter((t) => t.actif !== false);
      const tete = html`<tr><th>N°</th><th class="g">Nom et prénoms</th><th>Matricule</th><th>Fonction</th><th>Genre</th><th>Emploi / grade</th><th>Classe tenue</th><th>Fonctionnement</th>${r.champs.contacts !== false ? html`<th>Contact</th>` : ''}</tr>`;
      const lignes = L.map((t, i) => html`<tr><td>${i + 1}</td><td class="nom">${t.nom}</td><td>${t.matricule}</td><td>${t.fonction}</td><td>${x.estFemme(t) ? 'F' : 'M'}</td><td>${x.emploiGrade(t)}</td><td>${x.clsTxt(t) || '—'}</td><td>${x.fonctTxt(t) || '—'}</td>${r.champs.contacts !== false ? html`<td>${t.tel}</td>` : ''}</tr>`);
      return { liste: { avant: html`${o.entete(r)}${o.titre(r.titre, `Année scolaire ${S().school.year} · ${L.length} membre(s)`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, 'Personnel') } };
    }
  });

  def({
    id: 'liste-cepe', lib: 'Liste des candidats au CEPE', icone: 'list',
    description: 'Candidats du CM2 : identité, naissance, nationalité, état du dossier.',
    defauts: { titre: 'LISTE DES CANDIDATS AU CEPE', page: { orientation: 'paysage' }, signatures: SIG_DIR, qr: { actif: false } },
    orientations: ['paysage', 'portrait'],
    rendu(ctx, r, o) {
      const x = X(), L = x.actifsDe('CM2').sort(x.parNom);
      const tete = html`<tr><th>N°</th><th class="g">Nom et prénoms</th><th>Matricule</th><th>Sexe</th><th>Date et lieu de naissance</th><th>Nationalité</th><th>Dossier</th></tr>`;
      const lignes = L.map((s, i) => html`<tr><td>${i + 1}</td><td class="nom">${x.nomComplet(s)}</td><td>${x.matOf(s)}</td><td>${s.sexe ? s.sexe[0] : ''}</td><td>${x.fmtNaissance(s)}${s.lieu ? ' à ' + s.lieu : ''}</td><td>${u.capitale(s.nationalite)}</td><td>${AK.pro.dossierCepe(s).complet ? 'Complet' : 'Incomplet'}</td></tr>`);
      return { liste: { avant: html`${o.entete(r)}${o.titre(`${r.titre} – SESSION ${X().anneeRentree() + 1}`, `${L.length} candidat(s)`)}`, tete, lignes, apres: signer(r, ctx), suite: suite(r, 'Candidats CEPE') } };
    }
  });
  AK.listesDoc = { sx };
})(window.AK);
