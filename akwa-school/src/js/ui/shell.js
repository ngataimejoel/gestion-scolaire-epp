/* =====================================================================================
   Coque de l'application : navigation (menu latéral, onglets, fil d'Ariane), routage par
   l'adresse (#section/onglet?param=valeur), barre supérieure (recherche, enregistrement,
   alertes, profil), tiroir de fiche, bandeaux d'information, verrouillage.
   Chaque écran s'enregistre avec AK.ecrans.def(route, { titre, rendu, apres, droit }).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui;
  const S = () => AK.store.etat;
  const X = () => AK.calc;

  /* ---------- Plan de navigation ---------- */
  const SECTIONS = [
    { grp: 'Pilotage' },
    { id: 'accueil', lib: 'Tableau de bord', court: 'Accueil', ic: 'home' },
    { grp: 'Scolarité' },
    { id: 'eleves', lib: 'Élèves & classes', court: 'Élèves', ic: 'users', onglets: [['eleves/liste', 'Registre des élèves'], ['eleves/classes', 'Classes'], ['eleves/import', 'Import Excel']] },
    { id: 'notes', lib: 'Notes & bulletins', court: 'Notes', ic: 'award', onglets: [['notes/saisie', 'Saisie des notes'], ['notes/resultats', 'Résultats & bulletins'], ['notes/validation', 'Validation des saisies'], ['notes/fin', 'Fin d’année']] },
    { id: 'absences', lib: 'Absences', court: 'Absences', ic: 'cal', onglets: [['absences/appel', 'Appel du jour'], ['absences/autorisations', 'Autorisations']] },
    { grp: 'Équipe' },
    { id: 'personnel', lib: 'Personnel', court: 'Personnel', ic: 'brief', onglets: [['personnel/liste', 'Personnel'], ['personnel/comptes', 'Comptes enseignants'], ['personnel/messages', 'Messages']] },
    { grp: 'Vie de l’école' },
    { id: 'vie', lib: 'Vie scolaire', court: 'Vie', ic: 'heart', onglets: [['vie/edt', 'Emploi du temps'], ['vie/cahier', 'Cahier de textes'], ['vie/discipline', 'Discipline'], ['vie/sante', 'Infirmerie'], ['vie/calendrier', 'Calendrier']] },
    { id: 'finances', lib: 'Scolarité & finances', court: 'Finances', ic: 'coin', onglets: [['finances/paiements', 'Frais & versements'], ['finances/depenses', 'Dépenses'], ['finances/cantine', 'Cantine']] },
    { id: 'services', lib: 'Services', court: 'Services', ic: 'star', onglets: [['services/biblio', 'Bibliothèque'], ['services/cepe', 'Examen du CEPE'], ['services/parents', 'Parents & annonces']] },
    { grp: 'Documents' },
    { id: 'documents', lib: 'Documents & cartes', court: 'Documents', ic: 'idCard', onglets: [['documents/emettre', 'Émettre un document'], ['documents/cartes', 'Cartes d’identification'], ['documents/registre', 'Registre des documents'], ['documents/verifier', 'Vérifier un document']] },
    { id: 'rapports', lib: 'Rapports & statistiques', court: 'Rapports', ic: 'book', onglets: [['rapports/officiels', 'Rapports officiels'], ['rapports/generateur', 'Générateur'], ['rapports/stats', 'Statistiques'], ['rapports/liaison', 'Transmission IEPP']] },
    { grp: 'Administration' },
    { id: 'donnees', lib: 'Données & sauvegarde', court: 'Données', ic: 'database', onglets: [['donnees/sauvegarde', 'Sauvegarde & restauration'], ['donnees/export', 'Exports'], ['donnees/journal', 'Journal des opérations'], ['donnees/corbeille', 'Corbeille']] },
    { id: 'parametres', lib: 'Paramètres', court: 'Paramètres', ic: 'sliders', onglets: [['parametres/ecole', 'École'], ['parametres/modeles', 'Modèles de documents'], ['parametres/securite', 'Sécurité & signature'], ['parametres/calendrier', 'Calendrier'], ['parametres/apparence', 'Apparence'], ['parametres/diagnostic', 'Diagnostic']] }
  ];
  const ecrans = new Map();
  AK.ecrans = {
    def(route, o) {
      ecrans.set(route, o);
    },
    existe: (r) => ecrans.has(r),
    SECTIONS
  };
  const accessible = (route) => {
    const e = ecrans.get(route);
    return !!e && (!e.droit || AK.perm.peut(e.droit));
  };
  const ongletsVisibles = (sec) => (sec.onglets || []).filter(([r]) => accessible(r));
  const sectionDe = (route) => SECTIONS.find((s) => s.id && (route === s.id || route.startsWith(s.id + '/')));

  /* ---------- Adresse ---------- */
  function lireAdresse() {
    const h = decodeURIComponent((location.hash || '#accueil').slice(1));
    const [chemin, q] = h.split('?');
    const params = {};
    new URLSearchParams(q || '').forEach((v, k) => (params[k] = v));
    return { chemin: chemin || 'accueil', params };
  }
  function resoudre(chemin) {
    if (ecrans.has(chemin) && accessible(chemin)) return chemin;
    const sec = SECTIONS.find((s) => s.id === chemin.split('/')[0]);
    if (sec) {
      const o = ongletsVisibles(sec)[0];
      if (o) return o[0];
      if (accessible(sec.id)) return sec.id;
    }
    return 'accueil';
  }
  /** Va vers un écran ; params : filtres transmis à l'écran (ex. { classe: 'CP1' }). */
  function aller(route, params) {
    const q = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const cible = '#' + route + q;
    if (location.hash === cible) dessiner();
    else location.hash = cible;
  }

  /* ---------- Squelette ---------- */
  function construire() {
    document.body.insertAdjacentHTML('afterbegin', String(html`<a class="lien-evitement" href="#contenu" data-action="aller-contenu">Aller au contenu</a>
<div class="app" id="app">
  <aside class="side" id="side" aria-label="Navigation principale">
    <div class="side-tete"><img src="${AK.assets.logo}" alt=""><div class="marque"><b id="nom-ecole">AKWA SCHOOL</b><small>AKWA SCHOOL ${AK.VERSION}</small></div></div>
    <nav class="nav" id="nav"></nav>
    <div class="side-pied"><div class="carte-ecole" id="carte-ecole"></div><button type="button" class="btn-replier" data-action="replier-menu" aria-label="Réduire ou agrandir le menu">${ic('chevL')}<span>Réduire le menu</span></button></div>
  </aside>
  <div class="principal" id="principal">
    <header class="haut" id="haut">
      <button type="button" class="btn-haut burger" data-action="ouvrir-nav" aria-label="Ouvrir le menu" aria-expanded="false">${ic('menu')}</button>
      <div class="ariane" id="ariane"></div>
      <span class="espace"></span>
      <div class="recherche" id="zone-recherche">${ic('search')}<input id="recherche" type="search" placeholder="Élève, membre du personnel, écran, référence…" autocomplete="off" aria-label="Recherche globale" aria-controls="resultats-recherche"><kbd>Ctrl K</kbd><div class="resultats-recherche" id="resultats-recherche" role="listbox" hidden></div></div>
      <span class="etat-sauvegarde" id="etat-sauvegarde" role="status"><span class="point"></span><span class="txt">Enregistré</span></span>
      <button type="button" class="btn-haut" data-action="aller" data-route="documents/verifier" aria-label="Vérifier un document" data-bulle="Vérifier un document (QR code ou référence)">${ic('qr')}</button>
      <button type="button" class="btn-haut" id="btn-alertes" data-action="alertes" aria-label="Alertes et rappels" aria-haspopup="menu">${ic('bell')}</button>
      <button type="button" class="btn-haut" data-action="theme" aria-label="Thème clair ou sombre" data-bulle="Thème clair / sombre">${ic('moon')}</button>
      <button type="button" class="btn-profil" id="btn-profil" data-action="menu-profil" aria-haspopup="menu"></button>
    </header>
    <div class="bandeaux" id="bandeaux"></div>
    <main class="contenu" id="contenu" tabindex="-1"></main>
  </div>
</div>
<nav class="bas" id="bas" aria-label="Navigation rapide"></nav>`));
  }

  /* ---------- Menu ---------- */
  function dessinerNav(route) {
    const sec = sectionDe(route);
    const att = AK.session.estDirecteur() ? Object.keys(S().attente || {}).length : 0;
    const dem = AK.session.estDirecteur() ? S().auth.filter((a) => a.statut === 'En attente').length : 0;
    const comptes = { notes: att, absences: dem };
    const items = [];
    let groupe = null;
    SECTIONS.forEach((s) => {
      if (s.grp) {
        groupe = s.grp;
        return;
      }
      const cible = ongletsVisibles(s)[0] ? ongletsVisibles(s)[0][0] : accessible(s.id) ? s.id : null;
      if (!cible) return;
      if (groupe) {
        items.push(html`<div class="nav-groupe">${groupe}</div><div class="nav-sep"></div>`);
        groupe = null;
      }
      items.push(html`<a href="#${cible}" class="${s === sec ? 'actif' : ''}"${s === sec ? raw(' aria-current="page"') : ''} data-bulle="${document.documentElement.classList.contains('side-reduite') ? s.lib : ''}">${ic(s.ic)}<span class="lib">${s.lib}</span>${comptes[s.id] ? html`<span class="compte" aria-label="${comptes[s.id]} en attente">${comptes[s.id]}</span>` : ''}</a>`);
    });
    u.poser($('#nav'), items);
    const principaux = ['accueil', 'eleves', 'notes', 'absences'].map((id) => SECTIONS.find((s) => s.id === id)).filter((s) => ongletsVisibles(s).length || accessible(s.id));
    u.poser($('#bas'), html`${principaux.map((s) => html`<a href="#${ongletsVisibles(s)[0] ? ongletsVisibles(s)[0][0] : s.id}" class="${s === sec ? 'actif' : ''}">${ic(s.ic)}${s.court}</a>`)}<button type="button" data-action="ouvrir-nav">${ic('menu')}Menu</button>`);
    const sc = S().school;
    $('#nom-ecole').textContent = sc.name || 'AKWA SCHOOL';
    u.poser($('#carte-ecole'), html`<b>${sc.name || 'École non renseignée'}</b>${[sc.iepp, sc.drenaet].filter(Boolean).join(' · ')}<br>${sc.year ? 'Année ' + sc.year + ' · ' : ''}${AK.cfg.evCourt(sc.evalCourante || 1)}`);
    const a = AK.session.agent();
    u.poser($('#btn-profil'), html`${a ? ui.avatar(a) : html`<span class="av">${ic('key')}</span>`}<span class="pt"><b>${AK.session.libelle()}</b><small>${a ? 'Enseignant · ' + (X().clsTxt(a) || 'sans classe') : 'Directeur · administrateur'}</small></span>${ic('chevD', 'i-sm')}`);
    const n = alertes().length, b = $('#btn-alertes');
    const p = b.querySelector('.pastille');
    if (p) p.remove();
    if (n) b.insertAdjacentHTML('beforeend', `<span class="pastille">${n > 9 ? '9+' : n}</span>`);
    b.setAttribute('aria-label', `Alertes et rappels : ${n}`);
  }

  /* ---------- Rendu de l'écran courant ---------- */
  let routeCourante = null, paramsCourants = {};
  function dessiner(opts = {}) {
    if (!AK.session.ouverte()) return;
    const { chemin, params } = lireAdresse();
    const route = resoudre(chemin);
    if (route !== chemin && ecrans.has(chemin) && !accessible(chemin)) ui.toast('Cet écran n’est pas accessible avec votre profil.', { type: 'avert' });
    const change = route !== routeCourante;
    routeCourante = route;
    paramsCourants = params;
    const e = ecrans.get(route);
    const sec = sectionDe(route);
    dessinerNav(route);
    const ong = sec && ongletsVisibles(sec).find(([r]) => r === route);
    u.poser($('#ariane'), html`<a href="#accueil">${S().school.name || 'AKWA SCHOOL'}</a>${sec && sec.id !== 'accueil' ? html`${ic('chev')}${ong ? html`<a href="#${ongletsVisibles(sec)[0][0]}">${sec.lib}</a>${ic('chev')}<b>${ong[1]}</b>` : html`<b>${sec.lib}</b>`}` : ''}`);
    document.title = `${(ong && ong[1]) || (sec && sec.lib) || 'Tableau de bord'} · ${S().school.name || 'AKWA SCHOOL'}`;
    // focus et position conservés lors d'un simple rafraîchissement
    const actif = document.activeElement, idActif = actif && actif.id && $('#contenu').contains(actif) ? actif.id : null;
    const sel = idActif && 'selectionStart' in actif ? [actif.selectionStart, actif.selectionEnd] : null;
    const zone = $('#principal'), defil = zone.scrollTop;
    const contenu = $('#contenu');
    try {
      const corps = e.rendu(params, { route });
      u.poser(contenu, html`${sec && sec.onglets && ongletsVisibles(sec).length > 1 && !e.sansOnglets ? ui.onglets(ongletsVisibles(sec).map(([r, l]) => [r, l, e.compteOnglet && e.compteOnglet(r)]), route) : ''}${corps}`);
      if (e.apres) e.apres(contenu, params);
    } catch (err) {
      AK.diag.erreur(err, 'écran ' + route);
      u.poser(contenu, html`${ui.pageTete('Écran indisponible')}${ui.encadre(html`Cet écran n’a pas pu s’afficher à cause d’une erreur inattendue. Vos données ne sont pas touchées. <b>Détail technique :</b> ${err && err.message}`, 'erreur')}<p class="mt"><a class="btn" href="#accueil">${ic('home')}Retour au tableau de bord</a> <a class="btn" href="#parametres/diagnostic">${ic('activity')}Diagnostic</a></p>`);
    }
    if (change && !opts.garderPosition) {
      zone.scrollTop = 0;
      contenu.classList.remove('entree');
      void contenu.offsetWidth;
      contenu.classList.add('entree');
    } else {
      contenu.classList.remove('entree');
      zone.scrollTop = defil;
      if (idActif) {
        const el = document.getElementById(idActif);
        if (el) {
          el.focus({ preventScroll: true });
          if (sel && 'setSelectionRange' in el) try { el.setSelectionRange(sel[0], sel[1]); } catch (x) { /* champ sans sélection */ }
        }
      }
    }
    dessinerTiroir();
    dessinerBandeaux();
    fermerNav();
  }
  let rafRendu = 0;
  const redessiner = () => {
    cancelAnimationFrame(rafRendu);
    rafRendu = requestAnimationFrame(() => dessiner({ garderPosition: true }));
  };

  /* ---------- Bandeaux d'information ---------- */
  function dessinerBandeaux() {
    const B = [];
    if (S().meta.demo) B.push(html`<div class="bandeau demo">${ic('info')}<span>Démonstration : école et élèves fictifs. Les documents portent le filigrane SPÉCIMEN.</span><span class="espace"></span>${AK.session.estDirecteur() ? html`<button type="button" class="btn btn-sm" data-action="quitter-demo">Créer mon école</button>` : ''}</div>`);
    const st = AK.store.sauvegarde;
    if (st.statut === 'erreur') B.push(html`<div class="bandeau erreur" role="alert">${ic('alert')}<span><b>Enregistrement impossible.</b> ${st.message}</span><span class="espace"></span><button type="button" class="btn btn-sm" data-action="reessayer-sauvegarde">Réessayer</button><button type="button" class="btn btn-sm" data-action="aller" data-route="donnees/sauvegarde">Sauvegarder sur clé USB</button></div>`);
    if (AK.stockage.actif && AK.stockage.actif.ephemere) B.push(html`<div class="bandeau erreur">${ic('alert')}<span><b>Aucun enregistrement possible dans ce navigateur</b> (navigation privée ou stockage bloqué). Les modifications seront perdues à la fermeture : exportez une sauvegarde.</span></div>`);
    else if (AK.stockage.description().startsWith('localStorage')) B.push(html`<div class="bandeau avert">${ic('warn')}<span>Stockage de capacité limitée (IndexedDB indisponible) : évitez les photos et sauvegardez souvent.</span></div>`);
    if (AK.session.estDirecteur() && S().securite.forcerChangement && AK.hote.type === 'navigateur') B.push(html`<div class="bandeau avert">${ic('lock')}<span>Le mot de passe administrateur est trop faible (ancienne version). Choisissez-en un nouveau.</span><span class="espace"></span><button type="button" class="btn btn-sm" data-action="changer-mdp-admin">Changer maintenant</button></div>`);
    if (AK.session.estDirecteur() && S().securite.aSecourir && AK.hote.type === 'navigateur') B.push(html`<div class="bandeau info">${ic('key')}<span>Créez votre code de secours personnel (l’ancien code commun à toutes les installations a été désactivé).</span><span class="espace"></span><button type="button" class="btn btn-sm" data-action="nouveau-secours">Créer le code</button></div>`);
    u.poser($('#bandeaux'), B);
  }
  function dessinerSauvegarde(st) {
    const el = $('#etat-sauvegarde');
    if (!el) return;
    el.className = 'etat-sauvegarde ' + (st.statut === 'ok' ? '' : st.statut);
    const txt = { ok: 'Enregistré', encours: 'Enregistrement…', erreur: 'Non enregistré', ephemere: 'Non conservé' }[st.statut] || '';
    $('.txt', el).textContent = txt;
    el.title = st.statut === 'ok' ? `Enregistré dans ${AK.stockage.description()}` + (st.t ? ' à ' + new Date(st.t).toLocaleTimeString('fr-FR') : '') : st.message || txt;
    if (st.statut === 'erreur' || st.statut === 'ok') dessinerBandeaux();
  }

  /* ---------- Alertes et rappels ---------- */
  function alertes() {
    const L = [], ev = S().school.evalCourante || 1, auj = u.aujourdhui();
    const a = AK.session.agent();
    if (AK.session.estEnseignant()) {
      if (!a) return L;
      const nl = AK.personnel.nonLus(a.id).length;
      if (nl) L.push(['avert', `${u.pluriel(nl, 'message')} du directeur`, 'Messages', () => AK.actions.lancer('lire-messages')]);
      X().clsDe(a).forEach((c) => {
        const m = X().notesManquantes(c, ev);
        if (m) L.push(['avert', `${u.pluriel(m, 'note')} à saisir en ${c}`, AK.cfg.evCourt(ev), () => aller('notes/saisie', { classe: c })]);
        if (X().estJourClasse(auj) && !(S().appel[auj] || {})[c]) L.push(['avert', `Appel du jour à faire en ${c}`, 'Absences', () => aller('absences/appel', { classe: c })]);
      });
      return L;
    }
    const att = Object.keys(S().attente || {}).length;
    if (att) L.push(['avert', `${u.pluriel(att, 'note')} en attente de validation`, 'Saisies des enseignants', () => aller('notes/validation')]);
    const dem = S().auth.filter((x) => x.statut === 'En attente').length;
    if (dem) L.push(['avert', `${u.pluriel(dem, 'demande')} d’autorisation à décider`, 'Absences', () => aller('absences/autorisations', { statut: 'En attente' })]);
    const nd = X().niveaux().filter((c) => !(S().appel[auj] || {})[c]);
    if (X().estJourClasse(auj) && nd.length) L.push(['avert', 'Appel du jour incomplet', nd.join(', '), () => aller('absences/appel', { classe: nd[0] })]);
    const sansEns = X().niveaux().filter((c) => !X().enseignantDe(c));
    if (sansEns.length) L.push(['mauvais', 'Classe(s) sans enseignant', sansEns.join(', '), () => aller('eleves/classes')]);
    const bk = S().lastBackup ? u.ecartJours(S().lastBackup, auj) : null;
    if (bk == null || bk > 7) L.push(['mauvais', 'Sauvegarde sur clé USB à faire', bk == null ? 'Aucune sauvegarde exportée' : `Dernière il y a ${bk} jours`, () => aller('donnees/sauvegarde')]);
    if (!AK.cles.active() && AK.crypto.dispo()) L.push(['avert', 'Signature des documents non configurée', 'Créez la clé de signature de l’école', () => aller('parametres/securite')]);
    return L;
  }
  AK.ui.alertes = alertes;

  /* ---------- Tiroir (fiche élève / personnel) ---------- */
  let tiroir = null; // { type, id }
  const rendusTiroir = {};
  AK.ui.defTiroir = (type, f) => (rendusTiroir[type] = f);
  function ouvrirTiroir(type, id) {
    tiroir = { type, id };
    dessinerTiroir(true);
  }
  function fermerTiroir() {
    tiroir = null;
    dessinerTiroir();
  }
  function dessinerTiroir(focus) {
    let v = $('#voile-tiroir'), t = $('#tiroir');
    if (!tiroir) {
      if (v) v.remove();
      if (t) t.remove();
      return;
    }
    const corps = rendusTiroir[tiroir.type] && rendusTiroir[tiroir.type](tiroir.id);
    if (!corps) return fermerTiroir();
    if (!t) {
      document.body.insertAdjacentHTML('beforeend', '<div class="voile" id="voile-tiroir" data-action="fermer-tiroir"></div><aside class="tiroir" id="tiroir" role="dialog" aria-modal="true" aria-label="Fiche"></aside>');
      t = $('#tiroir');
    }
    u.poser(t, html`<div class="tiroir-tete"><span>${tiroir.type === 'eleve' ? 'Fiche élève' : 'Fiche personnel'}</span><button type="button" class="btn-ic" data-action="fermer-tiroir" aria-label="Fermer la fiche">${ic('x')}</button></div><div class="tiroir-corps">${corps}</div>`);
    if (focus) setTimeout(() => $('.tiroir-tete .btn-ic', t).focus(), 30);
  }
  AK.ui.ouvrirTiroir = ouvrirTiroir;
  AK.ui.fermerTiroir = fermerTiroir;

  /* ---------- Recherche globale ---------- */
  let iRes = 0;
  function itemsRecherche(q) {
    const n = u.norm(q);
    if (!n) return [];
    const R = [];
    const ref = AK.valid.normRef(q);
    if (/^AK-[A-Z]{3}-\d{4}-\d{6}-[0-9A-Z]$/.test(ref) && AK.perm.peut('verification.utiliser'))
      R.push({ f: () => aller('documents/verifier', { ref }), h: html`<span class="av">${ic('qr')}</span><span><b>${ref}</b><small>Vérifier ce document</small></span><span class="k">Référence</span>` });
    X().niveaux().filter((c) => u.norm(c) === n && AK.session.classes().includes(c)).forEach((c) => R.push({ f: () => aller('eleves/liste', { classe: c }), h: html`<span class="av">${c}</span><span><b>Classe ${c}</b><small>${X().actifsDe(c).length} élèves</small></span><span class="k">Classe</span>` }));
    S().students.filter((s) => AK.session.classes().includes(s.classe) && u.norm(s.nom + s.prenoms + s.prenoms + s.nom + s.mat + (s.matNat || '')).includes(n)).sort(X().parClasse).slice(0, 7)
      .forEach((s) => R.push({ f: () => ouvrirTiroir('eleve', s.id), h: html`${ui.avatar(s)}<span><b>${X().nomComplet(s)}</b><small>${s.classe} · ${X().matOf(s)}${s.statut !== 'Inscrit' ? ' · ' + s.statut : ''}</small></span><span class="k">Élève</span>` }));
    if (AK.perm.peut('personnel.voir')) S().teachers.filter((t) => u.norm(t.nom + t.fonction + t.matricule).includes(n)).slice(0, 3)
      .forEach((t) => R.push({ f: () => ouvrirTiroir('agent', t.id), h: html`${ui.avatar(t)}<span><b>${t.nom}</b><small>${t.fonction}${X().clsTxt(t) ? ' · ' + X().clsTxt(t) : ''}</small></span><span class="k">Personnel</span>` }));
    SECTIONS.filter((s) => s.id).forEach((s) => (ongletsVisibles(s).length ? ongletsVisibles(s) : accessible(s.id) ? [[s.id, s.lib]] : []).forEach(([r, l]) => {
      if (u.norm(l + s.lib).includes(n) && R.length < 16) R.push({ f: () => aller(r), h: html`<span class="av">${ic(s.ic)}</span><span><b>${l}</b><small>${s.lib}</small></span><span class="k">Écran</span>` });
    }));
    return R;
  }
  function dessinerRecherche() {
    const inp = $('#recherche'), box = $('#resultats-recherche'), q = inp.value.trim();
    if (!q) {
      box.hidden = true;
      return;
    }
    const L = itemsRecherche(q);
    iRes = Math.min(iRes, Math.max(0, L.length - 1));
    box._items = L;
    u.poser(box, L.length ? html`${L.map((x, i) => html`<button type="button" role="option" class="${i === iRes ? 'hl' : ''}" aria-selected="${i === iRes}" data-i="${i}">${x.h}</button>`)}<div class="rien petit">Entrée : ouvrir · ↑ ↓ : choisir · Échap : fermer</div>` : html`<div class="rien">Aucun résultat pour « ${q} ».</div>`);
    box.hidden = false;
  }
  function brancherRecherche() {
    const inp = $('#recherche'), box = $('#resultats-recherche');
    inp.addEventListener('input', () => {
      iRes = 0;
      dessinerRecherche();
    });
    inp.addEventListener('focus', dessinerRecherche);
    inp.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const it = box._items[+b.dataset.i];
      inp.value = '';
      box.hidden = true;
      inp.blur();
      it.f();
    });
    inp.addEventListener('keydown', (e) => {
      const L = box._items || [];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!L.length) return;
        iRes = (iRes + (e.key === 'ArrowDown' ? 1 : -1) + L.length) % L.length;
        dessinerRecherche();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (L[iRes]) {
          inp.value = '';
          box.hidden = true;
          inp.blur();
          L[iRes].f();
        }
      } else if (e.key === 'Escape') {
        inp.value = '';
        box.hidden = true;
        inp.blur();
      }
    });
  }

  /* ---------- Navigation mobile, thème, menu réduit ---------- */
  function fermerNav() {
    document.documentElement.classList.remove('nav-ouverte');
    const v = $('#voile-nav');
    if (v) v.remove();
    const b = $('.burger');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function appliquerTheme() {
    const r = document.documentElement, sc = S().school;
    r.dataset.accent = sc.accent && sc.accent !== 'navy' ? sc.accent : '';
    if (!r.dataset.accent) delete r.dataset.accent;
    if (sc.theme === 'light' || sc.theme === 'dark') r.dataset.theme = sc.theme;
    else delete r.dataset.theme;
    r.classList.toggle('sans-animation', !!sc.sansAnimation);
  }
  AK.ui.appliquerTheme = appliquerTheme;

  AK.actions.def({
    aller: (el) => aller(el.dataset.route, el.dataset.params ? JSON.parse(el.dataset.params) : undefined),
    'aller-contenu'() {
      $('#contenu').focus();
    },
    'fermer-tiroir': () => fermerTiroir(),
    'ouvrir-nav'() {
      const ouvert = document.documentElement.classList.toggle('nav-ouverte');
      if (ouvert) {
        document.body.insertAdjacentHTML('beforeend', '<div class="voile-nav" id="voile-nav" data-action="fermer-nav"></div>');
        $('.burger').setAttribute('aria-expanded', 'true');
        setTimeout(() => ($('#nav a.actif') || $('#nav a')).focus(), 60);
      } else fermerNav();
    },
    'fermer-nav': fermerNav,
    'replier-menu'() {
      const r = document.documentElement.classList.toggle('side-reduite');
      try {
        localStorage.setItem('akwa2:menu', r ? 'reduit' : '');
      } catch (e) { /* préférence non conservée */ }
      dessinerNav(routeCourante || 'accueil');
    },
    theme() {
      const sombre = matchMedia('(prefers-color-scheme: dark)').matches;
      const cur = S().school.theme === 'auto' || !S().school.theme ? (sombre ? 'dark' : 'light') : S().school.theme;
      AK.store.modifier(null, (s) => (s.school.theme = cur === 'dark' ? 'light' : 'dark'), { rendu: false });
      appliquerTheme();
    },
    alertes(el) {
      const L = alertes();
      ui.menu(el, L.length ? L.map(([niv, a, b, f]) => ({ avant: html`<span class="niv ${niv}"></span>`, lib: a, sous: b, f })) : [html`<div class="vide" style="padding:18px">${ic('checkCircle')}<b>Tout est à jour</b></div>`], 'Alertes et rappels');
    },
    'menu-profil'(el) {
      const items = [];
      if (AK.hote.type === 'navigateur') {
        items.push({ icone: 'key', lib: 'Changer mon mot de passe', f: () => AK.actions.lancer(AK.session.estDirecteur() ? 'changer-mdp-admin' : 'changer-mdp-ens') });
        items.push({ icone: 'lock', lib: 'Verrouiller', sous: 'L’écran reste ouvert, mot de passe requis', f: () => AK.app.verrouiller() });
        items.push('sep');
        items.push({ icone: 'logout', lib: 'Se déconnecter', f: () => AK.app.deconnecter() });
      } else items.push({ icone: 'logout', lib: 'Se déconnecter', f: () => AK.hote.appel('deconnexion') });
      ui.menu(el, items, AK.session.libelle());
    },
    'reessayer-sauvegarde': () => AK.store.reessayer()
  });

  /* ---------- Raccourcis clavier ---------- */
  document.addEventListener('keydown', (e) => {
    if (!AK.session.ouverte()) return;
    const saisie = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !saisie)) {
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      $('#recherche').focus();
    }
    if (e.key === 'Escape' && tiroir && !document.querySelector('dialog[open]')) fermerTiroir();
  });

  AK.shell = {
    construire,
    demarrer() {
      try {
        if (localStorage.getItem('akwa2:menu') === 'reduit') document.documentElement.classList.add('side-reduite');
      } catch (e) { /* stockage indisponible */ }
      brancherRecherche();
      AK.bus.on('change', redessiner);
      AK.bus.on('sauvegarde', dessinerSauvegarde);
      AK.bus.on('erreur-sauvegarde', (st) => ui.toast(st.message, { type: 'erreur', duree: 0 }));
      addEventListener('hashchange', () => {
        fermerTiroir();
        dessiner();
      });
      appliquerTheme();
      dessiner();
    },
    dessiner,
    redessiner,
    aller,
    routeCourante: () => routeCourante,
    params: () => paramsCourants,
    appliquerTheme
  };
})(window.AK);
