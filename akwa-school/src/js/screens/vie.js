/* =====================================================================================
   Vie scolaire : emploi du temps de chaque classe (saisie case par case, modèle type,
   volume horaire), cahier de textes (séances, filtres par période et discipline), registre
   de discipline (faits, sanctions, suivi, convocation des parents), infirmerie (passages et
   soins : données de santé confidentielles) et calendrier de l'école (vue mois, vue liste,
   export iCalendar). Les congés et jours fériés viennent de Paramètres › Calendrier.

   Les droits sont vérifiés par les fonctions métier (AK.pro, et AK.vie ci-dessous pour les
   opérations qui manquaient) : masquer un bouton n'est qu'un confort d'affichage.
   Un enseignant ne voit que sa classe ; la suppression est réservée au directeur.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const P = () => S().pro;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const E = (m, champ) => new AK.ErreurMetier(m, champ);

  /* ---------- Outils communs ---------- */
  const classeDe = (p) => {
    const L = AK.session.classes();
    return L.includes(p.classe) ? p.classe : L[0] || null;
  };
  const eleve = (sid) => AK.eleves.trouver(sid);
  const nomDe = (sid) => {
    const s = eleve(sid);
    return s ? X().nomComplet(s) : 'Élève supprimé';
  };
  /** Le directeur voit tout (y compris les élèves supprimés) ; l'enseignant, sa classe. */
  const visibleSid = (sid) => {
    if (AK.session.estDirecteur()) return true;
    const s = eleve(sid);
    return !!s && AK.session.classes().includes(s.classe);
  };
  const classeEleve = (sid) => (eleve(sid) || {}).classe || '';
  const exigerClasse = (c) => {
    if (!AK.session.classes().includes(c)) throw new AK.ErreurDroits('Cette classe ne vous est pas affectée.');
  };
  const quiDe = (sid) => {
    const s = eleve(sid);
    return s ? ui.quiEleve(s) : html`<span class="mut">Élève supprimé</span>`;
  };
  const jourSemaine = (d) => u.parseISO(d).toLocaleDateString('fr-FR', { weekday: 'long' });
  const dateJour = (d) => u.parseISO(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  /** Action d'une notification (« Annuler ») : une erreur s'affiche au lieu d'échapper. */
  const secu = (f) => () => {
    try {
      const r = f();
      if (r && r.catch) r.catch((e) => ui.erreur(e));
    } catch (e) {
      ui.erreur(e);
    }
  };
  /** Va vers l'écran en retirant les paramètres vides de l'adresse. */
  const allerPropre = (route, p) => {
    const q = { ...p };
    Object.keys(q).forEach((k) => (q[k] === '' || q[k] == null) && delete q[k]);
    AK.shell.aller(route, q);
  };
  const filtrer = (route, p, cle, valeur, idTableau) => {
    if (idTableau) ui.tableauEtat(idTableau).page = 1;
    allerPropre(route, { ...p, [cle]: valeur });
  };
  const choixFiltre = (action, f, valeur, options, vide, lib) =>
    html`<select class="inp inp-sm" data-change="${action}" data-f="${f}" aria-label="${lib}">${ui.options(options, valeur || '', vide)}</select>`;

  /* Disciplines proposées : matières de la grille + activités de l'emploi du temps */
  const EXTRAS = ['ANGLAIS', 'EPS', 'ACTIVITES DIRIGEES', 'RECREATION'];
  const disciplines = (c, avecRecreation) => [...new Set([...X().matieres(c, 1).map(([m]) => m), ...EXTRAS.filter((m) => avecRecreation || m !== 'RECREATION')])];

  /* Sélection d'un élève : classe puis élève (seulement les classes visibles) */
  function optionsEleves(classe, sel) {
    const cls = classe ? [classe] : AK.session.classes();
    return html`<option value="">Choisir l’élève…</option>${cls.map((c) => {
      const L = X().actifsDe(c).sort(X().parNom);
      const opts = L.map((s) => html`<option value="${s.id}"${s.id === sel ? raw(' selected') : ''}>${X().nomComplet(s)} · ${X().matOf(s)}</option>`);
      return L.length ? (classe ? opts : html`<optgroup label="${c}">${opts}</optgroup>`) : '';
    })}`;
  }
  function champsEleve(classe) {
    const cls = AK.session.classes();
    const c0 = cls.includes(classe) ? classe : cls.length === 1 ? cls[0] : '';
    return html`${F.choix({ lib: 'Classe', nom: 'classe', id: 'vie-f-classe', val: c0, options: cls, vide: cls.length > 1 ? 'Toutes les classes' : null })}
      <div class="champ"><label for="vie-f-sid">Élève<span class="req" aria-hidden="true">*</span></label><select class="inp" id="vie-f-sid" name="sid" required>${optionsEleves(c0, '')}</select></div>`;
  }
  function brancherEleve(racine, surChoix) {
    const f = $('form', racine), c = f.elements.classe, s = f.elements.sid;
    c.addEventListener('change', () => {
      u.poser(s, optionsEleves(c.value, s.value));
      if (surChoix) surChoix(s.value);
    });
    if (surChoix) {
      s.addEventListener('change', () => surChoix(s.value));
      surChoix(s.value);
    }
  }
  const confirmerDoublon = (titre, message) => ui.confirmer({ titre, message, ok: 'Enregistrer quand même', annuler: 'Revenir à la saisie' });

  /* ---------- Fonctions métier manquantes (droits vérifiés AVANT toute modification) ---------- */
  const CLE_EDT = new RegExp('^(' + C.JOURS_EDT.map(([d]) => d).join('|') + ')\\|(\\d+)$');
  const TYPES_EV = [['acc', 'Réunion, activité'], ['w', 'Évaluation'], ['g', 'Congé, jour férié'], ['b', 'Inspection, visite']];
  const libType = (k) => (TYPES_EV.find((t) => t[0] === k) || TYPES_EV[0])[1];
  const vie = {
    /** Vide la grille d'une classe (annulable : voir restaurerEdt). */
    viderEdt(classe) {
      AK.perm.exiger('vie.utiliser', { classe });
      if (!X().niveaux().includes(classe)) throw E('Classe inconnue.');
      AK.store.modifier('Emploi du temps vidé : ' + classe, () => (P().edt[classe] = {}));
    },
    /** Rétablit une grille (annulation d'un « vider » ou d'un modèle type). */
    restaurerEdt(classe, grille) {
      AK.perm.exiger('vie.utiliser', { classe });
      if (!X().niveaux().includes(classe)) throw E('Classe inconnue.');
      const G = {};
      Object.entries(grille || {}).forEach(([k, v]) => {
        const m = String(k).match(CLE_EDT);
        if (!m || Number(m[2]) >= C.CRENEAUX.length) throw E('Grille d’emploi du temps invalide.');
        const t = String(v || '').trim().slice(0, 40);
        if (t) G[k] = t;
      });
      AK.store.modifier('Emploi du temps rétabli : ' + classe, () => (P().edt[classe] = G));
    },
    /** Rouvre un fait de discipline clos par erreur. */
    rouvrirIncident(id) {
      const x = P().incidents.find((o) => o.id === id);
      if (!x) throw E('Fait de discipline introuvable.');
      const s = eleve(x.sid);
      if (!s) AK.perm.exiger('vie.supprimer'); // élève supprimé : directeur seulement
      else AK.perm.exiger('vie.utiliser', { classe: s.classe });
      if (x.statut !== 'Traité') return;
      AK.store.modifier('Fait de discipline rouvert', () => (x.statut = 'En cours'));
    },
    /** Modification d'un événement : mêmes droits que la suppression (directeur). */
    modifierEvenement(id, d) {
      AK.perm.exiger('vie.supprimer');
      const ev = P().events.find((e) => e.id === id);
      if (!ev) throw E('Événement introuvable.');
      const e = V.date(d.date, 'Date', { requise: true });
      if (e) throw E(e, 'date');
      const titre = String(d.titre || '').trim();
      const et = V.texte(titre, 'Intitulé', { requis: true, max: 100 });
      if (et) throw E(et, 'titre');
      const type = TYPES_EV.some(([k]) => k === d.type) ? d.type : 'acc';
      AK.store.modifier('Événement modifié : ' + titre, () => Object.assign(ev, { date: d.date, type, titre }));
    }
  };
  AK.vie = vie;

  /* ==================================================================================
     Emploi du temps
     ================================================================================== */
  const AUTRE = '__autre__';
  /** Durée d'un créneau « 07 h 30 – 08 h 30 » en minutes. */
  const dureeCreneau = (h) => {
    const m = String(h).match(/(\d+)\s*h\s*(\d+)\D+(\d+)\s*h\s*(\d+)/);
    return m ? Number(m[3]) * 60 + Number(m[4]) - (Number(m[1]) * 60 + Number(m[2])) : 0;
  };
  const fmtDuree = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h${m ? ' ' + u.pad(m) : ''}` : `${m} min`;
  };
  const remplies = (c) => Object.values(P().edt[c] || {}).filter(Boolean).length;

  function rendreEdt(p) {
    const c = classeDe(p);
    if (!c) return html`${ui.pageTete('Emploi du temps')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée. Le directeur affecte les classes dans Personnel.')}`;
    const x = X(), G = P().edt[c] || {}, t = x.enseignantDe(c);
    const mats = [...new Set([...disciplines(c, true), ...Object.values(G).filter(Boolean)])];
    const total = C.JOURS_EDT.length * C.CRENEAUX.length, n = remplies(c);
    const classes = AK.session.classes();
    const pil = ui.pilules(classes.map((k) => [k, k, remplies(k) ? raw('<span class="pt" aria-hidden="true"></span>') : '']), c, 'vie-edt-classe');
    const actions = html`<button type="button" class="btn" data-action="vie-edt-type" data-classe="${c}">${ic('grid')}Emploi du temps type</button>
      ${n ? html`<button type="button" class="btn" data-action="vie-edt-vider" data-classe="${c}">${ic('trash')}Vider la grille</button>` : ''}
      ${classes.length > 1 ? html`<button type="button" class="btn" data-action="vie-edt-imprimer-tout">${ic('print')}Toutes les classes</button>` : ''}
      <button type="button" class="btn btn-pri" data-action="vie-edt-imprimer" data-classe="${c}">${ic('print')}Imprimer</button>`;
    const cellule = (d, jour, i, h) => {
      const k = d + '|' + i, v = G[k] || '';
      return html`<td><select class="${v ? 'plein' : ''}" id="edt-${d}-${i}" data-change="vie-edt-case" data-classe="${c}" data-k="${k}" data-avant="${v}" aria-label="${jour}, ${h}">${ui.options(mats, v, '—')}<option value="${AUTRE}">Autre discipline…</option></select></td>`;
    };
    // volume horaire hebdomadaire par discipline
    const vol = {};
    Object.entries(G).forEach(([k, m]) => {
      if (!m) return;
      const i = Number(k.split('|')[1]);
      vol[m] = vol[m] || { n: 0, min: 0 };
      vol[m].n++;
      vol[m].min += dureeCreneau(C.CRENEAUX[i]);
    });
    const lignesVol = Object.entries(vol).sort((a, b) => b[1].min - a[1].min || a[0].localeCompare(b[0], 'fr'));
    const enseignement = lignesVol.filter(([m]) => m !== 'RECREATION').reduce((a, [, v]) => a + v.min, 0);
    return html`${ui.pageTete('Emploi du temps', 'Grille hebdomadaire de chaque classe : lundi, mardi, jeudi et vendredi (le mercredi n’est pas un jour de classe). Chaque case est enregistrée dès qu’elle est choisie.', actions)}
      <div class="barre-outils">${pil}<span class="puce">${ic('user')}${t ? 'Titulaire : ' + t.nom : 'Aucun titulaire'}</span><span class="puce" id="vie-edt-compte" role="status">${n} créneau(x) rempli(s) sur ${total}</span></div>
      <div class="tab-cadre"><table class="tab edt" aria-label="Emploi du temps ${c}"><thead><tr><th scope="col">Horaire</th>${C.JOURS_EDT.map(([, j]) => html`<th scope="col">${j}</th>`)}</tr></thead>
        <tbody>${C.CRENEAUX.map((h, i) => html`<tr><th scope="row">${h}</th>${C.JOURS_EDT.map(([d, j]) => cellule(d, j, i, h))}</tr>`)}</tbody></table></div>
      <p class="mut petit vie-note">« Autre discipline… » permet d’inscrire une activité absente de la liste (40 caractères au plus). « Emploi du temps type » propose une grille à partir des matières de la classe.</p>
      ${ui.carte('Volume horaire hebdomadaire', lignesVol.length ? html`<div class="liste">${lignesVol.map(([m, v]) => html`<div><span class="flex1">${m === 'RECREATION' ? html`<span class="mut">${m}</span>` : html`<b>${m}</b>`}</span><span class="m">${u.pluriel(v.n, 'créneau', 'créneaux')} · <b>${fmtDuree(v.min)}</b></span></div>`)}</div>` : html`<p class="mut mb0">Aucune case remplie pour l’instant.</p>`, { sous: `Temps d’enseignement (hors récréation) : ${fmtDuree(enseignement)} par semaine` })}`;
  }

  /** Saisie d'une discipline libre (« Autre discipline… ») ; renvoie le texte ou null. */
  function saisirAutre(classe, k) {
    return new Promise((resolve) => {
      let res = null;
      const [d, i] = k.split('|');
      const jour = (C.JOURS_EDT.find((j) => j[0] === d) || [, ''])[1];
      ui.fenetre({
        titre: 'Autre discipline', icone: 'edit', taille: 'sm', ok: 'Inscrire', proteger: false,
        corps: html`<div class="pile"><p class="mut petit mb0">${classe} · ${jour}, ${C.CRENEAUX[Number(i)] || ''}</p>${F.texte({ lib: 'Discipline ou activité', nom: 'lib', id: 'vie-edt-autre', req: true, attrs: { maxlength: 40, autocomplete: 'off', placeholder: 'Ex. : LECTURE SILENCIEUSE' } })}</div>`,
        surValider(dn) {
          const v = String(dn.lib || '').trim().replace(/\s+/g, ' ').toUpperCase();
          if (!v) throw E('Saisissez la discipline ou l’activité.', 'lib');
          if (v.length > 40) throw E('40 caractères au maximum.', 'lib');
          res = v;
        },
        surFermer: () => resolve(res)
      });
    });
  }

  /* ==================================================================================
     Cahier de textes
     ================================================================================== */
  const PERIODES = [['', 'Toute l’année'], ['semaine', 'Cette semaine'], ['mois', 'Ce mois-ci'], ['perso', 'Dates choisies…']];
  function bornes(p) {
    const auj = u.aujourdhui();
    if (p.per === 'semaine') {
      const lundi = u.ajouterJours(auj, -((u.parseISO(auj).getDay() + 6) % 7));
      return { du: lundi, au: u.ajouterJours(lundi, 6) };
    }
    if (p.per === 'mois') {
      const [y, m] = auj.split('-').map(Number);
      return { du: auj.slice(0, 7) + '-01', au: u.iso(new Date(y, m, 0)) };
    }
    if (p.per === 'perso') return { du: u.estISO(p.du) ? p.du : '', au: u.estISO(p.au) ? p.au : '' };
    return { du: '', au: '' };
  }

  function rendreCahier(p) {
    const c = classeDe(p);
    if (!c) return html`${ui.pageTete('Cahier de textes')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const { du, au } = bornes(p);
    const tous = P().cahier.filter((x) => x.classe === c);
    const L = tous.filter((x) => (!du || x.date >= du) && (!au || x.date <= au) && (!p.mat || x.mat === p.mat)).sort((a, b) => b.date.localeCompare(a.date) || a.mat.localeCompare(b.mat, 'fr'));
    const derniere = tous.reduce((m, x) => (x.date > m ? x.date : m), '');
    const mats = [...new Set([...disciplines(c, false), ...tous.map((x) => x.mat)])];
    const incoherent = du && au && au < du;
    const filtres = html`${choixFiltre('vie-cahier-filtre', 'per', p.per, PERIODES, null, 'Période')}
      ${p.per === 'perso' ? html`<input class="inp inp-sm" type="date" id="vie-cahier-du" value="${du}" data-change="vie-cahier-filtre" data-f="du" aria-label="Du" style="width:auto"><input class="inp inp-sm" type="date" id="vie-cahier-au" value="${au}" data-change="vie-cahier-filtre" data-f="au" aria-label="Au (inclus)" style="width:auto">` : ''}
      ${choixFiltre('vie-cahier-filtre', 'mat', p.mat, mats, 'Toutes les disciplines', 'Discipline')}`;
    const actions = html`${tous.length ? html`<button type="button" class="btn" data-action="vie-cahier-imprimer" data-classe="${c}">${ic('print')}Imprimer le cahier</button>` : ''}<button type="button" class="btn btn-pri" data-action="vie-seance-nouvelle" data-classe="${c}">${ic('plus')}Nouvelle séance</button>`;
    return html`${ui.pageTete('Cahier de textes', 'Ce qui a été fait en classe et le travail donné aux élèves, séance par séance. L’impression reprend toutes les séances de la classe, dans l’ordre des dates.', actions)}
      <div class="barre-outils">${ui.pilules(AK.session.classes().map((k) => [k, k]), c, 'vie-cahier-classe')}<span class="puce">${ic('book')}${u.pluriel(tous.length, 'séance')} en ${c}${derniere ? ' · dernière le ' + u.fmtDate(derniere) : ''}</span></div>
      ${incoherent ? ui.encadre('La date de fin est avant la date de début : aucune séance ne peut correspondre.', 'avert', 'cal') : ''}
      ${ui.tableau({
        id: 'vie-cahier', lignes: L, unite: 'séance', legende: `Cahier de textes ${c}`, filtres, placeholder: 'Rechercher dans les séances…',
        recherche: (x) => x.mat + ' ' + x.contenu + ' ' + x.travail, exporter: peut('donnees.exporter') ? 'cahier-de-textes' : null,
        colonnes: [
          { cle: 'date', lib: 'Date', tri: (x) => x.date, csv: (x) => u.fmtDate(x.date), rendu: (x) => html`<b>${u.fmtDate(x.date)}</b><br><span class="mut petit">${jourSemaine(x.date)}</span>` },
          { cle: 'mat', lib: 'Discipline', tri: (x) => x.mat, csv: (x) => x.mat, rendu: (x) => ui.tag(x.mat, 'acc') },
          { cle: 'contenu', lib: 'Contenu de la séance', cls: 'texte', csv: (x) => x.contenu, rendu: (x) => html`<span class="vie-texte">${x.contenu}</span>` },
          { cle: 'travail', lib: 'Travail à faire', cls: 'texte', csv: (x) => x.travail, rendu: (x) => (x.travail ? html`<span class="vie-texte">${x.travail}</span>` : html`<span class="mut">—</span>`) },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (x) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap"><button type="button" class="btn-ic" data-action="vie-seance-modifier" data-id="${x.id}" aria-label="Modifier la séance de ${x.mat} du ${u.fmtDate(x.date)}" data-bulle="Modifier">${ic('edit')}</button><button type="button" class="btn-ic dng" data-action="vie-seance-supprimer" data-id="${x.id}" aria-label="Supprimer la séance de ${x.mat} du ${u.fmtDate(x.date)}" data-bulle="Supprimer">${ic('trash')}</button></div>` }
        ],
        vide: tous.length ? ui.vide('Aucune séance', 'Aucune séance ne correspond à ces filtres.') : ui.vide('Cahier vide', `Aucune séance consignée en ${c} pour l’instant.`, html`<button type="button" class="btn btn-pri" data-action="vie-seance-nouvelle" data-classe="${c}">${ic('plus')}Consigner la première séance</button>`)
      })}`;
  }

  function formSeance(x, classe) {
    const cls = AK.session.classes();
    const c = x ? x.classe : cls.includes(classe) ? classe : cls[0];
    const optionsMat = (k, sel) => {
      const L = [...new Set([...disciplines(k, false), ...(sel ? [sel] : [])])];
      return ui.options(L, sel, 'Choisir…');
    };
    ui.fenetre({
      titre: x ? 'Modifier la séance' : 'Nouvelle séance', icone: x ? 'edit' : 'book', ok: x ? 'Enregistrer' : 'Consigner la séance', taille: 'lg',
      corps: html`<div class="form-grille">
        ${F.choix({ lib: 'Classe', nom: 'classe', id: 'vie-s-classe', val: c, options: cls, req: true })}
        ${F.date({ lib: 'Date de la séance', nom: 'date', id: 'vie-s-date', val: x ? x.date : u.aujourdhui(), req: true })}
        <div class="champ plein"><label for="vie-s-mat">Discipline<span class="req" aria-hidden="true">*</span></label><select class="inp" id="vie-s-mat" name="mat" required>${optionsMat(c, x ? x.mat : '')}</select></div>
        ${F.zone({ lib: 'Contenu de la séance', nom: 'contenu', id: 'vie-s-contenu', val: x ? x.contenu : '', req: true, plein: true, lignes: 5, attrs: { maxlength: 1000, placeholder: 'Leçon, objectifs, activités menées…' }, aide: '1 000 caractères au plus.' })}
        ${F.zone({ lib: 'Travail à faire', nom: 'travail', id: 'vie-s-travail', val: x ? x.travail : '', plein: true, lignes: 2, attrs: { maxlength: 300, placeholder: 'Facultatif : exercices, leçon à apprendre…' }, aide: '300 caractères au plus.' })}
      </div>`,
      apres(racine) {
        const f = $('form', racine);
        f.elements.classe.addEventListener('change', () => u.poser(f.elements.mat, optionsMat(f.elements.classe.value, f.elements.mat.value)));
      },
      async surValider(d) {
        if (!cls.includes(d.classe)) throw E('Choisissez la classe.', 'classe');
        if (!d.mat) throw E('Choisissez la discipline.', 'mat');
        const ec = V.texte(d.contenu, 'Contenu de la séance', { requis: true, max: 1000 });
        if (ec) throw E(ec, 'contenu');
        const et = V.texte(d.travail, 'Travail à faire', { max: 300 });
        if (et) throw E(et, 'travail');
        const ed = V.date(d.date, 'Date de la séance', { requise: true });
        if (ed) throw E(ed, 'date');
        const dbl = P().cahier.find((y) => (!x || y.id !== x.id) && y.classe === d.classe && y.date === d.date && y.mat === d.mat);
        if (dbl && !(await confirmerDoublon('Séance déjà consignée', html`Une séance de <b>${d.mat}</b> est déjà consignée le ${u.fmtDate(d.date)} en ${d.classe}. Enregistrer une seconde séance ?`))) return false;
        const o = { classe: d.classe, date: d.date, mat: d.mat, contenu: d.contenu, travail: d.travail };
        if (x) {
          AK.perm.exiger('vie.utiliser', { classe: x.classe }); // la séance d'origine doit être de ma classe
          AK.pro.seance(o, x.id);
        } else AK.pro.seance(o);
        ui.toast(x ? 'Séance modifiée.' : `Séance consignée au cahier de textes (${d.classe}).`);
        const p = AK.shell.params();
        if (AK.shell.routeCourante() === 'vie/cahier' && d.classe !== classeDe(p)) allerPropre('vie/cahier', { ...p, classe: d.classe, mat: '' });
      }
    });
  }

  /* ==================================================================================
     Discipline
     ================================================================================== */
  const incidentsVisibles = () => P().incidents.filter((x) => visibleSid(x.sid));
  const STATUTS_FAIT = [['En cours', 'En cours'], ['Traité', 'Traité']];

  function rendreDiscipline(p) {
    const classes = AK.session.classes();
    if (!classes.length) return html`${ui.pageTete('Discipline')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const auj = u.aujourdhui(), mois = auj.slice(0, 7);
    const tous = incidentsVisibles();
    const cp = classes.includes(p.classe) ? p.classe : '';
    const L = tous.filter((x) => (!p.statut || x.statut === p.statut) && (!cp || classeEleve(x.sid) === cp)).sort((a, b) => b.date.localeCompare(a.date));
    const enCours = tous.filter((x) => x.statut === 'En cours').length;
    const pts = {}, nb = {};
    tous.forEach((x) => {
      pts[x.sid] = (pts[x.sid] || 0) + (Number(x.pts) || 1);
      nb[x.sid] = (nb[x.sid] || 0) + 1;
    });
    const top = Object.entries(pts).sort((a, b) => b[1] - a[1] || nomDe(a[0]).localeCompare(nomDe(b[0]), 'fr')).slice(0, 5);
    const max = Math.max(10, ...top.map(([, n]) => n));
    const dir = peut('vie.supprimer');
    const filtres = html`${classes.length > 1 ? choixFiltre('vie-disc-filtre', 'classe', cp, classes, 'Toutes les classes', 'Classe') : ''}${choixFiltre('vie-disc-filtre', 'statut', p.statut, STATUTS_FAIT, 'Tous les statuts', 'Statut')}`;
    const actionsLigne = (x) => {
      const s = eleve(x.sid), lib = `${x.fait} du ${u.fmtDate(x.date)}${s ? ' (' + X().nomComplet(s) + ')' : ''}`;
      return html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap">
        ${!s && x.statut !== 'Traité' ? '' : x.statut !== 'Traité' ? html`<button type="button" class="btn btn-sm" data-action="vie-incident-clore" data-id="${x.id}" aria-label="Clore : ${lib}">${ic('check')}Clore</button>` : html`<button type="button" class="btn-ic" data-action="vie-incident-rouvrir" data-id="${x.id}" aria-label="Rouvrir : ${lib}" data-bulle="Rouvrir">${ic('refresh')}</button>`}
        ${s ? html`<button type="button" class="btn-ic" data-action="vie-incident-convocation" data-id="${x.id}" aria-label="Convocation des parents : ${lib}" data-bulle="Convocation des parents">${ic('print')}</button>` : ''}
        ${dir ? html`<button type="button" class="btn-ic dng" data-action="vie-incident-supprimer" data-id="${x.id}" aria-label="Supprimer : ${lib}" data-bulle="Supprimer">${ic('trash')}</button>` : ''}</div>`;
    };
    return html`${ui.pageTete('Discipline', 'Registre de discipline : faits constatés, sanctions et suivi. La convocation des parents s’imprime en un clic.', html`<button type="button" class="btn btn-pri" data-action="vie-incident-nouveau" data-classe="${cp}">${ic('plus')}Signaler un fait</button>`)}
      <div class="grille g4 mb vie-kpis">
        ${ui.kpi({ icone: 'cal', lib: 'Faits ce mois-ci', val: tous.filter((x) => x.date.slice(0, 7) === mois).length, sous: classes.length > 1 ? 'toutes classes' : classes[0] })}
        ${ui.kpi({ action: { nom: 'vie-disc-statut', attrs: { 'data-v': 'En cours' } }, icone: 'clock', lib: 'En cours', val: enCours, sous: enCours ? 'à traiter : afficher' : 'aucun fait à traiter', ton: enCours ? 'avert' : '' })}
        ${ui.kpi({ icone: 'mail', lib: 'Convocations', val: tous.filter((x) => /Convocation/.test(x.sanction)).length, sous: 'parents convoqués' })}
        ${ui.kpi({ icone: 'users', lib: 'Élèves concernés', val: new Set(tous.map((x) => x.sid)).size, sous: 'au registre' })}
      </div>
      ${top.length ? ui.carte('Élèves à suivre', html`<div class="liste vie-suivi">${top.map(([sid, n]) => {
        const s = eleve(sid);
        const corps = html`<span class="flex1"><span><b>${nomDe(sid)}</b>${s ? html` <span class="mut petit">${s.classe}</span>` : ''}</span><span class="piste fond" aria-hidden="true"><i class="pri" style="width:${Math.round((n / max) * 100)}%"></i></span></span><span class="m"><b>${n}</b> ${n > 1 ? 'points' : 'point'} · ${u.pluriel(nb[sid], 'fait')}</span>`;
        return s ? html`<button type="button" data-action="fiche-eleve" data-id="${sid}" aria-label="${nomDe(sid)} : ${n} points de conduite, ${u.pluriel(nb[sid], 'fait')}. Ouvrir la fiche.">${corps}</button>` : html`<div>${corps}</div>`;
      })}</div>`, { sous: 'Points de conduite cumulés : 3 pour un fait grave (bagarre, insolence, dégradation, tricherie, objet dangereux), 1 pour les autres.' }) : ''}
      <div class="${top.length ? 'mt' : ''}">${ui.tableau({
        id: 'vie-discipline', lignes: L, unite: 'fait', legende: 'Registre de discipline', filtres, placeholder: 'Élève, fait, sanction…',
        recherche: (x) => nomDe(x.sid) + ' ' + classeEleve(x.sid) + ' ' + x.fait + ' ' + x.detail + ' ' + x.sanction, exporter: peut('donnees.exporter') ? 'discipline' : null,
        colonnes: [
          { cle: 'date', lib: 'Date', tri: (x) => x.date, csv: (x) => u.fmtDate(x.date), rendu: (x) => u.fmtDate(x.date) },
          { cle: 'eleve', lib: 'Élève', tri: (x) => nomDe(x.sid), csv: (x) => `${nomDe(x.sid)} (${classeEleve(x.sid) || '—'})`, rendu: (x) => quiDe(x.sid) },
          { cle: 'fait', lib: 'Fait', cls: 'texte', tri: (x) => x.fait, csv: (x) => x.fait + (x.detail ? ' – ' + x.detail : ''), rendu: (x) => html`${x.fait}${Number(x.pts) >= 3 ? html` ${ui.tag('Grave', 'mauvais', 'warn')}` : ''}${x.detail ? html`<br><span class="mut petit vie-texte">${x.detail}</span>` : ''}` },
          { cle: 'sanction', lib: 'Sanction', cls: 'texte', tri: (x) => x.sanction, csv: (x) => x.sanction, rendu: (x) => x.sanction },
          { cle: 'statut', lib: 'Statut', tri: (x) => x.statut, csv: (x) => x.statut, rendu: (x) => ui.tag(x.statut, x.statut === 'Traité' ? 'ok' : 'avert', x.statut === 'Traité' ? 'check' : 'clock') },
          { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: actionsLigne }
        ],
        vide: tous.length ? ui.vide('Aucun fait', 'Aucun fait ne correspond à ces filtres.') : ui.vide('Registre vide', 'Aucun fait de discipline consigné.')
      })}</div>`;
  }

  function formIncident(classe) {
    ui.fenetre({
      titre: 'Signaler un fait de discipline', icone: 'shield', ok: 'Enregistrer le fait',
      corps: html`<div class="form-grille">
        ${champsEleve(classe)}
        ${F.date({ lib: 'Date du fait', nom: 'date', id: 'vie-i-date', val: u.aujourdhui(), req: true, attrs: { max: u.aujourdhui() } })}
        ${F.choix({ lib: 'Fait constaté', nom: 'fait', id: 'vie-i-fait', options: C.FAITS, vide: 'Choisir…', req: true })}
        ${F.texte({ lib: 'Précision', nom: 'detail', id: 'vie-i-detail', plein: true, attrs: { maxlength: 200, placeholder: 'Facultatif (obligatoire pour « Autre »)' } })}
        ${F.choix({ lib: 'Sanction', nom: 'sanction', id: 'vie-i-sanction', val: C.SANCTIONS[0], options: C.SANCTIONS, req: true })}
        ${F.radios({ lib: 'Statut', nom: 'statut', val: 'En cours', options: [['En cours', 'En cours de traitement'], ['Traité', 'Déjà traité']] })}
      </div>`,
      apres: (racine) => brancherEleve(racine),
      async surValider(d) {
        if (!d.sid) throw E('Choisissez l’élève.', 'sid');
        if (!C.FAITS.includes(d.fait)) throw E('Choisissez le fait constaté.', 'fait');
        const ep = V.texte(d.detail, 'Précision', { max: 200 });
        if (ep) throw E(ep, 'detail');
        if (d.fait === 'Autre' && !String(d.detail || '').trim()) throw E('Précisez le fait constaté (« Autre »).', 'detail');
        const dbl = P().incidents.find((x) => x.sid === d.sid && x.date === d.date && x.fait === d.fait);
        if (dbl && !(await confirmerDoublon('Fait déjà enregistré', html`Le fait « <b>${d.fait}</b> » est déjà enregistré pour <b>${nomDe(d.sid)}</b> le ${u.fmtDate(d.date)}. L’enregistrer une seconde fois ?`))) return false;
        AK.pro.incident({ sid: d.sid, date: d.date, fait: d.fait, detail: d.detail, sanction: d.sanction, statut: d.statut });
        const x = P().incidents[P().incidents.length - 1];
        ui.toast('Fait enregistré au registre de discipline.', /Convocation/.test(d.sanction) ? { action: { lib: 'Imprimer la convocation', f: secu(() => convocation(x)) }, duree: 12000 } : {});
      }
    });
  }

  function convocation(x) {
    const s = eleve(x.sid);
    if (!s) throw E('Élève introuvable (supprimé ?) : la convocation ne peut pas être établie.');
    exigerClasse(s.classe);
    return AK.docs.ouvrir('convocation-parents', [{ eleve: s, fait: x }], { nomFichier: `convocation-${X().nomComplet(s)}` });
  }

  /* ==================================================================================
     Infirmerie (données de santé : directeur et enseignant de la classe seulement)
     ================================================================================== */
  const soinsVisibles = () => P().soins.filter((x) => visibleSid(x.sid));
  const tonSuite = (s) => (/centre|Remis/.test(s) ? 'avert' : /Parents|Repos/.test(s) ? 'pri' : 'ok');

  function rendreSante(p) {
    const classes = AK.session.classes();
    if (!classes.length) return html`${ui.pageTete('Infirmerie')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée.')}`;
    const auj = u.aujourdhui(), mois = auj.slice(0, 7);
    const tous = soinsVisibles();
    const cp = classes.includes(p.classe) ? p.classe : '';
    const L = tous.filter((x) => (!cp || classeEleve(x.sid) === cp) && (!p.motif || x.motif === p.motif) && (!p.suite || x.suite === p.suite)).sort((a, b) => b.date.localeCompare(a.date) || String(b.heure).localeCompare(String(a.heure)));
    const allergies = X().actifs().filter((s) => classes.includes(s.classe) && String(s.allergies || '').trim()).sort(X().parClasse);
    const orientes = tous.filter((x) => /centre/.test(x.suite)).length;
    const dir = peut('vie.supprimer');
    const filtres = html`${classes.length > 1 ? choixFiltre('vie-sante-filtre', 'classe', cp, classes, 'Toutes les classes', 'Classe') : ''}${choixFiltre('vie-sante-filtre', 'motif', p.motif, C.MAUX, 'Tous les motifs', 'Motif')}${choixFiltre('vie-sante-filtre', 'suite', p.suite, C.SUITES_SOIN, 'Toutes les suites', 'Suite donnée')}`;
    return html`${ui.pageTete('Infirmerie', 'Registre des passages à l’infirmerie : motif, soins donnés et suite. Les allergies et groupes sanguins viennent des fiches des élèves.', html`<button type="button" class="btn btn-pri" data-action="vie-soin-nouveau" data-classe="${cp}">${ic('plus')}Nouveau passage</button>`)}
      ${ui.encadre(html`<b>Données de santé confidentielles.</b> Elles ne sont visibles que par le directeur et l’enseignant de la classe, ne figurent pas dans les exports et ne se communiquent qu’aux parents de l’élève concerné.`, 'info', 'shield')}
      <div class="grille g4 mb mt vie-kpis">
        ${ui.kpi({ icone: 'cal', lib: 'Passages ce mois-ci', val: tous.filter((x) => x.date.slice(0, 7) === mois).length, sous: 'à l’infirmerie' })}
        ${ui.kpi({ icone: 'clock', lib: 'Aujourd’hui', val: tous.filter((x) => x.date === auj).length, sous: 'passage(s)' })}
        ${ui.kpi({ icone: 'activity', lib: 'Orientés', val: orientes, sous: 'vers le centre de santé', ton: orientes ? 'avert' : '' })}
        ${ui.kpi({ icone: 'heart', lib: 'Allergies signalées', val: allergies.length, sous: 'élève(s) à surveiller', ton: allergies.length ? 'acc' : '' })}
      </div>
      ${allergies.length ? ui.carte('Allergies et santé à surveiller', html`<div class="liste">${allergies.map((s) => html`<div><span class="flex1">${ui.nomEleve(s)} <span class="mut petit">${s.classe}</span><br><span class="petit vie-texte">${s.allergies}</span></span>${s.sang ? html`<span class="m">${ui.tag('Groupe ' + s.sang)}</span>` : ''}</div>`)}</div>`, { sous: 'Renseignées dans la fiche de chaque élève (onglet santé).', cls: 'mb' }) : ''}
      ${ui.tableau({
        id: 'vie-sante', lignes: L, unite: 'passage', legende: 'Registre de l’infirmerie', filtres, placeholder: 'Élève, motif, soins…',
        recherche: (x) => nomDe(x.sid) + ' ' + classeEleve(x.sid) + ' ' + x.motif + ' ' + x.soin + ' ' + x.suite,
        colonnes: [
          { cle: 'date', lib: 'Date', tri: (x) => x.date + ' ' + (x.heure || ''), rendu: (x) => html`${u.fmtDate(x.date)}${x.heure ? html`<br><span class="mut petit">${x.heure.replace(':', ' h ')}</span>` : ''}` },
          { cle: 'eleve', lib: 'Élève', tri: (x) => nomDe(x.sid), rendu: (x) => {
            const s = eleve(x.sid);
            return html`<div class="ligne" style="flex-wrap:nowrap">${quiDe(x.sid)}${s && s.sang ? ui.tag(s.sang) : ''}${s && String(s.allergies || '').trim() ? ui.tag('Allergie', 'avert', 'warn') : ''}</div>`;
          } },
          { cle: 'motif', lib: 'Motif', tri: (x) => x.motif },
          { cle: 'soin', lib: 'Soins donnés', cls: 'texte', rendu: (x) => (x.soin ? html`<span class="vie-texte">${x.soin}</span>` : html`<span class="mut">—</span>`) },
          { cle: 'suite', lib: 'Suite donnée', tri: (x) => x.suite, rendu: (x) => ui.tag(x.suite, tonSuite(x.suite)) },
          { cle: 'act', lib: '', cls: 'droite', rendu: (x) => (dir ? html`<button type="button" class="btn-ic dng" data-action="vie-soin-supprimer" data-id="${x.id}" aria-label="Supprimer le passage du ${u.fmtDate(x.date)} (${nomDe(x.sid)})" data-bulle="Supprimer">${ic('trash')}</button>` : '') }
        ],
        vide: tous.length ? ui.vide('Aucun passage', 'Aucun passage ne correspond à ces filtres.') : ui.vide('Aucun passage enregistré', 'Les passages à l’infirmerie apparaîtront ici.')
      })}`;
  }

  function infoSante(sid) {
    const s = eleve(sid);
    if (!s) return '';
    const tel = AK.pro.telParent(s), all = String(s.allergies || '').trim();
    return ui.encadre(html`${all ? html`<b>Allergies : ${all}</b>` : 'Aucune allergie signalée'} · ${s.sang ? html`groupe sanguin <b>${s.sang}</b>` : 'groupe sanguin non renseigné'}${tel ? html` · parent : <a href="tel:${tel.replace(/\s/g, '')}">${tel}</a>` : ' · aucun téléphone de parent'}`, all ? 'avert' : 'info', 'heart');
  }

  function formSoin(classe) {
    const h = new Date().toTimeString().slice(0, 5);
    ui.fenetre({
      titre: 'Passage à l’infirmerie', icone: 'heart', ok: 'Enregistrer le passage',
      corps: html`<div class="form-grille">
        ${champsEleve(classe)}
        <div class="plein" id="vie-soin-info" aria-live="polite"></div>
        ${F.date({ lib: 'Date', nom: 'date', id: 'vie-o-date', val: u.aujourdhui(), req: true, attrs: { max: u.aujourdhui() } })}
        ${F.texte({ lib: 'Heure', nom: 'heure', id: 'vie-o-heure', type: 'time', val: h })}
        ${F.choix({ lib: 'Motif', nom: 'motif', id: 'vie-o-motif', options: C.MAUX, vide: 'Choisir…', req: true })}
        ${F.choix({ lib: 'Suite donnée', nom: 'suite', id: 'vie-o-suite', val: C.SUITES_SOIN[0], options: C.SUITES_SOIN })}
        ${F.texte({ lib: 'Soins donnés', nom: 'soin', id: 'vie-o-soin', plein: true, attrs: { maxlength: 200, placeholder: 'Ex. : compresse, repos, appel au parent' } })}
      </div>`,
      apres: (racine) => brancherEleve(racine, (sid) => u.poser($('#vie-soin-info', racine), infoSante(sid))),
      async surValider(d) {
        if (!d.sid) throw E('Choisissez l’élève.', 'sid');
        if (d.heure && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.heure)) throw E('Heure invalide (hh:mm).', 'heure');
        if (!C.MAUX.includes(d.motif)) throw E('Choisissez le motif.', 'motif');
        const es = V.texte(d.soin, 'Soins donnés', { max: 200 });
        if (es) throw E(es, 'soin');
        const dbl = P().soins.find((x) => x.sid === d.sid && x.date === d.date && x.motif === d.motif && (x.heure || '') === (d.heure || ''));
        if (dbl && !(await confirmerDoublon('Passage déjà enregistré', html`Un passage identique (même élève, même date, même heure, même motif) est déjà enregistré. L’enregistrer une seconde fois ?`))) return false;
        AK.pro.soin({ sid: d.sid, date: d.date, heure: d.heure, motif: d.motif, suite: d.suite, soin: d.soin });
        ui.toast('Passage à l’infirmerie enregistré.');
      }
    });
  }

  /* ==================================================================================
     Calendrier
     ================================================================================== */
  const JOURS_COURTS = [['Lun', 'Lundi'], ['Mar', 'Mardi'], ['Mer', 'Mercredi'], ['Jeu', 'Jeudi'], ['Ven', 'Vendredi'], ['Sam', 'Samedi'], ['Dim', 'Dimanche']];
  const ORIGINES = { ecole: 'Événement de l’école', conge: 'Paramètres › Calendrier', eval: 'Calendrier des évaluations' };

  /** Tous les éléments du calendrier : événements, congés (lecture seule), évaluations. */
  function elementsCalendrier() {
    const x = X(), L = [];
    P().events.forEach((e) => {
      if (u.estISO(e.date)) L.push({ cle: 'ev-' + e.id, id: e.id, d: e.date, au: e.date, t: e.titre, k: TYPES_EV.some(([k]) => k === e.type) ? e.type : 'acc', src: 'ecole' });
    });
    S().conges.forEach((c, i) => {
      if (!u.estISO(c.du)) return;
      const au = u.estISO(c.au) && c.au >= c.du && u.ecartJours(c.du, c.au) <= 120 ? c.au : c.du;
      L.push({ cle: 'cg-' + (c.id || i), d: c.du, au, t: c.lib || 'Congé', k: 'g', src: 'conge' });
    });
    // évaluations : calendrier commun et, s'il est ouvert, calendrier propre au CM2
    const cals = [...new Set(x.niveaux().map((c) => x.info(c).cal))];
    const parDate = new Map();
    [1, 2, 3, 4].forEach((n) => cals.forEach((cal) => {
      const d = x.evalDate(cal === 'CM2' ? 'CM2' : 'CP1', n), lib = C.EVALUATIONS[cal][n - 1];
      if (!parDate.has(d)) parDate.set(d, new Map());
      const m = parDate.get(d);
      m.set(lib, [...(m.get(lib) || []), cal]);
    }));
    parDate.forEach((m, d) => m.forEach((cl, lib) => {
      const suffixe = cals.length > 1 && cl.length < cals.length ? (cl.includes('CM2') ? ' (CM2)' : ' (sauf CM2)') : '';
      L.push({ cle: 'eval-' + d + '-' + lib, d, au: d, t: lib + suffixe, k: 'w', src: 'eval' });
    }));
    return L.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t, 'fr'));
  }

  const etiquette = (it) => {
    const contenu = html`<span class="sr">${libType(it.k)} : </span>${it.t}`;
    if (it.id && peut('vie.supprimer')) return html`<button type="button" class="cal-e ${it.k}" data-action="vie-ev-menu" data-id="${it.id}" title="${it.t}" aria-haspopup="menu">${contenu}</button>`;
    if (it.src === 'conge' && peut('parametres.gerer')) return html`<a class="cal-e g" href="#parametres/calendrier" title="${it.t} (Paramètres › Calendrier)">${contenu}</a>`;
    return html`<span class="cal-e ${it.k}" title="${it.t}">${contenu}</span>`;
  };
  const puceDate = (d) => {
    const x = u.parseISO(d);
    return html`<span class="dt" aria-hidden="true"><b>${x.getDate()}</b>${x.toLocaleDateString('fr-FR', { month: 'short' })}</span>`;
  };

  function rendreCalendrier(p) {
    const auj = u.aujourdhui();
    const vue = p.vue === 'liste' ? 'liste' : 'mois';
    const items = elementsCalendrier();
    const ajouter = peut('vie.utiliser');
    const gerer = peut('vie.supprimer');
    const actions = html`<button type="button" class="btn" data-action="vie-cal-ics">${ic('down')}Exporter (.ics)</button>${ajouter ? html`<button type="button" class="btn btn-pri" data-action="vie-ev-nouveau">${ic('plus')}Nouvel événement</button>` : ''}`;
    const legende = html`<div class="legende" aria-label="Légende">${TYPES_EV.map(([k, l]) => html`<span><i class="vie-leg ${k}"></i>${l}</span>`)}<span><i class="vie-leg repos"></i>Pas de classe</span></div>`;
    const tete = html`${ui.pageTete('Calendrier de l’école', html`Événements de l’école, évaluations, congés et jours fériés. Les congés se gèrent dans ${peut('parametres.gerer') ? html`<a href="#parametres/calendrier">Paramètres › Calendrier</a>` : 'Paramètres › Calendrier (directeur)'} : ils sont affichés ici en lecture.`, actions)}
      <div class="barre-outils">${ui.pilules([['mois', 'Mois'], ['liste', 'Liste']], vue, 'vie-cal-vue')}${legende}</div>`;
    if (vue === 'liste') return html`${tete}${rendreListeCal(p, items, auj, gerer)}`;

    const mois = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.mois || '') ? p.mois : auj.slice(0, 7);
    const [y, m] = mois.split('-').map(Number);
    const decal = (new Date(y, m - 1, 1).getDay() + 6) % 7, nb = new Date(y, m, 0).getDate();
    const cases = [];
    for (let i = 0; i < decal; i++) cases.push(html`<div class="cal-j hors" aria-hidden="true"></div>`);
    for (let j = 1; j <= nb; j++) {
      const d = `${y}-${u.pad(m)}-${u.pad(j)}`, classe = X().estJourClasse(d);
      const ev = items.filter((it) => d >= it.d && d <= it.au);
      const lib = `${dateJour(d)}${d === auj ? ', aujourd’hui' : ''}${classe ? '' : ', pas de classe'}`;
      cases.push(html`<div class="cal-j${d === auj ? ' auj' : ''}${classe ? '' : ' repos'}">${ajouter ? html`<button type="button" class="vie-jour" data-action="vie-ev-nouveau" data-date="${d}" aria-label="${lib} : ajouter un événement" data-bulle="Ajouter un événement ce jour">${j}</button>` : html`<b aria-label="${lib}">${j}</b>`}${ev.map(etiquette)}</div>`);
    }
    const prec = u.iso(new Date(y, m - 2, 1)).slice(0, 7), suiv = u.iso(new Date(y, m, 1)).slice(0, 7);
    const nav = html`<div class="ligne" style="flex-wrap:nowrap"><button type="button" class="btn btn-sm" data-action="vie-cal-mois" data-v="${prec}" aria-label="Mois précédent">${ic('chevL')}</button><button type="button" class="btn btn-sm" data-action="vie-cal-mois" data-v="${auj.slice(0, 7)}"${mois === auj.slice(0, 7) ? raw(' aria-current="date"') : ''}>Aujourd’hui</button><button type="button" class="btn btn-sm" data-action="vie-cal-mois" data-v="${suiv}" aria-label="Mois suivant">${ic('chev')}</button></div>`;
    const prochains = items.filter((it) => it.au >= auj).slice(0, 8);
    return html`${tete}<div class="grille g-2-1">
      ${ui.carte(`${C.MOIS[m - 1]} ${y}`, html`<div class="cal" role="group" aria-label="${C.MOIS[m - 1]} ${y}">${JOURS_COURTS.map(([c, l]) => html`<div class="cal-h"><abbr title="${l}">${c}</abbr></div>`)}${cases}</div>`, { actions: nav })}
      ${ui.carte('À venir', prochains.length ? html`<div class="liste">${prochains.map((it) => html`<div>${puceDate(it.d)}<span class="flex1"><b class="vie-texte">${it.t}</b><br><span class="mut petit">${u.fmtDate(it.d)}${it.au !== it.d ? ` → ${u.fmtDate(it.au)}` : ''} · ${libType(it.k)}</span></span>${it.id && gerer ? html`<button type="button" class="btn-ic" data-action="vie-ev-menu" data-id="${it.id}" aria-haspopup="menu" aria-label="Actions : ${it.t}">${ic('more')}</button>` : ''}</div>`)}</div>` : ui.vide('Rien de prévu', 'Aucun événement à venir.'), { actions: html`<button type="button" class="btn btn-sm btn-ghost" data-action="vie-cal-vue" data-v="liste">Tout voir</button>` })}
    </div>`;
  }

  function rendreListeCal(p, items, auj, gerer) {
    const QUAND = [['', 'Tout le calendrier'], ['avenir', 'À venir'], ['passe', 'Passés']];
    const L = items.filter((it) => (!p.type || it.k === p.type) && (p.quand !== 'avenir' || it.au >= auj) && (p.quand !== 'passe' || it.au < auj));
    const filtres = html`${choixFiltre('vie-cal-filtre', 'type', p.type, TYPES_EV, 'Tous les types', 'Type')}${choixFiltre('vie-cal-filtre', 'quand', p.quand, QUAND, null, 'Période')}`;
    return ui.tableau({
      id: 'vie-agenda', lignes: L, cleId: (it) => it.cle, unite: 'élément', legende: 'Calendrier de l’école', filtres, placeholder: 'Rechercher un événement…',
      recherche: (it) => it.t + ' ' + libType(it.k) + ' ' + ORIGINES[it.src], exporter: peut('donnees.exporter') ? 'calendrier' : null,
      colonnes: [
        { cle: 'date', lib: 'Date', tri: (it) => it.d, csv: (it) => u.fmtDate(it.d) + (it.au !== it.d ? ' → ' + u.fmtDate(it.au) : ''), rendu: (it) => html`<b>${u.fmtDate(it.d)}</b>${it.au !== it.d ? html` → ${u.fmtDate(it.au)}` : ''}<br><span class="mut petit">${jourSemaine(it.d)}${it.au < auj ? ' · passé' : it.d <= auj ? ' · en cours' : ''}</span>` },
        { cle: 't', lib: 'Intitulé', cls: 'texte', tri: (it) => it.t, csv: (it) => it.t, rendu: (it) => html`<span class="vie-texte">${it.t}</span>` },
        { cle: 'k', lib: 'Type', tri: (it) => libType(it.k), csv: (it) => libType(it.k), rendu: (it) => html`<span class="ligne" style="flex-wrap:nowrap"><i class="vie-leg ${it.k}" aria-hidden="true"></i>${libType(it.k)}</span>` },
        { cle: 'src', lib: 'Origine', tri: (it) => ORIGINES[it.src], csv: (it) => ORIGINES[it.src], rendu: (it) => (it.src === 'conge' && peut('parametres.gerer') ? html`<a href="#parametres/calendrier">${ORIGINES[it.src]}</a>` : html`<span class="mut">${ORIGINES[it.src]}</span>`) },
        { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (it) => (it.id && gerer ? html`<button type="button" class="btn-ic" data-action="vie-ev-menu" data-id="${it.id}" aria-haspopup="menu" aria-label="Actions : ${it.t}">${ic('more')}</button>` : '') }
      ],
      vide: ui.vide('Aucun élément', p.type || p.quand ? 'Aucun élément ne correspond à ces filtres.' : 'Le calendrier est vide.')
    });
  }

  function formEvenement(ev, date) {
    ui.fenetre({
      titre: ev ? 'Modifier l’événement' : 'Nouvel événement', icone: 'cal', ok: ev ? 'Enregistrer' : 'Ajouter au calendrier',
      corps: html`<div class="form-grille">
        ${F.date({ lib: 'Date', nom: 'date', id: 'vie-e-date', val: ev ? ev.date : u.estISO(date) ? date : u.aujourdhui(), req: true })}
        ${F.choix({ lib: 'Type', nom: 'type', id: 'vie-e-type', val: ev ? ev.type || 'acc' : 'acc', options: TYPES_EV })}
        ${F.texte({ lib: 'Intitulé', nom: 'titre', id: 'vie-e-titre', val: ev ? ev.titre : '', req: true, plein: true, attrs: { maxlength: 100, autocomplete: 'off', placeholder: 'Ex. : Conseil des maîtres' } })}
        <div class="plein" data-vie-aide-conge hidden>${ui.encadre(html`Un congé saisi ici n’est qu’une <b>information</b> du calendrier. Pour qu’il soit retiré des jours de classe (appel, absences, statistiques), enregistrez-le dans Paramètres › Calendrier.`, 'avert', 'info')}</div>
      </div>`,
      apres(racine) {
        const f = $('form', racine), aide = $('[data-vie-aide-conge]', racine);
        const maj = () => (aide.hidden = f.elements.type.value !== 'g');
        f.elements.type.addEventListener('change', maj);
        maj();
      },
      async surValider(d) {
        const ed = V.date(d.date, 'Date', { requise: true });
        if (ed) throw E(ed, 'date');
        const et = V.texte(d.titre, 'Intitulé', { requis: true, max: 100 });
        if (et) throw E(et, 'titre');
        const dbl = P().events.find((e) => (!ev || e.id !== ev.id) && e.date === d.date && u.norm(e.titre) === u.norm(d.titre));
        if (dbl && !(await confirmerDoublon('Événement déjà prévu', html`« <b>${dbl.titre}</b> » figure déjà au calendrier le ${u.fmtDate(d.date)}. L’ajouter une seconde fois ?`))) return false;
        if (ev) AK.vie.modifierEvenement(ev.id, d);
        else AK.pro.evenement({ date: d.date, type: d.type, titre: d.titre });
        ui.toast(ev ? 'Événement modifié.' : `Événement ajouté au ${u.fmtDate(d.date)}.`);
        const p = AK.shell.params();
        if (AK.shell.routeCourante() === 'vie/calendrier' && p.vue !== 'liste' && d.date.slice(0, 7) !== (p.mois || u.aujourdhui().slice(0, 7))) AK.shell.aller('vie/calendrier', { ...p, mois: d.date.slice(0, 7) });
      }
    });
  }

  /* Export iCalendar (RFC 5545) : lignes pliées à 75 octets, textes échappés. */
  function ics() {
    const sc = S().school, enc = new TextEncoder();
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const plier = (l) => {
      let out = '', n = 0;
      for (const ch of l) {
        const b = enc.encode(ch).length;
        if (n + b > 74) {
          out += '\r\n ';
          n = 1;
        }
        out += ch;
        n += b;
      }
      return out;
    };
    const j = (d) => d.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//AKWA SCHOOL//Calendrier ${AK.VERSION}//FR`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(sc.name || 'Calendrier de l’école')];
    elementsCalendrier().forEach((it) => L.push('BEGIN:VEVENT', `UID:${it.cle.replace(/[^\w-]/g, '')}@akwa-school`, 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + j(it.d), 'DTEND;VALUE=DATE:' + j(u.ajouterJours(it.au, 1)), 'SUMMARY:' + esc(it.t), 'CATEGORIES:' + esc(libType(it.k)), 'TRANSP:TRANSPARENT', 'END:VEVENT'));
    L.push('END:VCALENDAR');
    return L.map(plier).join('\r\n') + '\r\n';
  }

  /* ---------- Écrans ---------- */
  const compteVie = (r) => (r === 'vie/discipline' ? incidentsVisibles().filter((x) => x.statut === 'En cours').length || null : null);
  AK.ecrans.def('vie/edt', { rendu: rendreEdt, droit: 'vie.utiliser', compteOnglet: compteVie });
  AK.ecrans.def('vie/cahier', { rendu: rendreCahier, droit: 'vie.utiliser', compteOnglet: compteVie });
  AK.ecrans.def('vie/discipline', { rendu: rendreDiscipline, droit: 'vie.utiliser', compteOnglet: compteVie });
  AK.ecrans.def('vie/sante', { rendu: rendreSante, droit: 'vie.utiliser', compteOnglet: compteVie });
  AK.ecrans.def('vie/calendrier', { rendu: rendreCalendrier, droit: 'vie.utiliser', compteOnglet: compteVie });
  AK.ecransVie = { formIncident, formSoin, formSeance, formEvenement, convocation, elementsCalendrier, ics };

  /* ---------- Actions ---------- */
  const trouverDans = (liste, el, quoi) => {
    const x = P()[liste].find((o) => o.id === el.dataset.id);
    if (!x) throw E(quoi + ' introuvable (peut-être supprimé).');
    return x;
  };
  const seanceDe = (el) => {
    const x = trouverDans('cahier', el, 'Séance');
    exigerClasse(x.classe);
    return x;
  };
  const incidentDe = (el) => trouverDans('incidents', el, 'Fait de discipline');
  const soinDe = (el) => trouverDans('soins', el, 'Passage');
  const evenementDe = (el) => trouverDans('events', el, 'Événement');

  async function supprimerEvenement(e) {
    AK.perm.exiger('vie.supprimer');
    if (!(await ui.confirmer({ titre: 'Supprimer un événement', danger: true, ok: 'Supprimer', message: html`Retirer « <b>${e.titre}</b> » (${u.fmtDate(e.date)}) du calendrier ?` }))) return;
    const copie = { date: e.date, type: e.type, titre: e.titre };
    AK.pro.supprimerEvenement(e.id);
    ui.toast('Événement supprimé.', { action: { lib: 'Annuler', f: secu(() => AK.pro.evenement(copie)) } });
  }

  AK.actions.def({
    /* Emploi du temps */
    'vie-edt-classe': (el) => AK.shell.aller('vie/edt', { classe: el.dataset.v }),
    async 'vie-edt-type'(el) {
      const c = el.dataset.classe;
      exigerClasse(c);
      const avant = u.clone(P().edt[c] || {});
      const plein = Object.values(avant).some(Boolean);
      if (plein && !(await ui.confirmer({ titre: 'Emploi du temps type', danger: true, ok: 'Remplacer', message: html`Remplacer l’emploi du temps de <b>${c}</b> par l’emploi du temps type ? Les cases déjà remplies seront remplacées (annulation possible juste après).` }))) return;
      AK.pro.edtType(c);
      ui.toast(`Emploi du temps type appliqué en ${c}. Ajustez les cases si besoin.`, plein ? { action: { lib: 'Annuler', f: secu(() => AK.vie.restaurerEdt(c, avant)) } } : {});
    },
    async 'vie-edt-vider'(el) {
      const c = el.dataset.classe;
      exigerClasse(c);
      const avant = u.clone(P().edt[c] || {});
      if (!(await ui.confirmer({ titre: 'Vider la grille', danger: true, ok: 'Vider la grille', message: html`Effacer toutes les cases de l’emploi du temps de <b>${c}</b> ?` }))) return;
      AK.vie.viderEdt(c);
      ui.toast(`Emploi du temps de ${c} vidé.`, { action: { lib: 'Annuler', f: secu(() => AK.vie.restaurerEdt(c, avant)) }, duree: 12000 });
    },
    'vie-edt-imprimer'(el) {
      exigerClasse(el.dataset.classe);
      return AK.docs.ouvrir('emploi-du-temps', [{ classe: el.dataset.classe }], { nomFichier: 'emploi-du-temps-' + el.dataset.classe });
    },
    'vie-edt-imprimer-tout': () => AK.docs.ouvrir('emploi-du-temps', AK.session.classes().map((c) => ({ classe: c })), { titre: 'Emplois du temps · toutes les classes', nomFichier: 'emplois-du-temps' }),

    /* Cahier de textes */
    'vie-cahier-classe': (el) => {
      ui.tableauEtat('vie-cahier').page = 1;
      allerPropre('vie/cahier', { ...AK.shell.params(), classe: el.dataset.v, mat: '' });
    },
    'vie-seance-nouvelle': (el) => formSeance(null, el.dataset.classe),
    'vie-seance-modifier': (el) => formSeance(seanceDe(el)),
    async 'vie-seance-supprimer'(el) {
      const x = seanceDe(el);
      if (!(await ui.confirmer({ titre: 'Supprimer une séance', danger: true, ok: 'Supprimer', message: html`Supprimer du cahier de textes la séance de <b>${x.mat}</b> du ${u.fmtDate(x.date)} (${x.classe}) ?` }))) return;
      const copie = { classe: x.classe, date: x.date, mat: x.mat, contenu: x.contenu, travail: x.travail };
      AK.pro.supprimerSeance(x.id);
      ui.toast('Séance supprimée.', { action: { lib: 'Annuler', f: secu(() => AK.pro.seance(copie)) } });
    },
    'vie-cahier-imprimer'(el) {
      const c = el.dataset.classe;
      exigerClasse(c);
      if (!P().cahier.some((x) => x.classe === c)) throw E(`Aucune séance consignée en ${c} : rien à imprimer.`);
      return AK.docs.ouvrir('cahier-textes', [{ classe: c }], { nomFichier: 'cahier-de-textes-' + c });
    },

    /* Discipline */
    'vie-disc-statut': (el) => filtrer('vie/discipline', AK.shell.params(), 'statut', el.dataset.v, 'vie-discipline'),
    'vie-incident-nouveau': (el) => formIncident(el.dataset.classe || AK.shell.params().classe),
    'vie-incident-clore'(el) {
      const x = incidentDe(el);
      AK.pro.clore(x.id);
      ui.toast('Fait clos (traité).', { action: { lib: 'Annuler', f: secu(() => AK.vie.rouvrirIncident(x.id)) } });
    },
    'vie-incident-rouvrir'(el) {
      AK.vie.rouvrirIncident(incidentDe(el).id);
      ui.toast('Fait rouvert : de nouveau « En cours ».');
    },
    'vie-incident-convocation': (el) => convocation(incidentDe(el)),
    async 'vie-incident-supprimer'(el) {
      AK.perm.exiger('vie.supprimer');
      const x = incidentDe(el), s = eleve(x.sid);
      if (!(await ui.confirmer({ titre: 'Supprimer un fait de discipline', danger: true, ok: 'Supprimer', message: html`<p>Supprimer du registre le fait « <b>${x.fait}</b> » du ${u.fmtDate(x.date)}${s ? html` concernant <b>${X().nomComplet(s)}</b>` : ''} ?</p><p class="mb0 mut petit">Pour un fait réglé, préférez « Clore » : il reste au registre.</p>` }))) return;
      if (!(await AK.auth.confirmer('Supprimer un fait du registre de discipline.'))) return;
      const copie = { sid: x.sid, date: x.date, fait: x.fait, detail: x.detail, sanction: x.sanction, statut: x.statut };
      AK.pro.supprimerIncident(x.id);
      ui.toast('Fait supprimé du registre.', { action: { lib: 'Annuler', f: secu(() => AK.pro.incident(copie)) } });
    },

    /* Infirmerie */
    'vie-soin-nouveau': (el) => formSoin(el.dataset.classe || AK.shell.params().classe),
    async 'vie-soin-supprimer'(el) {
      AK.perm.exiger('vie.supprimer');
      const x = soinDe(el);
      if (!(await ui.confirmer({ titre: 'Supprimer un passage', danger: true, ok: 'Supprimer', message: html`Supprimer du registre de l’infirmerie le passage du ${u.fmtDate(x.date)} (${nomDe(x.sid)}) ?` }))) return;
      if (!(await AK.auth.confirmer('Supprimer un passage du registre de l’infirmerie.'))) return;
      const copie = { sid: x.sid, date: x.date, heure: x.heure, motif: x.motif, suite: x.suite, soin: x.soin };
      AK.pro.supprimerSoin(x.id);
      ui.toast('Passage supprimé du registre.', { action: { lib: 'Annuler', f: secu(() => AK.pro.soin(copie)) } });
    },

    /* Calendrier */
    'vie-cal-vue': (el) => allerPropre('vie/calendrier', { ...AK.shell.params(), vue: el.dataset.v === 'liste' ? 'liste' : '' }),
    'vie-cal-mois': (el) => AK.shell.aller('vie/calendrier', { ...AK.shell.params(), mois: el.dataset.v }),
    'vie-ev-nouveau': (el) => formEvenement(null, el.dataset.date),
    'vie-ev-menu'(el) {
      const e = evenementDe(el);
      ui.menu(el, [
        { icone: 'edit', lib: 'Modifier', f: () => {
          AK.perm.exiger('vie.supprimer');
          formEvenement(e);
        } },
        'sep',
        { icone: 'trash', lib: 'Supprimer', danger: true, f: () => supprimerEvenement(e) }
      ], `${u.fmtDate(e.date)} · ${u.tronquer(e.titre, 40)}`);
    },
    async 'vie-cal-ics'() {
      const nom = `calendrier-${u.sansAccents(S().school.name || 'ecole').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'ecole'}.ics`;
      await AK.hote.fichier(nom, ics(), 'text/calendar');
      AK.store.journaliser('Export du calendrier (.ics)');
      ui.toast('Calendrier enregistré (.ics) : il s’importe dans l’agenda d’un téléphone ou d’un ordinateur.');
    }
  });
  AK.actions.defChange({
    async 'vie-edt-case'(el) {
      const c = el.dataset.classe, k = el.dataset.k, avant = el.dataset.avant || '';
      let v = el.value;
      try {
        if (v === AUTRE) {
          v = await saisirAutre(c, k);
          if (v == null) {
            el.value = avant;
            return;
          }
        }
        AK.pro.caseEdt(c, k, v);
      } catch (err) {
        el.value = avant;
        throw err;
      }
      el.dataset.avant = v;
      el.classList.toggle('plein', !!v);
      AK.shell.redessiner(); // compteur et volume horaire (la case garde le focus)
    },
    'vie-cahier-filtre'(el) {
      const p = { ...AK.shell.params() };
      if (el.dataset.f === 'per' && el.value !== 'perso') {
        delete p.du;
        delete p.au;
      }
      filtrer('vie/cahier', p, el.dataset.f, el.value, 'vie-cahier');
    },
    'vie-disc-filtre': (el) => filtrer('vie/discipline', AK.shell.params(), el.dataset.f, el.value, 'vie-discipline'),
    'vie-sante-filtre': (el) => filtrer('vie/sante', AK.shell.params(), el.dataset.f, el.value, 'vie-sante'),
    'vie-cal-filtre': (el) => filtrer('vie/calendrier', AK.shell.params(), el.dataset.f, el.value, 'vie-agenda')
  });
})(window.AK);
