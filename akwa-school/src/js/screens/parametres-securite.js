/* =====================================================================================
   Paramètres › Sécurité & signature (directeur) : mot de passe administrateur, code de
   secours, verrouillage automatique, clés de signature électronique des documents
   (création, rotation, déclaration de compromission, export des clés publiques) et
   explication honnête de ce que la signature prouve — et ne prouve pas — hors ligne.

   Fonctions métier ajoutées ici (AK.reglagesSecurite) : elles vérifient les droits et
   valident AVANT de modifier. Le changement de mot de passe et le code de secours
   réutilisent les actions existantes de l'application (ui/app.js).
   Version bureau (application Windows) : connexion, mot de passe, code de secours et
   verrouillage sont gérés par l'application Windows ; seules les clés se gèrent ici.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const K = () => AK.cles;
  const ROUTE = 'parametres/securite';
  const VERROU_MAX = 240; // minutes
  const SAISIE_COMPROMISE = 'COMPROMISE';
  const STATUTS = { active: ['Active', 'ok', 'checkCircle'], retiree: ['Retirée', 'pri', 'archive'], compromise: ['Compromise', 'mauvais', 'shieldX'] };
  const MOTIFS = ['Ordinateur volé ou perdu', 'Mot de passe administrateur divulgué', 'Fichier de sauvegarde perdu ou copié', 'Départ du directeur sans passation', 'Autre'];

  /* ---------- Fonctions métier ---------- */
  const securite = {
    VERROU_MAX,
    /** Verrouillage automatique après inactivité, en minutes (0 : jamais). */
    verrouillage(valeur) {
      AK.perm.exiger('securite.gerer');
      if (!AK.hote.authentificationLocale) throw new AK.ErreurMetier('Le verrouillage de session est géré par l’application Windows AKWA SCHOOL.');
      const t = String(valeur ?? '').trim();
      if (!/^\d{1,4}$/.test(t)) throw new AK.ErreurMetier(`Indiquez un nombre entier de minutes, de 0 à ${VERROU_MAX} (0 : jamais).`, 'min');
      const n = Number(t);
      if (n > VERROU_MAX) throw new AK.ErreurMetier(`${VERROU_MAX} minutes (4 heures) au plus : au-delà, la protection n’a plus de sens.`, 'min');
      if (n === Number(S().securite.verrouMin)) return n;
      AK.store.modifier(n ? `Verrouillage automatique après ${n} min d’inactivité` : 'Verrouillage automatique désactivé', (s) => (s.securite.verrouMin = n), { categorie: 'securite' });
      return n;
    },
    /** Déclare une clé compromise, après contrôle (clé existante, pas déjà compromise, motif décrit). */
    declarerCompromise(id, motif) {
      AK.perm.exiger('cles.gerer');
      const c = K().liste().find((x) => x.id === id);
      if (!c) throw new AK.ErreurMetier('Clé de signature introuvable.');
      if (c.statut === 'compromise') throw new AK.ErreurMetier(`La clé ${id} est déjà déclarée compromise.`);
      const m = String(motif || '').replace(/\s+/g, ' ').trim();
      if (m.length < 5) throw new AK.ErreurMetier('Décrivez le motif (5 caractères au moins) : vol, perte, mot de passe divulgué…', 'motif');
      if (m.length > 200) throw new AK.ErreurMetier('Motif trop long : 200 caractères au plus.', 'motif');
      K().declarerCompromise(id, m);
    },
    /** Clés publiques (aucun secret) au format JSON, pour l'IEPP ou un autre poste de vérification. */
    async exporterClesPubliques() {
      AK.perm.exiger('cles.gerer');
      const cles = K().publiques();
      if (!cles.length) throw new AK.ErreurMetier('Aucune clé de signature à exporter : créez d’abord la clé de l’école.');
      const sc = S().school;
      const donnees = { format: 'akwa-cles-publiques', version: 1, cree: new Date().toISOString(), ecole: { nom: sc.name || '', code: sc.codeecole || '', iepp: sc.iepp || '', drenaet: sc.drenaet || '' }, active: (K().active() || {}).id || null, cles };
      const nom = `AKWA_cles_publiques_${u.sansAccents(sc.name || 'ecole').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${u.aujourdhui()}.json`;
      const ou = await AK.hote.fichier(nom, JSON.stringify(donnees, null, 2), 'application/json');
      if (ou) AK.store.journaliser(`Clés publiques exportées (${u.pluriel(cles.length, 'clé')})`, 'securite');
      return ou;
    }
  };
  AK.reglagesSecurite = securite;

  /* ---------- Outils d'affichage ---------- */
  const dernier = (re) => {
    const e = (S().pro.journal || []).find((x) => re.test(x.m));
    return e ? e.t : null;
  };
  const date10 = (iso) => (iso ? u.fmtDate(String(iso).slice(0, 10)) : '—');
  const docsSignes = (id) => (S().docs.items || []).filter((d) => d.kid === id).length;
  const tagStatut = (st) => {
    const [l, ton, i] = STATUTS[st] || [st, '', 'key'];
    return ui.tag(l, ton, i);
  };
  const RE_JOURNAL = /mot de passe|secours|clé|clés|rotation des clés|verrouillage|connexion|déconnexion|compte administrateur/i;

  /* ---------- Rendu ---------- */
  function carteMotsDePasse() {
    const sec = S().securite;
    if (!AK.hote.authentificationLocale) {
      const bureau = AK.hote.type === 'bureau';
      return ui.carte('Connexion et mot de passe', html`<div class="pile">${ui.encadre(bureau
        ? html`<b>Version Windows :</b> la connexion, le mot de passe du directeur, le code de secours et le verrouillage de session sont gérés par l’application Windows AKWA SCHOOL, en dehors de cette page. En cas d’oubli, utilisez « Mot de passe oublié » sur la fenêtre de connexion de l’application.`
        : html`La connexion et les mots de passe sont gérés par l’application qui héberge AKWA SCHOOL (${AK.hote.libelle}).`, 'info', 'lock')}
        <p class="mb0 petit">Le mot de passe du directeur reste demandé ici pour les opérations sensibles et pour déverrouiller la clé de signature des documents.</p></div>`, { sous: AK.hote.libelle });
    }
    const chg = dernier(/^Mot de passe administrateur changé|^Compte administrateur créé/);
    const scs = dernier(/^Nouveau code de secours créé|^Compte administrateur créé|code de secours$/);
    return html`<div class="grille g2">
      ${ui.carte('Mot de passe administrateur', html`<div class="pile">
        ${sec.forcerChangement ? ui.encadre(html`<b>Mot de passe trop faible</b> (hérité d’une ancienne version) : choisissez-en un nouveau.`, 'avert', 'warn') : ''}
        <p class="mb0">Demandé à la connexion du directeur, pour les opérations sensibles (corrections, suppressions, annulations…) et pour signer les documents. Il chiffre aussi la clé privée de signature : le changer la rechiffre.</p>
        <p class="mut petit mb0">${C.SECU.MDP_MIN} caractères au moins, lettres et chiffres. Une confirmation reste valable ${Math.round(C.SECU.GRACE_SEC / 60)} minutes.${chg ? ` Dernière modification : ${u.fmtHorodatage(chg)}.` : ''}</p>
        <div><button type="button" class="btn btn-pri" data-action="changer-mdp-admin">${ic('key')}Changer le mot de passe</button></div></div>`)}
      ${ui.carte('Code de secours', html`<div class="pile">
        ${sec.aSecourir || !sec.secours ? ui.encadre(html`<b>Aucun code de secours personnel</b> : créez-le maintenant, sinon un mot de passe oublié ne pourra pas être remplacé.`, 'avert', 'warn') : ''}
        <p class="mb0">Il remplace un mot de passe oublié, sans Internet. Il n’est affiché qu’une fois : notez-le sur papier et rangez-le à part de l’ordinateur. En créer un nouveau rend l’ancien inutilisable.</p>
        <p class="mut petit mb0">Après une récupération par code de secours, la clé de signature protégée par l’ancien mot de passe ne peut plus être déchiffrée : elle est retirée et une nouvelle clé est à créer.${scs ? ` Dernier code créé : ${u.fmtHorodatage(scs)}.` : ''}</p>
        <div><button type="button" class="btn" data-action="nouveau-secours">${ic('refresh')}${sec.secours && !sec.aSecourir ? 'Créer un nouveau code de secours' : 'Créer mon code de secours'}</button></div></div>`)}
    </div>`;
  }

  function carteVerrouillage() {
    if (!AK.hote.authentificationLocale) return '';
    const min = Number(S().securite.verrouMin) || 0;
    return ui.carte('Verrouillage automatique', html`<form class="pile" id="ps-verrou" data-submit="ps-verrou" novalidate autocomplete="off">
      <p class="mb0">Après ce délai sans activité, l’écran se verrouille : le mot de passe est redemandé et la clé de signature est retirée de la mémoire. Utile si l’ordinateur reste allumé dans un bureau partagé.</p>
      <div class="ligne ps-verrou-ligne">${F.nombre({ id: 'ps-verrou-min', nom: 'min', lib: 'Délai d’inactivité (minutes)', val: min, attrs: { min: 0, max: VERROU_MAX, step: 1, inputmode: 'numeric' }, aide: `0 à ${VERROU_MAX} minutes ; 0 désactive le verrouillage (déconseillé). Valeur conseillée : ${C.SECU.VERROU_MIN} minutes.` })}</div>
      <div class="ligne"><button type="submit" class="btn btn-pri">${ic('save')}Enregistrer le délai</button><button type="button" class="btn" data-action="ps-verrouiller">${ic('lock')}Verrouiller maintenant</button>
      <span class="mut petit">Actuellement : <b>${min ? `${min} min` : 'jamais'}</b></span></div>
      ${min ? '' : ui.encadre('Verrouillage désactivé : toute personne qui s’assoit devant l’ordinateur ouvert accède à l’application.', 'avert', 'warn')}</form>`);
  }

  function carteCles() {
    const L = K().liste(), a = K().active();
    const dispo = AK.crypto.dispo();
    const demo = !!S().meta.demo;
    const etat = [];
    if (!dispo) etat.push(ui.encadre('La cryptographie du navigateur (Web Crypto) est indisponible ici : la signature électronique ne peut pas être utilisée. Ouvrez AKWA SCHOOL dans Chrome, Edge ou Firefox récent. Les documents restent inscrits au registre et vérifiables sur cet ordinateur.', 'erreur', 'shieldX'));
    if (demo) etat.push(ui.encadre('Démonstration : les documents portent le filigrane SPÉCIMEN et ne sont jamais signés, même si une clé existe.', 'info'));
    if (a) {
      const charge = K().disponible();
      etat.push(html`<div class="ps-cle-active">
        <div><span class="mut petit">Clé active</span><b class="ps-cle-id">${a.id}</b>${tagStatut('active')}</div>
        <div><span class="mut petit">Empreinte à communiquer à l’IEPP</span><b class="ps-empreinte" aria-label="Empreinte ${a.empreinte.split('').join(' ')}">${a.empreinte}</b></div>
        <div class="petit">Créée le ${date10(a.creeeLe)} · ${u.pluriel(docsSignes(a.id), 'document signé', 'documents signés')} · ${a.algo}</div>
        <div class="petit">${charge ? html`${ic('unlock', 'i-sm')} Déverrouillée pour cette session : les documents émis sont signés sans redemander le mot de passe.` : html`${ic('lock', 'i-sm')} Verrouillée : le mot de passe sera demandé à la première signature.`}</div></div>`);
    } else if (dispo) {
      etat.push(ui.encadre(L.length
        ? html`<b>Aucune clé active.</b> Les documents émis maintenant ne sont pas signés (vérifiables seulement par le registre de cet ordinateur). Créez une nouvelle clé.`
        : html`<b>Signature électronique non configurée.</b> Créez la clé de l’école : chaque document officiel recevra un QR code signé, vérifiable sur un autre appareil.`, 'avert', 'shield'));
    }
    const boutons = html`<div class="ligne">
      ${dispo && !a ? html`<button type="button" class="btn btn-pri" data-action="ps-cle-creer">${ic('key')}${L.length ? 'Créer une nouvelle clé' : 'Créer la clé de signature'}</button>` : ''}
      ${dispo && a ? html`<button type="button" class="btn" data-action="ps-cle-rotation">${ic('rotate')}Remplacer la clé (rotation)</button>` : ''}
      ${dispo && a && !K().disponible() ? html`<button type="button" class="btn" data-action="ps-cle-deverrouiller">${ic('unlock')}Déverrouiller pour cette session</button>` : ''}
      ${L.length ? html`<button type="button" class="btn" data-action="ps-cles-export">${ic('down')}Exporter les clés publiques (JSON)</button>` : ''}
      ${L.length && AK.ecrans.existe('documents/verifier') ? html`<a class="btn btn-ghost" href="#documents/verifier">${ic('qr')}Vérifier un document</a>` : ''}</div>`;
    const tableau = L.length ? ui.tableau({
      id: 'ps-cles', lignes: L.slice().reverse(), unite: 'clé', legende: 'Clés de signature', triDefaut: null,
      colonnes: [
        { cle: 'id', lib: 'Clé', tri: (c) => parseInt(String(c.id).slice(1), 10) || 0, rendu: (c) => html`<b>${c.id}</b>` },
        { cle: 'empreinte', lib: 'Empreinte', rendu: (c) => html`<span class="mono">${c.empreinte}</span>`, csv: (c) => c.empreinte },
        { cle: 'statut', lib: 'Statut', tri: (c) => c.statut, rendu: (c) => tagStatut(c.statut), csv: (c) => (STATUTS[c.statut] || [c.statut])[0] },
        { cle: 'creeeLe', lib: 'Créée le', tri: (c) => c.creeeLe, rendu: (c) => date10(c.creeeLe) },
        { cle: 'fin', lib: 'Retirée / compromise le', tri: (c) => c.compromiseLe || c.retireeLe || null, rendu: (c) => date10(c.compromiseLe || c.retireeLe) },
        { cle: 'motif', lib: 'Motif', cls: 'texte', rendu: (c) => c.motif || html`<span class="mut">—</span>`, csv: (c) => c.motif || '' },
        { cle: 'docs', lib: 'Documents signés', cls: 'r', tri: (c) => docsSignes(c.id), rendu: (c) => docsSignes(c.id) },
        { cle: 'act', lib: 'Action', cls: 'actions-l', csv: false, rendu: (c) => (c.statut !== 'compromise' ? html`<button type="button" class="btn btn-sm btn-dng" data-action="ps-cle-compromise" data-id="${c.id}" aria-label="Déclarer la clé ${c.id} compromise">${ic('shieldX')}Déclarer compromise</button>` : html`<span class="mut petit">—</span>`) }
      ]
    }) : '';
    return ui.carte('Clés de signature des documents', html`<div class="pile ps-pile">${etat}${boutons}${tableau}
      <p class="mut petit mb0">La clé privée est créée sur cet ordinateur et chiffrée par le mot de passe administrateur : elle n’est jamais enregistrée en clair, ni dans les données, ni dans les sauvegardes, ni dans l’outil de vérification. Seules les clés publiques (et leur empreinte) sont distribuées.</p></div>`,
    { sous: 'Signature ECDSA P-256 du QR code des documents officiels (certificats, attestations, bulletins, cartes).' });
  }

  function carteExplications() {
    const locale = AK.hote.authentificationLocale;
    const points = [
      ['shieldCheck', 'Intégrité', 'Le QR code d’un document émis contient sa référence, sa date, une empreinte des données du titulaire et une signature calculée avec la clé privée de l’école. Modifier ce contenu, même d’un caractère, rend la signature invalide.'],
      ['school', 'Émetteur', 'Une signature valide prouve que le document a été produit avec la clé de l’école dont l’empreinte est affichée ci-dessus. Cela ne vaut que si le vérificateur connaît la vraie clé publique : communiquez l’empreinte à l’IEPP par un canal sûr (en main propre, par téléphone) et transmettez l’outil de vérification à jour.'],
      ['fileCheck', 'Validité administrative', 'La signature ne dit pas si le document est encore valable : un document annulé, remplacé par un duplicata ou expiré reste correctement signé. Seul le registre des documents de l’école connaît son statut, et la signature ne garantit pas que les informations saisies étaient exactes.'],
      ['offline', 'Révocation hors ligne', 'Il n’existe pas de serveur central. Une annulation ou une clé déclarée compromise n’est connue d’un autre appareil que s’il reçoit une copie récente (outil de vérification ou clés publiques exportées) : redistribuez-la après chaque changement.'],
      ['rotate', 'Rotation et compromission', 'Une clé remplacée est « retirée » : elle ne signe plus mais vérifie toujours les documents émis avant son retrait. Une clé « compromise » (ordinateur volé, mot de passe divulgué) fait signaler comme douteux les documents qu’elle a signés : réémettez alors les documents importants avec une nouvelle clé.'],
      ['lock', 'Ce que protège le mot de passe', locale
        ? 'Le mot de passe protège l’accès à l’application et chiffre la clé privée de signature. Il ne chiffre pas les données de l’école enregistrées sur cet appareil : une personne qui utilise votre session (ordinateur ou téléphone déverrouillé) et les outils du navigateur peut les lire. Verrouillez la session de l’appareil et gardez les sauvegardes en lieu sûr.'
        : 'Dans la version installée, la connexion est contrôlée par l’application Windows ; le mot de passe chiffre aussi la clé privée de signature. Protégez la session Windows et les sauvegardes : quiconque y accède peut copier les fichiers de l’application.']
    ];
    return ui.carte('Ce que prouve la signature électronique, et ce qu’elle ne prouve pas', html`<div class="ps-explications">${points.map(([i, t, x]) => html`<div class="ps-point">${ic(i)}<div><b>${t}</b><p class="mb0">${x}</p></div></div>`)}</div>`);
  }

  function carteJournal() {
    const E = (S().pro.journal || []).filter((e) => RE_JOURNAL.test(e.m)).slice(0, 8);
    const lien = AK.ecrans.existe('donnees/journal') && AK.perm.peut('journal.voir') ? html`<a class="btn btn-sm btn-ghost" href="#donnees/journal">${ic('history')}Journal complet</a>` : '';
    return ui.carte('Événements de sécurité récents', E.length ? html`<div class="liste">${E.map((e) => html`<div><span class="flex1">${e.m}</span><span class="m">${u.fmtHorodatage(e.t)}${e.qui ? ' · ' + e.qui : ''}</span></div>`)}</div>` : html`<p class="mut mb0">Aucun événement de sécurité enregistré.</p>`, { actions: lien });
  }

  function rendu() {
    const sec = S().securite, a = K().active();
    const locale = AK.hote.authentificationLocale;
    const min = Number(sec.verrouMin) || 0;
    const kpis = html`<div class="grille g4 ps-kpis">
      ${ui.kpi({ icone: 'key', lib: 'Mot de passe', val: locale ? (sec.forcerChangement ? 'À changer' : 'Défini') : 'Windows', sous: locale ? (sec.forcerChangement ? 'trop faible' : 'empreinte PBKDF2, jamais en clair') : 'géré par l’application', ton: locale && sec.forcerChangement ? 'avert' : '' })}
      ${ui.kpi({ icone: 'shield', lib: 'Code de secours', val: !locale ? 'Windows' : sec.secours && !sec.aSecourir ? 'Créé' : 'À créer', sous: !locale ? 'géré par l’application' : sec.secours && !sec.aSecourir ? 'à garder sur papier' : 'récupération impossible sans lui', ton: locale && (!sec.secours || sec.aSecourir) ? 'mauvais' : '' })}
      ${ui.kpi({ icone: 'lock', lib: 'Verrouillage', val: !locale ? 'Windows' : min ? html`${min}<small> min</small>` : 'Jamais', sous: !locale ? 'géré par l’application' : min ? 'après inactivité' : 'désactivé', ton: locale && !min ? 'avert' : '' })}
      ${ui.kpi({ icone: 'shieldCheck', lib: 'Signature des documents', val: a ? a.id : 'Aucune clé', sous: a ? 'clé active' : AK.crypto.dispo() ? 'à configurer' : 'indisponible', ton: a ? '' : 'avert' })}</div>`;
    return html`${ui.pageTete('Sécurité & signature', 'Mot de passe du directeur, code de secours, verrouillage automatique et clés de signature électronique des documents officiels.')}
      ${kpis}<div class="pile-lg mt">${carteMotsDePasse()}${carteVerrouillage()}${carteCles()}<div class="grille g-2-1">${carteExplications()}${carteJournal()}</div></div>`;
  }

  /* ---------- Actions ---------- */
  const champMdp = (aide) => html`<div class="champ"><label for="ps-mdp">Mot de passe du directeur</label><input id="ps-mdp" class="inp" type="password" name="pwd" autocomplete="current-password" required autofocus>${aide ? html`<div class="aide">${aide}</div>` : ''}</div>`;
  function fenetreCle(rotation) {
    const a = K().active();
    const prochain = 'K' + (K().liste().reduce((m, c) => Math.max(m, parseInt(String(c.id).slice(1), 10) || 0), 0) + 1);
    ui.fenetre({
      titre: rotation ? 'Remplacer la clé de signature' : 'Créer la clé de signature de l’école', icone: rotation ? 'rotate' : 'key', taille: 'sm', ok: rotation ? `Remplacer ${a.id} par ${prochain}` : `Créer la clé ${prochain}`, proteger: false,
      corps: html`<div class="pile">${rotation
        ? html`<p class="mb0">La clé <b>${a.id}</b> sera <b>retirée</b> : elle ne signera plus, mais les ${u.pluriel(docsSignes(a.id), 'document')} déjà signé(s) resteront vérifiables. La nouvelle clé <b>${prochain}</b> deviendra active.</p>${ui.encadre('Après le remplacement, exportez les clés publiques (ou l’outil de vérification) et communiquez la nouvelle empreinte à l’IEPP.', 'avert')}`
        : html`<p class="mb0">Une paire de clés est créée sur cet ordinateur. La clé privée, chiffrée par votre mot de passe, signera le QR code des documents officiels ; la clé publique permettra de les vérifier ailleurs.</p>`}
        ${champMdp('Le même mot de passe que pour la connexion du directeur.')}</div>`,
      async surValider(d) {
        if (!d.pwd) throw new AK.ErreurMetier('Saisissez le mot de passe du directeur.', 'pwd');
        if (rotation && (!K().active() || K().active().id !== a.id)) throw new AK.ErreurMetier('La clé active a changé entre-temps : fermez cette fenêtre et recommencez.');
        const id = await K().creer(d.pwd);
        const n = K().liste().find((c) => c.id === id);
        ui.toast(rotation ? `Clé ${id} active (empreinte ${n.empreinte}) ; ${a.id} retirée.` : `Clé de signature ${id} créée. Empreinte : ${n.empreinte}.`, { duree: 9000 });
      }
    });
  }

  AK.actions.defEnvoi({
    'ps-verrou'(form) {
      ui.effacerErreurs(form);
      try {
        const n = securite.verrouillage(form.elements.min.value);
        ui.toast(n ? `Verrouillage automatique après ${n} min d’inactivité.` : 'Verrouillage automatique désactivé.', { type: n ? 'ok' : 'avert' });
      } catch (err) {
        if (!(err instanceof AK.ErreurMetier)) throw err;
        ui.erreurChamp(form, err.champ, err.message);
      }
    }
  });
  AK.actions.def({
    'ps-verrouiller'() {
      if (!AK.app || !AK.app.verrouiller) throw new AK.ErreurMetier('Verrouillage indisponible dans cette version.');
      AK.app.verrouiller();
    },
    'ps-cle-creer'() {
      AK.perm.exiger('cles.gerer');
      if (K().active()) return fenetreCle(true);
      fenetreCle(false);
    },
    'ps-cle-rotation'() {
      AK.perm.exiger('cles.gerer');
      if (!K().active()) return fenetreCle(false);
      fenetreCle(true);
    },
    async 'ps-cle-deverrouiller'() {
      const mdp = await ui.saisirMotDePasse('Déverrouiller la clé de signature pour cette session : les documents émis seront signés sans redemander le mot de passe, jusqu’à la déconnexion ou au verrouillage.');
      if (!mdp) return;
      if (!(await K().deverrouiller(mdp))) throw new AK.ErreurMetier('La clé n’a pas pu être déchiffrée avec ce mot de passe. Si le mot de passe a été remplacé par le code de secours, créez une nouvelle clé.');
      ui.toast('Clé de signature déverrouillée pour cette session.');
      AK.shell.redessiner();
    },
    'ps-cle-compromise'(el) {
      AK.perm.exiger('cles.gerer');
      const c = K().liste().find((x) => x.id === el.dataset.id);
      if (!c) throw new AK.ErreurMetier('Clé de signature introuvable.');
      const n = docsSignes(c.id);
      ui.fenetre({
        titre: `Déclarer la clé ${c.id} compromise`, icone: 'shieldX', taille: 'sm', danger: true, ok: 'Déclarer compromise', okStyle: 'dng',
        corps: html`<div class="pile">
          <p class="mb0">À faire si la clé a pu tomber entre d’autres mains : ordinateur volé, mot de passe divulgué, sauvegarde perdue…</p>
          ${ui.encadre(html`Les <b>${u.pluriel(n, 'document')}</b> signé(s) avec ${c.id} seront signalés <b>« émetteur douteux »</b> à la vérification.${c.statut === 'active' ? ' Les documents ne seront plus signés jusqu’à la création d’une nouvelle clé.' : ''} Cette déclaration ne peut pas être annulée.`, 'erreur', 'warn')}
          ${F.choix({ id: 'ps-motif-type', nom: 'type', lib: 'Cause', options: MOTIFS, vide: 'Choisir…', req: true })}
          ${F.zone({ id: 'ps-motif', nom: 'motif', lib: 'Motif (inscrit dans le registre des clés)', lignes: 3, req: true, attrs: { maxlength: 200 }, aide: '5 à 200 caractères. Ex. : ordinateur de la direction volé le 12/10.' })}
          <div class="champ"><label for="ps-saisie">Pour confirmer, tapez <b>${SAISIE_COMPROMISE}</b></label><input id="ps-saisie" class="inp" name="saisie" autocomplete="off" autocapitalize="characters" spellcheck="false"></div></div>`,
        async surValider(d) {
          if (!d.type) throw new AK.ErreurMetier('Choisissez la cause.', 'type');
          const motif = d.type === 'Autre' ? String(d.motif || '').trim() : `${d.type}${String(d.motif || '').trim() ? ' : ' + String(d.motif).trim() : ''}`;
          if (d.type === 'Autre' && motif.length < 5) throw new AK.ErreurMetier('Décrivez le motif (5 caractères au moins).', 'motif');
          if (String(d.saisie || '').trim().toUpperCase() !== SAISIE_COMPROMISE) throw new AK.ErreurMetier(`Tapez exactement ${SAISIE_COMPROMISE} pour confirmer.`, 'saisie');
          if (motif.length > 200) throw new AK.ErreurMetier('Motif trop long : 200 caractères au plus (cause comprise).', 'motif');
          if (!(await AK.auth.confirmer(`Déclarer la clé ${c.id} compromise.`, { forcer: true }))) return false;
          const etaitActive = c.statut === 'active';
          securite.declarerCompromise(c.id, motif);
          ui.toast(`Clé ${c.id} déclarée compromise.${etaitActive ? ' Créez une nouvelle clé pour reprendre la signature.' : ''}`, {
            type: 'avert', duree: 12000,
            action: etaitActive && AK.crypto.dispo() ? { lib: 'Créer une clé', f: () => fenetreCle(false) } : null
          });
        }
      });
    },
    async 'ps-cles-export'() {
      const ou = await securite.exporterClesPubliques();
      ui.toast(ou ? `Clés publiques enregistrées : ${ou}. Aucun secret n’y figure.` : 'Enregistrement annulé.', { type: ou ? 'ok' : 'avert' });
    }
  });

  AK.ecrans.def(ROUTE, { rendu, droit: 'securite.gerer' });
})(window.AK);
