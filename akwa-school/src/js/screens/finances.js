/* =====================================================================================
   Scolarité & finances : grille des frais par niveau, situation de chaque élève (dû, versé,
   reste, état), encaissement des versements avec reçu numéroté REC-AAAA-NNNNN (A5 ou A4),
   annulation tracée d'un reçu (motif + mot de passe : le reçu reste, mention ANNULÉ),
   historique filtrable, journal de caisse ; dépenses de l'école (postes, pièces, solde) ;
   cantine (inscrits, prix du repas, menu de la semaine, repas du jour).
   Les droits et les règles sont vérifiés par les fonctions métier (AK.pro, AK.cantine) :
   masquer un bouton n'est qu'un confort d'affichage.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, $ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const P = () => S().pro;
  const X = () => AK.calc;
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  /* Rubriques de la grille des frais : clé de AK.pro.fraisDe, libellé, objet de versement correspondant */
  const RUBRIQUES = [['inscription', 'Inscription', 'Inscription'], ['coges', 'Cotisation COGES', 'Cotisation COGES'], ['tenue', 'Tenue scolaire', 'Tenue scolaire'], ['autre', 'Autre', 'Autre']];
  const ETATS = ['Soldé', 'Partiel', 'Non payé', 'Aucun frais'];
  const TON_ETAT = { Soldé: 'ok', Partiel: 'avert', 'Non payé': 'mauvais', 'Aucun frais': '' };
  const ICONE_ETAT = { Soldé: 'checkCircle', Partiel: 'clock', 'Non payé': 'alert', 'Aucun frais': 'minus' };
  const VUES = [['situation', 'Situation des élèves'], ['historique', 'Historique des reçus'], ['frais', 'Frais par niveau']];
  const R_PAIE = 'finances/paiements', R_DEP = 'finances/depenses', R_CANT = 'finances/cantine';

  /* Recherches en cours (état d'écran : la frappe redessine sans perdre le focus) */
  const recherche = { eleves: '', recus: '', depenses: '' };

  /* ---------- Outils ---------- */
  const somme = (L) => L.reduce((a, o) => a + (+o.montant || 0), 0);
  const totalDepenses = () => somme(P().depenses);

  /* Contournement d'un défaut de domain/pro.js (signalé) : la méthode « depense(d) » (enregistrer une
     dépense) porte le même nom que le total « depense() » et le masque. Le modèle « journal-caisse »
     appelle AK.pro.depense() SANS argument pour obtenir le total : sans argument, on renvoie le total ;
     avec un argument, la méthode d'origine (droits et validation compris) est appelée telle quelle. */
  if (AK.pro && typeof AK.pro.depense === 'function' && AK.pro.depense.length === 1 && !AK.pro.depense.totalSansArgument) {
    const enregistrer = AK.pro.depense;
    const depense = function (d) {
      return d === undefined ? totalDepenses() : enregistrer.call(this, d);
    };
    depense.totalSansArgument = true;
    AK.pro.depense = depense;
  }
  const resteDe = (s) => Math.max(0, AK.pro.duDe(s) - AK.pro.payeDe(s));
  const tagEtat = (e) => ui.tag(e, TON_ETAT[e] || '', ICONE_ETAT[e]);
  const eleveDe = (sid) => AK.eleves.trouver(sid) || null;
  const nomDe = (sid) => {
    const s = eleveDe(sid);
    return s ? X().nomComplet(s) : 'Élève retiré du registre';
  };
  const recusDe = (sid) => P().paiements.filter((r) => r.sid === sid);
  const versePour = (sid, objet) => somme(P().paiements.filter((r) => r.sid === sid && !r.annule && r.objet === objet));
  const parDateDesc = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.cree || 0) - (a.cree || 0) || String(b.ref || '').localeCompare(String(a.ref || ''), 'fr', { numeric: true });
  const dateParam = (v) => (u.estISO(v) ? v : '');
  /** Parent à qui le reçu est établi par défaut : tuteur, sinon père, sinon mère. */
  const parentDe = (s) => {
    const nom = (p) => (p ? [p.nom, p.prenoms].filter(Boolean).join(' ') : '');
    return (s.parent || nom(s.pere) || nom(s.mere) || '').slice(0, 80);
  };
  /** Objet proposé pour un nouveau versement : la première rubrique du niveau qui n'est pas réglée. */
  const objetConseille = (s) => {
    const f = AK.pro.fraisDe(s.classe);
    const r = RUBRIQUES.find(([k, , objet]) => f[k] > versePour(s.id, objet));
    return r ? r[2] : 'Cotisation COGES';
  };
  /** Montant saisi : entier strictement positif, en francs CFA (pas de centimes). */
  function lireMontant(v, lib, champ) {
    const t = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
    if (!t) throw E(`${lib} : à renseigner (en francs CFA).`, champ);
    const n = Number(t);
    if (!Number.isFinite(n)) throw E(`${lib} : nombre invalide.`, champ);
    if (n <= 0) throw E(`${lib} : le montant doit être supérieur à zéro.`, champ);
    if (!Number.isInteger(n)) throw E(`${lib} : nombre entier de francs, sans centimes.`, champ);
    return n;
  }
  /** Montant positif ou nul (grille des frais, prix du repas) : '' vaut 0 si vide accepté. */
  function lireMontantNul(v, lib, champ, max) {
    const t = String(v ?? '').trim();
    if (!t) return 0;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) throw E(`${lib} : montant positif ou nul.`, champ);
    if (!Number.isInteger(n)) throw E(`${lib} : nombre entier de francs, sans centimes.`, champ);
    if (n > max) throw E(`${lib} : ${max.toLocaleString('fr-FR')} F au maximum.`, champ);
    return n;
  }
  const appel = (f) => () => {
    try {
      const r = f();
      if (r && r.catch) r.catch((e) => ui.erreur(e));
    } catch (e) {
      ui.erreur(e);
    }
  };
  /** Champ de recherche d'un tableau de cet écran (identifiant stable : le focus est conservé). */
  const champRecherche = (cle, tab, texte) =>
    html`<div class="recherche-tab">${ic('search')}<input class="inp" type="search" id="fin-q-${cle}" value="${recherche[cle]}" placeholder="${texte}" aria-label="${texte}" data-input="fin-recherche" data-cle="${cle}" data-tab="${tab}" autocomplete="off"></div>`;
  const filtreDate = (route, tab, f, val, lib) =>
    html`<input class="inp inp-sm" type="date" value="${val}" max="${u.aujourdhui()}" data-change="fin-filtre" data-route="${route}" data-tab="${tab}" data-f="${f}" aria-label="${lib}" data-bulle="${lib}" style="width:auto">`;
  const filtreChoix = (route, tab, f, liste, val, vide, lib) =>
    html`<select class="inp inp-sm" data-change="fin-filtre" data-route="${route}" data-tab="${tab}" data-f="${f}" aria-label="${lib}">${ui.options(liste, val, vide)}</select>`;
  const actionsLigne = (contenu) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap">${contenu}</div>`;

  /* ---------- Préférence d'impression des reçus (propre à ce poste) ---------- */
  const CLE_PAPIER = 'akwa2:recu-papier';
  const papierRecu = () => {
    try {
      return localStorage.getItem(CLE_PAPIER) === 'A4' ? 'A4' : 'A5';
    } catch (e) {
      return 'A5';
    }
  };
  const retenirPapier = (p) => {
    try {
      localStorage.setItem(CLE_PAPIER, p === 'A4' ? 'A4' : 'A5');
    } catch (e) { /* préférence non conservée */ }
  };

  /* ---------- Documents ---------- */
  /** Reçu d'un versement (modèle « recu ») en A5 ou A4 ; la personnalisation du modèle par l'école est conservée. */
  function imprimerRecu(r, papier) {
    const reglages = u.clone(AK.modeles.reglages('recu'));
    reglages.page = { ...(reglages.page || {}), papier: papier === 'A4' ? 'A4' : 'A5' };
    // élève retiré du registre : le reçu reste imprimable (le générateur exige un élève pour ce modèle)
    const eleve = eleveDe(r.sid) || { id: '', nom: 'ÉLÈVE RETIRÉ DU REGISTRE', prenoms: '', classe: '—', mat: '', matNat: '' };
    return AK.docs.ouvrir('recu', [{ paiement: r, eleve }], { reglages, nomFichier: `recu-${r.ref}`, titre: `Reçu ${r.ref}${r.annule ? ' (annulé)' : ''}` });
  }
  const imprimerJournal = () => AK.docs.ouvrir('journal-caisse', [{}], { nomFichier: `journal-caisse-${u.aujourdhui()}` });

  /* ---------- Fonctions métier complémentaires (cantine) ---------- */
  AK.cantine = {
    /** Inscrit ou désinscrit un élève : l'élève doit exister et, pour une inscription, être inscrit à l'école. */
    inscrire(sid, oui) {
      AK.perm.exiger('finances.gerer');
      const s = eleveDe(sid);
      if (!s) throw E('Élève introuvable (peut-être supprimé).');
      if (oui && s.statut !== 'Inscrit') throw E('Seul un élève inscrit à l’école peut être inscrit à la cantine.');
      AK.pro.cantineInscrire(s.id, !!oui);
    },
    /** Retire de la cantine tous les élèves inscrits d'une classe (l'inscription en bloc est AK.pro.cantineTous). */
    desinscrireClasse(classe) {
      AK.perm.exiger('finances.gerer');
      if (V.classe(classe, X().niveaux())) throw E(V.classe(classe, X().niveaux()));
      const L = X().actifsDe(classe).filter((s) => P().cantine.inscrits[s.id]);
      if (!L.length) throw E(`Aucun élève de ${classe} n’est inscrit à la cantine.`);
      AK.store.modifier(`Cantine : ${u.pluriel(L.length, 'élève')} de ${classe} désinscrit(s)`, () => L.forEach((s) => delete P().cantine.inscrits[s.id]), { categorie: 'finances' });
      return L.length;
    },
    /** Plat d'un jour du menu de la semaine (80 caractères au plus). */
    plat(i, texte) {
      AK.perm.exiger('finances.gerer');
      const k = Number(i);
      if (!Number.isInteger(k) || k < 0 || k >= P().cantine.menu.length) throw E('Jour du menu inconnu.');
      const t = String(texte || '').trim();
      if (t.length > 80) throw E('Plat du jour : 80 caractères au maximum.');
      AK.pro.cantineMenu(k, t);
    }
  };

  /* =====================================================================================
     Frais & versements
     ===================================================================================== */
  function chiffres() {
    const pro = AK.pro, A = X().actifs();
    const du = A.reduce((a, s) => a + pro.duDe(s), 0);
    const recouvre = A.reduce((a, s) => a + Math.min(pro.payeDe(s), pro.duDe(s)), 0);
    const reste = A.reduce((a, s) => a + resteDe(s), 0);
    const enc = pro.encaisse(), dep = totalDepenses();
    return { A, du, recouvre, reste, familles: A.filter((s) => resteDe(s) > 0).length, enc, dep, solde: enc - dep };
  }
  function kpisCaisse(k) {
    return html`<div class="grille g4 mb">
      ${ui.kpi({ lien: R_PAIE + '?vue=frais', icone: 'list', lib: 'Attendu', val: u.fcfa(k.du), sous: `${u.pluriel(k.A.length, 'élève inscrit', 'élèves inscrits')}` })}
      ${ui.kpi({ lien: R_PAIE + '?vue=historique', icone: 'coin', lib: 'Encaissé', val: u.fcfa(k.enc), sous: k.du ? `${u.pct(k.recouvre, k.du)} des frais recouvrés` : 'aucun frais fixé', ton: 'acc' })}
      ${ui.kpi({ lien: R_PAIE + '?etat=impayes', icone: 'clock', lib: 'Reste à recouvrer', val: u.fcfa(k.reste), sous: k.familles ? `${u.pluriel(k.familles, 'élève concerné', 'élèves concernés')}` : 'aucun impayé', ton: k.reste ? 'avert' : '' })}
      ${ui.kpi({ lien: R_DEP, icone: k.solde < 0 ? 'warn' : 'database', lib: 'Solde de caisse', val: u.fcfa(k.solde), sous: k.solde < 0 ? 'déficit : encaissé − dépensé' : 'encaissé − dépensé', ton: k.solde < 0 ? 'mauvais' : '' })}</div>`;
  }

  function rendrePaiements(p) {
    const vue = VUES.some(([v]) => v === p.vue) ? p.vue : 'situation';
    const k = chiffres();
    const sansFrais = X().niveaux().every((c) => !AK.pro.duDe({ classe: c }));
    return html`${ui.pageTete('Frais & versements', 'Frais fixés par niveau, versements des parents et reçus numérotés. Un reçu n’est jamais effacé : il peut seulement être annulé, avec un motif.',
      html`<button type="button" class="btn" data-action="fin-journal">${ic('print')}Journal de caisse</button><button type="button" class="btn" data-action="fin-frais">${ic('sliders')}Frais par niveau</button><button type="button" class="btn btn-pri" data-action="fin-encaisser" data-id="${p.eleve || ''}">${ic('plus')}Encaisser un versement</button>`)}
      ${p.eleve ? carteSituation(p.eleve) : ''}
      ${kpisCaisse(k)}
      ${sansFrais && X().niveaux().length ? ui.encadre(html`Aucun frais n’est encore fixé : chaque élève apparaît « Aucun frais ». <button type="button" class="lien" data-action="fin-frais">Fixer la grille des frais par niveau</button>.`, 'info', 'sliders') : ''}
      <div class="barre-outils">${ui.pilules(VUES, vue, 'fin-vue')}<span class="espace"></span><label class="petit mut" for="fin-papier">Reçus au format</label><select class="inp inp-sm" id="fin-papier" data-change="fin-recu-papier">${ui.options([['A5', 'A5 (demi-feuille)'], ['A4', 'A4 (feuille entière)']], papierRecu())}</select></div>
      ${vue === 'historique' ? vueHistorique(p) : vue === 'frais' ? vueFrais() : vueSituation(p)}`;
  }

  /* ---------- Situation d'un élève (paramètre ?eleve=) ---------- */
  const chiffre = (lib, v, fort) => html`<div class="fin-chiffre${fort ? ' fort' : ''}"><span>${lib}</span><b>${u.fcfa(v)}</b></div>`;
  const celStatut = (r) => (r.annule ? html`${ui.tag('Annulé', 'mauvais', 'ban')}<br><span class="mut petit">le ${u.fmtDate(String(r.annule.le || '').slice(0, 10))} · ${r.annule.motif}</span>` : ui.tag('Valide', 'ok', 'check'));
  const celMontant = (r) => (r.annule ? html`<del aria-label="${u.fcfa(r.montant)}, annulé">${u.fcfa(r.montant)}</del>` : html`<b>${u.fcfa(r.montant)}</b>`);
  const celActions = (r) => actionsLigne(html`<button type="button" class="btn-ic" data-action="fin-recu-imprimer" data-id="${r.id}" aria-label="Imprimer le reçu ${r.ref}${r.annule ? ' (annulé)' : ''}" data-bulle="Imprimer le reçu">${ic('print')}</button>${r.annule ? '' : html`<button type="button" class="btn-ic" data-action="fin-recu-annuler" data-id="${r.id}" aria-label="Annuler le reçu ${r.ref}" data-bulle="Annuler le reçu (motif et mot de passe)">${ic('ban')}</button>`}`);

  function carteSituation(id) {
    const fermer = html`<button type="button" class="btn-ic" data-action="fin-situation-fermer" aria-label="Fermer la situation de l’élève" data-bulle="Fermer">${ic('x')}</button>`;
    const s = eleveDe(id);
    if (!s) return html`<section class="carte mb fin-situation" id="fin-situation" aria-labelledby="fin-situation-titre"><div class="carte-tete fin-tete"><h2 id="fin-situation-titre" tabindex="-1">Situation introuvable</h2>${fermer}</div>${ui.encadre('Cet élève n’est plus dans le registre (supprimé ou archivé). Ses reçus restent consultables dans l’historique.', 'avert')}</section>`;
    const x = X(), pro = AK.pro, du = pro.duDe(s), paye = pro.payeDe(s), reste = Math.max(0, du - paye), f = pro.fraisDe(s.classe);
    const objets = [
      ...RUBRIQUES.map(([k, lib, objet]) => ({ lib, du: f[k], verse: versePour(s.id, objet) })),
      ...C.OBJETS_PAIE.filter((o) => !RUBRIQUES.some((r) => r[2] === o)).map((o) => ({ lib: o, du: null, verse: versePour(s.id, o) }))
    ].filter((o) => o.du || o.verse);
    const R = recusDe(s.id).slice().sort(parDateDesc);
    const nbAnnules = R.filter((r) => r.annule).length;
    return html`<section class="carte mb fin-situation" id="fin-situation" aria-labelledby="fin-situation-titre">
      <div class="carte-tete fin-tete"><div class="qui">${ui.avatar(s)}<div class="tronque"><h2 id="fin-situation-titre" tabindex="-1">Situation de ${x.nomComplet(s)}</h2><div class="sous">${s.classe} · ${x.matOf(s)}${s.statut !== 'Inscrit' ? ' · ' + s.statut : ''}</div></div></div>
        <div class="ligne"><button type="button" class="btn btn-sm btn-pri" data-action="fin-encaisser" data-id="${s.id}">${ic('coin')}Encaisser un versement</button>${reste > 0 ? html`<button type="button" class="btn btn-sm" data-action="fin-rappel" data-id="${s.id}">${ic('msg')}Rappel au parent</button>` : ''}<button type="button" class="btn btn-sm" data-action="fiche-eleve" data-id="${s.id}">${ic('user')}Fiche élève</button>${fermer}</div></div>
      <div class="fin-chiffres mb">${chiffre('Total dû', du)}${chiffre('Déjà versé', paye)}${chiffre('Reste à payer', reste, true)}</div>
      <div class="ligne mb">${tagEtat(pro.etatPaie(s))}${!du ? html`<span class="mut petit">Aucun frais fixé pour ${s.classe}.</span>` : ''}${pro.telParent(s) ? html`<span class="mut petit">${ic('msg', 'i-sm')} Parent : <a href="tel:${pro.telParent(s)}">${pro.telParent(s)}</a></span>` : ''}</div>
      <div class="grille g-1-2">
        <div><h3 class="petit mut mb">Par rubrique</h3>${objets.length ? html`<div class="tab-cadre"><table class="tab" aria-label="Frais et versements par rubrique"><thead><tr><th>Rubrique</th><th class="r">Dû</th><th class="r">Versé</th></tr></thead><tbody>${objets.map((o) => html`<tr><td>${o.lib}</td><td class="r num">${o.du == null ? '—' : u.fcfa(o.du)}</td><td class="r num">${u.fcfa(o.verse)}</td></tr>`)}</tbody></table></div>` : html`<p class="mut petit mb0">Aucun frais ni versement.</p>`}</div>
        <div><h3 class="petit mut mb">Reçus (${R.length}${nbAnnules ? `, dont ${nbAnnules} annulé(s)` : ''})</h3>${R.length ? html`<div class="tab-cadre"><table class="tab" aria-label="Reçus de ${x.nomComplet(s)}"><thead><tr><th>Reçu</th><th>Date</th><th>Objet</th><th>Mode</th><th class="r">Montant</th><th>Statut</th><th class="r"><span class="sr">Actions</span></th></tr></thead><tbody>${R.map((r) => html`<tr><td class="mono">${r.ref}</td><td>${u.fmtDate(r.date)}</td><td>${r.objet}</td><td>${r.mode}</td><td class="r num">${celMontant(r)}</td><td class="texte">${celStatut(r)}</td><td class="r">${celActions(r)}</td></tr>`)}</tbody></table></div>` : ui.vide('Aucun versement', 'Aucun reçu n’a encore été établi pour cet élève.')}</div>
      </div></section>`;
  }
  let situationVue = null;
  function apresPaiements(racine, p) {
    if (!p.eleve) {
      situationVue = null;
      return;
    }
    if (situationVue === p.eleve) return;
    situationVue = p.eleve;
    // après la restauration de la position de défilement par la coque
    setTimeout(() => {
      const t = document.getElementById('fin-situation-titre');
      if (!t) return;
      t.scrollIntoView({ block: 'start', behavior: 'smooth' });
      t.focus({ preventScroll: true });
    }, 40);
  }

  /* ---------- Vue « Situation des élèves » ---------- */
  const filtreEtat = (s, e) => !e || (e === 'impayes' ? ['Partiel', 'Non payé'].includes(AK.pro.etatPaie(s)) : AK.pro.etatPaie(s) === e);
  function vueSituation(p) {
    const x = X(), pro = AK.pro, q = u.norm(recherche.eleves);
    const classe = x.niveaux().includes(p.classe) ? p.classe : '';
    const L = x.actifs().filter((s) => (!classe || s.classe === classe) && filtreEtat(s, p.etat) && (!q || u.norm(x.nomComplet(s) + ' ' + s.prenoms + ' ' + s.nom + ' ' + x.matOf(s) + ' ' + s.mat).includes(q))).sort(x.parClasse);
    const filtre = !!(classe || p.etat || recherche.eleves);
    const filtres = html`${champRecherche('eleves', 'fin-eleves', 'Nom ou matricule…')}
      ${filtreChoix(R_PAIE, 'fin-eleves', 'classe', x.niveaux(), classe, 'Toutes les classes', 'Classe')}
      ${filtreChoix(R_PAIE, 'fin-eleves', 'etat', [['impayes', 'Reste à payer'], ...ETATS.map((e) => [e, e])], p.etat, 'Tous les états', 'État des versements')}
      ${filtre ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="fin-effacer" data-route="${R_PAIE}" data-cle="eleves">${ic('x')}Effacer les filtres</button>` : ''}`;
    const T = { du: 0, paye: 0, reste: 0 };
    L.forEach((s) => {
      T.du += pro.duDe(s);
      T.paye += pro.payeDe(s);
      T.reste += resteDe(s);
    });
    return ui.tableau({
      id: 'fin-eleves', lignes: L, filtres, unite: 'élève', parPage: 50, exporter: 'situation-versements', legende: 'Situation des élèves : frais et versements',
      colonnes: [
        { cle: 'nom', lib: 'Élève', tri: (s) => x.nomComplet(s), rendu: (s) => ui.quiEleve(s), csv: (s) => x.nomComplet(s) },
        { cle: 'classe', lib: 'Classe', cache: true, csv: (s) => s.classe },
        { cle: 'mat', lib: 'Matricule', cache: true, csv: (s) => x.matOf(s) },
        { cle: 'du', lib: 'Dû', cls: 'r num', tri: (s) => pro.duDe(s), rendu: (s) => u.fcfa(pro.duDe(s)) },
        { cle: 'paye', lib: 'Versé', cls: 'r num', tri: (s) => pro.payeDe(s), rendu: (s) => u.fcfa(pro.payeDe(s)) },
        { cle: 'reste', lib: 'Reste', cls: 'r num', tri: (s) => resteDe(s), rendu: (s) => html`<b>${u.fcfa(resteDe(s))}</b>` },
        { cle: 'etat', lib: 'État', tri: (s) => ETATS.indexOf(pro.etatPaie(s)), rendu: (s) => tagEtat(pro.etatPaie(s)), csv: (s) => pro.etatPaie(s) },
        { cle: 'tel', lib: 'Téléphone du parent', cache: true, csv: (s) => pro.telParent(s) },
        { cle: 'act', lib: '', cls: 'r', csv: false, rendu: (s) => actionsLigne(html`<button type="button" class="btn btn-sm" data-action="fin-encaisser" data-id="${s.id}" aria-label="Encaisser un versement pour ${x.nomComplet(s)}">${ic('coin')}Versement</button><button type="button" class="btn-ic" data-action="fin-situation" data-id="${s.id}" aria-label="Situation et reçus de ${x.nomComplet(s)}" data-bulle="Situation et reçus">${ic('file')}</button>`) }
      ],
      pied: L.length ? html`<tr><td>Total (${u.pluriel(L.length, 'élève')})</td><td class="r num">${u.fcfa(T.du)}</td><td class="r num">${u.fcfa(T.paye)}</td><td class="r num">${u.fcfa(T.reste)}</td><td colspan="2"></td></tr>` : null,
      vide: x.actifs().length ? ui.vide('Aucun élève', 'Aucun élève ne correspond à ces filtres.') : ui.vide('Aucun élève inscrit', 'Inscrivez d’abord les élèves (Élèves & classes) pour suivre leurs versements.', html`<a class="btn" href="#eleves/liste">${ic('users')}Registre des élèves</a>`)
    });
  }

  /* ---------- Vue « Historique des reçus » ---------- */
  function vueHistorique(p) {
    const x = X(), q = u.norm(recherche.recus);
    const du = dateParam(p.du), au = dateParam(p.au);
    const classe = x.niveaux().includes(p.classe) ? p.classe : '';
    const L = P().paiements.filter((r) => {
      const s = eleveDe(r.sid);
      return (!classe || (s && s.classe === classe)) && (!p.mode || r.mode === p.mode) && (!p.objet || r.objet === p.objet) && (!p.statut || (p.statut === 'annule' ? !!r.annule : !r.annule))
        && (!du || r.date >= du) && (!au || r.date <= au) && (!q || u.norm(`${r.ref} ${nomDe(r.sid)} ${s ? x.matOf(s) : ''} ${r.payeur || ''}`).includes(q));
    }).sort(parDateDesc);
    const valides = L.filter((r) => !r.annule), annules = L.filter((r) => r.annule);
    const parMode = C.MODES_PAIE.map((m) => [m, somme(valides.filter((r) => r.mode === m))]).filter(([, v]) => v);
    const filtre = !!(classe || p.mode || p.objet || p.statut || du || au || recherche.recus);
    const T = 'fin-recus';
    const filtres = html`${champRecherche('recus', T, 'Reçu, élève, matricule, payeur…')}
      ${filtreChoix(R_PAIE, T, 'classe', x.niveaux(), classe, 'Toutes les classes', 'Classe')}
      ${filtreChoix(R_PAIE, T, 'objet', C.OBJETS_PAIE, p.objet, 'Tous les objets', 'Objet')}
      ${filtreChoix(R_PAIE, T, 'mode', C.MODES_PAIE, p.mode, 'Tous les modes', 'Mode de paiement')}
      ${filtreChoix(R_PAIE, T, 'statut', [['valide', 'Valides'], ['annule', 'Annulés']], p.statut, 'Valides et annulés', 'Statut du reçu')}
      ${filtreDate(R_PAIE, T, 'du', du, 'Versements à partir du')}${filtreDate(R_PAIE, T, 'au', au, 'Versements jusqu’au')}
      ${filtre ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="fin-effacer" data-route="${R_PAIE}" data-cle="recus" data-vue="historique">${ic('x')}Effacer les filtres</button>` : ''}`;
    return html`${V.periode(du, au) ? ui.encadre(V.periode(du, au), 'avert', 'cal') : ''}
      ${parMode.length ? html`<div class="ligne mb">${parMode.map(([m, v]) => html`<span class="puce">${m} : <b>${u.fcfa(v)}</b></span>`)}</div>` : ''}
      ${ui.tableau({
        id: T, lignes: L, filtres, unite: 'reçu', parPage: 50, exporter: 'versements', legende: 'Historique des reçus',
        colonnes: [
          { cle: 'ref', lib: 'Reçu', tri: (r) => r.ref, rendu: (r) => html`<span class="mono">${r.ref}</span>`, csv: (r) => r.ref },
          { cle: 'date', lib: 'Date', tri: (r) => r.date, rendu: (r) => u.fmtDate(r.date) },
          { cle: 'eleve', lib: 'Élève', tri: (r) => nomDe(r.sid), csv: (r) => nomDe(r.sid), rendu: (r) => {
            const s = eleveDe(r.sid);
            return s ? html`<button type="button" class="lien" data-action="fin-situation" data-id="${s.id}">${x.nomComplet(s)}</button><br><span class="mut petit">${s.classe} · ${x.matOf(s)}</span>` : html`<span class="mut">${nomDe(r.sid)}</span>`;
          } },
          { cle: 'classe', lib: 'Classe', cache: true, csv: (r) => (eleveDe(r.sid) || {}).classe || '' },
          { cle: 'mat', lib: 'Matricule', cache: true, csv: (r) => (eleveDe(r.sid) ? x.matOf(eleveDe(r.sid)) : '') },
          { cle: 'objet', lib: 'Objet', tri: (r) => r.objet },
          { cle: 'mode', lib: 'Mode', tri: (r) => r.mode },
          { cle: 'payeur', lib: 'Versé par', tri: (r) => r.payeur || '', rendu: (r) => r.payeur || html`<span class="mut">—</span>`, csv: (r) => r.payeur || '' },
          { cle: 'montant', lib: 'Montant', cls: 'r num', tri: (r) => +r.montant, rendu: celMontant },
          { cle: 'statut', lib: 'Statut', cls: 'texte', tri: (r) => (r.annule ? 1 : 0), rendu: celStatut, csv: (r) => (r.annule ? `Annulé le ${u.fmtDate(String(r.annule.le || '').slice(0, 10))} : ${r.annule.motif}` : 'Valide') },
          { cle: 'act', lib: '', cls: 'r', csv: false, rendu: celActions }
        ],
        pied: L.length ? html`<tr><td colspan="6">Total des reçus valides (${valides.length})${annules.length ? html` · <span class="mut">${u.pluriel(annules.length, 'reçu annulé', 'reçus annulés')} : ${u.fcfa(somme(annules))}, non comptés</span>` : ''}</td><td class="r num">${u.fcfa(somme(valides))}</td><td colspan="2"></td></tr>` : null,
        vide: P().paiements.length ? ui.vide('Aucun reçu', 'Aucun reçu ne correspond à ces filtres.') : ui.vide('Aucun versement encaissé', 'Les reçus apparaîtront ici dès le premier versement.', html`<button type="button" class="btn btn-pri" data-action="fin-encaisser">${ic('plus')}Encaisser un versement</button>`)
      })}`;
  }

  /* ---------- Vue « Frais par niveau » ---------- */
  function vueFrais() {
    const x = X(), pro = AK.pro, niv = x.niveaux();
    if (!niv.length) return ui.vide('Aucun niveau ouvert', 'Ouvrez les niveaux de l’école dans Paramètres › École.');
    const L = niv.map((c) => {
      const f = pro.fraisDe(c), A = x.actifsDe(c);
      return { c, f, tot: RUBRIQUES.reduce((a, [k]) => a + f[k], 0), n: A.length, du: A.reduce((a, s) => a + pro.duDe(s), 0), recouvre: A.reduce((a, s) => a + Math.min(pro.payeDe(s), pro.duDe(s)), 0) };
    });
    const tot = (k) => L.reduce((a, o) => a + o[k], 0);
    const taux = (a, b) => {
      if (!b) return html`<span class="mut">—</span>`;
      const t = Math.round((a / b) * 100);
      return html`<span class="fin-taux"><span class="progression" aria-hidden="true"><i style="width:${Math.min(100, t)}%"></i></span><b>${t} %</b></span>`;
    };
    return ui.carte('Grille des frais par niveau', html`<div class="tab-cadre"><table class="tab" aria-label="Frais par niveau et recouvrement">
        <thead><tr><th>Niveau</th>${RUBRIQUES.map(([, lib]) => html`<th class="r">${lib}</th>`)}<th class="r">Total par élève</th><th class="r">Élèves</th><th class="r">Attendu</th><th class="r">Recouvré</th><th>Taux</th></tr></thead>
        <tbody>${L.map((o) => html`<tr><td><b>${o.c}</b></td>${RUBRIQUES.map(([k]) => html`<td class="r num">${o.f[k] ? u.fcfa(o.f[k]) : html`<span class="mut">—</span>`}</td>`)}<td class="r num"><b>${u.fcfa(o.tot)}</b></td><td class="r num">${o.n}</td><td class="r num">${u.fcfa(o.du)}</td><td class="r num">${u.fcfa(o.recouvre)}</td><td>${taux(o.recouvre, o.du)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="6">Ensemble de l’école</td><td class="r num">${tot('n')}</td><td class="r num">${u.fcfa(tot('du'))}</td><td class="r num">${u.fcfa(tot('recouvre'))}</td><td>${taux(tot('recouvre'), tot('du'))}</td></tr></tfoot></table></div>
      <p class="mut petit mt mb0">Montants annuels par élève, en francs CFA. Le total dû d’un élève est la somme des rubriques de son niveau ; le recouvrement ne compte pas ce qui dépasse le dû.</p>`,
    { sous: 'Inscription, cotisation COGES, tenue et autres contributions', actions: html`<button type="button" class="btn btn-sm btn-pri" data-action="fin-frais">${ic('edit')}Modifier les frais</button>` });
  }

  /* ---------- Fenêtre : frais par niveau ---------- */
  function fenetreFrais() {
    AK.perm.exiger('finances.gerer');
    const niv = X().niveaux();
    if (!niv.length) throw E('Aucun niveau n’est ouvert dans l’école (Paramètres › École).');
    const cellule = (c, k, lib, v) => html`<td><input class="inp inp-sm fin-montant" type="number" name="${c}|${k}" value="${v || ''}" min="0" max="10000000" step="5" inputmode="numeric" placeholder="0" aria-label="${lib}, ${c} (F CFA)"></td>`;
    ui.fenetre({
      titre: 'Frais par niveau (F CFA)', icone: 'sliders', taille: 'lg', ok: 'Enregistrer les frais',
      corps: html`<div class="pile">
        ${ui.encadre('Montants annuels par élève. Dans une école publique, l’inscription est gratuite : ne renseignez que les contributions décidées en assemblée générale du COGES. Une case vide vaut 0.', 'info')}
        <div class="tab-cadre"><table class="tab fin-grille-frais" aria-label="Grille des frais par niveau"><thead><tr><th>Niveau</th>${RUBRIQUES.map(([, lib]) => html`<th>${lib}</th>`)}<th class="r">Total</th></tr></thead>
          <tbody>${niv.map((c) => {
            const f = AK.pro.fraisDe(c);
            return html`<tr><td><b>${c}</b></td>${RUBRIQUES.map(([k, lib]) => cellule(c, k, lib, f[k]))}<td class="r num" data-fin-total="${c}"></td></tr>`;
          })}</tbody></table></div>
        ${niv.length > 1 ? html`<div class="ligne"><button type="button" class="btn btn-sm" data-fin-recopier>${ic('copy')}Recopier la ligne ${niv[0]} sur tous les niveaux</button></div>` : ''}</div>`,
      apres(racine) {
        const f = $('form', racine);
        const totaux = () => niv.forEach((c) => {
          const t = RUBRIQUES.reduce((a, [k]) => a + (Math.max(0, Number(f.elements[c + '|' + k].value) || 0)), 0);
          const el = $(`[data-fin-total="${c}"]`, racine);
          if (el) el.textContent = u.fcfa(t);
        });
        f.addEventListener('input', totaux);
        const b = $('[data-fin-recopier]', racine);
        if (b) b.addEventListener('click', () => {
          niv.slice(1).forEach((c) => RUBRIQUES.forEach(([k]) => (f.elements[c + '|' + k].value = f.elements[niv[0] + '|' + k].value)));
          f.dispatchEvent(new Event('input', { bubbles: true }));
        });
        totaux();
      },
      surValider(d) {
        const table = {};
        niv.forEach((c) => RUBRIQUES.forEach(([k, lib]) => (table[c + '|' + k] = lireMontantNul(d[c + '|' + k], `${c} · ${lib}`, c + '|' + k, 10000000))));
        AK.pro.fixerFrais(table);
        ui.toast('Frais par niveau enregistrés.');
      }
    });
  }

  /* ---------- Fenêtre : encaisser un versement ---------- */
  function fenetreEncaisser(sid) {
    AK.perm.exiger('finances.gerer');
    const x = X(), s0 = sid ? eleveDe(sid) : null;
    const tous = x.actifs().slice().sort(x.parClasse);
    if (s0 && !tous.includes(s0)) tous.unshift(s0);
    if (!tous.length) throw E('Aucun élève inscrit : inscrivez d’abord les élèves (Élèves & classes).');
    const opt = (s) => [s.id, `${x.nomComplet(s)} · ${s.classe} · ${x.matOf(s)}${s.statut !== 'Inscrit' ? ' (' + s.statut + ')' : ''}`];
    const c0 = s0 ? s0.classe : '';
    const liste = (c) => tous.filter((s) => !c || s.classe === c || s === s0);
    ui.fenetre({
      titre: 'Encaisser un versement', icone: 'coin', ok: 'Encaisser',
      corps: html`<div class="pile">
        <div class="form-grille">
          ${F.choix({ lib: 'Classe', nom: 'filtreClasse', val: c0, options: x.niveaux(), vide: 'Toutes les classes', aide: 'Pour retrouver l’élève plus vite.' })}
          ${F.choix({ lib: 'Élève', nom: 'sid', val: s0 ? s0.id : '', options: liste(c0).map(opt), vide: 'Choisir…', req: true })}
        </div>
        <div class="encadre" id="fin-enc-situation" role="status" aria-live="polite"></div>
        <div class="form-grille">
          ${F.nombre({ lib: 'Montant (F CFA)', nom: 'montant', req: true, attrs: { min: 25, max: 10000000, step: 5, inputmode: 'numeric', autofocus: !!s0 } })}
          ${F.choix({ lib: 'Objet', nom: 'objet', val: s0 ? objetConseille(s0) : 'Cotisation COGES', options: C.OBJETS_PAIE, req: true })}
          ${F.choix({ lib: 'Mode de paiement', nom: 'mode', val: 'Espèces', options: C.MODES_PAIE, req: true })}
          ${F.date({ lib: 'Date du versement', nom: 'date', val: u.aujourdhui(), req: true, attrs: { max: u.aujourdhui() } })}
          ${F.texte({ lib: 'Versé par', nom: 'payeur', val: s0 ? parentDe(s0) : '', plein: true, attrs: { maxlength: 80, placeholder: 'Nom du parent ou du tuteur', autocomplete: 'off' } })}
          ${F.choix({ lib: 'Reçu', nom: 'recu', val: papierRecu(), plein: true, options: [['A5', 'Ouvrir le reçu pour l’imprimer (A5, demi-feuille)'], ['A4', 'Ouvrir le reçu pour l’imprimer (A4)'], ['', 'Ne pas ouvrir le reçu maintenant']] })}
        </div></div>`,
      apres(racine) {
        const f = $('form', racine), sel = f.elements.sid, zone = $('#fin-enc-situation', racine);
        const auto = new Set(['montant', 'objet', 'payeur']); // pré-remplis tant que l'utilisateur ne les a pas changés
        ['montant', 'objet', 'payeur'].forEach((n) => ['input', 'change'].forEach((t) => f.elements[n].addEventListener(t, (e) => e.isTrusted && auto.delete(n))));
        const maj = (remplir) => {
          const s = eleveDe(sel.value);
          if (!s) {
            u.poser(zone, html`${ic('info')}<div>Choisissez l’élève : sa situation (dû, déjà versé, reste) s’affiche ici.</div>`);
            return;
          }
          const du = AK.pro.duDe(s), paye = AK.pro.payeDe(s), reste = Math.max(0, du - paye);
          u.poser(zone, html`${ic('coin')}<div><b>${x.nomComplet(s)}</b> (${s.classe}) : dû ${u.fcfa(du)} · déjà versé ${u.fcfa(paye)} · reste à payer <b>${u.fcfa(reste)}</b> · ${AK.pro.etatPaie(s)}</div>`);
          if (!remplir) return;
          if (auto.has('montant')) f.elements.montant.value = reste || '';
          if (auto.has('objet')) f.elements.objet.value = objetConseille(s);
          if (auto.has('payeur')) f.elements.payeur.value = parentDe(s);
        };
        f.elements.filtreClasse.addEventListener('change', () => {
          const v = sel.value, L = liste(f.elements.filtreClasse.value);
          u.poser(sel, ui.options(L.map(opt), L.some((s) => s.id === v) ? v : '', 'Choisir…'));
          maj(true);
        });
        sel.addEventListener('change', () => maj(true));
        maj(true);
      },
      async surValider(d) {
        const s = eleveDe(d.sid);
        if (!s) throw E('Choisissez l’élève.', 'sid');
        const montant = lireMontant(d.montant, 'Montant', 'montant');
        const double = P().paiements.find((r) => !r.annule && r.sid === s.id && r.date === d.date && +r.montant === montant && r.objet === d.objet);
        if (double && !(await ui.confirmer({ titre: 'Versement déjà enregistré ?', icone: 'warn', ok: 'Encaisser un second versement', annuler: 'Revenir à la saisie',
          message: html`<p>Le reçu <b>${double.ref}</b> enregistre déjà ${u.fcfa(double.montant)} (${double.objet}) le ${u.fmtDate(double.date)} pour ${x.nomComplet(s)}.</p><p class="mb0">Confirmez seulement s’il s’agit vraiment d’un second versement.</p>` }))) return false;
        const reste = resteDe(s);
        if (montant > reste && !(await ui.confirmer({ titre: 'Montant supérieur au reste à payer', icone: 'warn', ok: 'Encaisser quand même', annuler: 'Corriger le montant',
          message: html`<p>${x.nomComplet(s)} : reste à payer <b>${u.fcfa(reste)}</b>${AK.pro.duDe(s) ? '' : ` (aucun frais fixé pour ${s.classe})`}.</p><p class="mb0">Le versement de <b>${u.fcfa(montant)}</b> dépasse ce reste de <b>${u.fcfa(montant - reste)}</b>. Confirmez seulement s’il s’agit d’une avance, de la cantine ou d’une contribution volontaire.</p>` }))) return false;
        const r = AK.pro.encaisser({ sid: s.id, montant, mode: d.mode, objet: d.objet, date: d.date, payeur: d.payeur });
        if (d.recu) retenirPapier(d.recu);
        ui.toast(`Versement ${r.ref} encaissé : ${u.fcfa(r.montant)}.`, { action: { lib: 'Imprimer le reçu', f: appel(() => imprimerRecu(r, papierRecu())) } });
        if (d.recu) setTimeout(appel(() => imprimerRecu(r, d.recu)), 60);
      }
    });
  }

  /* ---------- Fenêtre : annuler un reçu (motif + mot de passe) ---------- */
  function fenetreAnnuler(r) {
    AK.perm.exiger('finances.gerer');
    if (r.annule) throw E(`Le reçu ${r.ref} est déjà annulé.`);
    ui.fenetre({
      titre: `Annuler le reçu ${r.ref}`, icone: 'ban', taille: 'sm', danger: true, okStyle: 'dng', ok: 'Annuler le reçu', annuler: 'Garder le reçu',
      corps: html`<div class="pile">
        <dl class="kv"><dt>Élève</dt><dd>${nomDe(r.sid)}</dd><dt>Montant</dt><dd>${u.fcfa(r.montant)} (${r.mode})</dd><dt>Objet</dt><dd>${r.objet}</dd><dt>Date</dt><dd>${u.fmtDate(r.date)}</dd></dl>
        ${ui.encadre('Le reçu reste dans l’historique avec la mention ANNULÉ et le motif ; son montant n’est plus compté dans les versements ni dans la caisse. L’annulation ne peut pas être défaite : il faudra encaisser un nouveau versement.', 'avert')}
        ${F.zone({ lib: 'Motif de l’annulation', nom: 'motif', req: true, lignes: 2, attrs: { maxlength: 160, placeholder: 'Ex. : erreur de montant, versement saisi deux fois', autofocus: true } })}
        <p class="mut petit mb0">${ic('lock', 'i-sm')} Le mot de passe du directeur sera demandé.</p></div>`,
      async surValider(d) {
        const motif = String(d.motif || '').trim();
        if (!motif) throw E('Motif de l’annulation : à renseigner.', 'motif');
        if (motif.length > 160) throw E('Motif de l’annulation : 160 caractères au maximum.', 'motif');
        if (!(await AK.auth.confirmer(`Annuler le reçu ${r.ref} de ${u.fcfa(r.montant)} (${nomDe(r.sid)}).`))) return false;
        AK.pro.annulerRecu(r.id, motif);
        ui.toast(`Reçu ${r.ref} annulé : il reste consultable dans l’historique.`, { action: { lib: 'Imprimer le reçu annulé', f: appel(() => imprimerRecu(r, papierRecu())) } });
      }
    });
  }

  /* ---------- Fenêtre : rappel au parent (texte à copier ou à envoyer depuis le téléphone) ---------- */
  function fenetreRappel(s) {
    const x = X(), sc = S().school, reste = resteDe(s), tel = V.telCI(AK.pro.telParent(s));
    const texte = `${sc.name ? sc.name + ' : c' : 'C'}hers parents, il reste ${u.fcfa(reste)}CFA à régler pour la scolarité de ${x.nomComplet(s)} (${s.classe})${sc.year ? ', année ' + sc.year : ''}. Merci de passer à la direction. La Direction.`;
    ui.fenetre({
      titre: `Rappel au parent · ${x.nomComplet(s)}`, icone: 'msg', ok: false, annuler: 'Fermer', proteger: false,
      corps: html`<div class="pile">
        ${F.zone({ lib: 'Texte du rappel', nom: 'texte', id: 'fin-rappel-texte', val: texte, lignes: 4, attrs: { maxlength: 459 }, aide: 'Modifiable avant de le copier. L’application n’envoie pas de SMS elle-même.' })}
        <div class="ligne"><button type="button" class="btn btn-pri" data-fin-copier>${ic('copy')}Copier le texte</button>${tel ? html`<a class="btn" href="sms:${tel.replace(/\s/g, '')}" data-fin-sms>${ic('send')}Ouvrir l’application SMS (${tel})</a>` : html`<span class="mut petit">Aucun téléphone de parent enregistré dans la fiche de l’élève.</span>`}</div></div>`,
      apres(racine) {
        const zone = $('#fin-rappel-texte', racine), sms = $('[data-fin-sms]', racine);
        const majSms = () => sms && (sms.href = `sms:${tel.replace(/\s/g, '')}?body=${encodeURIComponent(zone.value)}`);
        zone.addEventListener('input', majSms);
        majSms();
        $('[data-fin-copier]', racine).addEventListener('click', async () => {
          let ok = false;
          try {
            await navigator.clipboard.writeText(zone.value);
            ok = true;
          } catch (e) {
            zone.select();
            try {
              ok = document.execCommand('copy');
            } catch (x2) { /* copie refusée par le navigateur */ }
          }
          ui.toast(ok ? 'Texte copié : collez-le dans votre messagerie.' : 'Copie impossible : sélectionnez le texte puis Ctrl+C.', { type: ok ? 'ok' : 'avert' });
        });
      }
    });
  }

  /* =====================================================================================
     Dépenses
     ===================================================================================== */
  function rendreDepenses(p) {
    const pro = AK.pro, tout = P().depenses;
    const enc = pro.encaisse(), dep = totalDepenses(), solde = enc - dep;
    const sansPiece = tout.filter((d) => !d.justif).length;
    const du = dateParam(p.du), au = dateParam(p.au), q = u.norm(recherche.depenses);
    const L = tout.filter((d) => (!p.cat || d.cat === p.cat) && (!p.justif || (p.justif === 'sans' ? !d.justif : !!d.justif)) && (!du || d.date >= du) && (!au || d.date <= au)
      && (!q || u.norm(`${d.libelle} ${d.fournisseur || ''} ${d.justif || ''} ${d.cat}`).includes(q))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const postes = [...new Set([...C.CAT_DEP, ...tout.map((d) => d.cat)])].map((c) => [c, somme(tout.filter((d) => d.cat === c))]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...postes.map(([, v]) => v));
    const T = 'fin-depenses';
    const filtre = !!(p.cat || p.justif || du || au || recherche.depenses);
    const filtres = html`${champRecherche('depenses', T, 'Libellé, fournisseur, pièce…')}
      ${filtreChoix(R_DEP, T, 'cat', [...new Set([...C.CAT_DEP, ...tout.map((d) => d.cat)])], p.cat, 'Tous les postes', 'Poste de dépense')}
      ${filtreChoix(R_DEP, T, 'justif', [['avec', 'Avec justificatif'], ['sans', 'Sans justificatif']], p.justif, 'Toutes les pièces', 'Justificatif')}
      ${filtreDate(R_DEP, T, 'du', du, 'Dépenses à partir du')}${filtreDate(R_DEP, T, 'au', au, 'Dépenses jusqu’au')}
      ${filtre ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="fin-effacer" data-route="${R_DEP}" data-cle="depenses">${ic('x')}Effacer les filtres</button>` : ''}`;
    return html`${ui.pageTete('Dépenses', 'Dépenses de l’école (fonds COGES, subventions) avec leur pièce justificative. Le journal de caisse s’imprime pour l’assemblée générale.',
      html`<button type="button" class="btn" data-action="fin-journal">${ic('print')}Journal de caisse</button><button type="button" class="btn btn-pri" data-action="fin-depense-nouvelle">${ic('plus')}Nouvelle dépense</button>`)}
      <div class="grille g4 mb">
        ${ui.kpi({ lien: R_PAIE + '?vue=historique', icone: 'coin', lib: 'Recettes', val: u.fcfa(enc), sous: 'versements des parents (reçus valides)', ton: 'acc' })}
        ${ui.kpi({ icone: 'list', lib: 'Dépenses', val: u.fcfa(dep), sous: u.pluriel(tout.length, 'opération') })}
        ${ui.kpi({ icone: solde < 0 ? 'warn' : 'database', lib: 'Solde', val: u.fcfa(solde), sous: solde < 0 ? 'déficit : dépenses supérieures aux recettes' : 'disponible en caisse', ton: solde < 0 ? 'mauvais' : '' })}
        ${ui.kpi({ lien: sansPiece ? R_DEP + '?justif=sans' : null, icone: 'file', lib: 'Sans justificatif', val: sansPiece, sous: sansPiece ? 'pièces à classer' : 'toutes les pièces sont classées', ton: sansPiece ? 'avert' : '' })}</div>
      ${V.periode(du, au) ? ui.encadre(V.periode(du, au), 'avert', 'cal') : ''}
      ${postes.length ? ui.carte('Dépenses par poste', html`<div class="fin-postes">${postes.map(([c, v]) => html`<button type="button" class="fin-poste" data-action="fin-poste" data-cat="${c}" aria-pressed="${p.cat === c}" aria-label="${c} : ${u.fcfa(v)}, ${u.pct(v, dep)} des dépenses. Filtrer sur ce poste."><span class="nom">${c}</span><span class="piste fond" aria-hidden="true"><i class="pri" style="width:${(v / mx) * 100}%"></i></span><span class="val"><b>${u.fcfa(v)}</b> · ${u.pct(v, dep)}</span></button>`)}</div>`, { sous: 'Cliquez sur un poste pour n’afficher que ses dépenses.', cls: 'mb' }) : ''}
      ${ui.tableau({
        id: T, lignes: L, filtres, unite: 'dépense', parPage: 50, exporter: 'depenses', legende: 'Dépenses de l’école',
        colonnes: [
          { cle: 'date', lib: 'Date', tri: (d) => d.date, rendu: (d) => u.fmtDate(d.date), csv: (d) => d.date },
          { cle: 'libelle', lib: 'Libellé', cls: 'texte', tri: (d) => d.libelle, rendu: (d) => html`<b>${d.libelle}</b>${d.fournisseur ? html`<br><span class="mut petit">${d.fournisseur}</span>` : ''}`, csv: (d) => d.libelle },
          { cle: 'fournisseur', lib: 'Fournisseur', cache: true, csv: (d) => d.fournisseur || '' },
          { cle: 'cat', lib: 'Poste', tri: (d) => d.cat, rendu: (d) => ui.tag(d.cat), csv: (d) => d.cat },
          { cle: 'justif', lib: 'Justificatif', tri: (d) => d.justif || '', rendu: (d) => (d.justif ? ui.tag(d.justif, 'ok', 'check') : ui.tag('À fournir', 'avert', 'warn')), csv: (d) => d.justif || 'À fournir' },
          { cle: 'montant', lib: 'Montant', cls: 'r num', tri: (d) => +d.montant, rendu: (d) => html`<b>${u.fcfa(d.montant)}</b>` },
          { cle: 'act', lib: '', cls: 'r', csv: false, rendu: (d) => actionsLigne(html`<button type="button" class="btn-ic" data-action="fin-depense-supprimer" data-id="${d.id}" aria-label="Supprimer la dépense ${d.libelle}" data-bulle="Supprimer (mot de passe)">${ic('trash')}</button>`) }
        ],
        pied: L.length ? html`<tr><td colspan="4">Total (${u.pluriel(L.length, 'dépense')})</td><td class="r num">${u.fcfa(somme(L))}</td><td></td></tr>` : null,
        vide: tout.length ? ui.vide('Aucune dépense', 'Aucune dépense ne correspond à ces filtres.') : ui.vide('Aucune dépense enregistrée', 'Enregistrez chaque achat avec le numéro de la facture ou du reçu.', html`<button type="button" class="btn btn-pri" data-action="fin-depense-nouvelle">${ic('plus')}Nouvelle dépense</button>`)
      })}`;
  }

  function fenetreDepense() {
    AK.perm.exiger('finances.gerer');
    ui.fenetre({
      titre: 'Nouvelle dépense', icone: 'coin', ok: 'Enregistrer la dépense',
      corps: html`<div class="form-grille">
        ${F.texte({ lib: 'Libellé', nom: 'libelle', req: true, plein: true, attrs: { maxlength: 120, placeholder: 'Ex. : achat de craies et de cahiers', autocomplete: 'off', autofocus: true } })}
        ${F.choix({ lib: 'Poste', nom: 'cat', val: C.CAT_DEP[0], options: C.CAT_DEP, req: true })}
        ${F.nombre({ lib: 'Montant (F CFA)', nom: 'montant', req: true, attrs: { min: 1, max: 100000000, step: 5, inputmode: 'numeric' } })}
        ${F.date({ lib: 'Date', nom: 'date', val: u.aujourdhui(), req: true, attrs: { max: u.aujourdhui() } })}
        ${F.texte({ lib: 'Fournisseur', nom: 'fournisseur', attrs: { maxlength: 80, placeholder: 'Facultatif', autocomplete: 'off' } })}
        ${F.texte({ lib: 'N° de facture ou de reçu', nom: 'justif', plein: true, attrs: { maxlength: 60, placeholder: 'Laisser vide si la pièce n’est pas encore fournie', autocomplete: 'off' }, aide: 'Une dépense sans pièce justificative est signalée « À fournir ».' })}
      </div>`,
      async surValider(d) {
        if (!String(d.libelle || '').trim()) throw E('Libellé : à renseigner.', 'libelle');
        const montant = lireMontant(d.montant, 'Montant', 'montant');
        const lib = u.norm(d.libelle);
        const double = P().depenses.find((x) => u.norm(x.libelle) === lib && +x.montant === montant && x.date === d.date);
        if (double && !(await ui.confirmer({ titre: 'Dépense déjà enregistrée ?', icone: 'warn', ok: 'Enregistrer quand même', annuler: 'Revenir à la saisie',
          message: html`<p class="mb0">Une dépense identique existe déjà : « <b>${double.libelle}</b> », ${u.fcfa(double.montant)} le ${u.fmtDate(double.date)}. S’agit-il d’une autre dépense ?</p>` }))) return false;
        AK.pro.depense({ ...d, montant });
        ui.toast(`Dépense enregistrée : ${u.fcfa(montant)}.`);
      }
    });
  }

  async function supprimerDepense(d) {
    AK.perm.exiger('finances.gerer');
    const ok = await ui.confirmer({
      titre: 'Supprimer une dépense', danger: true, ok: 'Supprimer la dépense',
      message: html`<p>Supprimer « <b>${d.libelle}</b> » (${u.fcfa(d.montant)}, ${u.fmtDate(d.date)}) ?</p><p class="mb0">La suppression est inscrite au journal des opérations ; vous pourrez la rétablir juste après si c’est une erreur.</p>`
    });
    if (!ok) return;
    if (!(await AK.auth.confirmer(`Supprimer la dépense « ${d.libelle} » (${u.fcfa(d.montant)}).`))) return;
    const copie = { libelle: d.libelle, cat: d.cat, montant: d.montant, date: d.date, fournisseur: d.fournisseur, justif: d.justif };
    AK.pro.supprimerDepense(d.id);
    ui.toast('Dépense supprimée.', { action: { lib: 'Rétablir', f: appel(() => {
      AK.pro.depense(copie);
      ui.toast('Dépense rétablie.');
    }) } });
  }

  /* =====================================================================================
     Cantine
     ===================================================================================== */
  function rendreCantine(p) {
    const x = X(), Ca = P().cantine, auj = u.aujourdhui(), classes = x.niveaux();
    const c = classes.includes(p.classe) ? p.classe : classes[0] || '';
    const A = x.actifs(), inscrits = A.filter((s) => Ca.inscrits[s.id]);
    const jour = x.estJourClasse(auj), abs = S().att[auj] || {};
    const prevus = inscrits.filter((s) => !abs[s.id]).length;
    const jours = Object.entries(Ca.repas).filter(([, n]) => +n >= 0).sort((a, b) => b[0].localeCompare(a[0]));
    const servis = jours.reduce((a, [, n]) => a + (+n || 0), 0), valide = Ca.repas[auj];
    const sansAppel = jour ? classes.filter((k) => !(S().appel[auj] || {})[k] && inscrits.some((s) => s.classe === k)) : [];
    const L = c ? x.actifsDe(c).sort(x.parNom) : [];
    const nIns = (k) => x.actifsDe(k).filter((s) => Ca.inscrits[s.id]).length;
    const insClasse = L.filter((s) => Ca.inscrits[s.id]).length;
    return html`${ui.pageTete('Cantine scolaire', 'Élèves inscrits, prix du repas, menu de la semaine et repas du jour (inscrits présents d’après l’appel).',
      html`<button type="button" class="btn" data-action="fin-cantine-prix">${ic('coin')}Prix du repas : ${u.fcfa(Ca.prix)}</button>${jour ? html`<button type="button" class="btn btn-pri" data-action="fin-cantine-jour">${ic('check')}${valide != null ? 'Mettre à jour les repas du jour' : 'Valider les repas du jour'}</button>` : ''}`)}
      <div class="grille g4 mb">
        ${ui.kpi({ icone: 'users', lib: 'Inscrits', val: inscrits.length, sous: `${u.pct(inscrits.length, A.length)} des élèves` })}
        ${ui.kpi({ icone: 'food', lib: 'Repas aujourd’hui', val: jour ? prevus : '—', sous: !jour ? 'pas de classe aujourd’hui' : valide != null ? `${u.pluriel(valide, 'repas validé', 'repas validés')} · inscrits présents` : 'inscrits présents, à valider', ton: jour && valide == null && prevus ? 'avert' : '' })}
        ${ui.kpi({ icone: 'cal', lib: 'Repas servis', val: servis, sous: `depuis la rentrée · ${u.pluriel(jours.length, 'jour')}` })}
        ${ui.kpi({ icone: 'coin', lib: 'Valeur servie', val: u.fcfa(servis * Ca.prix), sous: 'au prix actuel du repas', ton: 'acc' })}</div>
      ${!jour ? ui.encadre('Aujourd’hui n’est pas un jour de classe (lundi, mardi, jeudi et vendredi, hors congés) : aucun repas à valider.', 'info', 'cal') : sansAppel.length ? ui.encadre(html`Appel du jour non fait en ${sansAppel.join(', ')} : les inscrits de ${sansAppel.length > 1 ? 'ces classes' : 'cette classe'} seront comptés présents. <a href="#absences/appel?classe=${sansAppel[0]}">Faire l’appel</a>.`, 'avert', 'clip') : ''}
      <div class="grille g-2-1 mt">
        <section class="pile-sm" aria-label="Inscriptions à la cantine">
          ${classes.length ? html`<div class="barre-outils">${ui.pilules(classes.map((k) => [k, k, html` <span class="mut petit">(${nIns(k)})</span>`]), c, 'fin-cantine-classe')}<span class="espace"></span>
            ${L.length && insClasse < L.length ? html`<button type="button" class="btn btn-sm" data-action="fin-cantine-tous" data-classe="${c}">${ic('userCheck')}Inscrire toute la classe</button>` : ''}
            ${insClasse ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="fin-cantine-aucun" data-classe="${c}">${ic('x')}Désinscrire la classe</button>` : ''}</div>` : ''}
          ${L.length ? html`<div class="tab-cadre"><table class="tab" aria-label="Cantine : élèves de ${c}"><thead><tr><th>Élève</th><th class="c">Inscrit</th><th>Aujourd’hui</th></tr></thead><tbody>${L.map((s) => {
            const ins = !!Ca.inscrits[s.id];
            return html`<tr><td>${ui.quiEleve(s)}</td><td class="c"><input type="checkbox" id="fin-cant-${s.id}" data-change="fin-cantine-inscrire" data-id="${s.id}" aria-label="Inscrit(e) à la cantine : ${x.nomComplet(s)}"${ins ? u.raw(' checked') : ''}></td><td>${!ins ? html`<span class="mut">Non inscrit</span>` : !jour ? html`<span class="mut">—</span>` : abs[s.id] ? ui.tag('Absent', 'avert', 'x') : ui.tag('Repas', 'ok', 'check')}</td></tr>`;
          })}</tbody><tfoot><tr><td>${u.pluriel(insClasse, 'inscrit')} sur ${L.length}</td><td></td><td>${jour ? `${L.filter((s) => Ca.inscrits[s.id] && !abs[s.id]).length} repas` : ''}</td></tr></tfoot></table></div>`
            : ui.vide('Aucun élève inscrit', c ? `Aucun élève inscrit en ${c}.` : 'Aucun niveau ouvert dans l’école.')}
        </section>
        <div class="pile">
          ${ui.carte('Menu de la semaine', html`<div class="pile-sm">${Ca.menu.map((m, i) => F.texte({ lib: m.j, nom: 'menu' + i, id: 'fin-menu-' + i, val: m.p, attrs: { 'data-change': 'fin-cantine-menu', 'data-i': i, maxlength: 80, placeholder: 'Plat du jour', autocomplete: 'off' } }))}<p class="mut petit mb0" id="fin-menu-etat" role="status">Chaque plat est enregistré dès que vous quittez la case.</p></div>`)}
          ${ui.carte('Repas validés', jours.length ? html`<div class="liste">${jours.slice(0, 8).map(([d, n]) => html`<div><span class="dt"><b>${d.slice(8)}</b>${C.MOIS[+d.slice(5, 7) - 1].slice(0, 4)}</span><span class="flex1">${u.fmtJour(d)}</span><span class="m"><b>${u.pluriel(+n, 'repas')}</b> · ${u.fcfa(+n * Ca.prix)}</span></div>`)}</div>${jours.length > 8 ? html`<p class="mut petit mb0">… et ${u.pluriel(jours.length - 8, 'autre jour')} (export complet ci-dessus).</p>` : ''}` : html`<p class="mut mb0">Aucun repas validé pour l’instant.</p>`, { sous: 'Valeur au prix actuel du repas', actions: jours.length ? html`<button type="button" class="btn btn-sm" data-action="fin-cantine-csv">${ic('down')}Excel (CSV)</button>` : '' })}
        </div></div>`;
  }

  /* ---------- Écrans ---------- */
  AK.ecrans.def(R_PAIE, { rendu: rendrePaiements, apres: apresPaiements, droit: 'finances.gerer' });
  AK.ecrans.def(R_DEP, { rendu: rendreDepenses, droit: 'finances.gerer' });
  AK.ecrans.def(R_CANT, { rendu: rendreCantine, droit: 'finances.gerer' });

  /* ---------- Actions ---------- */
  const recuDe = (el) => {
    const r = P().paiements.find((x) => x.id === el.dataset.id);
    if (!r) throw E('Reçu introuvable.');
    return r;
  };
  const sansParams = (p, ...cles) => Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== '' && v != null && !cles.includes(k)));
  const minuteries = {};
  AK.actions.def({
    'fin-vue'(el) {
      const p = AK.shell.params();
      AK.shell.aller(R_PAIE, sansParams({ eleve: p.eleve, classe: p.classe, vue: el.dataset.v === 'situation' ? '' : el.dataset.v }));
    },
    'fin-effacer'(el) {
      recherche[el.dataset.cle] = '';
      const p = AK.shell.params();
      AK.shell.aller(el.dataset.route, sansParams({ eleve: p.eleve, vue: el.dataset.vue || '' }));
    },
    'fin-encaisser': (el) => fenetreEncaisser(el.dataset.id || ''),
    'fin-situation': (el) => AK.shell.aller(R_PAIE, { ...sansParams(AK.shell.params()), eleve: el.dataset.id }),
    'fin-situation-fermer': () => AK.shell.aller(R_PAIE, sansParams(AK.shell.params(), 'eleve')),
    'fin-rappel'(el) {
      const s = eleveDe(el.dataset.id);
      if (!s) throw E('Élève introuvable (peut-être supprimé).');
      fenetreRappel(s);
    },
    'fin-recu-imprimer': (el) => imprimerRecu(recuDe(el), papierRecu()),
    'fin-recu-annuler': (el) => fenetreAnnuler(recuDe(el)),
    'fin-frais': () => fenetreFrais(),
    'fin-journal': () => imprimerJournal(),
    'fin-depense-nouvelle': () => fenetreDepense(),
    'fin-depense-supprimer'(el) {
      const d = P().depenses.find((x) => x.id === el.dataset.id);
      if (!d) throw E('Dépense introuvable (peut-être déjà supprimée).');
      return supprimerDepense(d);
    },
    'fin-poste'(el) {
      const p = AK.shell.params();
      ui.tableauEtat('fin-depenses').page = 1;
      AK.shell.aller(R_DEP, sansParams({ ...p, cat: p.cat === el.dataset.cat ? '' : el.dataset.cat }));
    },
    'fin-cantine-classe': (el) => AK.shell.aller(R_CANT, { classe: el.dataset.v }),
    'fin-cantine-tous'(el) {
      const c = el.dataset.classe;
      if (V.classe(c, X().niveaux())) throw E(V.classe(c, X().niveaux()));
      AK.pro.cantineTous(c);
      ui.toast(`Toute la classe ${c} est inscrite à la cantine.`);
    },
    async 'fin-cantine-aucun'(el) {
      const c = el.dataset.classe;
      if (!(await ui.confirmer({ titre: 'Désinscrire la classe', ok: 'Désinscrire', message: `Retirer de la cantine tous les élèves de ${c} ? Les repas déjà validés restent comptés.` }))) return;
      const n = AK.cantine.desinscrireClasse(c);
      ui.toast(`${u.pluriel(n, 'élève désinscrit', 'élèves désinscrits')} de la cantine (${c}).`);
    },
    'fin-cantine-prix'() {
      AK.perm.exiger('finances.gerer');
      ui.fenetre({
        titre: 'Prix du repas', icone: 'coin', taille: 'sm', ok: 'Enregistrer',
        corps: html`<div class="pile">${F.nombre({ lib: 'Prix d’un repas (F CFA)', nom: 'prix', val: P().cantine.prix, req: true, attrs: { min: 0, max: 100000, step: 5, inputmode: 'numeric', autofocus: true }, aide: '0 si la cantine est gratuite (dotation de l’État, du PAM…). Sert au calcul de la valeur des repas servis.' })}</div>`,
        surValider(d) {
          if (!String(d.prix ?? '').trim()) throw E('Prix du repas : à renseigner (0 si gratuit).', 'prix');
          const n = lireMontantNul(d.prix, 'Prix du repas', 'prix', 100000);
          AK.pro.cantinePrix(n);
          ui.toast(`Prix du repas : ${u.fcfa(n)}.`);
        }
      });
    },
    async 'fin-cantine-jour'() {
      const auj = u.aujourdhui(), classes = X().niveaux();
      const manquent = classes.filter((k) => !(S().appel[auj] || {})[k] && X().actifsDe(k).some((s) => P().cantine.inscrits[s.id]));
      if (manquent.length && !(await ui.confirmer({ titre: 'Appel du jour incomplet', icone: 'clip', ok: 'Valider quand même', annuler: 'Faire l’appel d’abord',
        message: `L’appel n’est pas fait en ${manquent.join(', ')} : les inscrits de ${manquent.length > 1 ? 'ces classes' : 'cette classe'} seront comptés présents. Vous pourrez mettre à jour le nombre de repas après l’appel.` }))) return;
      const n = AK.pro.cantineJour();
      ui.toast(`${u.pluriel(n, 'repas enregistré', 'repas enregistrés')} pour le ${u.fmtDate(auj)}.`);
    },
    async 'fin-cantine-csv'() {
      const Ca = P().cantine;
      const lignes = [['Date', 'Repas', 'Prix actuel du repas (F)', 'Valeur au prix actuel (F)'], ...Object.entries(Ca.repas).sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => [d, +n || 0, Ca.prix, (+n || 0) * Ca.prix])];
      await AK.sauvegarde.csv(`cantine-repas-${u.aujourdhui()}.csv`, lignes, 'repas de la cantine');
      ui.toast('Fichier Excel (CSV) enregistré.');
    }
  });
  AK.actions.defChange({
    'fin-filtre'(el) {
      const p = { ...AK.shell.params(), [el.dataset.f]: el.value };
      if (el.dataset.tab) ui.tableauEtat(el.dataset.tab).page = 1;
      AK.shell.aller(el.dataset.route, sansParams(p));
    },
    'fin-recu-papier'(el) {
      retenirPapier(el.value);
      ui.toast(`Les reçus s’ouvriront au format ${el.value === 'A4' ? 'A4' : 'A5'} sur ce poste.`);
    },
    'fin-cantine-inscrire'(el) {
      try {
        AK.cantine.inscrire(el.dataset.id, el.checked);
      } catch (err) {
        el.checked = !el.checked;
        throw err;
      }
    },
    'fin-cantine-menu'(el) {
      AK.cantine.plat(el.dataset.i, el.value);
      el.value = P().cantine.menu[Number(el.dataset.i)].p;
      const etat = document.getElementById('fin-menu-etat');
      if (etat) etat.textContent = `Menu enregistré (${P().cantine.menu[Number(el.dataset.i)].j}).`;
    }
  });
  AK.actions.defSaisie({
    'fin-recherche'(el) {
      const cle = el.dataset.cle;
      if (!(cle in recherche)) return;
      recherche[cle] = el.value;
      if (el.dataset.tab) ui.tableauEtat(el.dataset.tab).page = 1;
      clearTimeout(minuteries[cle]);
      minuteries[cle] = setTimeout(() => AK.shell.redessiner(), 180);
    }
  });

  AK.ecransFinances = { fenetreEncaisser, imprimerRecu, imprimerJournal };
})(window.AK);
