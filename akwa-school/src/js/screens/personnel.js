/* =====================================================================================
   Personnel : fiches (affectation des classes, type de fonctionnement), comptes des
   enseignants (mot de passe provisoire affiché une seule fois), messages du directeur.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);

  /* ---------- Liste ---------- */
  function rendreListe() {
    const x = X(), L = S().teachers.slice().sort((a, b) => (a.actif === false) - (b.actif === false) || C.TOUS_NIVEAUX.indexOf(x.clsDe(a)[0] || 'ZZ') - C.TOUS_NIVEAUX.indexOf(x.clsDe(b)[0] || 'ZZ') || a.nom.localeCompare(b.nom, 'fr'));
    return html`${ui.pageTete('Personnel', 'Enseignants et agents. Un niveau n’a qu’un enseignant ; une classe multigrade ou jumelée regroupe plusieurs niveaux.', html`<button type="button" class="btn" data-action="doc-ecole" data-modele="liste-personnel">${ic('print')}Liste du personnel</button>${peut('document.emettre') && L.length ? html`<button type="button" class="btn" data-action="agents-cartes">${ic('idCard')}Cartes professionnelles</button>` : ''}<button type="button" class="btn btn-pri" data-action="agent-nouveau">${ic('userPlus')}Ajouter un membre</button>`)}
      ${ui.tableau({
        id: 'personnel', lignes: L, unite: 'membre', exporter: 'personnel', recherche: (t) => t.nom + ' ' + t.matricule + ' ' + t.fonction, placeholder: 'Nom, matricule, fonction…', selection: peut('document.emettre'),
        actionsSelection: () => html`<button type="button" class="btn btn-sm" data-action="agents-cartes" data-selection="1">${ic('idCard')}Cartes</button>`,
        colonnes: [
          { cle: 'nom', lib: 'Nom', tri: (t) => V.civ.sans(t.nom), csv: (t) => t.nom, rendu: (t) => html`<div class="qui">${ui.avatar(t)}<span class="tronque">${ui.nomAgent(t)}${t.actif === false ? html`<br>${ui.tag('Fiche désactivée', 'mauvais')}` : ''}</span></div>` },
          { cle: 'mat', lib: 'Matricule', tri: (t) => t.matricule, rendu: (t) => html`<span class="mono">${t.matricule || '—'}</span>` },
          { cle: 'fonction', lib: 'Fonction', tri: (t) => t.fonction },
          { cle: 'grade', lib: 'Emploi / grade', tri: (t) => x.emploiGrade(t), rendu: (t) => x.emploiGrade(t) || '—' },
          { cle: 'cl', lib: 'Classe(s)', tri: (t) => C.TOUS_NIVEAUX.indexOf(x.clsDe(t)[0] || 'ZZ'), csv: (t) => x.clsTxt(t), rendu: (t) => (x.clsDe(t).length ? html`${x.clsDe(t).map(ui.lienClasse)}${x.fonctTxt(t) ? html`<br><span class="mut petit">${x.fonctTxt(t)}</span>` : ''}` : ui.tag('—')) },
          { cle: 'tel', lib: 'Téléphone', tri: (t) => t.tel, rendu: (t) => (t.tel ? html`<a href="tel:${t.tel}">${t.tel}</a>` : '—'), csv: (t) => t.tel },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (t) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap"><button type="button" class="btn-ic" data-action="agent-modifier" data-id="${t.id}" aria-label="Modifier ${t.nom}" data-bulle="Modifier">${ic('edit')}</button><button type="button" class="btn-ic" data-action="agent-plus" data-id="${t.id}" aria-label="Autres actions pour ${t.nom}" aria-haspopup="menu">${ic('more')}</button></div>` }
        ],
        vide: ui.vide('Aucun membre du personnel', 'Ajoutez les enseignants pour leur affecter une classe et leur créer un compte.', html`<button type="button" class="btn btn-pri" data-action="agent-nouveau">${ic('userPlus')}Ajouter un membre</button>`)
      })}`;
  }

  function formulaire(t) {
    t = t || {};
    const x = X();
    return html`<div class="pile">
      <section class="section-form"><h3>${ic('user')}Identité</h3><div class="form-grille">
        ${F.choix({ lib: 'Civilité', nom: 'civ', val: V.civ.de(t.nom), options: C.CIVS, vide: 'Choisir…', req: true })}
        ${F.texte({ lib: 'Nom et prénoms', nom: 'nom', val: V.civ.sans(t.nom || ''), req: true, attrs: { 'data-input': 'maj-nom-complet', maxlength: 80, autocomplete: 'off', placeholder: 'Ex. : KOFFI Kouadio' } })}
        ${F.texte({ lib: 'Matricule', nom: 'matricule', val: t.matricule, attrs: { maxlength: 12, autocapitalize: 'characters', placeholder: 'Ex. : 123456A' } })}
        ${F.tel({ lib: 'Téléphone', nom: 'tel', val: t.tel })}
        ${F.image({ lib: 'Photo', nom: 'photo', val: t.photo, bouton: 'Choisir une photo', max: 360 })}
        ${F.date({ lib: 'Prise de service dans l’école', nom: 'dateEntree', val: t.dateEntree, attrs: { max: u.aujourdhui() } })}
      </div></section>
      <section class="section-form"><h3>${ic('brief')}Carrière</h3><div class="form-grille">
        ${F.choix({ lib: 'Fonction', nom: 'fonction', val: t.fonction || 'Instituteur', options: C.FONCTIONS, req: true })}
        ${F.choix({ lib: 'Emploi', nom: 'grade', val: t.grade || C.GRADES[0], options: C.GRADES })}
        ${F.texte({ lib: 'Grade (ex. B3)', nom: 'echelon', val: t.echelon, attrs: { maxlength: 6, autocapitalize: 'characters' } })}
        ${F.image({ lib: 'Avis d’affectation ou de mutation (photo)', nom: 'avis', val: t.avis, bouton: 'Photographier l’avis', max: 1400 })}
      </div></section>
      <section class="section-form"><h3>${ic('grid')}Classe(s) tenue(s)</h3><div class="pile">
        ${F.cases({ lib: 'Niveaux (plusieurs pour une classe multigrade ou jumelée)', nom: 'classes', options: x.niveaux(), valeurs: x.clsDe(t) })}
        <div class="form-grille">${F.choix({ lib: 'Type de fonctionnement de la classe', nom: 'fonct', val: t.fonct, options: C.FONCTS, vide: 'Choisir…', aide: 'Obligatoire dès qu’une classe est cochée.' })}
        ${F.texte({ lib: 'Préciser (si « Autre »)', nom: 'fonctAutre', val: t.fonctAutre, attrs: { maxlength: 60, placeholder: 'Ex. : classe passerelle' } })}</div>
        ${ui.encadre('Cocher un niveau déjà tenu par un collègue le lui retire.', 'info')}</div></section></div>`;
  }
  function ouvrirFormulaire(t) {
    ui.fenetre({
      titre: t ? `Modifier · ${t.nom}` : 'Ajouter un membre du personnel', icone: t ? 'edit' : 'userPlus', taille: 'lg', ok: t ? 'Enregistrer' : 'Ajouter',
      corps: formulaire(t),
      async surValider(d) {
        try {
          if (t) AK.personnel.modifier(t.id, d);
          else AK.personnel.ajouter(d);
        } catch (err) {
          if (!err.doublons) throw err;
          if (!(await ui.confirmer({ titre: 'Homonyme', message: `${err.message} S’agit-il d’une autre personne ?`, ok: 'Oui, une autre personne' }))) return false;
          if (t) AK.personnel.modifier(t.id, { ...d, accepterDoublon: true });
          else AK.personnel.ajouter({ ...d, accepterDoublon: true });
        }
        ui.toast(t ? 'Fiche mise à jour.' : 'Membre du personnel ajouté.');
      }
    });
  }

  function fiche(id) {
    const t = AK.personnel.trouver(id);
    if (!t || !peut('personnel.voir')) return null;
    const x = X(), auths = S().auth.filter((a) => a.qui === 'personnel' && a.pid === t.id).slice().reverse();
    const eff = x.actifs().filter((s) => x.clsDe(t).includes(s.classe)).length;
    const docs = AK.registre.duSujet(t.id).slice(-5).reverse();
    return html`<div class="pile">
      <div class="fiche-hero">${ui.avatar(t, 'xl')}<div class="flex1"><h2>${t.nom}</h2><div class="mut">${t.fonction}${x.emploiGrade(t) ? ' · ' + x.emploiGrade(t) : ''}</div><div class="ligne mt0">${x.clsDe(t).length ? html`${x.clsDe(t).map(ui.lienClasse)}<span class="mut petit">${eff} élèves</span>` : ui.tag('Sans classe')}${t.actif === false ? ui.tag('Fiche désactivée', 'mauvais') : ''}</div></div></div>
      <div class="ligne"><button type="button" class="btn btn-sm" data-action="agent-modifier" data-id="${t.id}">${ic('edit')}Modifier</button><button type="button" class="btn btn-sm" data-action="autorisation-nouvelle" data-qui="personnel" data-id="${t.id}">${ic('cal')}Demande d’absence</button><button type="button" class="btn btn-sm" data-action="agent-documents" data-id="${t.id}">${ic('file')}Documents</button></div>
      ${ui.carte('Dossier', html`<dl class="kv"><dt>Matricule</dt><dd>${t.matricule || '—'}</dd><dt>Emploi / grade</dt><dd>${x.emploiGrade(t) || '—'}</dd><dt>Fonctionnement</dt><dd>${x.fonctTxt(t) || '—'}</dd><dt>Téléphone</dt><dd>${t.tel || '—'}</dd><dt>Prise de service</dt><dd>${u.fmtDate(t.dateEntree)}</dd><dt>Compte</dt><dd>${t.compte ? `${t.compte.login} · ${t.compte.actif ? 'actif' : 'désactivé'}` : 'Aucun'}</dd></dl>${t.avis ? html`<h3 class="mt petit">Avis d’affectation ou de mutation</h3><img src="${t.avis}" alt="Avis d’affectation" style="max-width:100%;border:1px solid var(--line);border-radius:8px">` : ''}`)}
      ${ui.carte('Demandes d’autorisation', auths.length ? html`<div class="liste">${auths.map((a) => html`<a href="#absences/autorisations?qui=personnel"><span class="flex1"><b>${a.ref}</b> · ${a.motif}<br><span class="mut petit">${u.fmtDate(a.du)}${a.au !== a.du ? ' → ' + u.fmtDate(a.au) : ''} · ${u.pluriel(AK.absences.joursDemande(a), 'jour')}</span></span><span class="m">${ui.tag(a.statut, a.statut === 'Accordée' ? 'ok' : a.statut === 'Refusée' ? 'mauvais' : 'avert')}</span></a>`)}</div>` : html`<p class="mut mb0">Aucune demande.</p>`)}
      ${docs.length ? ui.carte('Documents émis', html`<div class="liste">${docs.map((d) => html`<a href="#documents/registre?ref=${d.ref}"><span class="flex1"><b>${AK.registre.libelleType(d.type)}</b><br><span class="mono petit mut">${d.ref}</span></span><span class="m">${u.fmtDate(d.emisLe.slice(0, 10))}</span></a>`)}</div>`) : ''}
    </div>`;
  }
  ui.defTiroir('agent', fiche);

  /* ---------- Comptes ---------- */
  function rendreComptes() {
    const L = S().teachers.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const local = AK.hote.authentificationLocale;
    return html`${ui.pageTete('Comptes enseignants', 'Chaque enseignant se connecte avec son identifiant et ne voit que sa classe : notes, appel, résultats, demandes d’absence.')}
      ${ui.encadre(local ? html`Le mot de passe provisoire n’est affiché <b>qu’une seule fois</b> : notez-le et remettez-le à l’enseignant, qui devra le changer à sa première connexion. Les mots de passe sont conservés sous forme d’empreintes (jamais en clair).` : 'Version bureau : les comptes sont gérés par l’application Windows.', 'info', 'shield')}
      ${ui.tableau({
        id: 'comptes', lignes: L, unite: 'membre', recherche: (t) => t.nom + ' ' + (t.compte ? t.compte.login : ''),
        colonnes: [
          { cle: 'nom', lib: 'Membre', tri: (t) => t.nom, rendu: (t) => html`<div class="qui">${ui.avatar(t)}<span>${ui.nomAgent(t)}<br><span class="mut petit">${X().clsTxt(t) || 'Sans classe'}</span></span></div>` },
          { cle: 'login', lib: 'Identifiant', tri: (t) => (t.compte ? t.compte.login : ''), rendu: (t) => (t.compte ? html`<span class="mono">${t.compte.login}</span>` : html`<span class="mut">—</span>`) },
          { cle: 'etat', lib: 'État', rendu: (t) => (!t.compte ? ui.tag('Pas de compte') : !t.compte.actif ? ui.tag('Désactivé', 'mauvais') : (S().securite.comptes[t.id] || {}).provisoire ? ui.tag('Mot de passe provisoire', 'avert') : ui.tag('Actif', 'ok')) },
          { cle: 'act', lib: '', cls: 'droite', rendu: (t) => html`<div class="ligne" style="justify-content:flex-end">${!t.compte ? html`<button type="button" class="btn btn-sm btn-pri" data-action="compte-creer" data-id="${t.id}"${t.actif === false ? raw(' disabled') : ''}>${ic('key')}Créer le compte</button>` : html`<button type="button" class="btn btn-sm" data-action="compte-reinit" data-id="${t.id}">${ic('refresh')}Nouveau mot de passe</button><button type="button" class="btn btn-sm" data-action="compte-basculer" data-id="${t.id}">${ic(t.compte.actif ? 'lock' : 'unlock')}${t.compte.actif ? 'Désactiver' : 'Activer'}</button>`}</div>` }
        ],
        vide: ui.vide('Aucun membre du personnel', 'Ajoutez d’abord les enseignants dans l’onglet Personnel.')
      })}
      <div class="mt">${suiviClasses()}</div>`;
  }
  /** Suivi des classes (évaluation en cours) : avancement des notes, saisie, appel, messages. */
  function suiviClasses() {
    const x = X(), n = S().school.evalCourante || 1, auj = u.aujourdhui();
    return ui.carte(`Suivi des classes · ${C.EV_GEN[n - 1]}`, html`<div class="tab-cadre"><table class="tab"><thead><tr><th>Classe</th><th>Enseignant</th><th class="centre">Notes saisies</th><th class="centre">En attente</th><th class="centre">Saisie</th><th class="centre">Appel du jour</th><th class="centre">Absents du jour</th><th class="centre">Messages non lus</th></tr></thead><tbody>${x.niveaux().map((c) => {
      const t = x.enseignantDe(c), L = x.actifsDe(c).filter((s) => !x.estAbsent(s.id, n)), tot = L.length * x.matieres(c, n).length;
      const sa = S().saisie[c + '|' + n] || {}, abs = Object.keys(S().att[auj] || {}).filter((id) => { const s = AK.eleves.trouver(id); return s && s.classe === c; }).length;
      const nl = t ? AK.personnel.nonLus(t.id).length : 0, att = AK.notes.enAttenteDe(c, n).length;
      return html`<tr><td>${ui.lienClasse(c)}</td><td>${t ? t.nom : html`<span class="mut">—</span>`}</td><td class="centre num">${tot - x.notesManquantes(c, n)} / ${tot}</td><td class="centre">${att ? ui.tag(String(att), 'avert') : '—'}</td><td class="centre">${AK.notes.saisieOuverte(c, n) ? html`ouverte${sa.fin ? ' jusqu’au ' + u.fmtDate(sa.fin) : ''}` : ui.tag('fermée', 'mauvais')}</td><td class="centre">${(S().appel[auj] || {})[c] ? ui.tag('fait', 'ok', 'check') : x.estJourClasse(auj) ? ui.tag('pas fait', 'avert') : html`<span class="mut">pas classe</span>`}</td><td class="centre num">${abs}</td><td class="centre num">${nl || '—'}</td></tr>`;
    })}</tbody></table></div>`, { sous: 'Ce que chaque enseignant a fait dans l’application', actions: html`<a class="btn btn-sm" href="#notes/validation">${ic('check')}Validation des notes</a>` });
  }

  function montrerMdp(t, mdp) {
    ui.fenetre({
      titre: `Mot de passe provisoire · ${t.nom}`, icone: 'key', taille: 'sm', ok: 'J’ai noté le mot de passe', annuler: false, proteger: false,
      corps: html`<div class="pile"><p class="mb0">Identifiant : <b class="mono">${t.compte.login}</b></p><div class="code-secours" style="font-size:22px">${mdp}</div>
        ${ui.encadre('Ce mot de passe ne sera plus jamais affiché. L’enseignant devra le remplacer à sa première connexion.', 'avert')}</div>`
    });
  }

  /* ---------- Messages ---------- */
  function rendreMessages() {
    const dir = AK.session.estDirecteur(), moi = AK.session.agent();
    const L = dir ? S().messages : S().messages.filter((m) => moi && (!m.dest || m.dest === moi.id));
    const actifs = S().teachers.filter((t) => t.actif !== false);
    return html`${ui.pageTete('Messages', dir ? 'Informations du directeur aux enseignants : elles s’affichent à leur connexion.' : 'Messages du directeur.', dir ? html`<button type="button" class="btn btn-pri" data-action="message-nouveau">${ic('send')}Nouveau message</button>` : moi && AK.personnel.nonLus(moi.id).length ? html`<button type="button" class="btn" data-action="lire-messages">${ic('check')}Tout marquer comme lu</button>` : '')}
      ${L.length ? html`<div class="pile">${L.map((m) => {
        const dest = m.dest ? AK.personnel.trouver(m.dest) : null;
        const cibles = m.dest ? (dest ? [dest] : []) : actifs;
        const lus = cibles.filter((t) => m.lus[t.id]).length;
        const nonLu = !dir && moi && !m.lus[moi.id];
        return ui.carte(m.titre, html`<p style="white-space:pre-wrap" class="mb0">${m.texte}</p>`, { sous: html`${new Date(m.t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · ${m.dest ? 'À ' + (dest ? dest.nom : 'un membre retiré') : 'À tous les enseignants'}${dir ? html` · lu par ${lus}/${cibles.length}` : ''}`, actions: nonLu ? ui.tag('Nouveau', 'acc') : '' });
      })}</div>` : ui.vide('Aucun message', dir ? 'Envoyez une information à tous les enseignants ou à l’un d’eux.' : 'Aucun message du directeur pour l’instant.')}`;
  }

  AK.ecrans.def('personnel/liste', { rendu: rendreListe, droit: 'personnel.voir' });
  AK.ecrans.def('personnel/comptes', { rendu: rendreComptes, droit: 'comptes.gerer' });
  AK.ecrans.def('personnel/messages', { rendu: rendreMessages, compteOnglet: () => {
    const moi = AK.session.agent();
    return moi ? AK.personnel.nonLus(moi.id).length || null : null;
  } });

  const agentDe = (el) => {
    const t = AK.personnel.trouver(el.dataset.id);
    if (!t) throw new AK.ErreurMetier('Membre du personnel introuvable.');
    return t;
  };
  AK.actions.def({
    'fiche-agent': (el) => (peut('personnel.voir') ? ui.ouvrirTiroir('agent', el.dataset.id) : null),
    'agent-nouveau': () => {
      AK.perm.exiger('personnel.gerer');
      ouvrirFormulaire(null);
    },
    'agent-modifier': (el) => {
      AK.perm.exiger('personnel.gerer');
      ouvrirFormulaire(agentDe(el));
    },
    'agent-documents'(el) {
      const t = agentDe(el);
      const items = AK.modeles.liste().filter((d) => d.sujet === 'agent').filter((d) => !d.emission || peut('document.emettre')).map((d) => ({
        icone: d.icone || 'file', lib: d.lib, f: () => (d.categorie === 'carte' ? AK.docsUi.cartes(d.id, [t.id]) : AK.docs.ouvrir(d.id, [{ agent: t }]))
      }));
      ui.menu(el, items.length ? items : [html`<p class="mut petit" style="padding:10px">Aucun document disponible pour votre profil.</p>`], t.nom);
    },
    'agent-plus'(el) {
      const t = agentDe(el);
      ui.menu(el, [
        { icone: 'user', lib: 'Ouvrir la fiche', f: () => ui.ouvrirTiroir('agent', t.id) },
        { icone: 'file', lib: 'Documents…', f: () => AK.actions.lancer('agent-documents', el) },
        { icone: t.actif === false ? 'unlock' : 'lock', lib: t.actif === false ? 'Réactiver la fiche' : 'Désactiver la fiche (départ, mutation)', sous: t.actif === false ? '' : 'Le compte est bloqué ; l’historique est conservé', f: () => AK.personnel.basculerFiche(t.id) },
        'sep',
        { icone: 'trash', lib: 'Retirer (corbeille)', danger: true, f: async () => {
          if (!(await ui.confirmer({ titre: 'Retirer un membre du personnel', danger: true, ok: 'Mettre à la corbeille', message: html`<p><b>${t.nom}</b> sera placé(e) dans la corbeille avec son compte. Ses classes deviennent sans enseignant.</p><p class="mb0">Pour un départ ou une mutation, préférez « Désactiver la fiche ».</p>` }))) return;
          if (!(await AK.auth.confirmer(`Retirer ${t.nom} du personnel.`))) return;
          AK.personnel.retirer(t.id);
          ui.fermerTiroir();
          ui.toast('Membre placé dans la corbeille.');
        } }
      ], t.nom);
    },
    'agents-cartes'(el) {
      const ids = el.dataset.selection ? ui.tableauChoix('personnel') : S().teachers.filter((t) => t.actif !== false).map((t) => t.id);
      AK.docsUi.cartes('carte-agent', ids);
    },
    async 'compte-creer'(el) {
      const t = agentDe(el);
      ui.fenetre({
        titre: `Créer le compte de ${t.nom}`, icone: 'key', taille: 'sm', ok: 'Créer le compte', proteger: false,
        corps: html`<div class="pile">${F.texte({ lib: 'Identifiant de connexion', nom: 'login', val: AK.auth.loginDe(t.nom), req: true, attrs: { maxlength: 24, autocomplete: 'off', autocapitalize: 'none' }, aide: '3 à 24 caractères : lettres minuscules, chiffres, point, tiret.' })}</div>`,
        async surValider(d) {
          const mdp = await AK.auth.creerCompte(t.id, d.login);
          setTimeout(() => montrerMdp(t, mdp), 50);
        }
      });
    },
    async 'compte-reinit'(el) {
      const t = agentDe(el);
      if (!(await ui.confirmer({ titre: 'Nouveau mot de passe', message: `Créer un nouveau mot de passe provisoire pour ${t.nom} ? L’ancien ne fonctionnera plus.`, ok: 'Créer' }))) return;
      if (!(await AK.auth.confirmer(`Réinitialiser le mot de passe de ${t.nom}.`))) return;
      montrerMdp(t, await AK.auth.reinitCompte(t.id));
    },
    'compte-basculer': (el) => AK.personnel.basculerCompte(agentDe(el).id),
    'message-nouveau'() {
      AK.perm.exiger('messages.envoyer');
      ui.fenetre({
        titre: 'Nouveau message aux enseignants', icone: 'send', ok: 'Envoyer',
        corps: html`<div class="pile">${F.choix({ lib: 'Destinataire', nom: 'dest', options: S().teachers.filter((t) => t.actif !== false && t.compte).map((t) => [t.id, t.nom]), vide: 'Tous les enseignants' })}
          ${F.texte({ lib: 'Objet', nom: 'titre', req: true, attrs: { maxlength: 120 } })}${F.zone({ lib: 'Message', nom: 'texte', req: true, lignes: 6, attrs: { maxlength: 2000 } })}</div>`,
        surValider(d) {
          AK.personnel.envoyerMessage(d);
          ui.toast('Message envoyé.');
        }
      });
    }
  });
})(window.AK);
