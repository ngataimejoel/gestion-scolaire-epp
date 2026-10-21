/* =====================================================================================
   Absences : appel du jour (Présent → Absent → Absent justifié) et demandes d'autorisation
   d'absence (personnel et élèves), avec décision du directeur et impression de la demande.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const LIB = { '': 'Présent', A: 'Absent', J: 'Absent justifié' };

  /* ---------- Appel ---------- */
  function rendreAppel(p) {
    const classes = AK.session.classes();
    const c = classes.includes(p.classe) ? p.classe : classes[0];
    if (!c) return html`${ui.pageTete('Appel du jour')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const x = X(), auj = u.aujourdhui();
    const date = u.estISO(p.date) && p.date <= auj ? p.date : auj;
    const L = x.actifsDe(c).sort(x.parNom), d = S().att[date] || {}, fait = (S().appel[date] || {})[c];
    const nA = L.filter((s) => d[s.id] === 'A').length, nJ = L.filter((s) => d[s.id] === 'J').length;
    const ferie = S().conges.find((k) => date >= k.du && date <= (k.au || k.du));
    const jourClasse = x.estJourClasse(date);
    const lever = peut('appel.lever');
    const pil = ui.pilules(classes.map((k) => [k, k, (S().appel[date] || {})[k] ? raw('<span class="pt" aria-label="appel fait"></span>') : '']), c, 'appel-classe');
    return html`${ui.pageTete('Appel du jour', lever ? 'Un clic sur l’état fait défiler : Présent → Absent → Absent justifié.' : 'Touchez « Présent » pour marquer un élève absent. Une absence enregistrée ne peut être levée que par le directeur.',
      html`<button type="button" class="btn" data-action="appel-tous" data-classe="${c}" data-date="${date}">${ic('check')}${lever ? 'Tout le monde présent' : 'Les autres sont présents'}</button><button type="button" class="btn btn-pri" data-action="appel-valider" data-classe="${c}" data-date="${date}">${ic('clip')}${fait ? 'Appel validé' : 'Valider l’appel'}</button>`)}
      <div class="barre-outils">${pil}<input class="inp inp-sm" type="date" value="${date}" max="${auj}" data-change="appel-date" aria-label="Date de l’appel" style="width:auto"><span class="puce">${L.length - nA - nJ} présent(s) · ${nA} absent(s) · ${nJ} justifié(s)</span>${fait ? ui.tag('Appel fait', 'ok', 'check') : ''}</div>
      ${!jourClasse ? ui.encadre(`${ferie ? ferie.lib + ' : ' : ''}ce jour n’est pas un jour de classe (lundi, mardi, jeudi et vendredi, hors congés). L’appel reste possible si nécessaire.`, 'avert', 'cal') : ''}
      ${L.length ? html`<div class="tab-cadre"><table class="tab" aria-label="Appel ${c} du ${u.fmtDate(date)}"><thead><tr><th>Élève</th><th>Matricule</th><th>Présence</th><th class="droite">Absences de l’année</th></tr></thead><tbody>${L.map((s) => {
        const v = d[s.id] || '', n = x.absencesDe(s.id).length;
        return html`<tr><td>${ui.quiEleve(s)}</td><td class="mono">${x.matOf(s)}</td><td><button type="button" id="pr-${s.id}" class="presence ${v}" data-action="appel-basculer" data-id="${s.id}" data-classe="${c}" data-date="${date}" aria-label="${x.nomComplet(s)} : ${LIB[v]}. Changer.">${v ? ic(v === 'J' ? 'info' : 'x', 'i-sm') : ic('check', 'i-sm')}${LIB[v]}</button></td><td class="droite">${n ? ui.tag(String(n), n >= 5 ? 'avert' : '') : '—'}</td></tr>`;
      })}</tbody></table></div>` : ui.vide('Aucun élève inscrit', `Aucun élève inscrit en ${c}.`)}`;
  }

  /* ---------- Autorisations ---------- */
  function rendreAutorisations(p) {
    const L = S().auth.filter(AK.absences.visible).filter((a) => (!p.statut || a.statut === p.statut) && (!p.qui || a.qui === p.qui)).slice().sort((a, b) => b.cree.localeCompare(a.cree) || b.ref.localeCompare(a.ref));
    const dir = peut('autorisation.decider');
    const filtres = html`<select class="inp inp-sm" data-change="auth-filtre" data-f="statut" aria-label="Statut">${ui.options(['En attente', 'Accordée', 'Refusée'], p.statut, 'Tous les statuts')}</select><select class="inp inp-sm" data-change="auth-filtre" data-f="qui" aria-label="Pour">${ui.options([['personnel', 'Personnel'], ['eleve', 'Élèves']], p.qui, 'Personnel et élèves')}</select>`;
    const ton = (s) => (s === 'Accordée' ? 'ok' : s === 'Refusée' ? 'mauvais' : 'avert');
    return html`${ui.pageTete('Autorisations d’absence', 'Demandes du personnel et des élèves. Une demande accordée pour un élève justifie automatiquement ses absences des jours de classe concernés.', peut('autorisation.demander') ? html`<button type="button" class="btn btn-pri" data-action="autorisation-nouvelle">${ic('plus')}Nouvelle demande</button>` : '')}
      ${ui.tableau({
        id: 'autorisations', lignes: L, filtres, recherche: (a) => a.ref + ' ' + a.nom + ' ' + a.motif + ' ' + a.precision, placeholder: 'Nom, référence, motif…', unite: 'demande', exporter: 'autorisations',
        colonnes: [
          { cle: 'ref', lib: 'Référence', tri: (a) => a.ref, rendu: (a) => html`<span class="mono">${a.ref}</span>` },
          { cle: 'nom', lib: 'Pour', tri: (a) => a.nom, rendu: (a) => html`<b>${a.nom}</b><br><span class="mut petit">${a.qui === 'eleve' ? 'Élève' : 'Personnel'}</span>`, csv: (a) => a.nom },
          { cle: 'per', lib: 'Période', tri: (a) => a.du, rendu: (a) => html`${u.fmtDate(a.du)}${a.au !== a.du ? html` → ${u.fmtDate(a.au)}` : ''}<br><span class="mut petit">${u.pluriel(AK.absences.joursDemande(a), 'jour')} de classe</span>`, csv: (a) => `${a.du} → ${a.au}` },
          { cle: 'motif', lib: 'Motif', tri: (a) => a.motif, rendu: (a) => html`${a.motif}${a.precision ? html`<br><span class="mut petit">${a.precision}</span>` : ''}`, csv: (a) => a.motif + (a.precision ? ' – ' + a.precision : '') },
          { cle: 'statut', lib: 'Statut', tri: (a) => a.statut, rendu: (a) => ui.tag(a.statut, ton(a.statut)), csv: (a) => a.statut },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (a) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap">${dir && a.statut === 'En attente' ? html`<button type="button" class="btn btn-sm btn-pri" data-action="auth-decider" data-id="${a.id}" data-accord="1">${ic('check')}Accorder</button><button type="button" class="btn btn-sm" data-action="auth-decider" data-id="${a.id}" data-accord="">${ic('x')}Refuser</button>` : ''}<button type="button" class="btn-ic" data-action="auth-imprimer" data-id="${a.id}" aria-label="Imprimer la demande ${a.ref}" data-bulle="Imprimer">${ic('print')}</button>${peut('autorisation.supprimer') ? html`<button type="button" class="btn-ic" data-action="auth-supprimer" data-id="${a.id}" aria-label="Supprimer la demande ${a.ref}" data-bulle="Supprimer">${ic('trash')}</button>` : ''}</div>` }
        ],
        vide: ui.vide('Aucune demande', p.statut || p.qui ? 'Aucune demande ne correspond à ces filtres.' : 'Les demandes d’autorisation d’absence apparaîtront ici.')
      })}`;
  }

  function demande(qui, id) {
    AK.perm.exiger('autorisation.demander');
    const moi = AK.session.agent();
    const eleves = X().actifs().filter((s) => AK.session.classes().includes(s.classe)).sort(X().parClasse);
    const agents = AK.session.estDirecteur() ? S().teachers.filter((t) => t.actif !== false) : moi ? [moi] : [];
    const q = qui || (agents.length ? 'personnel' : 'eleve');
    ui.fenetre({
      titre: 'Demande d’autorisation d’absence', icone: 'cal', ok: 'Enregistrer la demande',
      corps: html`<div class="pile">
        ${F.radios({ lib: 'Pour', nom: 'qui', val: q, options: [...(agents.length ? [['personnel', 'Un membre du personnel']] : []), ['eleve', 'Un élève']] })}
        <div class="form-grille">
          <div data-pour="personnel"${q === 'personnel' ? '' : raw(' hidden')}>${F.choix({ lib: 'Membre du personnel', nom: 'pid_personnel', val: q === 'personnel' ? id || (moi && moi.id) : '', options: agents.map((t) => [t.id, t.nom]), vide: 'Choisir…' })}</div>
          <div data-pour="eleve"${q === 'eleve' ? '' : raw(' hidden')}>${F.choix({ lib: 'Élève', nom: 'pid_eleve', val: q === 'eleve' ? id : '', options: eleves.map((s) => [s.id, `${X().nomComplet(s)} (${s.classe})`]), vide: 'Choisir…' })}</div>
          <span></span>
          ${F.date({ lib: 'Du', nom: 'du', val: u.aujourdhui(), req: true })}
          ${F.date({ lib: 'Au (inclus)', nom: 'au', val: u.aujourdhui(), req: true })}
          ${F.choix({ lib: 'Motif', nom: 'motif', options: C.MOTIFS, vide: 'Choisir…', req: true })}
          ${F.texte({ lib: 'Précision', nom: 'precision', attrs: { maxlength: 160, placeholder: 'Facultatif' } })}
          <p class="mut petit mb0 plein" id="auth-jours"></p>
        </div></div>`,
      apres(racine) {
        const f = $('form', racine);
        const maj = () => {
          const qv = (f.querySelector('[name=qui]:checked') || {}).value;
          f.querySelector('[data-pour=personnel]').hidden = qv !== 'personnel';
          f.querySelector('[data-pour=eleve]').hidden = qv !== 'eleve';
          const n = f.elements.du.value && f.elements.au.value && f.elements.au.value >= f.elements.du.value ? X().joursClasse(f.elements.du.value, f.elements.au.value).length : 0;
          $('#auth-jours', racine).textContent = `${u.pluriel(n, 'jour')} de classe concerné(s).`;
        };
        f.addEventListener('change', maj);
        maj();
      },
      surValider(d) {
        const a = AK.absences.demander({ qui: d.qui, pid: d.qui === 'eleve' ? d.pid_eleve : d.pid_personnel, du: d.du, au: d.au, motif: d.motif, precision: d.precision });
        ui.toast(`Demande ${a.ref} enregistrée.`, { action: { lib: 'Imprimer', f: () => imprimerDemande(a) } });
      }
    });
  }
  function imprimerDemande(a) {
    if (a.qui === 'eleve') {
      const s = AK.eleves.trouver(a.pid);
      if (!s) throw new AK.ErreurMetier('Élève introuvable.');
      return AK.docs.ouvrir('demande-absence-eleve', [{ demande: a, eleve: s }]);
    }
    const t = AK.personnel.trouver(a.pid);
    if (!t) throw new AK.ErreurMetier('Membre du personnel introuvable.');
    return AK.docs.ouvrir('demande-absence-personnel', [{ demande: a, agent: t }]);
  }

  AK.ecrans.def('absences/appel', { rendu: rendreAppel, droit: 'appel.faire' });
  AK.ecrans.def('absences/autorisations', { rendu: rendreAutorisations, droit: 'autorisation.demander', compteOnglet: () => (AK.session.estDirecteur() ? S().auth.filter((a) => a.statut === 'En attente').length || null : null) });
  AK.ecransAbsences = { demande };

  const demandeDe = (el) => {
    const a = S().auth.find((x) => x.id === el.dataset.id);
    if (!a) throw new AK.ErreurMetier('Demande introuvable.');
    return a;
  };
  AK.actions.def({
    'appel-classe': (el) => AK.shell.aller('absences/appel', { ...AK.shell.params(), classe: el.dataset.v }),
    'appel-basculer'(el) {
      const v = AK.absences.basculer(el.dataset.date, el.dataset.classe, el.dataset.id);
      el.className = 'presence ' + v;
      u.poser(el, html`${v ? ic(v === 'J' ? 'info' : 'x', 'i-sm') : ic('check', 'i-sm')}${LIB[v]}`);
      AK.shell.redessiner();
    },
    'appel-tous'(el) {
      AK.absences.tousPresents(el.dataset.date, el.dataset.classe);
      ui.toast(`Appel ${el.dataset.classe} enregistré.`);
    },
    'appel-valider'(el) {
      AK.absences.valider(el.dataset.date, el.dataset.classe);
      ui.toast(`Appel ${el.dataset.classe} du ${u.fmtDate(el.dataset.date)} validé.`);
    },
    'autorisation-nouvelle': (el) => demande(el.dataset.qui, el.dataset.id),
    'auth-decider'(el) {
      const a = demandeDe(el), oui = !!el.dataset.accord;
      const n = AK.absences.decider(a.id, oui);
      ui.toast(`${a.ref} ${oui ? 'accordée' : 'refusée'}${oui && a.qui === 'eleve' ? ` : ${u.pluriel(n, 'absence justifiée')}` : ''}.`);
    },
    'auth-imprimer': (el) => imprimerDemande(demandeDe(el)),
    async 'auth-supprimer'(el) {
      const a = demandeDe(el);
      if (!(await ui.confirmer({ titre: 'Supprimer une demande', danger: true, ok: 'Supprimer', message: `Supprimer la demande ${a.ref} (${a.nom}) ? Les absences déjà justifiées restent enregistrées.` }))) return;
      AK.absences.supprimer(a.id);
      ui.toast('Demande supprimée.');
    }
  });
  AK.actions.defChange({
    'appel-date': (el) => AK.shell.aller('absences/appel', { ...AK.shell.params(), date: el.value }),
    'auth-filtre'(el) {
      const p = { ...AK.shell.params(), [el.dataset.f]: el.value };
      Object.keys(p).forEach((k) => !p[k] && delete p[k]);
      AK.shell.aller('absences/autorisations', p);
    }
  });
})(window.AK);
