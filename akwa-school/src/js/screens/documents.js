/* =====================================================================================
   Documents & cartes : catalogue des modèles, choix des élèves / membres concernés,
   cartes d'identification (planche ou unité), registre des documents émis (copie,
   duplicata, annulation, historique) et vérification (référence, QR scanné, photo).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const R = () => AK.registre;

  const CATEGORIES = [
    ['eleve', 'Documents des élèves', 'Bulletins, certificats, attestations, fiches. Inscrits au registre, avec référence et QR code vérifiable.'],
    ['carte', 'Cartes d’identification', 'Carte scolaire et carte professionnelle : format carte bancaire, planche A4 ou impression à l’unité.'],
    ['personnel', 'Documents du personnel', 'Attestation de service.'],
    ['liste', 'Listes et états', 'États de gestion paginés, datés, sans inscription au registre.'],
    ['rapport', 'Rapports', 'Rapports officiels et générateur : ouverts depuis Rapports & statistiques.'],
    ['autres', 'Documents liés à une opération', 'Produits depuis l’écran de l’opération : demande d’absence, convocation, reçu, emploi du temps…']
  ];
  const RENVOIS = { absence: 'absences/autorisations', vie: 'vie/discipline', finance: 'finances/paiements', rapport: 'rapports/officiels' };
  const RENVOI_MODELE = { 'emploi-du-temps': 'vie/edt', 'cahier-textes': 'vie/cahier', 'convocation-parents': 'vie/discipline', recu: 'finances/paiements', 'journal-caisse': 'finances/paiements', 'rapport-perso': 'rapports/generateur', 'fiche-transmission': 'rapports/liaison', 'synthese-iepp': 'rapports/liaison', 'rapport-infrastructures': 'rapports/stats' };
  const catDe = (d) => (['eleve', 'carte', 'personnel', 'liste', 'rapport'].includes(d.categorie) ? d.categorie : 'autres');
  const accessibleModele = (d) => {
    if (d.categorie === 'rapport') return peut('rapports.officiels');
    if (d.categorie === 'liste') return d.sujet === 'classe' ? AK.session.classes().length > 0 : AK.session.estDirecteur() || peut('document.imprimerClasse', { classe: AK.session.classes()[0] });
    if (d.emission) return peut('document.emettre') || (d.emission.politique === 'unique' && AK.session.classes().some((c) => peut('document.imprimerClasse', { classe: c })));
    return true;
  };

  /* ---------- Catalogue ---------- */
  function rendreCatalogue() {
    const L = AK.modeles.liste().filter(accessibleModele);
    const carte = (d) => {
      const renvoi = RENVOI_MODELE[d.id] || (catDe(d) === 'autres' || d.categorie === 'rapport' ? RENVOIS[d.categorie] : null);
      const perso = AK.modeles.estPersonnalise(d.id);
      return html`<div class="modele-carte">${ic(d.icone || 'file')}<b>${d.lib}</b><small>${d.description || ''}</small>
        <div class="ligne">${d.emission ? ui.tag(d.emission.politique === 'unique' ? 'Référence unique' : 'Registre + QR', 'pri', 'qr') : ''}${perso ? ui.tag('Personnalisé', 'acc') : ''}<span class="mut petit">v${d.version}${perso ? '.' + (AK.modeles.reglages(d.id).rev || 1) : ''}</span></div>
        <div class="ligne mt0">${renvoi ? html`<a class="btn btn-sm" href="#${renvoi}">${ic('chev')}Ouvrir l’écran</a>` : d.categorie === 'carte' ? html`<a class="btn btn-sm btn-pri" href="#documents/cartes?modele=${d.id}">${ic('idCard')}Préparer les cartes</a>` : html`<button type="button" class="btn btn-sm btn-pri" data-action="doc-emettre" data-modele="${d.id}">${ic(d.emission ? 'filePlus' : 'print')}${d.emission ? 'Émettre' : 'Imprimer'}</button>`}
        ${peut('modeles.gerer') ? html`<a class="btn btn-sm btn-ghost" href="#parametres/modeles?modele=${d.id}">${ic('sliders')}Personnaliser</a>` : ''}</div></div>`;
    };
    return html`${ui.pageTete('Émettre un document', 'Chaque document officiel reçoit une référence unique inscrite au registre et, si la clé de l’école est créée, un QR code signé électroniquement.', peut('document.registre') ? html`<a class="btn" href="#documents/registre">${ic('archive')}Registre des documents</a>` : '')}
      ${peut('document.emettre') && !AK.cles.active() && AK.crypto.dispo() ? ui.encadre(html`<b>Signature électronique non configurée.</b> Les documents sont vérifiables par le registre de cet ordinateur seulement. ${peut('cles.gerer') ? html`<a href="#parametres/securite">Créer la clé de signature de l’école</a>.` : ''}`, 'avert', 'shield') : ''}
      ${S().meta.demo ? ui.encadre('Mode démonstration : tous les documents portent le filigrane SPÉCIMEN et ne sont pas signés.', 'info') : ''}
      <div class="pile-lg">${CATEGORIES.map(([k, titre, sous]) => {
        const M = L.filter((d) => catDe(d) === k);
        return M.length ? html`<section><div class="titre-section"><h2>${titre}</h2><span class="mut petit">${sous}</span></div><div class="catalogue">${M.map(carte)}</div></section>` : '';
      })}</div>`;
  }

  /* ---------- Choix des sujets ---------- */
  const PARAMS = { bulletin: 'periode', classement: 'periode' };
  function choisirEleves({ titre, multiple = true, classe, periode, filtre }) {
    return new Promise((resolve) => {
      let res = null;
      const classes = AK.session.classes();
      const c0 = classes.includes(classe) ? classe : classes[0] || '';
      const liste = (c, q) => X().actifs().filter((s) => classes.includes(s.classe) && (!c || s.classe === c) && (!q || u.norm(X().nomComplet(s) + s.mat + (s.matNat || '')).includes(u.norm(q))) && (!filtre || filtre(s))).sort(X().parClasse);
      const lignes = (c, q) => {
        const L = liste(c, q);
        return L.length ? html`${L.map((s) => html`<label class="coche ligne-choix"><input type="${multiple ? 'checkbox' : 'radio'}" name="ids" value="${s.id}"${multiple ? raw(' data-multiple') : ''}> ${ui.avatar(s)}<span class="flex1">${X().nomComplet(s)} <span class="mut petit">· ${s.classe} · ${X().matOf(s)}</span></span>${!s.photo ? html`<span class="mut petit">sans photo</span>` : ''}</label>`)}` : html`<p class="mut">Aucun élève.</p>`;
      };
      ui.fenetre({
        titre, icone: 'users', ok: 'Continuer', proteger: false,
        corps: html`<div class="pile">
          <div class="barre-outils">${F.choix({ lib: 'Classe', nom: 'classe', val: c0, options: classes, vide: 'Toutes les classes', attrs: { 'data-sujets': 'classe' } })}
          ${periode ? F.choix({ lib: 'Période', nom: 'periode', val: periode === true ? S().school.evalCourante || 1 : periode, options: [...[1, 2, 3, 4].map((n) => [n, C.EV_GEN[n - 1]]), ['A', 'Annuel (MGA)']] }) : ''}
          ${F.texte({ lib: 'Rechercher', nom: 'q', attrs: { type: 'search', placeholder: 'Nom ou matricule', 'data-sujets': 'q', autocomplete: 'off' } })}</div>
          ${multiple ? html`<div class="ligne"><button type="button" class="btn btn-sm" data-tout="1">Tout cocher</button><button type="button" class="btn btn-sm btn-ghost" data-tout="0">Tout décocher</button><span class="mut petit" data-nb></span></div>` : ''}
          <div class="liste-choix" data-liste>${lignes(c0, '')}</div></div>`,
        apres(racine) {
          const f = $('form', racine), zone = $('[data-liste]', racine);
          const compter = () => {
            const n = $$('[name=ids]:checked', f).length, el = $('[data-nb]', f);
            if (el) el.textContent = `${n} sélectionné(s)`;
          };
          const maj = () => {
            u.poser(zone, lignes(f.elements.classe.value, f.elements.q.value));
            compter();
          };
          f.elements.classe.addEventListener('change', maj);
          f.elements.q.addEventListener('input', maj);
          f.addEventListener('change', compter);
          racine.addEventListener('click', (e) => {
            const b = e.target.closest('[data-tout]');
            if (!b) return;
            $$('[name=ids]', f).forEach((x) => (x.checked = b.dataset.tout === '1'));
            compter();
          });
          compter();
        },
        surValider(d) {
          const ids = Array.isArray(d.ids) ? d.ids : d.ids ? [d.ids] : [];
          if (!ids.length) throw new AK.ErreurMetier('Choisissez au moins un élève.');
          res = { eleves: ids.map((id) => AK.eleves.trouver(id)).filter(Boolean), periode: d.periode === 'A' ? 'A' : Number(d.periode) || null };
        },
        surFermer: () => resolve(res)
      });
    });
  }
  function choisirAgents(titre) {
    return new Promise((resolve) => {
      let res = null;
      const L = S().teachers.filter((t) => t.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      ui.fenetre({
        titre, icone: 'users', ok: 'Continuer', proteger: false,
        corps: L.length ? html`<div class="liste-choix">${L.map((t) => html`<label class="coche ligne-choix"><input type="checkbox" name="ids" value="${t.id}" data-multiple> ${ui.avatar(t)}<span class="flex1">${t.nom} <span class="mut petit">· ${t.fonction}</span></span>${!t.photo ? html`<span class="mut petit">sans photo</span>` : ''}</label>`)}</div>` : ui.vide('Aucun membre du personnel', ''),
        surValider(d) {
          if (!d.ids || !d.ids.length) throw new AK.ErreurMetier('Choisissez au moins une personne.');
          res = d.ids.map((id) => AK.personnel.trouver(id)).filter(Boolean);
        },
        surFermer: () => resolve(res)
      });
    });
  }
  function choisirClasse(titre, avecPeriode) {
    return new Promise((resolve) => {
      let res = null;
      ui.fenetre({
        titre, icone: 'grid', taille: 'sm', ok: 'Continuer', proteger: false,
        corps: html`<div class="pile">${F.choix({ lib: 'Classe', nom: 'classe', options: AK.session.classes(), req: true })}${avecPeriode ? F.choix({ lib: 'Période', nom: 'periode', val: S().school.evalCourante || 1, options: [...[1, 2, 3, 4].map((n) => [n, C.EV_GEN[n - 1]]), ['A', 'Annuel (MGA)']] }) : ''}</div>`,
        surValider(d) {
          if (!d.classe) throw new AK.ErreurMetier('Choisissez la classe.', 'classe');
          res = { classe: d.classe, periode: d.periode === 'A' ? 'A' : Number(d.periode) || null };
        },
        surFermer: () => resolve(res)
      });
    });
  }

  async function emettre(id) {
    const d = AK.modeles.get(id);
    if (!d) throw new AK.ErreurMetier('Modèle inconnu.');
    if (d.sujet === 'eleve') {
      const r = await choisirEleves({ titre: d.lib, periode: PARAMS[id] ? true : null, filtre: d.refuser ? (s) => !d.refuser({ eleve: s }) : null });
      if (!r) return;
      if (id === 'bulletin') return AK.docsUi.bulletins(r.eleves, r.periode || S().school.evalCourante || 1);
      return AK.docs.ouvrir(id, r.eleves.map((s) => ({ eleve: s })));
    }
    if (d.sujet === 'agent') {
      const L = await choisirAgents(d.lib);
      if (L) AK.docs.ouvrir(id, L.map((t) => ({ agent: t })));
      return;
    }
    if (d.sujet === 'classe') {
      const r = await choisirClasse(d.lib, !!PARAMS[id]);
      if (r) AK.docs.ouvrir(id, [{ classe: r.classe, periode: r.periode }]);
      return;
    }
    return AK.docs.ouvrir(id, [{}]);
  }

  /* ---------- Cartes ---------- */
  const OPTIONS_PLANCHE = () => {
    let o = {};
    try {
      o = JSON.parse(localStorage.getItem('akwa2:planche') || '{}');
    } catch (e) { /* préférence absente */ }
    return { mode: o.mode === 'unitaire' ? 'unitaire' : 'planche', traits: o.traits !== false, verso: !!o.verso, debut: 0 };
  };
  function champsPlanche(idModele, o) {
    const r = AK.modeles.reglages(idModele), f = AK.cartes.format(r);
    const col = Math.max(1, Math.floor((210 - 16 + 2) / (f.l + 2))), lig = Math.max(1, Math.floor((297 - 16 - 6 + 2) / (f.h + 2)));
    return html`<div class="pile">
      <p class="mb0 petit">${ic('idCard')} Format du modèle : <b>${f.lib}</b>${f.cle === 'perso' ? ` (${f.l} × ${f.h} mm)` : ''} · ${peut('modeles.gerer') ? html`<a href="#parametres/modeles?modele=${idModele}">modifier le modèle</a>` : ''}</p>
      ${F.radios({ lib: 'Impression', nom: 'mode', val: o.mode, options: [['planche', `Planche A4 (${col * lig} cartes par feuille, traits de coupe)`], ['unitaire', 'À l’unité (imprimante à cartes, une carte par page)']] })}
      <div class="form-grille">
        ${F.case({ lib: 'Traits de coupe', nom: 'traits', coche: o.traits })}
        ${F.case({ lib: r.carte && r.carte.verso ? 'Imprimer aussi les versos (recto-verso)' : 'Verso désactivé dans le modèle', nom: 'verso', coche: o.verso && r.carte && r.carte.verso, attrs: { disabled: !(r.carte && r.carte.verso) } })}
        ${F.nombre({ lib: 'Commencer à l’emplacement n°', nom: 'debut', val: 1, attrs: { min: 1, max: col * lig, step: 1 }, aide: `Pour réutiliser une feuille entamée (1 à ${col * lig}, de gauche à droite puis de haut en bas).` })}
      </div>
      ${ui.encadre('Imprimez à 100 % (« Taille réelle », sans « Ajuster à la page ») pour obtenir les dimensions exactes. Pour le recto-verso, faites d’abord un essai sur papier ordinaire.', 'info', 'print')}</div>`;
  }
  const lirePlanche = (d) => {
    const o = { mode: d.mode === 'unitaire' ? 'unitaire' : 'planche', traits: !!d.traits, verso: !!d.verso, debut: Math.max(0, (parseInt(d.debut, 10) || 1) - 1) };
    try {
      localStorage.setItem('akwa2:planche', JSON.stringify({ mode: o.mode, traits: o.traits, verso: o.verso }));
    } catch (e) { /* préférence non conservée */ }
    return o;
  };
  /** Cartes pour une liste d'identifiants (élèves ou personnel) : options de planche puis aperçu. */
  function cartes(idModele, ids, options = {}) {
    AK.perm.exiger('document.emettre');
    const d = AK.modeles.get(idModele);
    const eleve = d.sujet === 'eleve';
    const sujets = ids.map((id) => (eleve ? AK.eleves.trouver(id) : AK.personnel.trouver(id))).filter(Boolean);
    if (!sujets.length) throw new AK.ErreurMetier(eleve ? 'Choisissez au moins un élève.' : 'Choisissez au moins un membre du personnel.');
    const sansPhoto = sujets.filter((x) => !x.photo).length;
    ui.fenetre({
      titre: `${d.lib} · ${u.pluriel(sujets.length, eleve ? 'élève' : 'personne')}`, icone: 'idCard', ok: 'Aperçu avant impression', proteger: false,
      corps: html`<div class="pile">${options.duplicataDe ? ui.encadre(html`Duplicata de la carte <b class="mono">${options.duplicataDe}</b> : à l’impression, la carte d’origine sera marquée <b>REMPLACÉE</b> au registre et refusée à la vérification.`, 'avert') : ''}
        ${sansPhoto ? ui.encadre(`${u.pluriel(sansPhoto, 'carte sera imprimée', 'cartes seront imprimées')} sans photo (cadre « PHOTO » vide).`, 'avert', 'image') : ''}${champsPlanche(idModele, OPTIONS_PLANCHE())}</div>`,
      surValider(dd) {
        const planche = lirePlanche(dd);
        setTimeout(() => AK.docs.ouvrir(idModele, sujets.map((x) => (eleve ? { eleve: x } : { agent: x })), {
          planche, duplicataDe: options.duplicataDe, titre: options.duplicataDe ? `Duplicata · ${d.lib}` : undefined,
          surEmission: options.duplicataDe ? (g) => g.docs[0] && R().remplacer(options.duplicataDe, g.docs[0].ref) : undefined
        }).catch(ui.erreur), 30);
      }
    });
  }
  function rendreCartes(p) {
    const idModele = p.modele === 'carte-agent' ? 'carte-agent' : 'carte-eleve';
    const eleve = idModele === 'carte-eleve';
    const classes = AK.session.classes();
    const c = classes.includes(p.classe) ? p.classe : '';
    const L = eleve ? X().actifs().filter((s) => classes.includes(s.classe) && (!c || s.classe === c)).sort(X().parClasse) : S().teachers.filter((t) => t.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const r = AK.modeles.reglages(idModele), f = AK.cartes.format(r);
    const dernieres = new Map();
    (S().docs.items || []).filter((d) => d.type === (eleve ? 'CEL' : 'CPE') && d.statut === 'valide' && d.sujet).forEach((d) => dernieres.set(d.sujet.id, d));
    return html`${ui.pageTete('Cartes d’identification', `${f.lib}. Photo, nom, matricule et QR code de vérification (référence, nom et matricule seulement : jamais de téléphone, de santé ni d’acte de naissance).`, html`${peut('modeles.gerer') ? html`<a class="btn" href="#parametres/modeles?modele=${idModele}">${ic('sliders')}Modèle de la carte</a>` : ''}<button type="button" class="btn" data-action="carte-specimen" data-modele="${idModele}">${ic('eye')}Spécimen</button>`)}
      <div class="barre-outils">${ui.pilules([['carte-eleve', 'Élèves'], ['carte-agent', 'Personnel']], idModele, 'cartes-type')}${eleve ? html`<select class="inp inp-sm" data-change="cartes-classe" aria-label="Classe">${ui.options(classes, c, 'Toutes les classes')}</select>` : ''}</div>
      ${ui.tableau({
        id: 'cartes-' + idModele, lignes: L, selection: true, unite: eleve ? 'élève' : 'membre', parPage: 100, recherche: (x) => (eleve ? X().nomComplet(x) + x.mat + (x.matNat || '') : x.nom + x.matricule),
        actionsSelection: (ids) => html`<button type="button" class="btn btn-sm btn-pri" data-action="cartes-imprimer" data-modele="${idModele}">${ic('print')}Préparer ${u.pluriel(ids.length, 'carte')}</button>`,
        colonnes: [
          { cle: 'nom', lib: eleve ? 'Élève' : 'Membre', tri: (x) => (eleve ? X().nomComplet(x) : x.nom), rendu: (x) => (eleve ? ui.quiEleve(x) : html`<div class="qui">${ui.avatar(x)}${ui.nomAgent(x)}</div>`) },
          eleve ? { cle: 'c', lib: 'Classe', tri: (x) => C.TOUS_NIVEAUX.indexOf(x.classe), rendu: (x) => x.classe } : { cle: 'f', lib: 'Fonction', tri: (x) => x.fonction, rendu: (x) => x.fonction },
          { cle: 'photo', lib: 'Photo', tri: (x) => (x.photo ? 1 : 0), rendu: (x) => (x.photo ? ui.tag('Oui', 'ok') : ui.tag('Manquante', 'avert')) },
          { cle: 'carte', lib: 'Carte en vigueur', tri: (x) => (dernieres.get(x.id) ? dernieres.get(x.id).emisLe : ''), rendu: (x) => {
            const d = dernieres.get(x.id);
            return d ? html`<a class="mono petit" href="#documents/registre?ref=${d.ref}">${d.ref}</a><br><span class="mut petit">${u.fmtDate(d.emisLe.slice(0, 10))}${d.expire ? ' · jusqu’au ' + u.fmtDate(d.expire) : ''}</span>` : html`<span class="mut">—</span>`;
          } }
        ],
        vide: ui.vide(eleve ? 'Aucun élève inscrit' : 'Aucun membre du personnel', '')
      })}`;
  }

  /* ---------- Registre ---------- */
  const STATUTS_DOC = { valide: ['En vigueur', 'ok'], annule: ['Annulé', 'mauvais'], remplace: ['Remplacé', 'mauvais'], expire: ['Expiré', 'avert'] };
  function rendreRegistre(p) {
    const items = (S().docs.items || []).slice().reverse();
    const L = items.filter((d) => (!p.type || d.type === p.type) && (!p.statut || R().statutEffectif(d) === p.statut) && (!p.annee || d.annee === p.annee));
    const st = ui.tableauEtat('registre');
    if (p.ref && st.q !== p.ref && !st._refApplique) {
      st.q = p.ref;
      st._refApplique = p.ref;
    }
    const annees = [...new Set(items.map((d) => d.annee).filter(Boolean))];
    const filtres = html`<select class="inp inp-sm" data-change="registre-filtre" data-f="type" aria-label="Type">${ui.options(Object.entries(R().TYPES), p.type, 'Tous les types')}</select><select class="inp inp-sm" data-change="registre-filtre" data-f="statut" aria-label="Statut">${ui.options(Object.entries(STATUTS_DOC).map(([k, [l]]) => [k, l]), p.statut, 'Tous les statuts')}</select>${annees.length > 1 ? html`<select class="inp inp-sm" data-change="registre-filtre" data-f="annee" aria-label="Année">${ui.options(annees, p.annee, 'Toutes les années')}</select>` : ''}`;
    const nb = (k) => items.filter((d) => R().statutEffectif(d) === k).length;
    return html`${ui.pageTete('Registre des documents', 'Tous les documents émis, avec leur statut. Rien n’est jamais effacé : un document annulé reste inscrit avec son motif.', html`<button type="button" class="btn" data-action="verificateur-exporter">${ic('down')}Outil de vérification autonome</button>`)}
      <div class="grille g4 mb">${ui.kpi({ icone: 'archive', lib: 'Documents émis', val: items.length, sous: `${items.filter((d) => d.signe).length} signé(s) électroniquement` })}${ui.kpi({ icone: 'checkCircle', lib: 'En vigueur', val: nb('valide'), ton: 'ok' })}${ui.kpi({ icone: 'ban', lib: 'Annulés ou remplacés', val: nb('annule') + nb('remplace'), ton: nb('annule') + nb('remplace') ? 'avert' : '' })}${ui.kpi({ icone: 'clock', lib: 'Expirés', val: nb('expire') })}</div>
      ${ui.tableau({
        id: 'registre', lignes: L, cleId: (d) => d.ref, filtres, unite: 'document', parPage: 50, exporter: 'registre-documents', placeholder: 'Référence, nom, type…',
        recherche: (d) => d.ref + ' ' + R().libelleType(d.type) + ' ' + (d.sujet ? d.sujet.libelle : '') + ' ' + (d.emisPar || ''),
        colonnes: [
          { cle: 'ref', lib: 'Référence', tri: (d) => d.ref, rendu: (d) => html`<button type="button" class="lien mono" data-action="doc-details" data-ref="${d.ref}">${d.ref}</button>${d.demo ? html`<br>${ui.tag('Démonstration')}` : ''}`, csv: (d) => d.ref },
          { cle: 'type', lib: 'Document', tri: (d) => R().libelleType(d.type), rendu: (d) => html`${R().libelleType(d.type)}${(d.versions || []).length ? html`<br><span class="mut petit">${u.pluriel(d.versions.length + 1, 'version')}</span>` : ''}`, csv: (d) => R().libelleType(d.type) },
          { cle: 'sujet', lib: 'Concerne', tri: (d) => (d.sujet ? d.sujet.libelle : ''), rendu: (d) => (d.sujet ? d.sujet.libelle : '—'), csv: (d) => (d.sujet ? d.sujet.libelle : '') },
          { cle: 'emis', lib: 'Émis le', tri: (d) => d.emisLe, rendu: (d) => html`${u.fmtDate(d.emisLe.slice(0, 10))}<br><span class="mut petit">${d.emisPar || ''}</span>`, csv: (d) => d.emisLe.slice(0, 10) },
          { cle: 'statut', lib: 'Statut', tri: (d) => R().statutEffectif(d), rendu: (d) => { const [l, t] = STATUTS_DOC[R().statutEffectif(d)] || ['?', '']; return html`${ui.tag(l, t)}${d.signe ? html` <span data-bulle="Signé électroniquement (clé ${d.kid})">${ic('shieldCheck', 'i-sm')}</span>` : ''}`; }, csv: (d) => (STATUTS_DOC[R().statutEffectif(d)] || ['?'])[0] },
          { cle: 'imp', lib: 'Impr.', cls: 'droite num', tri: (d) => (d.impressions || []).length, rendu: (d) => (d.impressions || []).length },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (d) => html`<button type="button" class="btn-ic" data-action="doc-actions" data-ref="${d.ref}" aria-label="Actions pour ${d.ref}" aria-haspopup="menu">${ic('more')}</button>` }
        ],
        vide: ui.vide('Aucun document émis', items.length ? 'Aucun document ne correspond aux filtres.' : 'Les documents émis (certificats, cartes, bulletins…) apparaîtront ici.')
      })}`;
  }
  function details(d) {
    const st = R().statutEffectif(d), [l, t] = STATUTS_DOC[st] || ['?', ''];
    const cle = d.kid ? AK.cles.liste().find((k) => k.id === d.kid) : null;
    ui.fenetre({
      titre: `${R().libelleType(d.type)} · ${d.ref}`, icone: 'file', taille: 'lg', ok: 'Fermer', annuler: false, proteger: false,
      corps: html`<div class="grille g-2-1"><div class="pile">
        <dl class="kv"><dt>Statut</dt><dd>${ui.tag(l, t)}</dd><dt>Concerne</dt><dd>${d.sujet ? d.sujet.libelle : '—'}</dd><dt>Émis le</dt><dd>${new Date(d.emisLe).toLocaleString('fr-FR')} par ${d.emisPar || '—'}</dd><dt>Année scolaire</dt><dd>${d.annee || '—'}</dd><dt>Validité</dt><dd>${d.expire ? 'jusqu’au ' + u.fmtDate(d.expire) : 'sans date de fin'}</dd>
          <dt>Signature</dt><dd>${d.signe ? `Clé ${d.kid}${cle ? ' · ' + cle.empreinte + ' · ' + cle.statut : ''}` : 'Non signé (vérification par le registre)'}</dd><dt>Empreinte</dt><dd class="mono">${d.H || '—'}</dd><dt>Modèle</dt><dd>${(AK.modeles.get(d.modele) || {}).lib || d.modele} (version ${d.modeleVersion || '?'})</dd>
          ${d.duplicataDe ? html`<dt>Duplicata de</dt><dd class="mono">${d.duplicataDe}</dd>` : ''}${d.remplacePar ? html`<dt>Remplacé par</dt><dd class="mono">${d.remplacePar}</dd>` : ''}
          ${d.annulation ? html`<dt>${st === 'remplace' ? 'Remplacement' : 'Annulation'}</dt><dd>${new Date(d.annulation.le).toLocaleString('fr-FR')} par ${d.annulation.par || '—'} : ${d.annulation.motif}</dd>` : ''}</dl>
        <h3 class="petit">Historique des impressions</h3><div class="liste">${(d.impressions || []).slice().reverse().map((i) => html`<div><span class="flex1">${{ original: 'Original', copie: 'Copie', reimpression: 'Réimpression', duplicata: 'Duplicata' }[i.type] || i.type}</span><span class="m">${new Date(i.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${i.par || ''}</span></div>`)}</div>
        ${(d.versions || []).length ? html`<h3 class="petit">Versions antérieures</h3><div class="liste">${d.versions.map((v) => html`<div><span class="flex1 mono petit">${v.H}</span><span class="m">${u.fmtDate(String(v.le).slice(0, 10))}</span></div>`)}</div>` : ''}
      </div><div class="pile">${d.qr ? html`<div style="max-width:220px">${AK.qr.svg(d.qr, { titre: 'QR code du document ' + d.ref })}</div><p class="mut petit mb0">Contenu du QR : ${d.qr.length} caractères (${d.qrIdentite ? 'référence, nom et matricule' : 'référence et empreinte seulement'}).</p>` : html`<p class="mut">Document sans QR code.</p>`}</div></div>`
    });
  }
  async function copie(d) {
    AK.perm.exiger('document.registre');
    const c = await AK.docs.conforme(d);
    if (!c.ok) {
      const nouveau = c.ctx && peut('document.emettre');
      const ok = await ui.confirmer({ titre: 'Copie impossible', icone: 'warn', message: c.motif, ok: nouveau ? 'Émettre un nouveau document' : 'Fermer', annuler: nouveau ? 'Annuler' : false });
      if (ok && nouveau) AK.docs.ouvrir(d.modele, [c.ctx]);
      return;
    }
    const m = AK.modeles.get(d.modele);
    return AK.docs.ouvrir(d.modele, [c.ctx], { copie: true, reutiliser: [d], titre: `Copie · ${d.ref}`, planche: m && m.categorie === 'carte' ? OPTIONS_PLANCHE() : undefined });
  }
  async function annuler(d) {
    AK.perm.exiger('document.annuler');
    ui.fenetre({
      titre: `Annuler ${d.ref}`, icone: 'ban', taille: 'sm', danger: true, ok: 'Annuler le document', okStyle: 'dng', annuler: 'Retour',
      corps: html`<div class="pile"><p class="mb0">${R().libelleType(d.type)}${d.sujet ? ' · ' + d.sujet.libelle : ''}</p>
        ${F.zone({ lib: 'Motif de l’annulation', nom: 'motif', req: true, lignes: 2, attrs: { maxlength: 300, placeholder: 'Ex. : erreur sur la date de naissance ; document remplacé' } })}
        ${ui.encadre('Le document reste au registre. Toute vérification (QR code ou référence) le signalera comme ANNULÉ. Les outils de vérification autonomes déjà distribués ne le sauront qu’après mise à jour.', 'avert')}</div>`,
      async surValider(dd) {
        if (String(dd.motif || '').trim().length < 3) throw new AK.ErreurMetier('Indiquez le motif de l’annulation.', 'motif');
        if (!(await AK.auth.confirmer(`Annuler le document ${d.ref}.`))) return false;
        R().annuler(d.ref, dd.motif);
        ui.toast(`Document ${d.ref} annulé.`);
      }
    });
  }
  function duplicata(d) {
    AK.perm.exiger('document.emettre');
    const m = AK.modeles.get(d.modele);
    if (!m) throw new AK.ErreurMetier('Modèle de document introuvable.');
    const ctx = AK.docs.contexteDe(d);
    if (m.categorie === 'carte') return cartes(d.modele, [d.sujet.id], { duplicataDe: d.ref });
    return AK.docs.ouvrir(d.modele, [ctx], { duplicataDe: d.ref, titre: `Duplicata · ${m.lib}`, surEmission: (g) => g.docs[0] && R().remplacer(d.ref, g.docs[0].ref) });
  }

  /* ---------- Vérification ---------- */
  const entreeRegistre = (d, avecNom) => (d ? { e: d.emisLe.slice(0, 10), n: avecNom && d.sujet ? d.sujet.libelle : '', h: d.H, v: (d.versions || []).map((v) => v.H), s: d.statut, a: d.annulation ? d.annulation.le.slice(0, 10) : null, motif: d.annulation ? d.annulation.motif : '', remplacePar: d.remplacePar || '', x: d.expire || null, demo: !!d.demo } : null);
  const sourceLocale = () => ({ cles: AK.cles.publiques().map((c) => ({ ...c, ecole: c.ecole || S().school.name })), trouver: (ref) => entreeRegistre(R().trouver(ref), true), aujourdhui: u.aujourdhui() });
  let dernierResultat = null, camera = null;

  async function verifierTexte(t) {
    if (!String(t || '').trim()) throw new AK.ErreurMetier('Saisissez une référence ou collez le contenu du QR code.', 'texte');
    dernierResultat = await AK.verif.verifier(t, sourceLocale());
    AK.store.journaliser(`Vérification : ${dernierResultat.ref || 'contenu non reconnu'} → ${dernierResultat.verdict}`, 'verification');
    const z = $('#verif-resultat');
    if (z) u.poser(z, resultatHtml(dernierResultat));
    else AK.shell.redessiner();
  }
  const resultatHtml = (Rr) => html`${AK.verif.rendu(Rr)}${Rr.ref && R().trouver(Rr.ref) && peut('document.registre') ? html`<div class="ligne mt"><button type="button" class="btn btn-sm" data-action="doc-details" data-ref="${Rr.ref}">${ic('file')}Détails au registre</button></div>` : ''}
    <p class="mut petit mt">Rappel : la signature prouve que le contenu du QR n’a pas été modifié et qui l’a émis. Le statut (annulé, remplacé) n’est connu que par le registre à jour. Comparez toujours le nom et la photo avec le document présenté.</p>`;
  function rendreVerifier(p) {
    if (p.ref && (!dernierResultat || dernierResultat.ref !== AK.valid.normRef(p.ref))) setTimeout(() => verifierTexte(p.ref).catch(ui.erreur), 0);
    const sc = S().school;
    return html`${ui.pageTete('Vérifier un document', 'Scannez le QR code d’un document ou d’une carte, importez-en une photo, ou saisissez sa référence.')}
      <div class="grille g2">
        <div class="pile">
          ${ui.carte('Référence ou contenu du QR', html`<form data-submit="verif-texte" class="pile" autocomplete="off">${F.texte({ lib: 'Référence (AK-XXX-AAAA-NNNNNN-C) ou texte lu par une douchette', nom: 'texte', id: 'verif-texte', val: p.ref || '', attrs: { autofocus: true, spellcheck: 'false', placeholder: 'AK-CSC-2026-000012-7' } })}<div class="ligne"><button type="submit" class="btn btn-pri">${ic('shieldCheck')}Vérifier</button></div></form>`)}
          ${ui.carte('Caméra ou photo', html`<div class="pile">
            <div class="camera" id="camera" hidden><video playsinline muted></video><div class="viseur"></div></div>
            <div class="ligne"><button type="button" class="btn" data-action="verif-camera" id="btn-camera">${ic('cam')}Scanner avec la caméra</button><label class="btn">${ic('image')}Importer une photo du QR<input type="file" accept="image/*" hidden data-change="verif-photo"></label></div>
            <p class="mut petit mb0">Le QR code est lu sur cet appareil, hors ligne. La caméra nécessite l’autorisation du navigateur (ou de l’application).</p></div>`)}
        </div>
        <div id="verif-resultat">${dernierResultat ? resultatHtml(dernierResultat) : ui.carte('', ui.vide('En attente d’un document', 'Le résultat détaille séparément : l’intégrité (signature), l’émetteur (clé), l’inscription au registre et le statut (annulé, remplacé, expiré).'))}</div>
      </div>
      ${peut('document.registre') ? ui.carte('Vérification par d’autres personnes', html`<p>L’<b>outil de vérification autonome</b> est un fichier HTML à remettre à l’IEPP, à un autre établissement ou à un parent. Il contient les clés <b>publiques</b> de ${sc.name || 'l’école'} et une copie datée du registre (références et statuts ; noms en option). Il ne contient aucune clé privée ni mot de passe et fonctionne hors ligne.</p>
        <p class="mb0 mut petit">Limite : un document annulé après la date de la copie apparaîtra encore « en vigueur » dans un outil ancien. Redistribuez l’outil après chaque annulation importante.</p>`, { actions: html`<button type="button" class="btn btn-pri" data-action="verificateur-exporter">${ic('down')}Créer l’outil</button>` }) : ''}`;
  }
  async function demarrerCamera() {
    const zone = $('#camera'), video = zone && $('video', zone);
    if (!video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new AK.ErreurMetier('Caméra non disponible dans ce navigateur. Importez une photo du QR code.');
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      throw new AK.ErreurMetier(e && e.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez-le dans le navigateur, ou importez une photo.' : 'Caméra indisponible. Importez une photo du QR code.');
    }
    zone.hidden = false;
    video.srcObject = flux;
    await video.play().catch(() => {});
    camera = { flux, actif: true };
    $('#btn-camera').lastChild.textContent = 'Arrêter la caméra';
    const boucle = async () => {
      if (!camera || !camera.actif || !document.body.contains(video)) return arreterCamera();
      if (video.readyState >= 2) {
        let t = null;
        try {
          t = await AK.qrdecode.lireSource(video, { rapide: true });
        } catch (e) { /* image suivante */ }
        if (t) {
          arreterCamera();
          if (navigator.vibrate) navigator.vibrate(80);
          const inp = $('#verif-texte');
          if (inp) inp.value = t.length > 120 ? t.slice(0, 117) + '…' : t;
          return verifierTexte(t).catch(ui.erreur);
        }
      }
      setTimeout(boucle, 220);
    };
    boucle();
  }
  function arreterCamera() {
    if (camera) {
      camera.actif = false;
      camera.flux.getTracks().forEach((t) => t.stop());
      camera = null;
    }
    const zone = $('#camera');
    if (zone) zone.hidden = true;
    const b = $('#btn-camera');
    if (b) b.lastChild.textContent = 'Scanner avec la caméra';
  }
  addEventListener('hashchange', arreterCamera);

  /* Outil de vérification autonome : modèle intégré + clés publiques + copie du registre. */
  function exporterVerificateur() {
    AK.perm.exiger('document.registre');
    if (!AK.gabaritVerificateur) throw new AK.ErreurMetier('Modèle de l’outil de vérification absent de cette version.');
    ui.fenetre({
      titre: 'Outil de vérification autonome', icone: 'shieldCheck', ok: 'Créer le fichier', proteger: false,
      corps: html`<div class="pile"><p class="mb0">Fichier HTML hors ligne, à ouvrir dans un navigateur ou une application. Contenu :</p>
        <ul class="mb0"><li>clés <b>publiques</b> de signature (${u.pluriel(AK.cles.liste().length, 'clé')}) avec leur statut ;</li><li>copie du registre au ${u.fmtDate(u.aujourdhui())} : ${u.pluriel((S().docs.items || []).filter((d) => !d.demo).length, 'référence')}, empreintes et statuts.</li></ul>
        ${F.case({ lib: 'Inclure les noms des titulaires (aide à la comparaison ; à ne remettre qu’à des destinataires de confiance)', nom: 'noms' })}
        ${ui.encadre('Aucune clé privée, aucun mot de passe, aucune donnée de santé ni téléphone ne sont inclus.', 'ok', 'shield')}</div>`,
      async surValider(d) {
        const donnees = {
          format: 'akwa-verification', version: 1, cree: new Date().toISOString(), registreDate: u.aujourdhui(),
          ecole: { nom: S().school.name, iepp: S().school.iepp, drenaet: S().school.drenaet },
          cles: AK.cles.publiques(), registre: R().exportVerification({ avecNoms: !!d.noms })
        };
        const json = JSON.stringify(donnees).replace(/</g, '\\u003c');
        const page = AK.gabaritVerificateur.replace('/*@DONNEES*/null', () => json);
        const nom = `AKWA_verification_${u.sansAccents(S().school.name || 'ecole').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${u.aujourdhui()}.html`;
        await AK.hote.fichier(nom, page, 'text/html');
        AK.store.journaliser(`Outil de vérification exporté (${donnees.registre.length} références${d.noms ? ', avec noms' : ''})`, 'documents');
        ui.toast('Outil de vérification enregistré : ' + nom);
      }
    });
  }

  AK.ecrans.def('documents/emettre', { rendu: rendreCatalogue });
  AK.ecrans.def('documents/cartes', { rendu: rendreCartes, droit: 'document.emettre' });
  AK.ecrans.def('documents/registre', { rendu: rendreRegistre, droit: 'document.registre' });
  AK.ecrans.def('documents/verifier', { rendu: rendreVerifier, droit: 'verification.utiliser', apres: () => { const i = $('#verif-texte'); if (i && !i.value) i.focus(); } });

  AK.docsUi = Object.assign(AK.docsUi || {}, { cartes, choisirEleves, choisirAgents, choisirClasse, emettre, copie, sourceLocale });

  const docDe = (el) => {
    const d = R().trouver(el.dataset.ref);
    if (!d) throw new AK.ErreurMetier('Document introuvable au registre.');
    return d;
  };
  AK.actions.def({
    'doc-emettre': (el) => emettre(el.dataset.modele),
    'cartes-type': (el) => AK.shell.aller('documents/cartes', { modele: el.dataset.v }),
    'cartes-imprimer': (el) => cartes(el.dataset.modele, ui.tableauChoix('cartes-' + el.dataset.modele)),
    'carte-specimen'(el) {
      const id = el.dataset.modele, d = AK.modeles.get(id);
      const ex = d.sujet === 'eleve' ? X().actifs()[0] : S().teachers[0];
      const ctx = d.sujet === 'eleve' ? { eleve: ex || { id: 'x', nom: 'NOM', prenoms: 'Prénoms', classe: 'CE1', mat: 'AK-26001', sexe: 'Féminin', naissance: '2017-03-12', statut: 'Inscrit' } } : { agent: ex || { id: 'x', nom: 'M. NOM Prénoms', fonction: 'Instituteur', matricule: '000000A', classes: [] } };
      AK.docs.ouvrir(id, [ctx], { apercu: true, titre: `Spécimen · ${d.lib}`, planche: { mode: 'unitaire' } });
    },
    'doc-details': (el) => details(docDe(el)),
    'doc-actions'(el) {
      const d = docDe(el), st = R().statutEffectif(d), m = AK.modeles.get(d.modele);
      const items = [{ icone: 'file', lib: 'Détails et historique', f: () => details(d) }, { icone: 'shieldCheck', lib: 'Vérifier', f: () => AK.shell.aller('documents/verifier', { ref: d.ref }) }];
      if (m && d.sujet) items.push({ icone: 'copy', lib: st === 'valide' ? 'Imprimer une copie' : 'Réimprimer (mention ANNULÉ)', sous: 'Même référence, mention COPIE', f: () => copie(d) });
      if (m && d.sujet && d.politique !== 'unique' && st === 'valide' && peut('document.emettre')) items.push({ icone: 'refresh', lib: 'Duplicata (perte, détérioration)', sous: 'Nouvelle référence ; l’original devient « remplacé »', f: () => duplicata(d) });
      if (d.statut === 'valide' && peut('document.annuler')) items.push('sep', { icone: 'ban', lib: 'Annuler le document', danger: true, f: () => annuler(d) });
      ui.menu(el, items, d.ref);
    },
    'verif-camera': () => (camera ? arreterCamera() : demarrerCamera()),
    'verificateur-exporter': () => exporterVerificateur()
  });
  AK.actions.defEnvoi({
    'verif-texte': (f) => verifierTexte(f.elements.texte.value)
  });
  AK.actions.defChange({
    'cartes-classe': (el) => AK.shell.aller('documents/cartes', { ...AK.shell.params(), classe: el.value }),
    'registre-filtre'(el) {
      const p = { ...AK.shell.params(), [el.dataset.f]: el.value };
      delete p.ref;
      Object.keys(p).forEach((k) => !p[k] && delete p[k]);
      AK.shell.aller('documents/registre', p);
    },
    async 'verif-photo'(el) {
      const f = el.files && el.files[0];
      el.value = '';
      if (!f) return;
      const t0 = ui.toast('Lecture du QR code…', { type: 'attente', duree: 0 });
      let t;
      try {
        t = await AK.qrdecode.lireFichier(f);
      } finally {
        t0.fermer();
      }
      if (!t) throw new AK.ErreurMetier('Aucun QR code lisible sur cette image. Recadrez la photo sur le QR code, bien éclairé et net.');
      const inp = $('#verif-texte');
      if (inp) inp.value = t.length > 120 ? t.slice(0, 117) + '…' : t;
      await verifierTexte(t);
    }
  });
})(window.AK);
