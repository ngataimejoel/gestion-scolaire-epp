/* =====================================================================================
   Tableau de bord : situation du jour, effectifs, suivi pédagogique, tâches, agenda.
   Chaque chiffre et chaque ligne « À faire » mène à l'écran concerné, déjà filtré.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;

  function aFaire() {
    const x = X(), auj = u.aujourdhui(), ev = S().school.evalCourante || 1, L = [];
    const nv = x.niveaux();
    const ap = S().appel[auj] || {};
    const pasFait = nv.filter((c) => !ap[c] && AK.session.classes().includes(c));
    if (x.estJourClasse(auj) && pasFait.length) L.push(['avert', 'Appel du jour', `Pas encore fait en ${pasFait.join(', ')}`, `absences/appel?classe=${pasFait[0]}`]);
    if (AK.session.estDirecteur()) {
      const att = Object.keys(S().attente || {}).length;
      if (att) L.push(['avert', 'Notes à valider', `${u.pluriel(att, 'note')} saisie(s) par les enseignants`, 'notes/validation']);
      const dem = S().auth.filter((a) => a.statut === 'En attente').length;
      if (dem) L.push(['avert', 'Demandes d’autorisation', `${u.pluriel(dem, 'demande')} en attente de décision`, 'absences/autorisations?statut=En%20attente']);
    }
    const manq = nv.filter((c) => AK.session.classes().includes(c)).map((c) => [c, x.notesManquantes(c, ev)]).filter(([, m]) => m).sort((a, b) => b[1] - a[1]);
    if (manq.length) L.push(['avert', 'Notes manquantes', `${u.pluriel(manq.reduce((a, [, m]) => a + m, 0), 'note')} (${C.evCourt(ev)}), surtout en ${manq[0][0]}`, `notes/saisie?classe=${manq[0][0]}&ev=${ev}`]);
    if (AK.session.estDirecteur()) {
      const sansEns = nv.filter((c) => !x.enseignantDe(c));
      if (sansEns.length) L.push(['mauvais', 'Classes sans enseignant', `${sansEns.join(', ')} : affectez un enseignant`, 'eleves/classes']);
      const sansExtrait = x.actifs().filter((s) => !s.extrait).length;
      if (sansExtrait) L.push(['avert', 'Extraits de naissance', `${u.pluriel(sansExtrait, 'élève')} sans extrait`, 'eleves/liste?dossier=sans']);
      const ages = x.actifs().filter(x.ageAnormal).length;
      if (ages) L.push(['avert', 'Âges à vérifier', `${u.pluriel(ages, 'élève')} avec 3 ans ou plus d’écart à l’âge normal`, 'eleves/liste?dossier=age']);
      const bk = S().lastBackup ? u.ecartJours(S().lastBackup, auj) : null;
      if (bk == null || bk > 7) L.push(['mauvais', 'Sauvegarde sur clé USB', bk == null ? 'Aucune sauvegarde exportée pour l’instant' : `Dernière sauvegarde il y a ${bk} jours`, 'donnees/sauvegarde']);
      if (!AK.cles.active() && AK.crypto.dispo()) L.push(['avert', 'Signature des documents', 'Créez la clé de signature pour des QR codes vérifiables', 'parametres/securite']);
    }
    return L;
  }

  function rendu() {
    const x = X(), sc = S().school, auj = u.aujourdhui(), ev = sc.evalCourante || 1, evC = C.evCourt(ev);
    const classes = AK.session.classes();
    const act = x.actifs().filter((s) => classes.includes(s.classe));
    const g = act.filter((s) => s.sexe === 'Masculin').length, f = act.length - g;
    const ap = S().appel[auj] || {}, att = S().att[auj] || {};
    const faits = classes.filter((c) => ap[c]);
    const attendus = act.filter((s) => ap[s.classe]);
    const absents = attendus.filter((s) => att[s.id]).length;
    const presence = attendus.length ? Math.round(((attendus.length - absents) / attendus.length) * 100) : null;
    const rs = classes.map((c) => x.reussite(c, ev));
    const okN = rs.reduce((a, r) => a + r.ok, 0), evN = rs.reduce((a, r) => a + r.n, 0);
    const manq = classes.reduce((k, c) => k + x.notesManquantes(c, ev), 0);
    const tot = classes.reduce((k, c) => k + x.actifsDe(c).filter((s) => !x.estAbsent(s.id, ev)).length * x.matieres(c, ev).length, 0);
    const pctNotes = tot ? Math.round(((tot - manq) / tot) * 100) : null;
    const h = new Date().getHours(), salut = h < 13 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
    const agent = AK.session.agent();
    const dir = AK.session.estDirecteur();
    const qui = agent ? agent.nom : sc.director || 'Directeur';
    const dateLongue = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const actions = [
      AK.perm.peut('eleve.inscrire') ? html`<button type="button" class="btn clair" data-action="eleve-nouveau">${ic('userPlus')}Inscrire un élève</button>` : '',
      html`<a class="btn" href="#absences/appel">${ic('clip')}Faire l’appel</a>`,
      html`<a class="btn" href="#notes/saisie">${ic('edit')}Saisir les notes</a>`,
      AK.perm.peut('document.emettre') ? html`<a class="btn" href="#documents/emettre">${ic('filePlus')}Émettre un document</a>` : ''
    ];

    const mx = Math.max(1, ...classes.map((c) => x.actifsDe(c).length));
    const effectifs = classes.map((c) => {
      const a = x.actifsDe(c), gg = a.filter((s) => s.sexe === 'Masculin').length, ff = a.length - gg;
      return html`<a class="barre-l" href="#eleves/liste?classe=${c}" data-bulle="${c} : ${gg} garçon(s), ${ff} fille(s)"><span class="nom">${c}</span><span class="piste" style="width:${(a.length / mx) * 100}%">${gg ? html`<i class="g-col" style="flex:${gg}"></i>` : ''}${ff ? html`<i class="f-col" style="flex:${ff}"></i>` : ''}</span><span class="val"><b>${a.length}</b> élève${a.length > 1 ? 's' : ''}</span></a>`;
    });
    const resultats = classes.map((c, i) => {
      const m = x.moyClasse(c, ev), r = rs[i], t = r.n ? Math.round((r.ok / r.n) * 100) : null, e = x.echelle(c);
      return html`<a class="barre-l" href="#notes/resultats?classe=${c}&ev=${ev}" data-bulle="${c} : moyenne ${u.fmtNote(m)} / ${e} ; ${t ?? '—'} % au seuil (${x.info(c).seuil}/${e})"><span class="nom">${c}</span><span class="piste fond">${m != null ? html`<i class="pri" style="width:${(m / e) * 100}%"></i>` : ''}<span class="ref" style="left:${(x.info(c).seuil / e) * 100}%"></span></span><span class="val"><b>${u.fmtNote(m)}</b>/${e} · ${t ?? '—'} %</span></a>`;
    });
    const jours = x.derniersJoursClasse(10, auj);
    const parJour = jours.map((d) => {
      const m = S().att[d] || {}, v = Object.entries(m).filter(([id]) => act.some((s) => s.id === id));
      return { d, a: v.filter(([, z]) => z === 'A').length, j: v.filter(([, z]) => z === 'J').length };
    });
    const amx = Math.max(4, ...parJour.map((z) => z.a + z.j));
    const premiers = classes.map((c) => {
      const t = x.classement(c, ev).w[0];
      return t ? html`<button type="button" data-action="fiche-eleve" data-id="${t.s.id}">${ui.avatar(t.s)}<span class="tronque"><b>${x.nomComplet(t.s)}</b><br><span class="mut petit">${c}</span></span><span class="m"><b style="color:var(--ink)">${u.fmtNote(t.avg)}</b> / ${x.echelle(c)}</span></button>` : '';
    }).filter((z) => String(z));
    const dt = (s) => {
      const d = u.parseISO(s);
      return html`<span class="dt"><b>${d.getDate()}</b>${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>`;
    };
    const prochaineEval = [1, 2, 3, 4].map((n) => ({ n, d: x.evalDate('CP1', n) })).find((z) => z.d >= auj);
    const agenda = [
      ...S().auth.filter((a) => a.statut === 'En attente' && AK.absences.visible(a)).slice(0, 3).map((a) => html`<a href="#absences/autorisations?statut=En%20attente">${dt(a.du)}<span class="tronque"><b>${a.nom}</b><br><span class="mut petit">${a.motif} · ${a.ref}</span></span><span class="m">${ui.tag('À décider', 'avert')}</span></a>`),
      ...(prochaineEval ? [html`<a href="#notes/saisie?ev=${prochaineEval.n}">${dt(prochaineEval.d)}<span><b>${C.EV_GEN[prochaineEval.n - 1]}</b><br><span class="mut petit">Date prévue au calendrier</span></span><span class="m">${ui.tag('Évaluation', 'acc')}</span></a>`] : []),
      ...S().pro.events.filter((e) => e.date >= auj).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2).map((e) => html`<a href="#vie/calendrier">${dt(e.date)}<span><b>${e.titre}</b></span><span class="m">${ui.tag('Événement', 'pri')}</span></a>`),
      ...S().conges.filter((c) => (c.au || c.du) >= auj).sort((a, b) => a.du.localeCompare(b.du)).slice(0, 2).map((c) => html`<a href="#parametres/calendrier">${dt(c.du)}<span><b>${c.lib}</b><br><span class="mut petit">${c.au ? `du ${u.fmtDate(c.du)} au ${u.fmtDate(c.au)}` : u.fmtDate(c.du)}</span></span><span class="m">${ui.tag(c.au ? 'Congés' : 'Férié')}</span></a>`)
    ];
    const messages = (S().messages || []).filter((m) => !agent || !m.dest || m.dest === agent.id).slice(0, 4);
    const taches = aFaire();
    const P = S().pro;

    return html`<section class="accueil-tete"><div style="position:relative;z-index:1"><span class="surtitre">${sc.name || 'AKWA SCHOOL'} · ${agent ? 'Espace enseignant' : 'Direction'}</span><h1>${salut}, ${qui}</h1><p>${dateLongue.charAt(0).toUpperCase() + dateLongue.slice(1)}${sc.iepp ? ' · ' + sc.iepp : ''}${sc.drenaet ? ' · ' + sc.drenaet : ''}</p>
        <div class="puces">${sc.year ? html`<span>Année scolaire ${sc.year}</span>` : html`<span class="acc">Année scolaire à renseigner</span>`}<span>${evC}</span>${agent ? html`<span>${x.clsTxt(agent) || 'Sans classe'}</span>` : ''}${S().meta.demo ? html`<span class="acc">Démonstration</span>` : ''}</div></div>
      <div class="actions-rapides">${actions}</div></section>

    <div class="titre-section"><h2>${agent ? 'Ma classe' : 'Effectifs et suivi'} · ${evC}</h2>${dir ? html`<a class="btn btn-sm btn-ghost" href="#rapports/stats">${ic('chart')}Statistiques détaillées</a>` : ''}</div>
    <div class="grille g5 mb">
      ${ui.kpi({ lien: 'eleves/liste', icone: 'users', lib: 'Élèves inscrits', val: act.length, sous: `${g} garçons · ${f} filles`, extra: html`<div class="repartition" aria-hidden="true"><i class="g-col" style="flex:${g || 0}"></i><i class="f-col" style="flex:${f || 0}"></i></div>` })}
      ${ui.kpi({ lien: 'absences/appel', icone: 'clip', lib: 'Assiduité aujourd’hui', val: presence == null ? '—' : html`${presence}<small>%</small>`, sous: `${absents} absent(s) · appel fait dans ${faits.length}/${classes.length} classe(s)` })}
      ${ui.kpi({ lien: dir && Object.keys(S().attente || {}).length ? 'notes/validation' : 'notes/saisie', icone: 'edit', lib: 'Notes saisies', val: pctNotes == null ? '—' : html`${pctNotes}<small>%</small>`, sous: `${u.pluriel(manq, 'note')} encore à saisir${dir && Object.keys(S().attente || {}).length ? ` · ${Object.keys(S().attente).length} à valider` : ''}`, ton: manq ? 'avert' : '' })}
      ${ui.kpi({ lien: 'notes/resultats', icone: 'award', lib: 'Réussite', val: evN ? html`${Math.round((okN / evN) * 100)}<small>%</small>` : '—', sous: `${okN} élève(s) sur ${evN} au seuil` })}
      ${dir ? ui.kpi({ lien: 'eleves/liste?dossier=sans', icone: 'file', lib: 'Dossiers à compléter', val: act.filter((s) => !s.extrait).length, sous: `élève(s) sans extrait · ${act.filter(x.ageAnormal).length} âge(s) à vérifier`, ton: act.some((s) => !s.extrait) ? 'acc' : '' }) : ui.kpi({ lien: 'absences/autorisations', icone: 'cal', lib: 'Demandes d’absence', val: S().auth.filter((a) => a.statut === 'En attente' && AK.absences.visible(a)).length, sous: 'en attente de décision' })}
    </div>

    <div class="grille g-2-1 mb">
      ${ui.carte('Effectifs par classe', html`<div class="barres">${effectifs.length ? effectifs : ui.vide('Aucune classe', 'Aucun niveau n’est ouvert.')}</div>`, { sous: `${act.length} élèves inscrits`, actions: html`<div class="legende"><span><i class="g-col"></i>Garçons</span><span><i class="f-col"></i>Filles</span></div>` })}
      ${ui.carte('À faire', taches.length ? html`<div class="liste a-faire">${taches.map(([niv, t, s, lien]) => html`<a href="#${lien}"><span class="niv ${niv}"></span><span class="flex1"><b>${t}</b><small>${s}</small></span>${ic('chev')}</a>`)}</div>` : html`<div class="vide">${ic('checkCircle', 'i-lg')}<b>Tout est à jour</b></div>`, { actions: html`<span class="puce">${taches.length}</span>` })}
    </div>

    <div class="grille g3 mb">
      ${ui.carte('Résultats par classe', html`<div class="barres">${resultats}</div>`, { sous: `${evC} · moyenne et seuil (trait)` })}
      ${ui.carte('Absences', html`<div class="colonnes">${parJour.map((z) => html`<a href="#absences/appel?date=${z.d}" data-bulle="${u.fmtJour(z.d)} : ${z.a} non justifiée(s), ${z.j} justifiée(s)" style="display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none"><b>${z.a + z.j || ''}</b>${z.j ? html`<i class="g-col" style="height:${(z.j / amx) * 118}px"></i>` : ''}${z.a ? html`<i class="f-col" style="height:${(z.a / amx) * 118}px"></i>` : ''}</a>`)}</div><div class="etiq-col">${parJour.map((z) => html`<span>${'DLMMJVS'[u.parseISO(z.d).getDay()]}<br>${u.parseISO(z.d).getDate()}</span>`)}</div>`, { sous: '10 derniers jours de classe', actions: html`<div class="legende"><span><i class="f-col"></i>Non justifiées</span><span><i class="g-col"></i>Justifiées</span></div>` })}
      ${ui.carte('Premiers de classe', premiers.length ? html`<div class="liste">${premiers}</div>` : ui.vide('Aucune note saisie', 'Les premiers apparaîtront dès la saisie des notes.'), { sous: evC, actions: html`<a class="btn btn-sm btn-ghost" href="#notes/resultats">Classements</a>` })}
    </div>

    <div class="grille g3 mb">
      ${ui.carte('Agenda', agenda.length ? html`<div class="liste">${agenda}</div>` : ui.vide('Rien de prévu'), { actions: html`<a class="btn btn-sm btn-ghost" href="#vie/calendrier">Calendrier</a>` })}
      ${ui.carte('Messages', messages.length ? html`<div class="liste">${messages.map((m) => html`<div><span class="av">${ic('mail')}</span><span class="tronque"><b>${m.titre}</b><br><span class="mut petit">${new Date(m.t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · ${m.dest ? (S().teachers.find((t) => t.id === m.dest) || {}).nom || '' : 'tous les enseignants'}</span></span></div>`)}</div>` : ui.vide('Aucun message'), { actions: dir ? html`<a class="btn btn-sm btn-ghost" href="#personnel/messages">Écrire</a>` : agent && AK.personnel.nonLus(agent.id).length ? html`<button type="button" class="btn btn-sm btn-pri" data-action="lire-messages">Lire (${AK.personnel.nonLus(agent.id).length})</button>` : '' })}
      ${dir ? ui.carte('Activité récente', S().pro.journal.length ? html`<div class="liste">${S().pro.journal.slice(0, 6).map((l) => html`<div><span class="tag pri">${new Date(l.t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span><span class="tronque" title="${l.m}">${l.m}</span></div>`)}</div>` : ui.vide('Aucune activité'), { actions: html`<a class="btn btn-sm btn-ghost" href="#donnees/journal">Journal</a>` }) : ui.carte('Ma classe', html`<dl class="kv"><dt>Classe(s)</dt><dd>${agent ? x.clsTxt(agent) || '—' : '—'}</dd><dt>Élèves</dt><dd>${act.length}</dd><dt>Notes en attente</dt><dd>${Object.keys(S().attente).filter((k) => act.some((s) => k.startsWith(s.id + '|'))).length}</dd><dt>Saisie (${evC})</dt><dd>${classes.map((c) => `${c} : ${AK.notes.saisieOuverte(c, ev) ? 'ouverte' : 'fermée'}`).join(' · ')}</dd></dl>`)}
    </div>

    ${dir ? html`<div class="titre-section"><h2>Gestion de l’école</h2></div>
    <div class="grille g4">
      ${ui.kpi({ lien: 'finances/paiements', icone: 'coin', lib: 'Cotisations encaissées', val: (() => { const du = x.actifs().reduce((a, s) => a + AK.pro.duDe(s), 0); return du ? u.pct(AK.pro.encaisse(), du) : u.fcfa(AK.pro.encaisse()); })(), sous: `${u.fcfa(AK.pro.encaisse())} encaissés`, ton: 'acc' })}
      ${ui.kpi({ lien: 'vie/discipline', icone: 'shield', lib: 'Faits en cours', val: P.incidents.filter((z) => z.statut === 'En cours').length, sous: 'registre de discipline' })}
      ${ui.kpi({ lien: 'services/biblio', icone: 'book', lib: 'Prêts en retard', val: P.prets.filter((p) => !p.rendu && p.due < auj).length, sous: 'bibliothèque' })}
      ${ui.kpi({ lien: 'documents/registre', icone: 'fileCheck', lib: 'Documents émis', val: S().docs.items.filter((d) => d.statut === 'valide').length, sous: `${S().docs.items.filter((d) => d.statut === 'annule').length} annulé(s) · registre` })}
    </div>` : ''}`;
  }

  AK.ecrans.def('accueil', { rendu, sansOnglets: true });
  AK.accueil = { aFaire };
})(window.AK);
