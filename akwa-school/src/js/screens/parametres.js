/* =====================================================================================
   Paramètres : identité de l'école (verrouillée après la première saisie), en-tête officiel,
   année, niveaux ouverts ; calendrier (jours fériés, congés, dates des évaluations) ;
   apparence ; diagnostic (version, hôte, stockage, intégrité, journal technique).
   La fonction métier AK.ecole.modifier vérifie les droits et tout le formulaire AVANT de
   modifier quoi que ce soit.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  /* Champs d'identité : modifiables seulement après déverrouillage (mot de passe). */
  const IDENTITE = ['name', 'statut', 'drenaet', 'iepp', 'codeecole', 'codedren', 'codeiep'];
  let identiteOuverte = false;

  /* ---------- Fonction métier ---------- */
  const ecole = {
    /** d : valeurs du formulaire ; renvoie la liste des niveaux fermés (pour information). */
    modifier(d) {
      AK.perm.exiger('parametres.gerer');
      const sc = S().school, n = {};
      const ident = !sc.idLock || identiteOuverte;
      if (ident) {
        const prive = d.statut === 'privee';
        const nom = V.ecoleNom(d.name, prive);
        if (!nom) throw E(V.ECOLE_ERR(prive), 'name');
        const dr = V.drenaetDe(d.drenaet);
        if (!dr) throw E('Saisissez la DRENAET (ex. TOUBA).', 'drenaet');
        let iepp = String(d.iepp || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (iepp && !/^IEPP/.test(iepp)) iepp = 'IEPP ' + iepp;
        Object.assign(n, { name: nom, statut: prive ? 'privee' : 'publique', drenaet: dr.drenaet, iepp });
        ['codeecole', 'codedren', 'codeiep'].forEach((k) => {
          const v = String(d[k] || '').trim().toUpperCase();
          if (v && !/^[0-9A-Z-]{2,20}$/.test(v)) throw E('Code : 2 à 20 lettres, chiffres ou tirets.', k);
          n[k] = v;
        });
      }
      const dir = String(d.director || '').trim();
      if (dir) {
        const e = V.nom(V.civ.sans(dir), 'Nom du directeur', 2, 80);
        if (e) throw E(e, 'director');
      }
      n.director = dir ? V.civ.avec(d.dirCiv || V.civ.de(dir), dir) : '';
      for (const [k, lib] of [['dirTel', 'Téléphone du directeur'], ['telephone', 'Téléphone de l’école'], ['inspTel', 'Téléphone de l’inspecteur'], ['cpTel', 'Téléphone du conseiller pédagogique']]) {
        const e = V.tel(d[k], lib);
        if (e) throw E(e, k);
        n[k] = V.telPropre(d[k]);
      }
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email).trim())) throw E('Adresse électronique invalide.', 'email');
      n.email = String(d.email || '').trim();
      for (const [k, lib, max] of [['localite', 'Localité', 60], ['sp', 'Sous-préfecture', 60], ['adresse', 'Adresse', 120], ['secteur', 'Secteur pédagogique', 60], ['inspNom', 'Inspecteur', 80], ['cpNom', 'Conseiller pédagogique', 80], ['entete', 'Ligne supplémentaire de l’en-tête', 140]]) {
        const e = V.texte(d[k], lib, { max });
        if (e) throw E(e, k);
        n[k] = String(d[k] || '').trim();
      }
      n.localite = n.localite.toUpperCase();
      for (const [k, lib] of [['ministere', 'Ministère'], ['direction', 'Direction régionale'], ['inspection', 'Inspection'], ['republique', 'République'], ['devise', 'Devise']]) {
        const v = String(d[k] || '').trim();
        if (!v) throw E(`${lib} : à renseigner (en-tête officiel des documents).`, k);
        if (v.length > 200) throw E(`${lib} : 200 caractères au maximum.`, k);
        n[k] = v;
      }
      const an = V.normAnnee(d.year);
      if (V.anneeScolaire(an)) throw E(V.anneeScolaire(an), 'year');
      n.year = an;
      const niv = C.TOUS_NIVEAUX.filter((c) => (d.niveaux || []).includes(c));
      if (!niv.length) throw E('Ouvrez au moins un niveau.', 'niveaux');
      const fermes = (sc.niveaux || []).filter((c) => !niv.includes(c));
      const occupes = fermes.filter((c) => S().students.some((s) => s.classe === c && s.statut === 'Inscrit'));
      if (occupes.length) throw E(`Impossible de fermer ${occupes.join(', ')} : des élèves y sont inscrits. Changez-les de classe ou enregistrez leur départ d’abord.`, 'niveaux');
      n.niveaux = niv;
      ['logoEcole', 'logoIepp', 'armoiries'].forEach((k) => {
        if (d[k] !== undefined) n[k] = d[k] && u.IMG_OK.test(d[k]) ? d[k] : '';
      });
      AK.store.modifier('Paramètres de l’école enregistrés' + (ident && sc.idLock ? ' (identité modifiée)' : ''), (st) => {
        Object.assign(st.school, n);
        st.school.idLock = true;
        // les enseignants ne gardent pas un niveau fermé
        if (fermes.length) st.teachers.forEach((t) => AK.personnel.poserClasses(t, X().clsDe(t).filter((c) => !fermes.includes(c))));
      }, { categorie: 'parametres' });
      identiteOuverte = false;
      return fermes;
    },
    apparence(o) {
      AK.perm.exiger('parametres.gerer');
      const accent = C.ACCENTS.some(([k]) => k === o.accent) ? o.accent : 'navy';
      const theme = ['auto', 'light', 'dark'].includes(o.theme) ? o.theme : 'auto';
      AK.store.modifier('Apparence modifiée', (st) => Object.assign(st.school, { accent, theme, sansAnimation: !!o.sansAnimation }), { categorie: 'parametres', rendu: false });
      AK.ui.appliquerTheme();
    }
  };
  AK.ecole = ecole;

  /* ---------- École ---------- */
  function rendreEcole() {
    const sc = S().school, verrou = sc.idLock && !identiteOuverte;
    const att = (k) => (verrou && IDENTITE.includes(k) ? { disabled: true } : {});
    const identite = html`${verrou ? ui.encadre(html`Identité de l’école verrouillée depuis sa première saisie (elle figure sur tous les documents officiels). <button type="button" class="btn btn-sm" data-action="ecole-deverrouiller">${ic('unlock')}Modifier l’identité…</button>`, 'info', 'lock') : sc.idLock ? ui.encadre('Identité déverrouillée : elle sera de nouveau verrouillée à l’enregistrement.', 'avert', 'unlock') : ''}
      <div class="form-grille">
        ${F.radios({ lib: 'Statut', nom: 'statut', val: sc.statut || 'publique', options: C.STATUTS_ECOLE })}
        <span></span>
        ${F.texte({ lib: 'Nom de l’école', nom: 'name', val: sc.name, req: true, plein: true, attrs: { maxlength: 80, autocapitalize: 'characters', ...att('name') }, aide: 'École publique : commence par EPP (ex. EPP OUANINOU 2).' })}
        ${F.texte({ lib: 'DRENAET', nom: 'drenaet', val: String(sc.drenaet || '').replace(/^DRENAET\s+(DE\s+|D')?/i, ''), req: true, attrs: { autocapitalize: 'characters', ...att('drenaet') } })}
        ${F.texte({ lib: 'IEPP', nom: 'iepp', val: sc.iepp, attrs: { autocapitalize: 'characters', ...att('iepp') } })}
        ${F.texte({ lib: 'Code de l’école', nom: 'codeecole', val: sc.codeecole, attrs: { maxlength: 20, ...att('codeecole') } })}
        ${F.texte({ lib: 'Code DRENAET', nom: 'codedren', val: sc.codedren, attrs: { maxlength: 20, ...att('codedren') } })}
        ${F.texte({ lib: 'Code IEPP', nom: 'codeiep', val: sc.codeiep, attrs: { maxlength: 20, ...att('codeiep') } })}
      </div>`;
    const contacts = html`<div class="form-grille">
      ${F.choix({ lib: 'Civilité du directeur', nom: 'dirCiv', val: V.civ.de(sc.director) || 'M.', options: C.CIVS })}
      ${F.texte({ lib: 'Nom et prénoms du directeur', nom: 'director', val: V.civ.sans(sc.director || ''), attrs: { 'data-input': 'maj-nom-complet', maxlength: 80 } })}
      ${F.tel({ lib: 'Téléphone du directeur', nom: 'dirTel', val: sc.dirTel })}
      ${F.tel({ lib: 'Téléphone de l’école', nom: 'telephone', val: sc.telephone })}
      ${F.texte({ lib: 'Courriel', nom: 'email', val: sc.email, attrs: { type: 'email', maxlength: 120, autocomplete: 'off' } })}
      ${F.texte({ lib: 'Adresse (boîte postale, quartier)', nom: 'adresse', val: sc.adresse, attrs: { maxlength: 120 } })}
      ${F.texte({ lib: 'Localité', nom: 'localite', val: sc.localite, attrs: { maxlength: 60 }, aide: 'Utilisée dans « Fait à … » sur les documents.' })}
      ${F.texte({ lib: 'Sous-préfecture', nom: 'sp', val: sc.sp, attrs: { list: 'dl-sp-ecole', maxlength: 60 } })}
      ${F.texte({ lib: 'Secteur pédagogique', nom: 'secteur', val: sc.secteur, attrs: { maxlength: 60 } })}
      <span></span>
      ${F.texte({ lib: 'Inspecteur (IEPP)', nom: 'inspNom', val: sc.inspNom, attrs: { maxlength: 80 } })}
      ${F.tel({ lib: 'Téléphone de l’inspecteur', nom: 'inspTel', val: sc.inspTel })}
      ${F.texte({ lib: 'Conseiller pédagogique', nom: 'cpNom', val: sc.cpNom, attrs: { maxlength: 80 } })}
      ${F.tel({ lib: 'Téléphone du conseiller', nom: 'cpTel', val: sc.cpTel })}
    </div><datalist id="dl-sp-ecole">${AK.ref.SOUS_PREFECTURES.map((v) => html`<option value="${Array.isArray(v) ? v[1] : v}">`)}</datalist>`;
    const entete = html`<div class="pile">${ui.encadre('Ces lignes forment l’en-tête officiel de tous les documents. Elles sont reprises telles quelles (majuscules comprises).', 'info')}
      <div class="form-grille">
        ${F.zone({ lib: 'Ministère', nom: 'ministere', val: sc.ministere || C.ENTETE.ministere, lignes: 2, plein: true, attrs: { maxlength: 200 } })}
        ${F.zone({ lib: 'Direction régionale', nom: 'direction', val: sc.direction || C.ENTETE.direction, lignes: 2, plein: true, attrs: { maxlength: 200 } })}
        ${F.zone({ lib: 'Inspection', nom: 'inspection', val: sc.inspection || C.ENTETE.inspection, lignes: 2, plein: true, attrs: { maxlength: 200 } })}
        ${F.texte({ lib: 'République', nom: 'republique', val: sc.republique || C.ENTETE.republique, attrs: { maxlength: 200 } })}
        ${F.texte({ lib: 'Devise', nom: 'devise', val: sc.devise || C.ENTETE.devise, attrs: { maxlength: 200 } })}
        ${F.texte({ lib: 'Ligne supplémentaire (facultative)', nom: 'entete', val: sc.entete, plein: true, attrs: { maxlength: 140, placeholder: 'Ex. : Arrêté d’ouverture n° … du …' } })}
        ${F.image({ lib: 'Logo de l’école', nom: 'logoEcole', val: sc.logoEcole, max: 400, typeImg: 'image/png' })}
        ${F.image({ lib: 'Logo de l’IEPP', nom: 'logoIepp', val: sc.logoIepp, max: 400, typeImg: 'image/png' })}
        ${F.image({ lib: 'Armoiries (si différentes de celles fournies)', nom: 'armoiries', val: sc.armoiries, max: 400, typeImg: 'image/png' })}
      </div></div>`;
    const annee = html`<div class="form-grille">
      ${F.texte({ lib: 'Année scolaire', nom: 'year', val: sc.year, req: true, attrs: { placeholder: '2026–2027', maxlength: 9 }, aide: 'Le passage à l’année suivante se fait dans Notes › Fin d’année.' })}
      <span></span>
      ${F.cases({ lib: 'Niveaux ouverts', nom: 'niveaux', options: C.TOUS_NIVEAUX, valeurs: sc.niveaux || [], plein: true, aide: 'Un niveau qui a des élèves inscrits ne peut pas être fermé.' })}
    </div>`;
    return html`${ui.pageTete('Paramètres de l’école', 'Identité, contacts, en-tête des documents, année scolaire et niveaux ouverts.')}
      <form class="carte pile" data-submit="ecole-enregistrer" novalidate autocomplete="off" id="form-ecole">
        ${ui.ongletsForm([['id', 'Identité', identite], ['contacts', 'Direction & contacts', contacts], ['entete', 'En-tête & logos', entete], ['annee', 'Année & niveaux', annee]])}
        <div class="ligne"><span class="mut petit">Dernière modification visible dans Données › Journal.</span><span class="espace"></span><button type="submit" class="btn btn-pri">${ic('save')}Enregistrer</button></div>
      </form>`;
  }

  /* ---------- Calendrier ---------- */
  function rendreCalendrier() {
    const L = S().conges.slice().sort((a, b) => a.du.localeCompare(b.du));
    const x = X(), an = x.anneeRentree();
    const classes = x.niveaux();
    const calendriers = [...new Set(classes.map((c) => x.info(c).cal))];
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return html`${ui.pageTete('Calendrier scolaire', `Année ${S().school.year || an + '–' + (an + 1)}. Les jours fériés et congés sont exclus des jours de classe (appel, autorisations d’absence, rapports).`, html`<button type="button" class="btn btn-pri" data-action="conge-nouveau">${ic('plus')}Ajouter un congé ou jour férié</button>`)}
      <div class="grille g-2-1">
        ${ui.carte('Jours fériés et congés', ui.tableau({
          id: 'conges', lignes: L, unite: 'période', triDefaut: { cle: 'du', sens: 'asc' },
          colonnes: [
            { cle: 'lib', lib: 'Libellé', tri: (c) => c.lib, rendu: (c) => html`<b>${c.lib}</b>` },
            { cle: 'du', lib: 'Du', tri: (c) => c.du, rendu: (c) => u.fmtDate(c.du) },
            { cle: 'au', lib: 'Au', tri: (c) => c.au || c.du, rendu: (c) => (c.au ? u.fmtDate(c.au) : '—') },
            { cle: 'n', lib: 'Jours de classe retirés', cls: 'droite num', rendu: (c) => String(x.joursClasse(c.du, c.au || c.du, []).length) },
            { cle: 'act', lib: '', cls: 'droite', rendu: (c) => html`<button type="button" class="btn-ic" data-action="conge-supprimer" data-id="${c.id}" aria-label="Supprimer ${c.lib}" data-bulle="Supprimer">${ic('trash')}</button>` }
          ],
          vide: ui.vide('Aucun congé enregistré', 'Ajoutez les jours fériés et les vacances du calendrier officiel.')
        }))}
        <div class="pile">
          ${ui.carte('Jours de classe', html`<p class="mb0">${C.JOURS_CLASSE.map((j) => jours[j]).join(', ')} (le mercredi n’est pas un jour de classe), hors jours fériés et congés.</p>`)}
          ${ui.carte('Dates des évaluations (calendrier officiel)', html`<div class="pile-sm">${calendriers.map((cal) => {
            const c0 = classes.find((c) => x.info(c).cal === cal);
            return html`<div><b>${cal === 'CM2' ? 'CM2' : 'Autres niveaux'}</b><div class="liste">${[1, 2, 3, 4].map((n) => html`<div><span class="flex1">${x.evalLabel(c0, n)}</span><span class="m">${u.fmtDate(x.evalDate(c0, n))}</span></div>`)}</div></div>`;
          })}</div>`, { sous: 'Dates fixées par le calendrier national, reprises sur les bulletins' })}
        </div>
      </div>`;
  }

  /* ---------- Apparence ---------- */
  function rendreApparence() {
    const sc = S().school;
    return html`${ui.pageTete('Apparence', 'Couleur d’accent, thème clair ou sombre, animations. N’affecte pas les documents imprimés.')}
      <div class="grille g2">
        ${ui.carte('Couleur d’accent', html`<div class="choix-carte" role="radiogroup" aria-label="Couleur d’accent">${C.ACCENTS.map(([k, coul, lib]) => html`<label><input type="radio" name="accent" value="${k}" data-change="apparence"${(sc.accent || 'navy') === k ? raw(' checked') : ''}> <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${coul};vertical-align:-2px"></span> ${lib}</label>`)}</div>`)}
        ${ui.carte('Thème', html`<div class="choix-carte" role="radiogroup" aria-label="Thème">${[['auto', 'Automatique (réglage de l’appareil)'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => html`<label><input type="radio" name="theme" value="${k}" data-change="apparence"${(sc.theme || 'auto') === k ? raw(' checked') : ''}> ${l}</label>`)}</div>`)}
        ${ui.carte('Animations', html`<label class="coche"><input type="checkbox" name="sansAnimation" data-change="apparence"${sc.sansAnimation ? raw(' checked') : ''}> Réduire les animations (confort visuel, ordinateurs lents)</label><p class="mut petit mb0 mt">Le réglage « réduire les animations » du système est aussi respecté.</p>`)}
        ${ui.carte('Aperçu', html`<div class="pile-sm"><div class="ligne"><button type="button" class="btn btn-pri" tabindex="-1">Bouton principal</button><button type="button" class="btn" tabindex="-1">Bouton</button>${ui.tag('En vigueur', 'ok')}${ui.tag('À vérifier', 'avert')}${ui.tag('Annulé', 'mauvais')}</div>${ui.encadre('Les états sont toujours indiqués par un texte ou une icône, jamais par la seule couleur.', 'info')}</div>`)}
      </div>`;
  }

  /* ---------- Diagnostic ---------- */
  let rapportDiag = null, controle = null;
  function rendreDiagnostic() {
    const S0 = S(), d = rapportDiag;
    if (!d) setTimeout(async () => {
      rapportDiag = await AK.diag.rapport();
      AK.shell.redessiner();
    }, 0);
    const kv = (L) => html`<dl class="kv">${L.map(([k, v]) => html`<dt>${k}</dt><dd>${v ?? '—'}</dd>`)}</dl>`;
    const mo = (o) => (o == null ? '—' : o > 1048576 ? (o / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.round(o / 1024) + ' Ko');
    const erreurs = AK.diag.liste();
    return html`${ui.pageTete('Diagnostic', 'Informations techniques pour l’assistance. Le rapport exporté ne contient aucune donnée personnelle des élèves.', html`<button type="button" class="btn" data-action="diag-controle">${ic('shieldCheck')}Contrôler l’intégrité des données</button><button type="button" class="btn btn-pri" data-action="diag-exporter">${ic('down')}Exporter le rapport</button>`)}
      <div class="grille g2">
        ${ui.carte('Application', kv([['Version', AK.NOM + ' ' + AK.VERSION], ['Hôte', AK.hote.libelle || AK.hote.type], ['Schéma des données', S0.meta && S0.meta.schema], ['Installation', S0.meta && S0.meta.installId ? String(S0.meta.installId).slice(0, 8) + '…' : '—'], ['Navigateur', d ? d.navigateur.replace(/^Mozilla\/5\.0 /, '').slice(0, 90) : '…'], ['Cryptographie (WebCrypto)', d ? (d.webCrypto ? 'disponible' : 'INDISPONIBLE') : '…']]))}
        ${ui.carte('Stockage', html`${kv([['Emplacement', AK.stockage.description()], ['Copies de sécurité locales', AK.stockage.copiesDisponibles() ? 'oui' : 'non disponibles avec ce stockage'], ['Espace utilisé', d && d.quota ? `${mo(d.quota.utilise)} sur ${mo(d.quota.total)}` : '—'], ['Conservation garantie', d ? (d.persistant ? 'oui' : 'non accordée par le navigateur (exportez des sauvegardes)') : '…'], ['État', AK.store.sauvegarde.statut === 'ok' ? 'enregistré' : AK.store.sauvegarde.statut]])}<div class="ligne mt"><a class="btn btn-sm" href="#donnees/sauvegarde">${ic('database')}Sauvegarde & restauration</a></div>`)}
        ${ui.carte('Volumes', kv([['Élèves', `${S0.students.length} (${X().actifs().length} inscrits)`], ['Personnel', S0.teachers.length], ['Notes', Object.keys(S0.grades).length], ['Documents au registre', (S0.docs.items || []).length], ['Entrées du journal', (S0.pro.journal || []).length], ['Éléments en corbeille', S0.corbeille.length]]))}
        ${ui.carte('Contrôle d’intégrité', controle ? (controle.length ? html`<div class="liste">${controle.slice(0, 20).map((p) => html`<div><span class="flex1">${ui.tag(p.gravite === 'erreur' ? 'Erreur' : 'Avertissement', p.gravite === 'erreur' ? 'mauvais' : 'avert')} ${p.message || p.texte || p.code}</span></div>`)}</div>${controle.length > 20 ? html`<p class="mut petit">… et ${controle.length - 20} autre(s) : voir Données › Sauvegarde.</p>` : ''}` : ui.encadre('Aucune incohérence détectée.', 'ok')) : html`<p class="mut mb0">Cliquez sur « Contrôler l’intégrité des données ».</p>`)}
      </div>
      ${ui.carte(`Journal technique (${erreurs.length})`, erreurs.length ? html`<div class="tab-cadre" style="max-height:340px"><table class="tab"><thead><tr><th>Heure</th><th>Niveau</th><th>Message</th></tr></thead><tbody>${erreurs.map((e) => html`<tr><td>${new Date(e.t).toLocaleTimeString('fr-FR')}</td><td>${ui.tag(e.niveau, e.niveau === 'erreur' ? 'mauvais' : e.niveau === 'avert' ? 'avert' : '')}</td><td class="texte">${e.message}</td></tr>`)}</tbody></table></div><div class="ligne mt"><span class="espace"></span><button type="button" class="btn btn-sm" data-action="diag-vider">${ic('trash')}Vider le journal technique</button></div>` : html`<p class="mut mb0">Aucune erreur technique depuis l’ouverture de l’application.</p>`, { cls: 'mt' })}`;
  }

  AK.ecrans.def('parametres/ecole', { rendu: rendreEcole, droit: 'parametres.gerer', apres: (r) => ui.activerOnglets(r) });
  AK.ecrans.def('parametres/calendrier', { rendu: rendreCalendrier, droit: 'parametres.gerer' });
  AK.ecrans.def('parametres/apparence', { rendu: rendreApparence, droit: 'parametres.gerer' });
  AK.ecrans.def('parametres/diagnostic', { rendu: rendreDiagnostic, droit: 'parametres.gerer' });

  AK.actions.def({
    async 'ecole-deverrouiller'() {
      AK.perm.exiger('parametres.gerer');
      if (!(await AK.auth.confirmer('Modifier l’identité de l’école (nom, statut, DRENAET, IEPP, codes). Elle figure sur tous les documents officiels.', { forcer: true }))) return;
      identiteOuverte = true;
      AK.shell.redessiner();
    },
    'conge-nouveau'() {
      ui.fenetre({
        titre: 'Ajouter un jour férié ou un congé', icone: 'cal', ok: 'Ajouter',
        corps: html`<div class="form-grille">${F.texte({ lib: 'Libellé', nom: 'lib', req: true, plein: true, attrs: { maxlength: 80, placeholder: 'Ex. : Congés de Noël, Fête de l’indépendance' } })}${F.date({ lib: 'Du', nom: 'du', req: true })}${F.date({ lib: 'Au (inclus, facultatif)', nom: 'au' })}</div>`,
        surValider(d) {
          AK.absences.ajouterConge(d);
          ui.toast('Ajouté au calendrier.');
        }
      });
    },
    async 'conge-supprimer'(el) {
      const c = S().conges.find((x) => x.id === el.dataset.id);
      if (!c || !(await ui.confirmer({ titre: 'Supprimer du calendrier', danger: true, ok: 'Supprimer', message: `Supprimer « ${c.lib} » ? Ces jours redeviendront des jours de classe.` }))) return;
      AK.absences.supprimerConge(c.id);
      ui.toast('Supprimé du calendrier.');
    },
    async 'diag-controle'() {
      controle = AK.schema.verifier(S());
      AK.shell.redessiner();
    },
    async 'diag-exporter'() {
      const r = rapportDiag || (await AK.diag.rapport());
      await AK.hote.fichier(`akwa-diagnostic-${u.aujourdhui()}.json`, JSON.stringify({ ...r, integrite: (controle || AK.schema.verifier(S())).map((p) => ({ gravite: p.gravite, code: p.code })) }, null, 1), 'application/json');
      ui.toast('Rapport de diagnostic enregistré.');
    },
    async 'diag-vider'() {
      if (!(await ui.confirmer({ titre: 'Vider le journal technique', message: 'Effacer la liste des erreurs techniques de cette session ? (Le journal des opérations n’est pas touché.)', ok: 'Vider' }))) return;
      AK.diag.vider();
      AK.shell.redessiner();
    }
  });
  AK.actions.defEnvoi({
    'ecole-enregistrer'(f) {
      ui.effacerErreurs(f);
      try {
        const fermes = ecole.modifier(ui.lireFormulaire(f));
        ui.toast(fermes.length ? `Paramètres enregistrés. Niveau(x) fermé(s) : ${fermes.join(', ')}.` : 'Paramètres de l’école enregistrés.');
        AK.shell.redessiner();
      } catch (err) {
        if (err && err.name === 'ErreurMetier') ui.erreurChamp(f, err.champ, err.message);
        else throw err;
      }
    }
  });
  AK.actions.defChange({
    apparence(el) {
      const f = el.closest('#contenu');
      const val = (n) => (f.querySelector(`[name="${n}"]:checked`) || {}).value;
      ecole.apparence({ accent: val('accent'), theme: val('theme'), sansAnimation: !!(f.querySelector('[name="sansAnimation"]') || {}).checked });
      ui.toast('Apparence enregistrée.', { duree: 1800 });
    }
  });
})(window.AK);
