/* =====================================================================================
   Services : bibliothèque (fonds, prêts, retours, retards), examen du CEPE (dossiers par
   pièce), parents (annonces et messages groupés).
   L'application n'envoie pas de SMS elle-même (aucun accès réseau ni passerelle) : elle prépare
   le texte et la liste des numéros, ouvre l'application SMS de l'appareil quand c'est possible,
   et garde la trace de l'envoi déclaré par l'utilisateur.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const P = () => AK.store.etat.pro;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const elevesVisibles = () => X().actifs().filter((s) => AK.session.classes().includes(s.classe)).sort(X().parClasse);

  /* ---------- Bibliothèque ---------- */
  const enCours = () => P().prets.filter((p) => !p.rendu);
  const enRetard = (p) => !p.rendu && p.due < u.aujourdhui();
  const disponibles = (b) => b.ex - P().prets.filter((p) => p.livre === b.id && !p.rendu).length;
  function rendreBiblio(p) {
    const livres = P().livres, prets = P().prets, retards = prets.filter(enRetard);
    const vue = p.vue === 'prets' ? 'prets' : 'fonds';
    const etatPret = (x) => (x.rendu ? ui.tag('Rendu le ' + u.fmtDate(x.rendu), 'ok', 'check') : enRetard(x) ? ui.tag('En retard', 'mauvais', 'warn') : ui.tag('En cours', 'pri'));
    const livre = (id) => livres.find((b) => b.id === id);
    const visibles = new Set(elevesVisibles().map((s) => s.id));
    const pretsVisibles = prets.filter((x) => AK.session.estDirecteur() || visibles.has(x.sid)).slice().sort((a, b) => (a.rendu ? 1 : 0) - (b.rendu ? 1 : 0) || String(a.due).localeCompare(String(b.due)));
    return html`${ui.pageTete('Bibliothèque', 'Fonds de l’école, prêts aux élèves et retours. Un ouvrage ne peut être retiré tant qu’un exemplaire est prêté.', html`<button type="button" class="btn" data-action="biblio-pret">${ic('send')}Nouveau prêt</button><button type="button" class="btn btn-pri" data-action="biblio-ouvrage">${ic('plus')}Ajouter un ouvrage</button>`)}
      <div class="grille g4 mb">${ui.kpi({ icone: 'book', lib: 'Ouvrages', val: livres.length, sous: `${u.pluriel(livres.reduce((a, b) => a + b.ex, 0), 'exemplaire')}` })}${ui.kpi({ icone: 'send', lib: 'Prêts en cours', val: enCours().length, action: { nom: 'biblio-vue', attrs: { 'data-v': 'prets' } } })}${ui.kpi({ icone: 'warn', lib: 'En retard', val: retards.length, ton: retards.length ? 'avert' : '', sous: retards.length ? 'à relancer' : 'aucun' })}${ui.kpi({ icone: 'check', lib: 'Retours enregistrés', val: prets.filter((x) => x.rendu).length })}</div>
      <div class="barre-outils">${ui.pilules([['fonds', 'Fonds documentaire'], ['prets', 'Prêts']], vue, 'biblio-vue')}</div>
      ${vue === 'fonds' ? ui.tableau({
        id: 'biblio-fonds', lignes: livres, unite: 'ouvrage', exporter: 'bibliotheque', libelleExport: 'fonds de la bibliothèque', recherche: (b) => `${b.titre} ${b.auteur} ${b.cote} ${b.genre}`, placeholder: 'Titre, auteur, cote…',
        colonnes: [
          { cle: 'cote', lib: 'Cote', tri: (b) => b.cote, rendu: (b) => html`<span class="mono">${b.cote}</span>` },
          { cle: 'titre', lib: 'Titre', tri: (b) => b.titre, rendu: (b) => html`<b>${b.titre}</b>${b.auteur ? html`<br><span class="mut petit">${b.auteur}</span>` : ''}`, csv: (b) => b.titre },
          { cle: 'auteur', lib: 'Auteur', cache: true, csv: (b) => b.auteur },
          { cle: 'genre', lib: 'Genre', tri: (b) => b.genre },
          { cle: 'ex', lib: 'Exemplaires', cls: 'droite num', tri: (b) => b.ex },
          { cle: 'dispo', lib: 'Disponibles', cls: 'droite num', tri: disponibles, rendu: (b) => (disponibles(b) ? String(disponibles(b)) : ui.tag('0', 'avert')), csv: disponibles },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (b) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap"><button type="button" class="btn btn-sm" data-action="biblio-pret" data-livre="${b.id}"${disponibles(b) ? '' : raw(' disabled')}>${ic('send')}Prêter</button><button type="button" class="btn-ic" data-action="biblio-retirer" data-id="${b.id}" aria-label="Retirer ${b.titre} du fonds" data-bulle="Retirer du fonds">${ic('trash')}</button></div>` }
        ],
        vide: ui.vide('Aucun ouvrage', 'Enregistrez les manuels et livres de l’école pour suivre les prêts.', html`<button type="button" class="btn btn-pri" data-action="biblio-ouvrage">${ic('plus')}Ajouter un ouvrage</button>`)
      }) : ui.tableau({
        id: 'biblio-prets', lignes: pretsVisibles, unite: 'prêt', exporter: 'prets-bibliotheque', libelleExport: 'prêts de la bibliothèque',
        recherche: (x) => { const s = AK.eleves.trouver(x.sid), b = livre(x.livre); return `${s ? X().nomComplet(s) : ''} ${b ? b.titre : ''}`; },
        colonnes: [
          { cle: 'eleve', lib: 'Élève', tri: (x) => { const s = AK.eleves.trouver(x.sid); return s ? X().nomComplet(s) : ''; }, rendu: (x) => { const s = AK.eleves.trouver(x.sid); return s ? ui.quiEleve(s) : html`<span class="mut">Élève supprimé</span>`; }, csv: (x) => { const s = AK.eleves.trouver(x.sid); return s ? X().nomComplet(s) : ''; } },
          { cle: 'livre', lib: 'Ouvrage', tri: (x) => (livre(x.livre) || {}).titre, rendu: (x) => (livre(x.livre) ? livre(x.livre).titre : html`<span class="mut">Ouvrage retiré</span>`), csv: (x) => (livre(x.livre) || {}).titre || '' },
          { cle: 'out', lib: 'Prêté le', tri: (x) => x.out, rendu: (x) => u.fmtDate(x.out), csv: (x) => x.out },
          { cle: 'due', lib: 'Retour prévu', tri: (x) => x.due, rendu: (x) => u.fmtDate(x.due), csv: (x) => x.due },
          { cle: 'etat', lib: 'État', tri: (x) => (x.rendu ? 2 : enRetard(x) ? 0 : 1), rendu: etatPret, csv: (x) => (x.rendu ? 'Rendu ' + x.rendu : enRetard(x) ? 'En retard' : 'En cours') },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (x) => (x.rendu ? '' : html`<button type="button" class="btn btn-sm" data-action="biblio-retour" data-id="${x.id}">${ic('check')}Retour</button>`) }
        ],
        vide: ui.vide('Aucun prêt', 'Les prêts apparaîtront ici.')
      })}`;
  }

  /* ---------- CEPE ---------- */
  function rendreCepe(p) {
    const x = X();
    if (!x.niveaux().includes('CM2')) return html`${ui.pageTete('Examen du CEPE')}${ui.vide('Pas de CM2', 'Le niveau CM2 n’est pas ouvert dans cette école (Paramètres › École).')}`;
    if (!AK.session.classes().includes('CM2')) return html`${ui.pageTete('Examen du CEPE')}${ui.vide('Réservé au CM2', 'Le suivi des dossiers du CEPE concerne la classe de CM2.')}`;
    const L = x.actifsDe('CM2').sort(x.parNom);
    const dos = new Map(L.map((s) => [s.id, AK.pro.dossierCepe(s)]));
    const complets = L.filter((s) => dos.get(s.id).complet).length;
    const lignes = p.filtre === 'incomplets' ? L.filter((s) => !dos.get(s.id).complet) : L;
    const g = L.filter((s) => s.sexe === 'Masculin').length;
    return html`${ui.pageTete('Examen du CEPE', 'Constitution des dossiers des candidats du CM2, pièce par pièce. L’extrait de naissance est coché d’office s’il figure au dossier de l’élève.', html`<button type="button" class="btn" data-action="doc-ecole" data-modele="liste-cepe">${ic('print')}Liste des candidats</button>`)}
      <div class="grille g4 mb">${ui.kpi({ icone: 'users', lib: 'Candidats', val: L.length, sous: `${g} garçons · ${L.length - g} filles` })}${ui.kpi({ icone: 'checkCircle', lib: 'Dossiers complets', val: complets, ton: 'ok', sous: u.pct(complets, L.length) })}${ui.kpi({ icone: 'warn', lib: 'Dossiers incomplets', val: L.length - complets, ton: L.length - complets ? 'avert' : '', action: { nom: 'cepe-filtre', attrs: { 'data-v': 'incomplets' } } })}${ui.kpi({ icone: 'file', lib: 'Sans extrait', val: L.filter((s) => !dos.get(s.id).d.extrait && !s.extrait).length, lien: 'eleves/liste?classe=CM2&dossier=sans' })}</div>
      <div class="barre-outils">${ui.pilules([['', 'Tous les candidats'], ['incomplets', 'Dossiers incomplets']], p.filtre || '', 'cepe-filtre')}</div>
      ${lignes.length ? html`<div class="tab-cadre"><table class="tab" aria-label="Dossiers du CEPE"><thead><tr><th>Candidat</th>${C.PIECES_CEPE.map(([, l]) => html`<th class="centre">${l}</th>`)}<th class="centre">Dossier</th></tr></thead><tbody>
        ${lignes.map((s) => {
          const d = dos.get(s.id);
          return html`<tr><td>${ui.quiEleve(s, { detail: false })}</td>${C.PIECES_CEPE.map(([k, l]) => {
            const coche = k === 'extrait' ? d.d.extrait ?? !!s.extrait : !!d.d[k];
            return html`<td class="centre"><input type="checkbox" id="cepe-${s.id}-${k}" data-change="cepe-piece" data-id="${s.id}" data-k="${k}" aria-label="${l} : ${X().nomComplet(s)}"${coche ? raw(' checked') : ''}></td>`;
          })}<td class="centre">${d.complet ? ui.tag('Complet', 'ok', 'check') : ui.tag(`${d.n} / ${C.PIECES_CEPE.length}`, 'avert')}</td></tr>`;
        })}</tbody></table></div>` : ui.vide(L.length ? 'Tous les dossiers sont complets' : 'Aucun candidat', L.length ? '' : 'Aucun élève inscrit en CM2.')}`;
  }

  /* ---------- Parents : annonces et messages ---------- */
  const DEST = [['tous', 'Tous les parents'], ['classe', 'Parents d’une classe'], ['cm2', 'Parents des candidats au CEPE'], ['absents', 'Parents des absents du jour'], ['impayes', 'Parents ayant un reste à payer']];
  let brouillon = { dest: 'tous', classe: '', modele: '0', texte: C.SMS_MODELES[0][1] };
  const destinataires = () => {
    const L = AK.pro.cibleSms(brouillon.dest, brouillon.classe);
    return L.map((s) => ({ s, tel: String(AK.pro.telParent(s) || '').replace(/[^\d+]/g, '') }));
  };
  function rendreParents(p) {
    const dests = DEST.filter(([k]) => k !== 'impayes' || peut('finances.gerer'));
    if (!dests.some(([k]) => k === brouillon.dest)) brouillon.dest = 'tous';
    const D = destinataires(), avec = D.filter((d) => d.tel), sans = D.filter((d) => !d.tel);
    const numeros = [...new Set(avec.map((d) => d.tel))];
    const annonces = P().annonces.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const longueur = brouillon.texte.length, parties = Math.max(1, Math.ceil(longueur / 153));
    return html`${ui.pageTete('Parents & annonces', 'Annonces affichées ou lues aux parents, et messages groupés préparés pour l’application SMS de votre téléphone.', html`<button type="button" class="btn btn-pri" data-action="annonce-nouvelle">${ic('plus')}Nouvelle annonce</button>`)}
      <div class="grille g-2-1">
        ${ui.carte('Message groupé aux parents', html`<div class="pile">
          ${ui.encadre('AKWA SCHOOL fonctionne sans Internet et ne peut pas envoyer de SMS lui-même. Il prépare le texte et les numéros : copiez-les dans votre téléphone, ou ouvrez directement l’application SMS (sur téléphone seulement ; certains téléphones n’acceptent qu’un seul destinataire à la fois). Notez ensuite l’envoi pour en garder la trace.', 'info', 'info')}
          <div class="form-grille">
            ${F.choix({ lib: 'Destinataires', nom: 'dest', id: 'sms-dest', val: brouillon.dest, options: dests, attrs: { 'data-change': 'sms-champ' } })}
            ${brouillon.dest === 'classe' ? F.choix({ lib: 'Classe', nom: 'classe', id: 'sms-classe', val: brouillon.classe, options: AK.session.classes(), vide: 'Choisir…', attrs: { 'data-change': 'sms-champ' } }) : html`<span></span>`}
            ${F.choix({ lib: 'Modèle de message', nom: 'modele', id: 'sms-modele', val: brouillon.modele, options: C.SMS_MODELES.map(([l], i) => [String(i), l]), attrs: { 'data-change': 'sms-modele' } })}
            <span></span>
            ${F.zone({ lib: 'Texte du message', nom: 'texte', id: 'sms-texte', val: brouillon.texte, lignes: 4, plein: true, attrs: { maxlength: 459, 'data-input': 'sms-texte' }, aide: 'Remplacez les éléments entre crochets ([date], [heure], [élève]…) avant l’envoi.' })}
          </div>
          <p class="mut petit mb0" id="sms-compte">${longueur} / 459 caractères · ${u.pluriel(parties, 'SMS')} par destinataire</p>
          <div class="ligne"><span class="puce">${ic('users')}${u.pluriel(D.length, 'élève')} · ${u.pluriel(numeros.length, 'numéro')}</span>${sans.length ? ui.tag(`${sans.length} sans numéro`, 'avert') : ''}</div>
          <div class="ligne">
            <button type="button" class="btn" data-action="sms-copier-texte">${ic('copy')}Copier le texte</button>
            <button type="button" class="btn" data-action="sms-copier-numeros"${numeros.length ? '' : raw(' disabled')}>${ic('copy')}Copier les numéros</button>
            <button type="button" class="btn" data-action="sms-csv"${D.length ? '' : raw(' disabled')}>${ic('down')}Liste (CSV)</button>
            ${numeros.length ? html`<button type="button" class="btn" data-action="sms-ouvrir">${ic('send')}Ouvrir l’application SMS</button>` : ''}
            <span class="espace"></span>
            <button type="button" class="btn btn-pri" data-action="sms-noter"${D.length && brouillon.texte.trim() ? '' : raw(' disabled')}>${ic('check')}Noter l’envoi</button>
          </div>
          ${sans.length ? html`<details><summary class="petit">Élèves sans numéro de parent (${sans.length})</summary><p class="petit mut">${sans.map((d) => `${X().nomComplet(d.s)} (${d.s.classe})`).join(' · ')}</p></details>` : ''}
        </div>`)}
        <div class="pile">
          ${ui.carte('Annonces', annonces.length ? html`<div class="pile-sm">${annonces.map((a) => html`<article class="annonce"><div class="ligne-entre"><b>${a.titre}</b><span class="ligne">${ui.tag(a.cible)}<span class="mut petit">${u.fmtDate(a.date)}</span><button type="button" class="btn-ic" data-action="annonce-retirer" data-id="${a.id}" aria-label="Retirer l’annonce ${a.titre}" data-bulle="Retirer">${ic('trash')}</button></span></div><p class="mb0" style="white-space:pre-wrap">${a.corps}</p></article>`)}</div>` : html`<p class="mut mb0">Aucune annonce.</p>`)}
          ${ui.carte('Messages notés', P().sms.length ? html`<div class="liste">${P().sms.slice(0, 12).map((m) => html`<div><span class="flex1"><b>${m.objet || 'Message'}</b><br><span class="mut petit">${(DEST.find(([k]) => k === m.dest) || [, m.dest])[1]} · ${u.pluriel(m.n, 'destinataire')}</span></span><span class="m">${u.fmtDate(m.date)}</span></div>`)}</div>` : html`<p class="mut mb0">Aucun envoi noté.</p>`)}
        </div>
      </div>`;
  }
  /** Lien sms: (Android : numéros séparés par des virgules ; corps encodé). */
  const smsLien = (numeros, texte) => `sms:${numeros.join(',')}?body=${encodeURIComponent(texte)}`;
  async function copier(texte, quoi) {
    try {
      await navigator.clipboard.writeText(texte);
      ui.toast(`${quoi} copié${quoi.endsWith('s') ? 's' : ''} dans le presse-papiers.`);
    } catch (e) {
      ui.info(quoi, html`<p>La copie automatique est bloquée par ce navigateur. Sélectionnez puis copiez :</p><textarea class="inp" rows="6" readonly style="width:100%">${texte}</textarea>`, { icone: 'copy' });
    }
  }

  AK.ecrans.def('services/biblio', { rendu: rendreBiblio, droit: 'services.utiliser' });
  AK.ecrans.def('services/cepe', { rendu: rendreCepe, droit: 'services.utiliser' });
  AK.ecrans.def('services/parents', { rendu: rendreParents, droit: 'services.utiliser' });

  AK.actions.def({
    'biblio-vue': (el) => AK.shell.aller('services/biblio', el.dataset.v === 'prets' ? { vue: 'prets' } : {}),
    'biblio-ouvrage'() {
      ui.fenetre({
        titre: 'Ajouter un ouvrage', icone: 'book', ok: 'Ajouter',
        corps: html`<div class="form-grille">${F.texte({ lib: 'Titre', nom: 'titre', req: true, plein: true, attrs: { maxlength: 120 } })}${F.texte({ lib: 'Auteur', nom: 'auteur', attrs: { maxlength: 80 } })}${F.choix({ lib: 'Genre', nom: 'genre', options: C.GENRES, val: 'Manuel' })}${F.nombre({ lib: 'Nombre d’exemplaires', nom: 'ex', val: 1, req: true, attrs: { min: 1, max: 9999, step: 1 } })}${F.texte({ lib: 'Cote', nom: 'cote', attrs: { maxlength: 20, placeholder: 'Attribuée automatiquement si vide' } })}</div>`,
        surValider(d) {
          AK.pro.ouvrage(d);
          ui.toast('Ouvrage ajouté au fonds.');
        }
      });
    },
    async 'biblio-retirer'(el) {
      const b = P().livres.find((x) => x.id === el.dataset.id);
      if (!b) return;
      const pretes = P().prets.filter((p) => p.livre === b.id && !p.rendu).length;
      if (pretes) throw new AK.ErreurMetier(`« ${b.titre} » : ${u.pluriel(pretes, 'exemplaire encore prêté', 'exemplaires encore prêtés')}. Enregistrez d’abord les retours.`);
      if (!(await ui.confirmer({ titre: 'Retirer un ouvrage', danger: true, ok: 'Retirer du fonds', message: `Retirer « ${b.titre} » (${u.pluriel(b.ex, 'exemplaire')}) du fonds de la bibliothèque ? L’historique des prêts est conservé.` }))) return;
      AK.pro.retirerOuvrage(b.id);
      ui.toast('Ouvrage retiré du fonds.');
    },
    'biblio-pret'(el) {
      const livres = P().livres.filter((b) => disponibles(b) > 0);
      if (!livres.length) throw new AK.ErreurMetier('Aucun ouvrage disponible : ajoutez des ouvrages ou enregistrez les retours.');
      const auj = u.aujourdhui();
      ui.fenetre({
        titre: 'Nouveau prêt', icone: 'send', ok: 'Enregistrer le prêt',
        corps: html`<div class="form-grille">${F.choix({ lib: 'Ouvrage', nom: 'livre', req: true, plein: true, val: el.dataset.livre, options: livres.map((b) => [b.id, `${b.titre} (${b.cote}) · ${disponibles(b)} disponible(s)`]), vide: 'Choisir…' })}
          ${F.choix({ lib: 'Élève', nom: 'sid', req: true, plein: true, options: elevesVisibles().map((s) => [s.id, `${X().nomComplet(s)} (${s.classe})`]), vide: 'Choisir…' })}
          ${F.date({ lib: 'Prêté le', nom: 'out', val: auj, req: true, attrs: { max: auj } })}${F.date({ lib: 'Retour prévu le', nom: 'due', val: u.ajouterJours(auj, 14), req: true })}</div>`,
        surValider(d) {
          if (!d.sid) throw new AK.ErreurMetier('Choisissez l’élève.', 'sid');
          AK.pro.preter(d);
          ui.toast('Prêt enregistré.');
        }
      });
    },
    'biblio-retour'(el) {
      AK.pro.retour(el.dataset.id);
      ui.toast('Retour enregistré.');
    },
    'cepe-filtre': (el) => AK.shell.aller('services/cepe', el.dataset.v ? { filtre: el.dataset.v } : {}),
    'annonce-nouvelle'() {
      ui.fenetre({
        titre: 'Nouvelle annonce', icone: 'msg', ok: 'Publier',
        corps: html`<div class="form-grille">${F.texte({ lib: 'Titre', nom: 'titre', req: true, plein: true, attrs: { maxlength: 100 } })}${F.choix({ lib: 'Destinée à', nom: 'cible', options: ['Parents', 'Enseignants', 'Élèves', 'Tous'], val: 'Parents' })}${F.date({ lib: 'Date', nom: 'date', val: u.aujourdhui() })}${F.zone({ lib: 'Texte', nom: 'corps', req: true, plein: true, lignes: 5, attrs: { maxlength: 1500 } })}</div>`,
        surValider(d) {
          AK.pro.annonce(d);
          ui.toast('Annonce publiée.');
        }
      });
    },
    async 'annonce-retirer'(el) {
      const a = P().annonces.find((x) => x.id === el.dataset.id);
      if (!a || !(await ui.confirmer({ titre: 'Retirer une annonce', danger: true, ok: 'Retirer', message: `Retirer l’annonce « ${a.titre} » ?` }))) return;
      AK.pro.retirerAnnonce(a.id);
      ui.toast('Annonce retirée.');
    },
    'sms-copier-texte': () => copier(brouillon.texte, 'Texte'),
    'sms-ouvrir'() {
      const numeros = [...new Set(destinataires().filter((d) => d.tel).map((d) => d.tel))];
      if (numeros.length) location.href = smsLien(numeros, brouillon.texte);
    },
    'sms-copier-numeros': () => copier([...new Set(destinataires().filter((d) => d.tel).map((d) => d.tel))].join(', '), 'Numéros'),
    async 'sms-csv'() {
      const D = destinataires();
      await AK.sauvegarde.csv(`parents-${brouillon.dest}-${u.aujourdhui()}.csv`, [['Élève', 'Classe', 'Parent ou tuteur', 'Téléphone'], ...D.map((d) => [X().nomComplet(d.s), d.s.classe, d.s.parent || [d.s.pere && d.s.pere.nom, d.s.pere && d.s.pere.prenoms].filter(Boolean).join(' ') || [d.s.mere && d.s.mere.nom, d.s.mere && d.s.mere.prenoms].filter(Boolean).join(' '), d.tel])], 'numéros des parents');
    },
    async 'sms-noter'() {
      const D = destinataires();
      if (!brouillon.texte.trim()) throw new AK.ErreurMetier('Le message est vide.');
      if (/\[[^\]]+\]/.test(brouillon.texte) && !(await ui.confirmer({ titre: 'Éléments à compléter', message: 'Le message contient encore des éléments entre crochets ([date], [élève]…). Noter quand même l’envoi ?', ok: 'Noter quand même' }))) return;
      AK.pro.noterEnvoi({ dest: brouillon.dest, n: D.length, objet: (C.SMS_MODELES[+brouillon.modele] || ['Message'])[0], texte: brouillon.texte });
      ui.toast(`Envoi noté : ${u.pluriel(D.length, 'destinataire')}.`);
    }
  });
  AK.actions.defChange({
    'cepe-piece'(el) {
      AK.pro.pieceCepe(el.dataset.id, el.dataset.k, el.checked);
    },
    'sms-champ'(el) {
      brouillon[el.name] = el.value;
      AK.shell.redessiner();
    },
    async 'sms-modele'(el) {
      const avant = C.SMS_MODELES[+brouillon.modele], choisi = el.value;
      if (brouillon.texte.trim() && avant && brouillon.texte !== avant[1] && !(await ui.confirmer({ titre: 'Remplacer le texte', message: 'Remplacer le texte saisi par le modèle choisi ?', ok: 'Remplacer' }))) {
        el.value = brouillon.modele;
        return;
      }
      el.value = choisi;
      brouillon.modele = choisi;
      brouillon.texte = (C.SMS_MODELES[+choisi] || ['', ''])[1];
      AK.shell.redessiner();
    }
  });
  AK.actions.defSaisie({
    'sms-texte'(el) {
      brouillon.texte = el.value;
      const n = el.value.length, c = $('#sms-compte');
      if (c) c.textContent = `${n} / 459 caractères · ${u.pluriel(Math.max(1, Math.ceil(n / 153)), 'SMS')} par destinataire`;
    }
  });
})(window.AK);
