/* =====================================================================================
   Notes & bulletins : saisie (grille clavier, recalcul immédiat sans perte de saisie),
   corrections protégées, validation des saisies des enseignants, résultats et bulletins,
   décisions de fin d'année et passage à l'année suivante (bilan + copie de sécurité).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);

  const classeDe = (p) => {
    const L = AK.session.classes();
    return L.includes(p.classe) ? p.classe : L[0] || null;
  };
  const evDe = (p, avecA) => (avecA && p.ev === 'A' ? 'A' : [1, 2, 3, 4].includes(Number(p.ev)) ? Number(p.ev) : S().school.evalCourante || 1);
  const pilulesClasses = (c, route, extra = {}) => ui.pilules(AK.session.classes().map((k) => [k, k]), c, 'notes-classe', { 'data-route': route, ...extra });
  const choixEval = (c, ev, avecA, route) => html`<select class="inp inp-sm" data-change="notes-ev" data-route="${route}" aria-label="Évaluation">${ui.options([...[1, 2, 3, 4].map((n) => [n, X().evalLabel(c, n)]), ...(avecA ? [['A', 'Annuel (MGA)']] : [])], ev)}</select>`;
  const valeur = (v) => (v == null ? '' : u.fmtSaisie(v));

  /* ---------- Saisie ---------- */
  function rendreSaisie(p) {
    const c = classeDe(p);
    if (!c) return html`${ui.pageTete('Saisie des notes')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const x = X(), n = evDe(p), M = x.matieres(c, n), g = x.grille(c), L = x.actifsDe(c).sort(x.parNom);
    const ouverte = AK.notes.saisieOuverte(c, n), sa = S().saisie[c + '|' + n] || {};
    const ens = AK.session.estEnseignant(), dir = AK.session.estDirecteur();
    const lecture = ens && !ouverte;
    const ligne = (s) => {
      const abA = AK.notes.absenceEnAttente(s.id, n), ab = x.estAbsent(s.id, n) || abA;
      return html`<tr data-eleve="${s.id}"><td><div class="qui">${ui.avatar(s)}<span class="tronque">${ui.nomEleve(s)}</span></div></td>
        <td class="centre${abA ? ' attente' : ''}"><input type="checkbox" id="abs-${s.id}" data-change="note-absent" data-id="${s.id}" aria-label="Absent(e) à l’évaluation : ${x.nomComplet(s)}${abA ? ' (en attente de validation)' : ''}"${ab ? raw(' checked') : ''}${lecture ? raw(' disabled') : ''}${abA ? raw(' data-bulle="Absence en attente de validation par le directeur"') : ''}></td>
        ${M.map(([m, w], j) => {
          const k = x.cle(s.id, n, m), v = S().grades[k], att = S().attente[k];
          const aff = v != null ? v : att;
          return html`<td class="centre"><input class="note-in${att != null && v == null ? ' attente' : ''}" data-change="note" data-id="${s.id}" data-m="${m}" data-j="${j}" data-max="${x.noteMax(c, w)}" data-avant="${valeur(aff)}" value="${valeur(aff)}" inputmode="decimal" autocomplete="off" placeholder="/${x.noteMax(c, w)}" aria-label="${m} sur ${x.noteMax(c, w)}, ${x.nomComplet(s)}"${att != null && v == null ? raw(' data-bulle="En attente de validation par le directeur"') : ''}${ab || lecture ? raw(' disabled') : ''}></td>`;
        })}
        <td class="num droite" data-total="${s.id}"></td><td class="num droite"><b data-moy="${s.id}"></b></td><td class="num droite" data-rang="${s.id}"></td></tr>`;
    };
    const actions = html`${x.info(c).grille === 'CP' && peut('notes.matieres', { classe: c }) ? html`<button type="button" class="btn" data-action="notes-matieres-cp" data-classe="${c}" data-ev="${n}">${ic('list')}Matières de la composition</button>` : ''}
      <a class="btn" href="#notes/resultats?classe=${c}&ev=${n}">${ic('award')}Classement</a>
      ${dir ? html`<button type="button" class="btn" data-action="notes-periode" data-classe="${c}" data-ev="${n}" aria-haspopup="menu">${ic(ouverte ? 'unlock' : 'lock')}${ouverte ? 'Saisie ouverte' : 'Saisie fermée'}</button>` : ''}`;
    return html`${ui.pageTete('Saisie des notes', html`Barème officiel de la grille ${g.lib}. <kbd>Tab</kbd> : matière suivante · <kbd>Entrée</kbd> : élève suivant. Chaque note est enregistrée dès qu’on quitte la case.`, actions)}
      <div class="barre-outils">${pilulesClasses(c, 'notes/saisie')}${choixEval(c, n, false, 'notes/saisie')}<span class="puce" id="notes-compte"></span>${sa.fin ? html`<span class="puce">${ic('clock')}Date limite : ${u.fmtDate(sa.fin)}</span>` : ''}</div>
      ${lecture ? ui.encadre('La saisie est fermée pour cette évaluation (date limite dépassée ou fermée par le directeur). Les notes sont affichées en lecture seule.', 'avert', 'lock') : ''}
      ${ens && S().school.validation && ouverte ? ui.encadre('Vos nouvelles notes sont transmises au directeur pour validation (case orangée tant qu’elles ne sont pas validées).', 'info') : ''}
      ${L.length ? html`<div class="tab-cadre" style="max-height:calc(100vh - 290px)"><table class="tab tab-notes" id="grille-notes" data-classe="${c}" data-ev="${n}" aria-label="Notes ${c}, ${x.evalLabel(c, n)}">
        <thead><tr><th>Élève</th><th class="centre">Absent</th>${M.map(([m, w]) => html`<th class="centre">${m}<br><span class="mut petit">/${x.noteMax(c, w)}</span></th>`)}<th class="droite">Total</th><th class="droite">Moy. /${g.echelle}</th><th class="droite">Rang</th></tr></thead>
        <tbody>${L.map(ligne)}</tbody>
        <tfoot><tr><th>Moyenne de la classe</th><th></th>${M.map(([m]) => html`<th class="centre num" data-moy-mat="${m}"></th>`)}<th></th><th class="droite num" id="notes-moy-classe"></th><th></th></tr></tfoot></table></div>`
        : ui.vide('Aucun élève inscrit', `Aucun élève inscrit en ${c}.`, peut('eleve.inscrire', { classe: c }) ? html`<button type="button" class="btn btn-pri" data-action="eleve-nouveau" data-classe="${c}">${ic('userPlus')}Inscrire un élève</button>` : '')}`;
  }
  /** Recalcule totaux, moyennes, rangs et compteur sans redessiner (la saisie garde le focus). */
  function recalculer() {
    const t = $('#grille-notes');
    if (!t) return;
    const c = t.dataset.classe, n = Number(t.dataset.ev), x = X();
    const L = x.actifsDe(c), { w } = x.classement(c, n);
    L.forEach((s) => {
      const r = x.resultat(s, n), z = w.find((o) => o.s.id === s.id);
      const set = (sel, v) => {
        const el = t.querySelector(sel);
        if (el) el.textContent = v;
      };
      set(`[data-total="${s.id}"]`, r && !r.abs ? u.fmtNote(r.total) : '—');
      set(`[data-moy="${s.id}"]`, r ? (r.abs ? 'Absent' : u.fmtNote(r.moy)) : '—');
      set(`[data-rang="${s.id}"]`, z ? x.rangTxt(z.rank) : '—');
    });
    x.matieres(c, n).forEach(([m]) => {
      const el = t.querySelector(`[data-moy-mat="${CSS.escape(m)}"]`);
      if (el) el.textContent = u.fmtNote(u.moyenne(L.filter((s) => !x.estAbsent(s.id, n)).map((s) => x.note(s.id, n, m)).filter((v) => v != null)));
    });
    const mc = $('#notes-moy-classe');
    if (mc) mc.textContent = u.fmtNote(x.moyClasse(c, n));
    const tot = L.filter((s) => !x.estAbsent(s.id, n)).length * x.matieres(c, n).length;
    const cpt = $('#notes-compte');
    const att = AK.notes.enAttenteDe(c, n).filter((k) => !k.endsWith('|' + AK.notes.ABS)).length;
    if (cpt) cpt.textContent = `${tot - x.notesManquantes(c, n) + att} / ${tot} notes saisies${att ? `, dont ${att} en attente de validation` : ''}`;
  }

  async function enregistrerNote(el) {
    const t = $('#grille-notes');
    const n = Number(t.dataset.ev);
    const tenter = (opt) => AK.notes.saisir(el.dataset.id, n, el.dataset.m, el.value, opt);
    let r;
    try {
      r = tenter();
    } catch (err) {
      if (err.correction) {
        const ok = AK.session.estDirecteur() ? await AK.auth.confirmer(err.message) : false;
        if (!ok) {
          if (!AK.session.estDirecteur()) ui.toast('Une note déjà validée ne peut être corrigée que par le directeur.', { type: 'avert' });
          el.value = el.dataset.avant;
          return;
        }
        r = tenter({ correctionConfirmee: true });
      } else if (err instanceof AK.ErreurDroits) {
        // refus de droits : la case reprend la valeur enregistrée
        el.value = el.dataset.avant;
        ui.toast(err.message, { type: 'avert' });
        return;
      } else {
        el.classList.add('mauvaise');
        el.setAttribute('aria-invalid', 'true');
        ui.toast(err.message, { type: 'erreur' });
        el.focus();
        el.select();
        return;
      }
    }
    el.classList.remove('mauvaise');
    el.removeAttribute('aria-invalid');
    el.value = valeur(r.v);
    el.dataset.avant = el.value;
    el.classList.toggle('attente', r.etat === 'attente' && r.v != null);
    if (r.etat !== 'inchange') {
      el.classList.remove('ok');
      void el.offsetWidth;
      el.classList.add('ok');
    }
    recalculer();
  }

  /* ---------- Résultats & bulletins ---------- */
  function rendreResultats(p) {
    const c = classeDe(p);
    if (!c) return html`${ui.pageTete('Résultats')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const x = X(), per = evDe(p, true), { w, all } = x.classement(c, per), e = x.echelle(c), mc = x.moyClasse(c, per), rs = x.reussite(c, per);
    const annuel = per === 'A';
    const manque = annuel ? x.actifsDe(c).filter((s) => x.mga(s) == null).length : x.notesManquantes(c, per);
    const kpis = html`<div class="grille g4 mb">
      ${ui.kpi({ icone: 'chart', lib: 'Moyenne de la classe', val: mc == null ? '—' : html`${u.fmtNote(mc)}<small> / ${e}</small>`, sous: `${u.pluriel(w.length, 'élève')} classé(s)` })}
      ${ui.kpi({ icone: 'checkCircle', lib: 'Taux de réussite', val: u.pct(rs.ok, rs.n), sous: `seuil ${x.info(c).seuil} / ${e}` })}
      ${ui.kpi({ icone: 'award', lib: 'Premier', val: w[0] ? w[0].s.prenoms.split(' ')[0] + ' ' + w[0].s.nom : '—', sous: w[0] ? u.fmtNote(w[0].avg) + ' / ' + e : '' })}
      ${ui.kpi({ icone: 'warn', lib: annuel ? 'MGA incomplètes' : 'Notes manquantes', val: manque, sous: annuel ? (x.info(c).regle === 'MOYENNE4' ? 'les 4 évaluations sont nécessaires' : '3 compositions + passage') : 'à compléter', lien: !annuel && manque ? `notes/saisie?classe=${c}&ev=${per}` : null, ton: manque ? 'avert' : '' })}</div>`;
    const colonnes = [
      { cle: 'rang', lib: 'Rang', tri: (z) => z.rank ?? 999, rendu: (z) => html`<b>${x.rangTxt(z.rank)}</b>` },
      { cle: 'nom', lib: 'Élève', tri: (z) => x.nomComplet(z.s), rendu: (z) => ui.quiEleve(z.s), csv: (z) => x.nomComplet(z.s) },
      ...(annuel
        ? [1, 2, 3, 4].map((n) => ({ cle: 'e' + n, lib: C.evCourt(n), cls: 'droite num', tri: (z) => x.moyEval(z.s, n), rendu: (z) => (x.estAbsent(z.s.id, n) ? 'Abs.' : u.fmtNote(x.moyEval(z.s, n))) }))
        : [{ cle: 'tot', lib: 'Total', cls: 'droite num', tri: (z) => { const r = x.resultat(z.s, per); return r && !r.abs ? r.total : null; }, rendu: (z) => { const r = x.resultat(z.s, per); return r && !r.abs ? u.fmtNote(r.total) : '—'; } }]),
      { cle: 'moy', lib: annuel ? `MGA / ${e}` : `Moyenne / ${e}`, cls: 'droite num', tri: (z) => z.avg, rendu: (z) => { const r = annuel ? null : x.resultat(z.s, per); return html`<b>${r && r.abs ? 'Absent' : u.fmtNote(z.avg)}</b>`; } },
      { cle: 'mention', lib: 'Mention', tri: (z) => z.avg, rendu: (z) => x.mention(z.avg, c), csv: (z) => x.mention(z.avg, c) },
      { cle: 'dec', lib: annuel ? 'Décision' : 'Appréciation', csv: (z) => (annuel ? x.decision(z.s) : z.avg == null ? '' : z.avg >= x.info(c).seuil ? 'Seuil atteint' : 'Sous le seuil'), rendu: (z) => (annuel ? ui.tagDecision(x.decision(z.s)) : z.avg == null ? ui.tag(x.estAbsent(z.s.id, per) ? 'Absent' : 'Notes manquantes') : z.avg >= x.info(c).seuil ? ui.tag('Seuil atteint', 'ok') : ui.tag('Sous le seuil', 'avert')) },
      { cle: 'b', lib: '', cls: 'droite', csv: false, rendu: (z) => html`<button type="button" class="btn btn-sm" data-action="bulletin" data-id="${z.s.id}" data-per="${per}">${ic('file')}Bulletin</button>` }
    ];
    return html`${ui.pageTete('Résultats & bulletins', 'Classement, mentions et bulletins de composition ou annuels (MGA).', html`<button type="button" class="btn" data-action="doc-classement" data-classe="${c}" data-per="${per}">${ic('print')}Imprimer le classement</button><button type="button" class="btn btn-pri" data-action="bulletins-classe" data-classe="${c}" data-per="${per}">${ic('file')}Tous les bulletins</button>`)}
      <div class="barre-outils">${pilulesClasses(c, 'notes/resultats')}${choixEval(c, per, true, 'notes/resultats')}</div>
      ${kpis}
      ${ui.tableau({ id: 'resultats-' + c + '-' + per, lignes: all, cleId: (z) => z.s.id, colonnes, parPage: 80, unite: 'élève', exporter: `resultats-${c}-${per}`, legende: `Classement ${c}`, vide: ui.vide('Aucun élève inscrit', '') })}`;
  }

  /* ---------- Validation (directeur) ---------- */
  function rendreValidation() {
    const x = X(), groupes = [];
    x.niveaux().forEach((c) => [1, 2, 3, 4].forEach((n) => {
      const L = AK.notes.enAttenteDe(c, n);
      if (L.length) groupes.push({ c, n, L });
    }));
    const sc = S().school;
    const etat = html`<div class="tab-cadre"><table class="tab"><thead><tr><th>Classe</th>${[1, 2, 3, 4].map((n) => html`<th class="centre">${C.evCourt(n)}</th>`)}</tr></thead><tbody>${x.niveaux().map((c) => html`<tr><td><b>${c}</b></td>${[1, 2, 3, 4].map((n) => {
      const sa = S().saisie[c + '|' + n] || {}, o = AK.notes.saisieOuverte(c, n);
      return html`<td class="centre"><button type="button" class="btn btn-sm ${o ? '' : 'btn-dng'}" data-action="notes-periode" data-classe="${c}" data-ev="${n}" aria-haspopup="menu">${ic(o ? 'unlock' : 'lock', 'i-sm')}${o ? 'Ouverte' : 'Fermée'}${sa.fin ? html`<small class="mut">&nbsp;→ ${u.fmtDate(sa.fin).slice(0, 5)}</small>` : ''}</button></td>`;
    })}</tr>`)}</tbody></table></div>`;
    return html`${ui.pageTete('Validation des saisies', 'Les notes saisies par les enseignants attendent votre validation avant de compter dans les moyennes (si l’option est active).')}
      <div class="grille g-2-1">
        <div class="pile">${groupes.length ? groupes.map((g) => ui.carte(`${g.c} · ${x.evalLabel(g.c, g.n)}`, html`<div class="tab-cadre" style="max-height:280px"><table class="tab"><thead><tr><th>Élève</th><th>Matière</th><th class="droite">Note</th></tr></thead><tbody>${g.L.slice().sort().map((k) => {
          const [id, , m] = k.split('|'), s = AK.eleves.trouver(id), mat = x.matieres(g.c, g.n).find(([z]) => z === m);
          if (m === AK.notes.ABS) return html`<tr><td>${s ? x.nomComplet(s) : '?'}</td><td colspan="2"><b>Absent(e) à l’évaluation</b> <span class="mut">(moyenne 0, notes effacées)</span></td></tr>`;
          return html`<tr><td>${s ? x.nomComplet(s) : '?'}</td><td>${m}</td><td class="droite num"><b>${u.fmtNote(S().attente[k])}</b> / ${mat ? x.noteMax(g.c, mat[1]) : '?'}</td></tr>`;
        })}</tbody></table></div>`, { sous: u.pluriel(g.L.length, 'saisie') + ' en attente', actions: html`<div class="ligne"><button type="button" class="btn btn-sm btn-dng" data-action="notes-rejeter" data-classe="${g.c}" data-ev="${g.n}">${ic('x')}Rejeter</button><button type="button" class="btn btn-sm btn-pri" data-action="notes-valider" data-classe="${g.c}" data-ev="${g.n}">${ic('check')}Valider</button></div>` })) : ui.carte('', ui.vide('Aucune note en attente', 'Toutes les saisies des enseignants sont validées.'))}</div>
        <div class="pile">
          ${ui.carte('Réglages', html`<div class="pile">${F.case({ lib: 'Les notes saisies par les enseignants doivent être validées par le directeur', nom: 'validation', coche: !!sc.validation, attrs: { 'data-change': 'notes-validation-option' } })}
            ${F.choix({ lib: 'Évaluation en cours (tableau de bord, rappels)', nom: 'evalCourante', val: sc.evalCourante || 1, options: [1, 2, 3, 4].map((n) => [n, C.EV_GEN[n - 1]]), attrs: { 'data-change': 'notes-eval-courante' } })}</div>`)}
          ${ui.carte('Ouverture de la saisie', etat, { sous: 'Cliquez pour fermer, rouvrir ou fixer une date limite' })}
        </div></div>`;
  }

  /* ---------- Fin d'année ---------- */
  function rendreFin(p) {
    const c = classeDe(p);
    if (!c) return ui.vide('Aucune classe', '');
    const x = X(), e = x.echelle(c), suiv = AK.notes.anneeSuivante();
    const L = x.actifsDe(c).map((s) => ({ s, m: x.mga(s) })).sort((a, b) => (b.m ?? -1) - (a.m ?? -1) || x.parNom(a.s, b.s));
    const cnt = (d) => x.actifs().filter((s) => x.decision(s) === d).length;
    const modif = peut('decision.modifier');
    return html`${ui.pageTete('Fin d’année', `Décisions d’après la MGA (seuil ${x.info(c).seuil}/${e} en ${c}), puis passage à l’année ${suiv || 'suivante'}.`, html`<button type="button" class="btn" data-action="doc-classe" data-modele="decisions" data-classe="${c}">${ic('print')}Imprimer les décisions</button>${peut('annee.passer') ? html`<button type="button" class="btn btn-pri" data-action="annee-passer">${ic('flag')}Passer à ${suiv || 'l’année suivante'}</button>` : ''}`)}
      <div class="grille g4 mb">${ui.kpi({ icone: 'checkCircle', lib: 'Admis', val: cnt('Admis'), sous: 'toute l’école', ton: 'ok' })}${ui.kpi({ icone: 'rotate', lib: 'Redoublants', val: cnt('Redoublant'), sous: 'toute l’école' })}${ui.kpi({ icone: 'warn', lib: 'Sans décision', val: x.actifs().filter((s) => !x.decision(s)).length, sous: 'MGA incomplète (évaluations manquantes)', ton: 'avert' })}${ui.kpi({ icone: 'flag', lib: 'Départs', val: S().students.filter((s) => s.statut !== 'Inscrit').length, sous: 'abandons, exclusions, transferts' })}</div>
      <div class="barre-outils">${pilulesClasses(c, 'notes/fin')}</div>
      <div class="tab-cadre"><table class="tab"><thead><tr><th>Élève</th>${[1, 2, 3, 4].map((n) => html`<th class="droite">${C.evCourt(n)}</th>`)}<th class="droite">MGA / ${e}</th><th>Proposition</th><th>Décision</th></tr></thead><tbody>
        ${L.length ? L.map(({ s, m }) => html`<tr><td>${ui.quiEleve(s)}</td>${[1, 2, 3, 4].map((n) => html`<td class="droite num">${x.estAbsent(s.id, n) ? 'Abs.' : x.incomplet(s, n) ? html`<span class="tag avert" data-bulle="Évaluation incomplète : des matières n’ont pas de note">${u.fmtNote(x.moyEval(s, n))} *</span>` : u.fmtNote(x.moyEval(s, n))}</td>`)}<td class="droite num"><b>${u.fmtNote(m)}</b></td><td>${ui.tagDecision(x.decisionProposee(s))}${x.incompletAnnee(s) ? html` ${ui.tag('notes incomplètes', 'avert')}` : ''}</td>
          <td>${modif ? html`<select class="inp inp-sm" id="dec-${s.id}" data-change="decision" data-id="${s.id}" aria-label="Décision pour ${x.nomComplet(s)}">${ui.options(C.DECISIONS, x.decision(s), '—')}</select>${s.decision && s.decision !== x.decisionProposee(s) ? html` ${ui.tag('modifiée', 'acc')}` : ''}` : ui.tagDecision(x.decision(s))}</td></tr>`) : html`<tr><td colspan="8">${ui.vide('Aucun élève inscrit', '')}</td></tr>`}
      </tbody></table></div>`;
  }

  AK.ecrans.def('notes/saisie', { rendu: rendreSaisie, droit: 'notes.saisir', apres: recalculer });
  AK.ecrans.def('notes/resultats', { rendu: rendreResultats, droit: 'resultats.voir' });
  AK.ecrans.def('notes/validation', { rendu: rendreValidation, droit: 'notes.valider', compteOnglet: () => Object.keys(S().attente || {}).length || null });
  AK.ecrans.def('notes/fin', { rendu: rendreFin, droit: 'resultats.voir' });

  /* ---------- Bulletins (aussi utilisés par la fiche élève et les documents) ---------- */
  AK.docsUi = AK.docsUi || {};
  AK.docsUi.bulletins = function (eleves, per) {
    const p = per || S().school.evalCourante || 1;
    const L = eleves.slice().sort(X().parClasse);
    if (p === 'A') return AK.docs.ouvrir('bulletin-annuel', L.map((s) => ({ eleve: s })), { nomFichier: 'bulletins-annuels' });
    return AK.docs.ouvrir('bulletin', L.map((s) => ({ eleve: s, periode: Number(p) })), { nomFichier: `bulletins-${C.evCourt(p)}` });
  };

  /* ---------- Actions ---------- */
  const perDe = (v) => (v === 'A' ? 'A' : Number(v));
  AK.actions.def({
    'notes-classe': (el) => AK.shell.aller(el.dataset.route, { ...AK.shell.params(), classe: el.dataset.v }),
    bulletin(el) {
      const s = AK.eleves.trouver(el.dataset.id);
      if (s) AK.docsUi.bulletins([s], perDe(el.dataset.per));
    },
    'bulletins-classe': (el) => AK.docsUi.bulletins(X().actifsDe(el.dataset.classe), perDe(el.dataset.per)),
    'doc-classement': (el) => AK.docs.ouvrir('classement', [{ classe: el.dataset.classe, periode: perDe(el.dataset.per) }]),
    'notes-valider'(el) {
      const k = AK.notes.valider(el.dataset.classe, Number(el.dataset.ev));
      ui.toast(`${u.pluriel(k, 'saisie validée', 'saisies validées')} en ${el.dataset.classe}.`);
    },
    async 'notes-rejeter'(el) {
      const ok = await ui.confirmer({ titre: 'Rejeter des notes', danger: true, ok: 'Rejeter', message: `Les notes en attente de ${el.dataset.classe} (${C.evCourt(el.dataset.ev)}) seront effacées ; l’enseignant devra les saisir de nouveau.` });
      if (!ok) return;
      const k = AK.notes.rejeter(el.dataset.classe, Number(el.dataset.ev));
      ui.toast(`${u.pluriel(k, 'saisie rejetée', 'saisies rejetées')}.`, { type: 'avert' });
    },
    'notes-periode'(el) {
      const c = el.dataset.classe, n = Number(el.dataset.ev), o = AK.notes.saisieOuverte(c, n), sa = S().saisie[c + '|' + n] || {};
      ui.menu(el, [
        { icone: o ? 'lock' : 'unlock', lib: o ? 'Fermer la saisie' : 'Rouvrir la saisie', sous: !o && sa.fin && sa.fin < u.aujourdhui() ? 'La date limite dépassée sera retirée' : '', f: () => AK.notes.basculerSaisie(c, n) },
        { icone: 'clock', lib: 'Fixer une date limite…', sous: sa.fin ? 'Actuelle : ' + u.fmtDate(sa.fin) : 'Aucune', f: () => ui.fenetre({
          titre: `Date limite de saisie · ${c} · ${C.evCourt(n)}`, icone: 'clock', taille: 'sm', proteger: false,
          corps: html`<div class="pile">${F.date({ lib: 'Dernier jour de saisie pour les enseignants', nom: 'fin', val: sa.fin })}<p class="mut petit mb0">Laissez vide pour ne fixer aucune date. Le directeur peut toujours saisir.</p></div>`,
          surValider: (d) => AK.notes.dateLimite(c, n, d.fin)
        }) }
      ], `${c} · ${C.evCourt(n)}`);
    },
    'notes-matieres-cp'(el) {
      const c = el.dataset.classe, n = Number(el.dataset.ev), act = X().matieres(c, n).map(([m]) => m);
      const tout = [...C.CP_MATIERES, ...(S().cpExtra || [])];
      ui.fenetre({
        titre: `Matières de la composition · ${c} · ${X().evalLabel(c, n)}`, icone: 'list',
        corps: html`<div class="pile">${F.cases({ lib: 'Matières évaluées', nom: 'liste', options: tout, valeurs: act })}
          ${F.texte({ lib: 'Ajouter une matière', nom: 'nouvelle', attrs: { maxlength: 40, placeholder: 'Ex. : DESSIN' } })}
          ${F.case({ lib: `Appliquer aussi au ${c === 'CP1' ? 'CP2' : 'CP1'}`, nom: 'aussi' })}
          ${ui.encadre('Retirer une matière ne supprime pas les notes déjà saisies ; elles ne comptent simplement plus dans la moyenne.', 'info')}</div>`,
        surValider: (d) => {
          AK.notes.matieresCP(c, n, d.liste, d.nouvelle, d.aussi);
          ui.toast('Matières de la composition enregistrées.');
        }
      });
    },
    async 'annee-passer'() {
      AK.perm.exiger('annee.passer');
      const R = AK.notes.bilanPassage(), suiv = AK.notes.anneeSuivante();
      if (!suiv) throw new AK.ErreurMetier('Renseignez d’abord l’année scolaire en cours (Paramètres › École).');
      const ok = await ui.confirmer({
        titre: `Passer à l’année ${suiv}`, danger: true, ok: `Passer à ${suiv}`, saisie: 'PASSER',
        message: html`<div class="pile-sm"><p class="mb0">Bilan du passage :</p><ul class="mb0"><li><b>${R.montent}</b> élève(s) admis passent au niveau supérieur ;</li><li><b>${R.restent}</b> restent dans leur classe (redoublants${R.sansDecision ? html`, dont <b>${R.sansDecision}</b> sans décision faute de MGA` : ''}) ;</li><li><b>${R.sortants + R.archives}</b> sont archivés (CM2 admis, départs${R.niveauNonOuvert.length ? ', admis vers un niveau non ouvert' : ''}).</li></ul>
          ${R.niveauNonOuvert.length ? ui.encadre(html`Niveau suivant non ouvert dans l’école : ${R.niveauNonOuvert.slice(0, 5).join(' ; ')}${R.niveauNonOuvert.length > 5 ? '…' : ''}. Ces élèves seront archivés avec la mention « à transférer ».`, 'avert') : ''}
          ${R.sansDecision ? ui.encadre(`${R.sansDecision} élève(s) sans MGA complète resteront dans leur classe. Fixez leur décision avant de continuer si nécessaire.`, 'avert') : ''}
          ${R.incompletes ? ui.encadre(`${R.incompletes} élève(s) ont au moins une évaluation incomplète (matières sans note) : leur moyenne et la décision proposée ne portent que sur les matières notées. Vérifiez-les dans Fin d’année (mention « notes incomplètes »).`, 'avert') : ''}
          ${R.attente ? ui.encadre(html`<b>${u.pluriel(R.attente, 'saisie')} d’enseignant en attente de validation</b> : elles seront archivées sans compter dans les moyennes. Validez-les d’abord (Notes › Validation).`, 'avert') : ''}
          <p class="mb0">Les notes, absences et appels de l’année sont archivés puis remis à zéro. ${AK.stockage.copiesDisponibles() ? html`<b>Une copie de sécurité est faite juste avant</b> (Données › Sauvegarde › Copies locales) ; si elle échoue, le passage n’a pas lieu. Exportez aussi une sauvegarde sur clé USB.` : html`<b>Ce stockage ne permet pas de copie de sécurité locale : exportez d’abord une sauvegarde sur clé USB</b> (Données › Sauvegarde).`}</p></div>`
      });
      if (!ok) return;
      if (!(await AK.auth.confirmer('Passage à l’année suivante.', { forcer: true }))) return;
      const r = await AK.notes.passerAnnee();
      ui.toast(`Année ${suiv} ouverte : ${r.montent} élève(s) passent, ${r.restent} restent, ${r.archives} archivé(s).`, { duree: 10000 });
      AK.shell.aller('accueil');
    }
  });
  AK.actions.defChange({
    'notes-ev': (el) => AK.shell.aller(el.dataset.route, { ...AK.shell.params(), ev: el.value }),
    note: (el) => enregistrerNote(el),
    async 'note-absent'(el) {
      const n = Number($('#grille-notes').dataset.ev);
      const voulu = el.checked;
      try {
        try {
          AK.notes.marquerAbsent(el.dataset.id, n, voulu);
        } catch (err) {
          if (!err.correction) throw err;
          // effacer des notes validées ou retirer une absence enregistrée : mot de passe, comme toute correction
          const ok = err.validees && AK.session.estDirecteur()
            ? await AK.auth.confirmer(err.message)
            : await ui.confirmer({ titre: voulu ? 'Absent(e) à l’évaluation' : 'Retirer l’absence', message: err.message, ok: 'Confirmer', danger: voulu });
          if (!ok) {
            el.checked = !voulu;
            return;
          }
          AK.notes.marquerAbsent(el.dataset.id, n, voulu, { confirme: true });
        }
      } catch (err) {
        el.checked = !voulu;
        throw err;
      }
      AK.shell.redessiner();
    },
    decision(el) {
      AK.notes.fixerDecision(el.dataset.id, el.value);
    },
    'notes-validation-option': (el) => AK.notes.basculerValidation(el.checked),
    'notes-eval-courante'(el) {
      AK.perm.exiger('notes.periode');
      AK.store.modifier(`Évaluation en cours : ${C.EV_GEN[el.value - 1]}`, (s) => (s.school.evalCourante = Number(el.value)));
    }
  });
  /* Entrée : élève suivant dans la même matière ; Maj+Entrée : élève précédent */
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.classList || !el.classList.contains('note-in')) return;
    e.preventDefault();
    const champs = $$(`#grille-notes .note-in[data-j="${el.dataset.j}"]:not(:disabled)`);
    const i = champs.indexOf(el), suivant = champs[i + (e.shiftKey ? -1 : 1)];
    if (suivant) {
      suivant.focus();
      suivant.select();
    } else el.blur();
  });
})(window.AK);
