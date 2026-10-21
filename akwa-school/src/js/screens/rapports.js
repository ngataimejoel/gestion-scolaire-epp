/* =====================================================================================
   Rapports & statistiques (directeur) : rapports officiels rédigés à l'écran (aperçu
   modifiable : les zones en pointillés s'écrivent sur la page), générateur de rapports
   personnalisés (blocs, ordre, titres, orientation), tableau de bord statistique (effectifs,
   âges, nationalités, extraits, redoublants, résultats, absences, personnel), rapport
   d'infrastructures et transmission à l'IEPP (fichier, fiches imprimables, historique).

   Les calculs viennent d'AK.rapports (docs/rapports.js) et d'AK.calc ; l'impression passe
   toujours par AK.docs.ouvrir avec les modèles de docs/modeles/rapports.js.
   Les modifications passent par des fonctions métier qui vérifient les droits et valident
   AVANT d'écrire : AK.generateur (rapports personnalisés) et AK.infrastructures ci-dessous,
   AK.pro.noterTransmission pour l'historique des transmissions.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, $, $$ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const R = () => AK.rapports;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const E = (m, champ) => new AK.ErreurMetier(m, champ);
  const MM = 96 / 25.4;
  const R_OFF = 'rapports/officiels', R_GEN = 'rapports/generateur', R_STATS = 'rapports/stats', R_LIAISON = 'rapports/liaison';

  /* ---------- Outils communs ---------- */
  /** Mois de l'année scolaire, de septembre à juillet. */
  const ORDRE_MOIS = Object.keys(C.JOURS_MOIS).map(Number).sort((a, b) => (a < 9 ? a + 12 : a) - (b < 9 ? b + 12 : b));
  const libMois = (m) => `${C.MOIS[m - 1]} ${X().moisInfo(m).y}`;
  const optionsMois = () => ORDRE_MOIS.map((m) => [String(m), `${libMois(m)} · ${C.JOURS_MOIS[m]} jours de classe`]);
  const optionsEv = (c) => [1, 2, 3, 4].map((n) => [String(n), c ? X().evalLabel(c, n) : C.EV_GEN[n - 1]]);
  const evDe = (v) => ([1, 2, 3, 4].includes(Number(v)) ? Number(v) : [1, 2, 3, 4].includes(Number(S().school.evalCourante)) ? Number(S().school.evalCourante) : 1);
  const moisDe = (v) => (C.JOURS_MOIS[Number(v)] ? Number(v) : X().moisCourant());
  /** Classe demandée si elle est ouverte ; sinon le CM2 (comme 1.7.0) ou le premier niveau. */
  const classeDe = (v) => {
    const nv = X().niveaux();
    return nv.includes(v) ? v : nv.includes('CM2') ? 'CM2' : nv[0] || null;
  };
  const slug = (t) => u.sansAccents(String(t || '')).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'document';
  /** Va vers l'écran en retirant les paramètres vides de l'adresse. */
  const allerPropre = (route, p) => {
    const q = { ...p };
    Object.keys(q).forEach((k) => (q[k] === '' || q[k] == null) && delete q[k]);
    AK.shell.aller(route, q);
  };
  /** Action d'une notification (« Annuler ») : une erreur s'affiche au lieu d'échapper. */
  const secu = (f) => () => {
    try {
      const r = f();
      if (r && r.catch) r.catch((e) => ui.erreur(e));
    } catch (e) {
      ui.erreur(e);
    }
  };
  const lien = (route, lib) => html`<a href="#${route}">${lib}</a>`;
  /** Texte d'une ligne (titre, sous-titre) : espaces réduits, longueur bornée, message sous le champ. */
  const ligneTexte = (v, lib, { requis = false, max = 120, champ } = {}) => {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    const err = V.texte(t, lib, { requis, max });
    if (err) throw E(err, champ);
    return t;
  };
  const somme = (L, f) => L.reduce((a, x) => a + (f ? f(x) : x), 0);
  const pourcent = (a, b) => (b ? Math.round((a / b) * 100) : null);

  /* =====================================================================================
     Aperçu à l'écran : les vraies feuilles du modèle (ctx.edit = zones à rédiger modifiables),
     réduites à la largeur disponible. Les zones s'enregistrent d'elles-mêmes (AK.rapports).
     ===================================================================================== */
  let jetonApercu = 0;
  const cadreApercu = (id, legende) =>
    html`<div class="apercu rap-apercu" id="${id}" role="region" aria-label="${legende}" aria-busy="true"><div class="pages"><p class="mut rap-attente">${ic('clock')} Préparation de l’aperçu…</p></div></div>`;
  function ajusterZoom(zone) {
    const pages = $('.pages', zone);
    if (!pages) return;
    const dispo = pages.clientWidth - 4;
    if (dispo <= 0) return;
    $$('.feuille-cadre', zone).forEach((c) => {
      const f = $('.feuille', c), l = Number((f && f.dataset.l) || 210) * MM;
      c.style.zoom = Math.min(1, dispo / l).toFixed(4);
    });
  }
  async function remplirApercu(id, idModele, ctx, options = {}) {
    const n = ++jetonApercu;
    if (!document.getElementById(id)) return;
    let g = null, err = null;
    try {
      g = await AK.docs.generer(idModele, [{ ...ctx, edit: true }], { ...options, apercu: true });
    } catch (e) {
      err = e;
    }
    const zone = document.getElementById(id);
    if (n !== jetonApercu || !zone) return; // écran redessiné entre-temps : un aperçu plus récent arrive
    zone.removeAttribute('aria-busy');
    if (err) {
      if (!(err.name === 'ErreurMetier' || err.name === 'ErreurDroits')) AK.diag.erreur(err, 'aperçu ' + idModele);
      u.poser(zone, html`<div class="pages">${ui.encadre(err.name === 'ErreurMetier' || err.name === 'ErreurDroits' ? err.message : 'L’aperçu n’a pas pu être préparé (détail dans Paramètres › Diagnostic). Vos données ne sont pas touchées.', 'erreur')}</div>`);
      return;
    }
    const F2 = g.feuilles;
    u.poser(zone, html`${g.avertissements.length ? html`<div class="rap-avert">${ui.encadre([...new Set(g.avertissements)].join(' '), 'avert')}</div>` : ''}<div class="pages">${F2.map((f, i) => html`<div class="feuille-cadre"><span class="num-page">Page ${i + 1} / ${F2.length}</span>${f}</div>`)}</div>`);
    ajusterZoom(zone);
  }
  addEventListener('resize', u.differer(() => $$('.rap-apercu').forEach(ajusterZoom), 150));

  /* =====================================================================================
     Rapports personnalisés : fonctions métier (droits et validation avant toute écriture)
     Un rapport : { id, titre, sous, pay (paysage), ajuster (une page), cree, maj,
                    blocs: [{ id, type, titre, ev?, mois?, cls?, lignes? }] }
     ===================================================================================== */
  const MAX_RAPPORTS = 100, MAX_BLOCS = 40;
  const LIGNES = [['2', '2 lignes'], ['3', '3 lignes'], ['5', '5 lignes'], ['8', '8 lignes'], ['12', '12 lignes']];
  const BL = () => R().BLOCS;
  const rapports = () => S().persoReps.filter((r) => r && typeof r.id === 'string' && r.id);
  const cleTexte = (rid, bid) => `PERSO|${rid}|${bid}`;
  function rapportDe(id) {
    const r = rapports().find((z) => z.id === id);
    if (!r) throw E('Rapport introuvable : il a peut-être été supprimé.');
    return r;
  }
  const blocsDe = (r) => (Array.isArray(r.blocs) ? r.blocs.filter((b) => b && typeof b === 'object') : []);
  /** Paramètres d'un bloc, contrôlés selon son type (évaluation, mois, classe, hauteur de zone). */
  function paramsBloc(B, o) {
    const p = {};
    Object.entries(o || {}).forEach(([k, v]) => {
      v = String(v ?? '').trim();
      if (k === 'titre') p.titre = ligneTexte(v, 'Titre du bloc', { max: 120, champ: 'titre' });
      else if (k === 'ev' && (B.p === 'ev' || B.p === 'clsev')) {
        if (![1, 2, 3, 4].includes(Number(v))) throw E('Évaluation inconnue : choisissez-la dans la liste.', 'ev');
        p.ev = String(Number(v));
      } else if (k === 'mois' && B.p === 'mois') {
        if (!C.JOURS_MOIS[Number(v)]) throw E('Mois hors de l’année scolaire : choisissez-le dans la liste.', 'mois');
        p.mois = String(Number(v));
      } else if (k === 'cls' && B.p === 'clsev') {
        if (!X().niveaux().includes(v)) throw E('Cette classe n’est pas ouverte dans l’école.', 'cls');
        p.cls = v;
      } else if (k === 'lignes' && B.p === 'lignes') {
        if (!LIGNES.some(([x]) => x === v)) throw E('Hauteur de zone non prévue : choisissez-la dans la liste.', 'lignes');
        p.lignes = v;
      } else throw E('Ce réglage ne s’applique pas à ce type de bloc.');
    });
    return p;
  }
  function nouveauBloc(type, titre, o = {}) {
    const B = BL()[type];
    if (!B) throw E('Type de bloc inconnu : choisissez-le dans la liste.', 'type');
    const b = { id: u.uid(), type, titre: titre ?? B.titre };
    if (B.p === 'ev') b.ev = String(evDe());
    if (B.p === 'mois') b.mois = String(X().moisCourant());
    if (B.p === 'clsev') Object.assign(b, { cls: classeDe() || 'CM2', ev: String(evDe()) });
    if (B.p === 'lignes') b.lignes = '3';
    return Object.assign(b, paramsBloc(B, o));
  }
  const exiger = () => AK.perm.exiger('rapports.generateur');

  const generateur = {
    liste: rapports,
    trouver: (id) => rapports().find((z) => z.id === id) || null,
    /** Crée un rapport vierge ou la copie modifiable d'un rapport officiel. */
    creer({ modele = '', titre = '', ev, mois, classe } = {}) {
      exiger();
      if (rapports().length >= MAX_RAPPORTS) throw E(`Vous avez déjà ${MAX_RAPPORTS} rapports personnalisés : supprimez-en un avant d’en créer un autre.`);
      let m;
      if (modele) {
        const f = R().MODELES_PERSO[modele];
        if (!f) throw E('Point de départ inconnu : choisissez-le dans la liste.', 'modele');
        if (modele === 'resultats' && !classeDe(classe)) throw E('Aucune classe ouverte : renseignez d’abord les niveaux de l’école.', 'classe');
        if (classe && !X().niveaux().includes(classe)) throw E('Cette classe n’est pas ouverte dans l’école.', 'classe');
        m = f({ ev: String(evDe(ev)), mois: String(moisDe(mois)), classe: classeDe(classe) });
      } else m = { titre: 'Nouveau rapport', sous: '', pay: true, blocs: [['texte', 'OBSERVATIONS'], ['signature', '']] };
      const t = ligneTexte(String(titre || '').trim() || (modele ? `${m.titre} (copie modifiable)` : m.titre), 'Titre du rapport', { requis: true, max: 120, champ: 'titre' });
      const auj = u.aujourdhui();
      const rap = { id: u.uid(), titre: t, sous: String(m.sous || '').slice(0, 160), pay: m.pay !== false, ajuster: true, cree: auj, maj: auj, blocs: m.blocs.map(([type, ti, o]) => nouveauBloc(type, ti, o)) };
      AK.store.modifier(`Rapport personnalisé créé : « ${t} »`, (s) => s.persoReps.push(rap), { categorie: 'rapports' });
      return rap;
    },
    /** Titre, sous-titre, orientation (pay), mise en page (ajuster : une seule page). */
    modifier(id, champs) {
      exiger();
      const r = rapportDe(id), maj = {};
      Object.entries(champs || {}).forEach(([k, v]) => {
        if (k === 'titre') maj.titre = ligneTexte(v, 'Titre du rapport', { requis: true, max: 120, champ: 'titre' });
        else if (k === 'sous') maj.sous = ligneTexte(v, 'Sous-titre', { max: 160, champ: 'sous' });
        else if (k === 'pay' || k === 'ajuster') {
          if (!['1', '0', true, false].includes(v)) throw E('Choix invalide : utilisez la liste.', k);
          maj[k] = v === true || v === '1';
        } else throw E('Réglage inconnu.');
      });
      AK.store.modifier(null, () => Object.assign(r, maj, { maj: u.aujourdhui() }));
    },
    ajouterBloc(id, type) {
      exiger();
      const r = rapportDe(id), L = blocsDe(r);
      if (L.length >= MAX_BLOCS) throw E(`Un rapport compte au plus ${MAX_BLOCS} blocs.`);
      const b = nouveauBloc(type);
      // comme dans 1.7.0 : un nouveau bloc se place avant la signature
      const sig = L.findIndex((x) => x.type === 'signature');
      AK.store.modifier(null, () => {
        r.blocs = L;
        if (sig >= 0 && type !== 'signature') r.blocs.splice(sig, 0, b);
        else r.blocs.push(b);
        r.maj = u.aujourdhui();
      });
      return b;
    },
    modifierBloc(id, bid, champs) {
      exiger();
      const r = rapportDe(id), b = blocsDe(r).find((x) => x.id === bid);
      if (!b) throw E('Bloc introuvable : il a peut-être été retiré.');
      const B = BL()[b.type];
      if (!B) throw E('Ce bloc vient d’une version précédente et n’est plus pris en charge : retirez-le.');
      const p = paramsBloc(B, champs);
      AK.store.modifier(null, () => Object.assign(b, p) && (r.maj = u.aujourdhui()));
    },
    deplacerBloc(id, bid, sens) {
      exiger();
      const r = rapportDe(id), L = blocsDe(r), i = L.findIndex((x) => x.id === bid), j = i + (Number(sens) < 0 ? -1 : 1);
      if (i < 0) throw E('Bloc introuvable : il a peut-être été retiré.');
      if (j < 0 || j >= L.length) return false;
      AK.store.modifier(null, () => {
        [L[i], L[j]] = [L[j], L[i]];
        r.blocs = L;
        r.maj = u.aujourdhui();
      });
      return true;
    },
    /** Retire un bloc ; renvoie de quoi le remettre (bloc, position, texte rédigé). */
    retirerBloc(id, bid) {
      exiger();
      const r = rapportDe(id), L = blocsDe(r), i = L.findIndex((x) => x.id === bid);
      if (i < 0) throw E('Bloc introuvable : il a peut-être déjà été retiré.');
      const k = cleTexte(r.id, bid), sauv = { rid: r.id, bloc: L[i], index: i, texte: S().redac[k] };
      AK.store.modifier(null, (s) => {
        r.blocs = L.filter((x) => x.id !== bid);
        delete s.redac[k];
        r.maj = u.aujourdhui();
      });
      return sauv;
    },
    remettreBloc(sauv) {
      exiger();
      const r = rapportDe(sauv.rid), L = blocsDe(r);
      if (L.some((x) => x.id === sauv.bloc.id)) return;
      AK.store.modifier(null, (s) => {
        L.splice(Math.min(sauv.index, L.length), 0, sauv.bloc);
        r.blocs = L;
        if (sauv.texte != null && s.redac[cleTexte(r.id, sauv.bloc.id)] == null) s.redac[cleTexte(r.id, sauv.bloc.id)] = sauv.texte;
      });
    },
    dupliquer(id) {
      exiger();
      if (rapports().length >= MAX_RAPPORTS) throw E(`Vous avez déjà ${MAX_RAPPORTS} rapports personnalisés : supprimez-en un avant d’en créer un autre.`);
      const r = rapportDe(id), auj = u.aujourdhui();
      const titre = u.tronquer(`Copie de ${String(r.titre || 'rapport sans titre')}`, 120);
      const copie = { ...u.clone(r), id: u.uid(), titre, cree: auj, maj: auj, blocs: [] };
      const textes = {};
      blocsDe(r).forEach((b) => {
        const nb = { ...u.clone(b), id: u.uid() };
        const t = S().redac[cleTexte(r.id, b.id)];
        if (t != null) textes[cleTexte(copie.id, nb.id)] = t;
        copie.blocs.push(nb);
      });
      AK.store.modifier(`Rapport personnalisé dupliqué : « ${titre} »`, (s) => {
        s.persoReps.push(copie);
        Object.assign(s.redac, textes);
      }, { categorie: 'rapports' });
      return copie;
    },
    /** Suppression (confirmée dans l'écran) ; renvoie de quoi annuler, textes rédigés compris. */
    supprimer(id) {
      exiger();
      const r = rapportDe(id), index = S().persoReps.indexOf(r), prefixe = `PERSO|${r.id}|`;
      const textes = Object.fromEntries(Object.entries(S().redac).filter(([k]) => k.startsWith(prefixe)));
      AK.store.modifier(`Rapport personnalisé supprimé : « ${String(r.titre || 'sans titre')} »`, (s) => {
        s.persoReps = s.persoReps.filter((x) => x !== r);
        Object.keys(textes).forEach((k) => delete s.redac[k]);
      }, { categorie: 'rapports' });
      return { rapport: r, index, textes };
    },
    restaurer(sauv) {
      exiger();
      if (!sauv || !sauv.rapport) throw E('Rien à restaurer.');
      if (rapports().some((x) => x.id === sauv.rapport.id)) throw E('Ce rapport est déjà présent.');
      AK.store.modifier(`Rapport personnalisé restauré : « ${String(sauv.rapport.titre || 'sans titre')} »`, (s) => {
        s.persoReps.splice(Math.min(Math.max(0, sauv.index), s.persoReps.length), 0, sauv.rapport);
        Object.entries(sauv.textes || {}).forEach(([k, v]) => s.redac[k] == null && (s.redac[k] = v));
      }, { categorie: 'rapports' });
    }
  };
  AK.generateur = generateur;

  /** Réglages d'impression d'un rapport personnalisé : ceux de l'école, orientation du rapport. */
  function reglagesPerso(rap) {
    const r = AK.modeles.reglages('rapport-perso');
    r.page = { ...r.page, orientation: rap.pay === false ? 'portrait' : 'paysage' };
    return r;
  }

  /* =====================================================================================
     Infrastructures : fonction métier (droits, contrôle de chaque champ, cohérence)
     ===================================================================================== */
  const NB = 'nombre', DEC = 'decimal';
  /** [nom du champ, nature (nombre, décimal ou liste de choix), libellé] */
  function champsInfra() {
    const T = (k, l) => [[`toil.${k}.type`, C.TOIL_T, `${l} : type`], [`toil.${k}.n`, NB, `${l} : nombre de cabines`], [`toil.${k}.fonct`, NB, `${l} : cabines fonctionnelles`], [`toil.${k}.sep`, C.ON, `${l} : séparées`]];
    return [
      ['bat.agglo', NB, 'Bâtiments en dur'], ['bat.prov', NB, 'Bâtiments en matériaux provisoires'], ['salles.agglo', NB, 'Salles de classe en dur'], ['salles.prov', NB, 'Salles de classe en matériaux provisoires'],
      ['toil.existe', C.ON, 'Toilettes à l’école'], ...T('eleves', 'Toilettes des élèves'), ['toil.eleves.nf', NB, 'Cabines des filles'], ['toil.eleves.ng', NB, 'Cabines des garçons'], ...T('ens', 'Toilettes des enseignants'),
      ['eau.existe', C.ON, 'Point d’eau à l’école'], ...C.EAUX.flatMap(([k, l]) => [[`eau.${k}.n`, NB, `${l} : nombre`], [`eau.${k}.fonct`, NB, `${l} : fonctionnels`]]),
      ['elec.village', C.ON, 'Électricité dans le village'], ['elec.ecole', C.ON, 'Électricité à l’école'], ['elec.salles', C.ONP, 'Électricité dans les salles de classe'],
      ['loge.existe', C.ON, 'Logements des enseignants'], ['loge.n', NB, 'Nombre de logements'],
      ['mob.tb', NB, 'Tables-bancs'], ['mob.tbBon', NB, 'Tables-bancs en bon état'], ['mob.bureaux', NB, 'Bureaux de maître'], ['mob.tableaux', NB, 'Tableaux'],
      ['cant.existe', C.ON, 'Cantine scolaire'], ['cant.fonct', C.ON, 'Cantine fonctionnelle'], ['cant.ration', NB, 'Nombre de rationnaires'], ['cant.partenaire', C.PARTS, 'Partenaire de la cantine'],
      ...C.LOCAUX.map(([k, l, p]) => [`locaux.${k}`, p ? C.ONP : C.ON, l]),
      ...C.TOUS_NIVEAUX.flatMap((c) => [[`manuels.${c}.lec`, NB, `${c} : manuels de lecture`], [`manuels.${c}.mat`, NB, `${c} : manuels de mathématiques`]]),
      ['acces.dist', DEC, 'Distance jusqu’à l’IEPP (km)'], ['acces.route', C.ROUTES, 'État de la route'], ['acces.reseau', C.RESEAUX, 'Réseau téléphone'], ['acces.rampe', C.ON, 'Rampe pour handicapés'], ['acces.pharma', C.ON, 'Boîte à pharmacie']
    ];
  }
  const valeurInfra = (I, nom) => nom.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), I);
  /** Détails effacés quand la réponse est « Non » ou n'est pas donnée (données cohérentes). */
  const DEPENDANCES = [
    ['toil.existe', /^toil\.(eleves|ens)\./], ['toil.eleves.sep', /^toil\.eleves\.n[fg]$/], ['eau.existe', /^eau\.(?!existe)/],
    ['loge.existe', /^loge\.n$/], ['cant.existe', /^cant\.(?!existe)/]
  ];
  const infrastructures = {
    /** Enregistre le formulaire ; renvoie l'état précédent (pour « Annuler »). */
    enregistrer(d) {
      AK.perm.exiger('rapports.officiels');
      const actuel = R().infra(), propre = {};
      for (const [nom, nature, lib] of champsInfra()) {
        if (!(nom in (d || {}))) continue;
        let v = String(d[nom] ?? '').trim();
        if (nature === NB) {
          if (v !== '' && !/^\d{1,5}$/.test(v)) throw E(`${lib} : entrez un nombre entier positif (99 999 au plus) ou laissez vide.`, nom);
          if (v !== '') v = String(Number(v));
        } else if (nature === DEC) {
          v = v.replace(',', '.');
          if (v !== '' && !/^\d{1,4}(\.\d{1,2})?$/.test(v)) throw E(`${lib} : distance en kilomètres, par exemple 12 ou 12,5.`, nom);
        } else {
          const ok = nature.map((o) => (Array.isArray(o) ? o[0] : o));
          if (v !== '' && !ok.includes(v) && v !== String(valeurInfra(actuel, nom) ?? '')) throw E(`${lib} : choix invalide, utilisez la liste.`, nom);
        }
        propre[nom] = v;
      }
      DEPENDANCES.forEach(([cle, re]) => {
        const rep = cle in propre ? propre[cle] : String(valeurInfra(actuel, cle) || '');
        if (rep !== 'oui') Object.keys(propre).forEach((k) => re.test(k) && (propre[k] = ''));
      });
      const I = R().lireInfra(propre); // cohérence (fonctionnels ≤ total…) ; lève ErreurMetier(champ)
      const avant = S().infra ? u.clone(S().infra) : null;
      AK.store.modifier('Rapport d’infrastructures mis à jour', (s) => (s.infra = I), { categorie: 'rapports' });
      return avant;
    },
    restaurer(avant) {
      AK.perm.exiger('rapports.officiels');
      AK.store.modifier('Rapport d’infrastructures : modification annulée', (s) => {
        if (avant) s.infra = avant;
        else delete s.infra;
      }, { categorie: 'rapports' });
    }
  };
  AK.infrastructures = infrastructures;

  /* =====================================================================================
     Rapports officiels
     ===================================================================================== */
  const OFF = () => R().OFFICIELS; // [clé, libellé, modèle]
  function etatOfficiel(p) {
    const cle = OFF().some(([k]) => k === p.rap) ? p.rap : OFF()[0][0];
    const [, lib, modele] = OFF().find(([k]) => k === cle);
    const ev = evDe(p.ev), mois = moisDe(p.mois), classe = classeDe(p.classe);
    const ctx = cle === 'compo' ? { ev } : cle === 'mensuel' ? { mois } : cle === 'resultats' ? { classe, ev } : {};
    return { cle, lib, modele, ev, mois, classe, ctx };
  }
  /** Contrôles avant impression : ce qui rendrait le rapport incomplet, avec le lien pour corriger. */
  function controlesOfficiel(st) {
    const x = X(), nv = x.niveaux(), act = x.actifs(), L = [];
    if (!nv.length) return [['erreur', html`Aucun niveau n’est ouvert dans l’école : les tableaux seront vides. ${peut('parametres.gerer') ? lien('parametres/ecole', 'Renseigner les niveaux') : ''}`]];
    if (!act.length) L.push(['', 'Aucun élève inscrit : les tableaux seront vides.']);
    const manquantes = (classes, n) => {
      const parClasse = classes.map((c) => [c, x.notesManquantes(c, n)]).filter(([, k]) => k);
      if (!parClasse.length) return;
      const total = somme(parClasse, ([, k]) => k), c0 = parClasse[0][0];
      L.push(['avert', html`<b>${u.pluriel(total, 'note manquante', 'notes manquantes')}</b> (${parClasse.map(([c, k]) => `${c} : ${k}`).join(', ')}) : une moyenne incomplète n’est pas comptée. ${lien(`notes/saisie?classe=${c0}&ev=${n}`, 'Compléter la saisie')}`]);
    };
    if (st.cle === 'rentree') {
      const sans = nv.filter((c) => !x.enseignantDe(c));
      if (sans.length) L.push(['avert', html`Classe(s) sans enseignant : <b>${sans.join(', ')}</b>. ${lien('eleves/classes', 'Affecter les classes')}`]);
      const nf = S().teachers.filter((t) => t.actif !== false && x.clsDe(t).length && !t.fonct).length;
      if (nf) L.push(['', html`${u.pluriel(nf, 'enseignant')} sans type de fonctionnement de classe (simple, jumelée, multigrade) : à préciser dans sa fiche. ${peut('personnel.voir') ? lien('personnel/liste', 'Ouvrir le personnel') : ''}`]);
    } else if (st.cle === 'compo') manquantes(nv, st.ev);
    else if (st.cle === 'resultats') {
      if (!st.classe) return [['erreur', 'Aucune classe ouverte : renseignez d’abord les niveaux de l’école.']];
      manquantes([st.classe], st.ev);
    } else if (st.cle === 'mensuel') {
      const { mm } = x.moisInfo(st.mois), appels = Object.keys(S().appel || {}).filter((d) => d.startsWith(mm)).length;
      L.push(appels ? ['', `Appel enregistré pour ${u.pluriel(appels, 'jour')} en ${libMois(st.mois)} ; ${C.JOURS_MOIS[st.mois]} jours de classe retenus pour le taux de fréquentation.`] : ['avert', html`Aucun appel enregistré en ${libMois(st.mois)} : le taux de fréquentation ne reflète pas les absences. ${lien('absences/appel', 'Faire l’appel')}`]);
    } else if (st.cle === 'fin' || st.cle === 'cm2') {
      if (st.cle === 'cm2' && !nv.includes('CM2')) return [['erreur', 'La classe de CM2 n’est pas ouverte dans cette école : ce rapport ne s’applique pas.']];
      const inc = act.filter((s) => (st.cle === 'fin' || s.classe === 'CM2') && x.mga(s) == null).length;
      if (inc) L.push(['avert', html`<b>${u.pluriel(inc, 'élève')}</b> sans moyenne générale annuelle complète : décision non calculée. ${lien('notes/fin', 'Voir la fin d’année')}`]);
    }
    return L;
  }
  function rendreOfficiels(p) {
    const st = etatOfficiel(p), d = AK.modeles.get(st.modele), ctrl = controlesOfficiel(st);
    const bloquant = ctrl.some(([t]) => t === 'erreur');
    const choix = (id, f, lib, options, val) => html`<label class="sr" for="${id}">${lib}</label><select class="inp inp-sm" id="${id}" data-change="rap-off-param" data-f="${f}" aria-label="${lib}">${ui.options(options, String(val))}</select>`;
    const params = st.cle === 'compo' ? choix('rap-off-ev', 'ev', 'Évaluation', optionsEv(), st.ev)
      : st.cle === 'mensuel' ? choix('rap-off-mois', 'mois', 'Mois', optionsMois(), st.mois)
        : st.cle === 'resultats' && st.classe ? html`${choix('rap-off-classe', 'classe', 'Classe', X().niveaux(), st.classe)}${choix('rap-off-ev', 'ev', 'Évaluation', optionsEv(st.classe), st.ev)}` : '';
    const actions = html`${peut('rapports.generateur') ? html`<button type="button" class="btn" data-action="rap-off-copier" data-bulle="Crée une copie modifiable : choix des tableaux, ordre, titres">${ic('layers')}Modifier une copie</button>` : ''}${bloquant ? '' : html`<button type="button" class="btn btn-pri" data-action="rap-off-imprimer">${ic('print')}Aperçu et impression</button>`}`;
    return html`${ui.pageTete('Rapports officiels', 'Calculés à partir de vos données. Rédigez les zones en pointillés directement sur la page (enregistrement automatique), puis imprimez.', actions)}
      <div class="barre-outils rap-barre-off">${ui.pilules(OFF().map(([k, l]) => [k, l]), st.cle, 'rap-off-choix', { 'aria-controls': 'rap-off-apercu' })}</div>
      ${params ? html`<div class="barre-outils">${params}<span class="mut petit">${st.cle === 'mensuel' ? 'Le rapport porte sur ce mois.' : 'Les résultats portent sur cette évaluation.'}</span></div>` : ''}
      <div class="pile-sm mb">${ctrl.map(([ton, t]) => ui.encadre(t, ton))}<p class="mut petit mb0">${ic('info', 'i-sm')} ${d.description} Les textes rédigés restent attachés à ce rapport${st.cle === 'compo' ? ' et à cette évaluation' : st.cle === 'mensuel' ? ' et à ce mois' : st.cle === 'resultats' ? ', à cette classe et à cette évaluation' : ''}.</p></div>
      ${bloquant ? '' : cadreApercu('rap-off-apercu', `Aperçu modifiable : ${st.lib}`)}`;
  }
  function apresOfficiels(racine, p) {
    const st = etatOfficiel(p);
    if (!controlesOfficiel(st).some(([t]) => t === 'erreur')) remplirApercu('rap-off-apercu', st.modele, st.ctx);
  }

  /* =====================================================================================
     Générateur de rapports
     ===================================================================================== */
  function fenetreNouveau(depart) {
    const nv = X().niveaux();
    ui.fenetre({
      titre: 'Nouveau rapport personnalisé', icone: 'layers', ok: 'Créer le rapport',
      corps: html`<div class="pile">
        ${F.choix({ lib: 'Point de départ', nom: 'modele', id: 'rap-n-modele', val: depart || '', options: [['', 'Rapport vierge (zone de texte et signature)'], ...OFF().map(([k, l]) => [k, `Partir du « ${l} »`])], aide: 'Une copie se modifie librement : tableaux, ordre, titres, orientation. Le rapport officiel n’est pas changé.' })}
        ${F.texte({ lib: 'Titre du rapport', nom: 'titre', id: 'rap-n-titre', attrs: { maxlength: 120, placeholder: 'Laisser vide : titre proposé par le modèle' } })}
        ${F.choix({ lib: 'Évaluation', nom: 'ev', id: 'rap-n-ev', zone: 'ev', options: optionsEv(), val: String(evDe()) })}
        ${F.choix({ lib: 'Mois', nom: 'mois', id: 'rap-n-mois', zone: 'mois', options: optionsMois(), val: String(X().moisCourant()) })}
        ${nv.length ? F.choix({ lib: 'Classe', nom: 'classe', id: 'rap-n-classe', zone: 'classe', options: nv, val: classeDe() }) : ''}
      </div>`,
      apres(dlg) {
        const f = $('form', dlg);
        const maj = () => {
          const m = f.elements.modele.value;
          $$('[data-zone]', f).forEach((z) => (z.hidden = !((z.dataset.zone === 'ev' && (m === 'compo' || m === 'resultats')) || (z.dataset.zone === 'mois' && m === 'mensuel') || (z.dataset.zone === 'classe' && m === 'resultats'))));
        };
        f.elements.modele.addEventListener('change', maj);
        maj();
      },
      surValider(d) {
        const r = generateur.creer(d);
        allerPropre(R_GEN, { id: r.id });
        ui.toast(`Rapport « ${r.titre} » créé : ajoutez, retirez ou déplacez ses blocs.`);
      }
    });
  }
  /** Réglages propres au type de bloc : évaluation, mois, classe, hauteur de la zone de texte. */
  function reglagesBloc(r, b, B, i) {
    const nom = `${i + 1} (${B.lab})`;
    const sel = (k, lib, options) => html`<select class="inp inp-sm" id="rap-bp-${b.id}-${k}" data-change="rap-gen-bloc" data-id="${r.id}" data-bid="${b.id}" data-k="${k}" aria-label="${lib} du bloc ${nom}">${ui.options(options, String(b[k] ?? ''))}</select>`;
    if (B.p === 'ev') return sel('ev', 'Évaluation', optionsEv());
    if (B.p === 'mois') return sel('mois', 'Mois', optionsMois());
    if (B.p === 'lignes') return sel('lignes', 'Hauteur', LIGNES);
    if (B.p === 'clsev') {
      const nv = X().niveaux(), cls = nv.includes(b.cls) ? b.cls : '';
      return html`<select class="inp inp-sm" id="rap-bp-${b.id}-cls" data-change="rap-gen-bloc" data-id="${r.id}" data-bid="${b.id}" data-k="cls" aria-label="Classe du bloc ${nom}">${ui.options(nv, cls, cls ? null : `Classe ${b.cls || '?'} fermée : choisir…`)}</select>${sel('ev', 'Évaluation', optionsEv(cls || null))}`;
    }
    return '';
  }
  function ligneBloc(r, b, i, n) {
    const B = BL()[b.type], nom = `${i + 1}${B ? ` (${B.lab})` : ''}`;
    const bouton = (sens, icone, lib, visible) => (visible
      ? html`<button type="button" class="btn-ic" id="rap-mv-${b.id}-${sens < 0 ? 'h' : 'b'}" data-action="rap-gen-deplacer" data-id="${r.id}" data-bid="${b.id}" data-sens="${sens}" aria-label="${lib} le bloc ${nom}" data-bulle="${lib}">${ic(icone)}</button>`
      : html`<span class="btn-ic rap-place" aria-hidden="true"></span>`);
    return html`<div class="gen-bloc${B ? '' : ' rap-inconnu'}">
      <span class="num" aria-hidden="true">${i + 1}</span>
      <span class="type">${B ? B.lab : html`${ic('warn', 'i-sm')} Bloc d’une version précédente (« ${b.type} ») : non imprimé`}</span>
      ${B && b.type !== 'signature' ? html`<input class="inp inp-sm" id="rap-bt-${b.id}" value="${b.titre || ''}" maxlength="120" placeholder="Titre (facultatif)" aria-label="Titre du bloc ${nom}" data-change="rap-gen-bloc" data-id="${r.id}" data-bid="${b.id}" data-k="titre">` : ''}
      ${B ? reglagesBloc(r, b, B, i) : ''}
      <span class="espace"></span>
      ${bouton(-1, 'chevU', 'Monter', i > 0)}${bouton(1, 'chevD', 'Descendre', i < n - 1)}
      <button type="button" class="btn-ic" data-action="rap-gen-retirer" data-id="${r.id}" data-bid="${b.id}" aria-label="Retirer le bloc ${nom}" data-bulle="Retirer">${ic('x')}</button>
    </div>`;
  }
  function rendreGenerateur(p) {
    const L = rapports(), r = L.find((z) => z.id === p.id) || L[0] || null;
    const nouveau = html`<button type="button" class="btn btn-pri" data-action="rap-gen-nouveau">${ic('plus')}Nouveau rapport</button>`;
    const liste = html`<section class="carte rap-gen-gauche"><div class="carte-tete"><div><h2>Mes rapports</h2><div class="sous">${u.pluriel(L.length, 'rapport personnalisé', 'rapports personnalisés')}</div></div></div>
      ${L.length ? html`<nav aria-label="Mes rapports personnalisés"><div class="liste gen-liste">${L.map((z) => html`<button type="button" class="${z === r ? 'actif' : ''}" data-action="rap-gen-choisir" data-id="${z.id}"${z === r ? html` aria-current="true"` : ''}><span class="flex1 rap-gen-nom"><b>${z.titre || 'Sans titre'}</b><span class="mut petit">${u.pluriel(blocsDe(z).length, 'bloc')} · ${z.pay === false ? 'portrait' : 'paysage'}</span></span>${z === r ? ic('chev', 'i-sm') : ''}</button>`)}</div></nav>` : html`<p class="mut petit">Aucun rapport pour l’instant.</p>`}
      <div class="pile-sm mt">${nouveau}<label class="mut petit" for="rap-gen-depart">Ou partir d’un rapport officiel</label><select class="inp" id="rap-gen-depart" data-change="rap-gen-depart">${ui.options(OFF().map(([k, l]) => [k, l]), '', 'Choisir un rapport…')}</select></div></section>`;
    if (!r) {
      return html`${ui.pageTete('Générateur de rapports', 'Composez vos propres rapports : tableaux calculés, zones à rédiger, signature, dans l’ordre et l’orientation de votre choix.')}
        <div class="gen">${liste}<section class="carte">${ui.vide('Aucun rapport personnalisé', 'Créez un rapport vierge ou partez d’un rapport officiel pour le modifier : vous choisissez les tableaux, leur ordre, leurs titres et l’orientation de la page.', nouveau)}</section></div>`;
    }
    const B = blocsDe(r);
    const reglages = html`<form class="form-grille" id="rap-gen-form" data-submit="rap-gen-reglages" data-id="${r.id}" novalidate autocomplete="off">
      ${F.texte({ lib: 'Titre du rapport', nom: 'titre', id: 'rap-g-titre', val: r.titre || '', req: true, attrs: { maxlength: 120, 'data-change': 'rap-gen-champ', 'data-id': r.id } })}
      ${F.texte({ lib: 'Sous-titre (période, date…)', nom: 'sous', id: 'rap-g-sous', val: r.sous || '', attrs: { maxlength: 160, 'data-change': 'rap-gen-champ', 'data-id': r.id } })}
      ${F.choix({ lib: 'Orientation', nom: 'pay', id: 'rap-g-pay', val: r.pay === false ? '0' : '1', options: [['1', 'A4 paysage'], ['0', 'A4 portrait']], attrs: { 'data-change': 'rap-gen-champ', 'data-id': r.id } })}
      ${F.choix({ lib: 'Mise en page', nom: 'ajuster', id: 'rap-g-ajuster', val: r.ajuster === false ? '0' : '1', options: [['1', 'Une seule page (réduction automatique)'], ['0', 'Plusieurs pages si nécessaire']], attrs: { 'data-change': 'rap-gen-champ', 'data-id': r.id } })}
    </form>`;
    const ajout = html`<div class="ligne mt"><label class="sr" for="rap-gen-type">Bloc à ajouter</label><select class="inp" id="rap-gen-type">${ui.options(Object.entries(BL()).map(([k, b]) => [k, b.lab]))}</select><button type="button" class="btn" data-action="rap-gen-ajouter" data-id="${r.id}">${ic('plus')}Ajouter ce bloc</button></div>`;
    const actionsRapport = html`<div class="ligne"><button type="button" class="btn btn-sm" data-action="rap-gen-dupliquer" data-id="${r.id}">${ic('copy')}Dupliquer</button><button type="button" class="btn btn-sm btn-dng" data-action="rap-gen-supprimer" data-id="${r.id}">${ic('trash')}Supprimer</button></div>`;
    return html`${ui.pageTete('Générateur de rapports', 'Composez vos propres rapports : tableaux calculés, zones à rédiger, signature, dans l’ordre et l’orientation de votre choix.', html`<button type="button" class="btn btn-pri" data-action="rap-gen-imprimer" data-id="${r.id}">${ic('print')}Aperçu et impression</button>`)}
      <div class="gen">${liste}
        <div class="pile">
          ${ui.carte('Réglages du rapport', reglages, { sous: `Créé le ${u.fmtDate(r.cree) || '—'}${r.maj ? ` · modifié le ${u.fmtDate(r.maj)}` : ''}`, actions: actionsRapport })}
          ${ui.carte('Contenu, dans l’ordre d’impression', html`${B.length ? html`<div class="gen-blocs">${B.map((b, i) => ligneBloc(r, b, i, B.length))}</div>` : html`<p class="mut">Ce rapport est vide : ajoutez un premier bloc ci-dessous.</p>`}${ajout}`, { sous: `${u.pluriel(B.length, 'bloc')} · les zones de texte se rédigent dans l’aperçu` })}
          <section class="carte"><div class="carte-tete"><div><h2>Aperçu modifiable</h2><div class="sous">${r.pay === false ? 'A4 portrait' : 'A4 paysage'} · ${r.ajuster === false ? 'plusieurs pages si nécessaire' : 'une seule page'}</div></div></div>${B.length ? cadreApercu('rap-gen-apercu', `Aperçu modifiable : ${r.titre || 'rapport'}`) : ui.vide('Rien à afficher', 'Ajoutez des blocs pour voir le rapport.')}</section>
        </div>
      </div>`;
  }
  function apresGenerateur(racine, p) {
    const L = rapports(), r = L.find((z) => z.id === p.id) || L[0];
    if (r && blocsDe(r).length) remplirApercu('rap-gen-apercu', 'rapport-perso', { rapport: r }, { reglages: reglagesPerso(r) });
  }
  const rapportParams = (el) => rapportDe(el.dataset.id);

  /* =====================================================================================
     Statistiques
     ===================================================================================== */
  const tranche = (a) => (a == null ? null : a <= 5 ? '≤5' : a >= 13 ? '≥13' : String(a));
  const COURT = { 1: 'Jan', 2: 'Fév', 3: 'Mar', 4: 'Avr', 5: 'Mai', 6: 'Juin', 7: 'Juil', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Déc' };
  /** Barre empilée garçons / filles (largeur relative au maximum) ; valeurs écrites à droite. */
  const barreSexe = (lib, L, max) => {
    const [g, f, t] = X().compteSexe(L);
    return html`<div class="barre-l" role="listitem"><span class="nom">${lib}</span><span class="piste" aria-hidden="true" style="width:${max ? Math.max(t ? 2 : 0, (t / max) * 100) : 0}%">${g ? html`<i class="g-col" style="flex:${g}"></i>` : ''}${f ? html`<i class="f-col" style="flex:${f}"></i>` : ''}</span><span class="val"><b>${t}</b> · ${g} G · ${f} F</span></div>`;
  };
  /** Barre de proportion (0 à 1) sur fond ; repère facultatif (seuil). */
  const barreTaux = (lib, part, valeur, ref) => html`<div class="barre-l" role="listitem"><span class="nom">${lib}</span><span class="piste fond" aria-hidden="true">${part != null ? html`<i class="pri" style="width:${Math.max(0, Math.min(1, part)) * 100}%"></i>` : ''}${ref != null ? html`<span class="ref" style="left:${ref * 100}%"></span>` : ''}</span><span class="val">${valeur}</span></div>`;
  const legendeSexe = html`<div class="legende"><span><i class="g-col"></i>Garçons (G)</span><span><i class="f-col"></i>Filles (F)</span></div>`;
  const details = (resume, corps) => html`<details class="rap-details"><summary>${resume}</summary>${corps}</details>`;

  function statsAbsences() {
    const x = X(), act = x.actifs(), att = Object.entries(S().att || {});
    return ORDRE_MOIS.map((m) => {
      const { mm, jours } = x.moisInfo(m), jrs = att.filter(([d]) => d.startsWith(mm)).map(([, o]) => Object.values(o || {}));
      const a = somme(jrs, (v) => v.filter((z) => z === 'A').length), j = somme(jrs, (v) => v.filter((z) => z && z !== 'A').length);
      return { m, a, j, t: a + j, appels: Object.keys(S().appel || {}).filter((d) => d.startsWith(mm)).length, assiduite: act.length && jours ? Math.max(0, 1 - (a + j) / (act.length * jours)) : null };
    });
  }
  function carteInfra() {
    const Rp = R(), I = Rp.infra(), act = X().actifs(), sal = Rp.iSom(I.salles.agglo, I.salles.prov), tb = Rp.iN(I.mob.tb), E2 = I.eau;
    const nr = 'Non renseigné';
    const lignes = [
      ['Salles de classe', sal == null ? nr : `${sal} (${Rp.iT(I.salles.agglo)} en dur, ${Rp.iT(I.salles.prov)} provisoires) · ${Rp.iRat(act.length, sal)} élèves par salle`],
      ['Tables-bancs', tb == null ? nr : `${tb}, dont ${Rp.iT(I.mob.tbBon)} en bon état · ${Rp.iRat(act.length, tb)} élèves par table-banc`],
      ['Toilettes des élèves', I.toil.existe === 'oui' ? `${Rp.iT(I.toil.eleves.n)} cabine(s), ${Rp.iT(I.toil.eleves.fonct)} fonctionnelle(s)` : I.toil.existe === 'non' ? 'Aucune' : nr],
      ['Points d’eau', E2.existe === 'oui' ? `${Rp.iT(Rp.iSom(...C.EAUX.map(([k]) => E2[k].n)))}, dont ${Rp.iT(Rp.iSom(...C.EAUX.map(([k]) => E2[k].fonct)))} fonctionnel(s)` : E2.existe === 'non' ? 'Aucun' : nr],
      ['Électricité à l’école', I.elec.ecole ? Rp.iL(C.ON, I.elec.ecole) : nr],
      ['Cantine', I.cant.existe === 'oui' ? `Oui · fonctionnelle : ${Rp.iL(C.ON, I.cant.fonct)}${I.cant.ration ? ` · ${I.cant.ration} rationnaires` : ''}` : I.cant.existe === 'non' ? 'Non' : nr],
      ['Distance jusqu’à l’IEPP', I.acces.dist === '' || I.acces.dist == null ? nr : `${Rp.iT(I.acces.dist)} km`]
    ];
    const actions = html`<div class="ligne">${peut('rapports.officiels') ? html`<button type="button" class="btn btn-sm btn-pri" data-action="rap-infra-modifier">${ic('edit')}Renseigner</button>` : ''}<button type="button" class="btn btn-sm" data-action="rap-infra-imprimer">${ic('print')}Imprimer</button></div>`;
    return ui.carte('Rapport d’infrastructures', html`${I.maj ? '' : ui.encadre('Pas encore renseigné : bâtiments, toilettes, eau, électricité, mobilier, cantine, manuels, accès. Ces informations alimentent aussi la fiche de synthèse pour l’IEPP.', 'avert')}<dl class="kv mt">${lignes.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`, { sous: I.maj ? `Mis à jour le ${u.fmtDate(I.maj)}` : 'À renseigner', actions, cls: 'rap-infra' });
  }
  const LISTES = [['effectifs', 'Tableau des effectifs', 'Par classe et par sexe', 'chart'], ['registre-eleves', 'Registre général', 'Tous les élèves', 'book'], ['etat-classe', 'État de chaque classe', 'Liste et statistiques', 'grid'],
    ['ages-extraits', 'Âges et extraits', 'Par niveau et par sexe', 'chart'], ['dossiers-regulariser', 'Dossiers à régulariser', 'Élèves sans extrait', 'file'], ['liste-personnel', 'Liste du personnel', 'Fonctions, classes', 'brief']];

  function rendreStats(p) {
    const x = X(), Rp = R(), nv = x.niveaux(), act = x.actifs(), tous = S().students, per = p.ev === 'A' ? 'A' : evDe(p.ev);
    const [g, f] = x.compteSexe(act), ext = act.filter((s) => s.extrait).length, red = act.filter((s) => s.redoublant).length, partis = tous.filter((s) => s.statut !== 'Inscrit').length;
    const rs = nv.map((c) => x.reussite(c, per)), ok = somme(rs, (z) => z.ok), n = somme(rs, (z) => z.n);
    const pers = S().teachers.filter((t) => t.actif !== false), ens = pers.filter((t) => x.clsDe(t).length), femmes = pers.filter(x.estFemme).length;
    const perLib = per === 'A' ? 'Annuel (MGA)' : C.evCourt(per);
    const vide = !act.length;

    const kpis = html`<div class="grille g4 mb">
      ${ui.kpi({ icone: 'users', lib: 'Élèves inscrits', val: act.length, sous: `${g} garçons · ${f} filles`, extra: html`<div class="repartition" aria-hidden="true"><i class="g-col" style="flex:${g}"></i><i class="f-col" style="flex:${f}"></i></div>` })}
      ${ui.kpi({ icone: 'heart', lib: 'Part des filles', val: u.pct(f, act.length), sous: `${f} fille(s) sur ${act.length}` })}
      ${ui.kpi({ icone: 'file', lib: 'Dossiers complets', val: u.pct(ext, act.length), sous: `avec extrait · ${act.length - ext} à régulariser`, lien: act.length - ext ? 'eleves/liste?dossier=sans' : null, ton: act.length - ext ? 'avert' : '' })}
      ${ui.kpi({ icone: 'award', lib: 'Réussite', val: u.pct(ok, n), sous: n ? `${perLib} · ${ok} sur ${n} au seuil` : `${perLib} · aucune moyenne complète` })}
    </div>
    <div class="grille g4 mb">
      ${ui.kpi({ icone: 'refresh', lib: 'Redoublants', val: red, sous: `${u.pct(red, act.length)} des inscrits` })}
      ${ui.kpi({ icone: 'logout', lib: 'Abandons et départs', val: partis, sous: 'abandons, exclusions, transferts', ton: partis ? 'avert' : '' })}
      ${ui.kpi({ icone: 'brief', lib: 'Personnel en activité', val: pers.length, sous: `${ens.length} tenant une classe · ${femmes} femme(s)` })}
      ${ui.kpi({ icone: 'grid', lib: 'Élèves par enseignant', val: Rp.iRat(act.length, ens.length), sous: `${nv.length} niveau(x) ouvert(s)` })}
    </div>`;

    // effectifs par classe et sexe + anneau garçons / filles
    const maxCl = Math.max(1, ...nv.map((c) => x.actifsDe(c).length));
    const pf = act.length ? (f / act.length) * 100 : 0, pg = act.length ? (g / act.length) * 100 : 0;
    const effectifs = ui.carte('Effectifs par classe et par sexe', html`<div class="barres rap-barres" role="list" aria-label="Effectifs par classe">${nv.map((c) => barreSexe(c, x.actifsDe(c), maxCl))}</div>
      <div class="ligne mt rap-anneau"><div class="anneau" aria-hidden="true" style="background:conic-gradient(var(--cg) 0 ${pg.toFixed(2)}%, var(--cf) ${pg.toFixed(2)}% ${(pg + pf).toFixed(2)}%, var(--sunk) ${(pg + pf).toFixed(2)}% 100%)"><span>${act.length}<small>élèves</small></span></div>
      <dl class="kv"><dt>Garçons</dt><dd>${g} (${u.pct(g, act.length)})</dd><dt>Filles</dt><dd>${f} (${u.pct(f, act.length)})</dd>${act.length - g - f ? html`<dt>Sexe non renseigné</dt><dd>${act.length - g - f}</dd>` : ''}</dl></div>`, { sous: `${act.length} élèves inscrits`, actions: legendeSexe });

    // âges
    const ages = C.BINS.map((b) => [b, act.filter((s) => tranche(x.ageDe(s)) === b)]), maxA = Math.max(1, ...ages.map(([, L]) => L.length)), sansAge = act.filter((s) => x.ageDe(s) == null).length, anormaux = act.filter((s) => x.ageAnormal(s)).length;
    const carteAges = ui.carte('Âges', html`<div class="barres rap-barres" role="list" aria-label="Élèves par âge">${ages.map(([b, L]) => barreSexe(`${b} ans`, L, maxA))}</div>
      ${sansAge || anormaux ? html`<p class="mut petit mt">${sansAge ? `${u.pluriel(sansAge, 'élève')} sans date de naissance. ` : ''}${anormaux ? html`${u.pluriel(anormaux, 'âge')} à vérifier (écart avec l’âge normal du niveau) : ${lien('eleves/liste?dossier=age', 'voir les élèves')}.` : ''}</p>` : ''}
      ${details('Tableau détaillé par niveau et par sexe', html`<div class="tab-cadre mt">${Rp.tableAges('tab rap-matrice')}</div>`)}`,
    { sous: `Âge au 1er octobre ${x.anneeRentree()}`, actions: html`<div class="ligne">${legendeSexe}${peut('donnees.exporter') ? html`<button type="button" class="btn btn-sm" data-action="rap-stats-ages-csv">${ic('down')}Excel (CSV)</button>` : ''}</div>` });

    // nationalités
    const nats = Object.entries(act.reduce((o, s) => {
      const k = u.capitale(String(s.nationalite || C.NAT_DEFAUT).toLowerCase());
      o[k] = (o[k] || 0) + 1;
      return o;
    }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
    const tete = nats.slice(0, 7), autres = somme(nats.slice(7), ([, k]) => k), ivo = act.filter(x.estIvoirien).length;
    const carteNat = ui.carte('Nationalités', html`<div class="barres rap-barres larges" role="list" aria-label="Élèves par nationalité">${[...tete, ...(autres ? [['Autres', autres]] : [])].map(([k, v]) => barreTaux(k, act.length ? v / act.length : 0, html`<b>${v}</b> · ${u.pct(v, act.length)}`))}</div>`, { sous: `${ivo} ivoirien(s) · ${act.length - ivo} étranger(s)` });

    // extraits et redoublants par classe
    const carteExtraits = ui.carte('Extraits de naissance', html`<div class="barres rap-barres larges" role="list" aria-label="Élèves avec extrait de naissance, par classe">${nv.map((c) => {
      const L = x.actifsDe(c), a = L.filter((s) => s.extrait).length;
      return barreTaux(c, L.length ? a / L.length : null, html`<b>${a}</b>/${L.length} · ${u.pct(a, L.length)}`);
    })}</div>${details('Tableau par niveau et par sexe', html`<div class="tab-cadre mt">${Rp.tableExtraits('tab rap-matrice')}</div>`)}`,
    { sous: 'Part des élèves ayant un extrait, par classe', actions: act.length - ext ? html`<a class="btn btn-sm" href="#eleves/liste?dossier=sans">${ic('users')}Élèves sans extrait</a>` : '' });
    const carteRed = ui.carte('Redoublants', html`<div class="barres rap-barres larges" role="list" aria-label="Redoublants par classe">${nv.map((c) => {
      const L = x.actifsDe(c), Rd = L.filter((s) => s.redoublant), [rg, rf] = x.compteSexe(Rd);
      return barreTaux(c, L.length ? Rd.length / L.length : null, html`<b>${Rd.length}</b> (${rg} G, ${rf} F) · ${u.pct(Rd.length, L.length)}`);
    })}</div>`, { sous: `${red} redoublant(s) sur ${act.length} inscrits` });

    // résultats par classe (évaluation choisie) et par évaluation
    const choixPer = ui.pilules([...[1, 2, 3, 4].map((k) => [String(k), C.evCourt(k)]), ['A', 'Annuel']], String(per), 'rap-stats-ev', { 'aria-controls': 'rap-stats-res' });
    const lignesRes = nv.map((c, i) => {
      const m = x.moyClasse(c, per), e = x.echelle(c), r = rs[i], s = x.info(c).seuil;
      return barreTaux(c, m == null ? null : m / e, html`<b>${u.fmtNote(m)}</b>/${e} · ${r.n ? `${pourcent(r.ok, r.n)} % au seuil` : 'aucune moyenne'}`, s / e);
    });
    const matrice = html`<div class="tab-cadre mt"><table class="tab rap-matrice"><caption class="sr">Taux de réussite et moyenne de chaque classe, par évaluation</caption><thead><tr><th scope="col">Classe</th>${[1, 2, 3, 4].map((k) => html`<th scope="col">${C.evCourt(k)}</th>`)}<th scope="col">Annuel (MGA)</th></tr></thead><tbody>${nv.map((c) => html`<tr><th scope="row">${c}</th>${[1, 2, 3, 4, 'A'].map((k) => {
      const r = x.reussite(c, k), m = x.moyClasse(c, k);
      return html`<td>${r.n ? html`<b>${pourcent(r.ok, r.n)} %</b><br><span class="mut petit">${u.fmtNote(m)}/${x.echelle(c)} · ${r.n} él.</span>` : html`<span class="mut">—</span>`}</td>`;
    })}</tr>`)}</tbody></table></div>`;
    const carteRes = ui.carte('Résultats par classe', html`<div class="barre-outils">${choixPer}</div><div class="barres rap-barres" id="rap-stats-res" role="list" aria-label="Moyenne et réussite par classe : ${perLib}">${lignesRes}</div><p class="mut petit">Barre : moyenne de la classe ; trait pointillé : seuil d’admission.</p>${details('Toutes les évaluations (taux de réussite et moyenne)', matrice)}`,
    { sous: `${perLib} · ${n ? `${u.pct(ok, n)} de réussite (${ok} sur ${n})` : 'aucune moyenne complète'}`, actions: html`<a class="btn btn-sm" href="#notes/resultats">${ic('award')}Résultats détaillés</a>` });

    // absences par mois
    const abs = statsAbsences(), maxM = Math.max(1, ...abs.map((z) => z.t));
    const carteAbs = ui.carte('Absences par mois', html`<div class="colonnes rap-colonnes">${abs.map((z) => html`<div role="img" aria-label="${libMois(z.m)} : ${z.a} non justifiée(s), ${z.j} justifiée(s)" data-bulle="${libMois(z.m)} : ${z.a} non justifiée(s), ${z.j} justifiée(s)"><b>${z.t || ''}</b>${z.j ? html`<i class="g-col" style="height:${(z.j / maxM) * 118}px"></i>` : ''}${z.a ? html`<i class="f-col" style="height:${(z.a / maxM) * 118}px"></i>` : ''}</div>`)}</div>
      <div class="etiq-col" aria-hidden="true">${abs.map((z) => html`<span>${COURT[z.m]}</span>`)}</div>
      ${details('Tableau des absences par mois', html`<div class="tab-cadre mt"><table class="tab rap-matrice"><thead><tr><th scope="col">Mois</th><th scope="col">Non justifiées</th><th scope="col">Justifiées</th><th scope="col">Jours d’appel</th><th scope="col">Assiduité</th></tr></thead><tbody>${abs.map((z) => html`<tr><th scope="row">${libMois(z.m)}</th><td>${z.a}</td><td>${z.j}</td><td>${z.appels}</td><td>${z.appels && z.assiduite != null ? (z.assiduite * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</td></tr>`)}</tbody><tfoot><tr><th scope="row">Total</th><td>${somme(abs, (z) => z.a)}</td><td>${somme(abs, (z) => z.j)}</td><td>${somme(abs, (z) => z.appels)}</td><td></td></tr></tfoot></table></div><p class="mut petit">Une absence = un élève absent un jour. Assiduité = 1 − absences ÷ (inscrits × jours de classe du mois).</p>`)}`,
    { sous: 'Jours d’absence des élèves, de septembre à juillet', actions: html`<div class="legende"><span><i class="f-col"></i>Non justifiées</span><span><i class="g-col"></i>Justifiées</span></div>` });

    // personnel
    const sansEns = nv.filter((c) => !x.enseignantDe(c));
    const cartePers = ui.carte('Personnel', html`<dl class="kv"><dt>En activité</dt><dd>${pers.length} (${femmes} femme(s), ${pers.length - femmes} homme(s))</dd><dt>Tenant une classe</dt><dd>${ens.length}</dd><dt>Sans classe</dt><dd>${pers.length - ens.length} (direction, autres fonctions)</dd><dt>Élèves par enseignant</dt><dd>${Rp.iRat(act.length, ens.length)}</dd><dt>Classes sans enseignant</dt><dd>${sansEns.length ? sansEns.join(', ') : 'Aucune'}</dd></dl>
      <h3 class="rap-sous-titre mt">Types de fonctionnement des classes</h3><div class="tab-cadre">${Rp.blocFonct('tab rap-matrice')}</div>`,
    { sous: 'Enseignants et fonctionnement des classes (repris dans le rapport de rentrée)', actions: peut('personnel.voir') ? html`<a class="btn btn-sm" href="#personnel/liste">${ic('brief')}Personnel</a>` : '' });

    const listes = ui.carte('Listes à imprimer', html`<div class="tuiles">${LISTES.map(([id, lib, sous, icone]) => html`<button type="button" class="tuile" data-action="rap-stats-liste" data-modele="${id}"><span class="ti">${ic(icone)}</span><span><b>${lib}</b><small>${sous}</small></span></button>`)}</div>`, { sous: 'États de gestion datés, paginés automatiquement' });

    return html`${ui.pageTete('Statistiques', 'Indicateurs calculés à partir de vos données, listes à imprimer et rapport d’infrastructures.', html`<button type="button" class="btn btn-pri" data-action="rap-synthese">${ic('print')}Synthèse pour l’IEPP</button>`)}
      ${S().meta.demo ? ui.encadre('Démonstration : chiffres calculés sur des élèves fictifs.', '') : ''}
      ${kpis}
      ${vide ? ui.encadre(html`Aucun élève inscrit : les statistiques se rempliront au fil des inscriptions. ${lien('eleves/liste', 'Inscrire des élèves')}`, 'avert') : ''}
      <div class="grille g2 mb">${effectifs}${carteRes}</div>
      <div class="grille g2 mb">${carteAges}${carteAbs}</div>
      <div class="grille g3 mb rap-g3">${carteNat}${carteExtraits}${carteRed}</div>
      <div class="grille g2 mb">${cartePers}${carteInfra()}</div>
      ${listes}`;
  }

  /* ---------- Formulaire des infrastructures ---------- */
  function fenetreInfra() {
    AK.perm.exiger('rapports.officiels');
    const I = R().infra(), Tt = I.toil, el = Tt.eleves, Ea = I.eau, man = (c) => I.manuels[c] || {};
    const id = (nom) => 'inf-' + nom.replace(/\./g, '-');
    const num = (nom, lib, dec) => F.nombre({ nom, lib, id: id(nom), val: valeurInfra(I, nom) ?? '', attrs: { min: 0, max: dec ? 9999 : 99999, step: dec ? '0.1' : '1', inputmode: dec ? 'decimal' : 'numeric' } });
    const sel = (nom, lib, L) => {
      const v = String(valeurInfra(I, nom) ?? ''), opts = L.map((o) => (Array.isArray(o) ? o : [o, o]));
      if (v && !opts.some(([k]) => k === v)) opts.push([v, v]); // valeur d'une version précédente : conservée
      return F.choix({ nom, lib, id: id(nom), val: v, options: opts, vide: 'Non renseigné' });
    };
    const si = (nom, corps) => html`<div class="form-grille plein" data-si="${nom}">${corps}</div>`;
    const st = (t) => html`<h3 class="plein rap-sous-titre">${t}</h3>`;
    const grille = (corps) => html`<div class="form-grille">${corps}</div>`;
    const onglets = [
      ['bat', 'Bâtiments', grille(html`${num('bat.agglo', 'Bâtiments en dur (agglos)')}${num('bat.prov', 'Bâtiments en matériaux provisoires')}${num('salles.agglo', 'Salles de classe en dur')}${num('salles.prov', 'Salles de classe en matériaux provisoires')}`)],
      ['toil', 'Toilettes', grille(html`${sel('toil.existe', 'L’école a-t-elle des toilettes ?', C.ON)}${si('toil.existe', html`${st('Toilettes des élèves')}${sel('toil.eleves.type', 'Type', C.TOIL_T)}${num('toil.eleves.n', 'Nombre de cabines')}${num('toil.eleves.fonct', 'Dont fonctionnelles')}${sel('toil.eleves.sep', 'Séparées filles / garçons ?', C.ON)}${si('toil.eleves.sep', html`${num('toil.eleves.nf', 'Cabines des filles')}${num('toil.eleves.ng', 'Cabines des garçons')}`)}
        ${st('Toilettes des enseignants')}${sel('toil.ens.type', 'Type', C.TOIL_T)}${num('toil.ens.n', 'Nombre de cabines')}${num('toil.ens.fonct', 'Dont fonctionnelles')}${sel('toil.ens.sep', 'Séparées hommes / femmes ?', C.ON)}`)}`)],
      ['eau', 'Eau et électricité', grille(html`${sel('eau.existe', 'L’école a-t-elle un point d’eau ?', C.ON)}${si('eau.existe', C.EAUX.map(([k, l]) => html`${num(`eau.${k}.n`, `${l} : nombre`)}${num(`eau.${k}.fonct`, `${l} : dont fonctionnels`)}`))}
        ${st('Électricité')}${sel('elec.village', 'Dans le village', C.ON)}${sel('elec.ecole', 'À l’école', C.ON)}${sel('elec.salles', 'Dans les salles de classe', C.ONP)}`)],
      ['mob', 'Mobilier et cantine', grille(html`${num('mob.tb', 'Tables-bancs')}${num('mob.tbBon', 'Dont en bon état')}${num('mob.bureaux', 'Bureaux de maître')}${num('mob.tableaux', 'Tableaux')}
        ${st('Logements des enseignants')}${sel('loge.existe', 'Y a-t-il des logements ?', C.ON)}${si('loge.existe', num('loge.n', 'Nombre de logements'))}
        ${st('Cantine scolaire')}${sel('cant.existe', 'Y a-t-il une cantine ?', C.ON)}${si('cant.existe', html`${sel('cant.fonct', 'Fonctionnelle ?', C.ON)}${num('cant.ration', 'Nombre de rationnaires')}${sel('cant.partenaire', 'Partenaire', C.PARTS)}`)}`)],
      ['loc', 'Locaux et accès', grille(html`${C.LOCAUX.map(([k, l, p]) => sel('locaux.' + k, l, p ? C.ONP : C.ON))}${st('Accès et sécurité')}${num('acces.dist', 'Distance jusqu’à l’IEPP (km)', true)}${sel('acces.route', 'État de la route', C.ROUTES)}${sel('acces.reseau', 'Réseau téléphone', C.RESEAUX)}${sel('acces.rampe', 'Rampe pour handicapés', C.ON)}${sel('acces.pharma', 'Boîte à pharmacie', C.ON)}`)],
      ['man', 'Manuels', X().niveaux().length ? grille(X().niveaux().map((c) => html`${num(`manuels.${c}.lec`, `${c} : manuels de lecture`)}${num(`manuels.${c}.mat`, `${c} : manuels de mathématiques`)}`)) : ui.vide('Aucun niveau ouvert', 'Les manuels se renseignent par niveau ouvert.')]
    ];
    void el; void Ea; void man;
    ui.fenetre({
      titre: 'Rapport d’infrastructures', icone: 'building', taille: 'lg', ok: 'Enregistrer',
      corps: html`<div class="pile"><p class="mut petit mb0">Laissez vide ce que vous ne savez pas. Si vous répondez « Non » (pas de toilettes, de point d’eau, de logement ou de cantine), les détails correspondants sont effacés.</p>${ui.ongletsForm(onglets)}</div>`,
      apres(dlg) {
        const f = $('form', dlg);
        const maj = () => $$('[data-si]', f).forEach((z) => {
          const e = f.elements[z.dataset.si];
          z.hidden = !(e && e.value === 'oui');
        });
        f.addEventListener('change', maj);
        maj();
      },
      surValider(d) {
        const avant = infrastructures.enregistrer(d);
        ui.toast('Rapport d’infrastructures enregistré.', { action: { lib: 'Annuler', f: secu(() => infrastructures.restaurer(avant)) }, duree: 10000 });
      }
    });
  }

  /* =====================================================================================
     Transmission à l'IEPP
     ===================================================================================== */
  const transmis = () => (S().pro.transmis || []).filter((t) => t && typeof t === 'object');
  const libEv = (n) => C.EV_GEN[n - 1];
  /** Texte court à coller dans un courriel ou un message (l'application n'envoie rien elle-même). */
  function resumeTexte(n, pk) {
    const sc = S().school, T = somme(pk.effectifs, (e) => e.T), Fi = somme(pk.effectifs, (e) => e.F);
    const ok = somme(pk.resultats, (r) => r.admis_seuil), ev = somme(pk.resultats, (r) => r.evalues);
    const [y, m] = String(pk.absences_mois.mois).split('-').map(Number);
    return [
      `Transmission IEPP – ${sc.name || 'école'}${sc.codeecole ? ` (code ${sc.codeecole})` : ''} – année ${sc.year || '—'}`,
      `${libEv(n)} : ${T} élèves dont ${Fi} filles ; ${ev ? `${pourcent(ok, ev)} % au seuil (${ok} sur ${ev} évalués)` : 'aucune moyenne complète'}.`,
      ...pk.effectifs.map((e, i) => {
        const r = pk.resultats[i];
        return `• ${e.classe} : ${e.T} élèves (${e.G} G, ${e.F} F)${r.moyenne == null ? '' : `, moyenne ${u.fmtNote(r.moyenne)}/${r.echelle}`}${r.taux == null ? '' : `, réussite ${String(r.taux).replace('.', ',')} %`}`;
      }),
      `Absences de ${m ? C.MOIS[m - 1].toLowerCase() : ''} ${y || ''} : ${pk.absences_mois.non_justifiees} non justifiée(s), ${pk.absences_mois.justifiees} justifiée(s).`,
      `Personnel : ${pk.personnel.length} · Candidats au CEPE : ${pk.cepe.candidats} · Faits de discipline : ${pk.vie_scolaire.incidents}.`,
      sc.director ? `${sc.director}, ${/^(mme|mlle)/i.test(sc.director) ? 'directrice' : 'directeur'}${sc.dirTel ? ' · ' + sc.dirTel : ''}` : ''
    ].filter(Boolean).join('\n');
  }
  function rendreLiaison(p) {
    const x = X(), n = evDe(p.ev), pk = AK.pro.paquetIEPP(n), sc = S().school;
    const T = somme(pk.effectifs, (e) => e.T), Fi = somme(pk.effectifs, (e) => e.F);
    const [y, m] = String(pk.absences_mois.mois).split('-').map(Number), moisLib = m ? `${C.MOIS[m - 1]} ${y}` : '';
    const manquantes = x.notesManquantes(null, n);
    const ident = [['nom de l’école', sc.name], ['IEPP', sc.iepp], ['code de l’école', sc.codeecole], ['année scolaire', sc.year], ['directeur', sc.director]].filter(([, v]) => !String(v || '').trim()).map(([l]) => l);
    const dernier = transmis().find((t) => String(t.objet || '').startsWith(libEv(n) + ' ·'));
    const L = transmis().map((t, i) => ({ ...t, i }));
    const avert = [
      ident.length ? ui.encadre(html`Identification incomplète : ${ident.join(', ')}. ${peut('parametres.gerer') ? lien('parametres/ecole', 'Compléter les paramètres de l’école') : ''}`, 'avert') : '',
      manquantes ? ui.encadre(html`<b>${u.pluriel(manquantes, 'note manquante', 'notes manquantes')}</b> pour cette évaluation : les élèves concernés ne sont pas comptés dans les résultats. ${lien(`notes/saisie?ev=${n}`, 'Compléter la saisie')}`, 'avert') : '',
      !pk.effectifs.length ? ui.encadre('Aucune classe ouverte : rien à transmettre.', 'erreur') : '',
      dernier ? ui.encadre(`Cette évaluation a déjà été transmise le ${u.fmtDate(dernier.date)}. Un nouveau fichier remplace le précédent auprès de l’IEPP si les chiffres ont changé.`, '') : ''
    ];
    const tableau = html`<div class="tab-cadre"><table class="tab rap-matrice"><caption class="sr">Effectifs et résultats par classe : ${libEv(n)}</caption><thead><tr><th scope="col">Classe</th><th scope="col">G</th><th scope="col">F</th><th scope="col">Total</th><th scope="col">Moyenne</th><th scope="col">Évalués</th><th scope="col">Au seuil</th><th scope="col">Taux</th></tr></thead>
      <tbody>${pk.effectifs.map((e, i) => {
        const r = pk.resultats[i];
        return html`<tr><th scope="row">${e.classe}</th><td>${e.G}</td><td>${e.F}</td><td><b>${e.T}</b></td><td>${r.moyenne == null ? '—' : `${u.fmtNote(r.moyenne)} / ${r.echelle}`}</td><td>${r.evalues}</td><td>${r.admis_seuil}</td><td>${r.taux == null ? '—' : String(r.taux).replace('.', ',') + ' %'}</td></tr>`;
      })}</tbody><tfoot><tr><th scope="row">Total</th><td>${somme(pk.effectifs, (e) => e.G)}</td><td>${Fi}</td><td><b>${T}</b></td><td></td><td>${somme(pk.resultats, (r) => r.evalues)}</td><td>${somme(pk.resultats, (r) => r.admis_seuil)}</td><td>${u.pct(somme(pk.resultats, (r) => r.admis_seuil), somme(pk.resultats, (r) => r.evalues))}</td></tr></tfoot></table></div>`;
    const contenu = html`<dl class="kv"><dt>École</dt><dd>${sc.name || '—'}${sc.codeecole ? ` · code ${sc.codeecole}` : ''} · ${sc.iepp || 'IEPP non renseignée'}</dd><dt>Évaluation</dt><dd>${libEv(n)}</dd><dt>Absences (${moisLib})</dt><dd>${pk.absences_mois.non_justifiees} non justifiée(s), ${pk.absences_mois.justifiees} justifiée(s)</dd>
      <dt>Personnel</dt><dd>${pk.personnel.length} : noms, fonctions et classes (sans téléphone)</dd><dt>Candidats au CEPE</dt><dd>${pk.cepe.candidats}</dd><dt>Vie scolaire</dt><dd>${pk.vie_scolaire.incidents} fait(s) de discipline, ${pk.vie_scolaire.soins} passage(s) à l’infirmerie (nombre seulement), ${pk.vie_scolaire.inscrits_cantine} inscrit(s) à la cantine</dd><dt>Finances</dt><dd>${u.fcfa(pk.finances.encaisse)} encaissés, ${u.fcfa(pk.finances.depenses)} de dépenses</dd></dl>
      <p class="mut petit mb0">${ic('shield', 'i-sm')} Aucun nom d’élève, aucune note individuelle ni donnée de santé nominative ne figure dans le fichier.</p>`;
    const historique = ui.tableau({
      id: 'rap-liaison-historique', lignes: L, cleId: (o) => String(o.i), unite: 'transmission', parPage: 20, triDefaut: { cle: 'date', sens: 'desc' }, legende: 'Transmissions effectuées',
      recherche: (o) => `${o.objet || ''} ${u.fmtDate(o.date)}`, placeholder: 'Rechercher une évaluation, un fichier…', exporter: peut('donnees.exporter') ? 'transmissions-iepp' : null,
      colonnes: [
        { cle: 'date', lib: 'Date', tri: (o) => o.date || '', rendu: (o) => ui.tag(u.fmtDate(o.date) || '—', 'ok', 'checkCircle'), csv: (o) => o.date || '' },
        { cle: 'objet', lib: 'Évaluation et fichier', cls: 'texte', tri: (o) => o.objet || '', rendu: (o) => html`<span class="rap-texte">${o.objet || '—'}</span>`, csv: (o) => o.objet || '' }
      ],
      vide: ui.vide('Aucune transmission pour l’instant', 'Chaque fichier enregistré pour l’IEPP est noté ici, avec sa date.')
    });
    return html`${ui.pageTete('Transmission à l’IEPP', 'Effectifs, résultats, absences, personnel et CEPE en un fichier à remettre à l’Inspection par clé USB, courriel ou WhatsApp, avec sa fiche imprimée.', html`<button type="button" class="btn" data-action="rap-liaison-fiche">${ic('print')}Fiche de transmission</button><button type="button" class="btn" data-action="rap-synthese">${ic('print')}Fiche de synthèse</button>${pk.effectifs.length ? html`<button type="button" class="btn btn-pri" data-action="rap-liaison-fichier">${ic('save')}Enregistrer le fichier</button>` : ''}`)}
      <div class="barre-outils"><label class="sr" for="rap-liaison-ev">Évaluation transmise</label><select class="inp inp-sm" id="rap-liaison-ev" data-change="rap-liaison-ev" aria-label="Évaluation transmise">${ui.options(optionsEv(), String(n))}</select><span class="mut petit">Les résultats portent sur cette évaluation ; les absences, sur le mois en cours.</span></div>
      ${avert.some((a) => a !== '') ? html`<div class="pile-sm mb">${avert}</div>` : ''}
      <div class="grille g4 mb">
        ${ui.kpi({ icone: 'users', lib: 'Effectif', val: T, sous: `${Fi} fille(s)` })}
        ${ui.kpi({ icone: 'grid', lib: 'Classes', val: pk.effectifs.length, sous: 'niveaux ouverts' })}
        ${ui.kpi({ icone: 'brief', lib: 'Personnel', val: pk.personnel.length, sous: 'en activité' })}
        ${ui.kpi({ icone: 'cal', lib: 'Absences non justifiées', val: pk.absences_mois.non_justifiees, sous: moisLib, ton: pk.absences_mois.non_justifiees ? 'avert' : '' })}
      </div>
      <div class="grille g-2-1 mb">${ui.carte('Effectifs et résultats par classe', tableau, { sous: libEv(n) })}${ui.carte('Contenu du fichier', contenu, { actions: html`<div class="ligne"><button type="button" class="btn btn-sm" data-action="rap-liaison-json">${ic('eye')}Voir le fichier</button><button type="button" class="btn btn-sm" data-action="rap-liaison-resume">${ic('copy')}Résumé à copier</button></div>` })}</div>
      ${ui.carte('Transmissions effectuées', historique, { sous: 'Historique conservé dans les sauvegardes' })}`;
  }

  /* =====================================================================================
     Déclaration des écrans
     ===================================================================================== */
  const compteOnglet = (r) => (r === R_GEN && peut('rapports.generateur') ? rapports().length || null : null);
  AK.ecrans.def(R_OFF, { rendu: rendreOfficiels, apres: apresOfficiels, droit: 'rapports.officiels', compteOnglet });
  AK.ecrans.def(R_GEN, { rendu: rendreGenerateur, apres: apresGenerateur, droit: 'rapports.generateur', compteOnglet });
  AK.ecrans.def(R_STATS, { rendu: rendreStats, droit: 'stats.voir', compteOnglet });
  AK.ecrans.def(R_LIAISON, { rendu: rendreLiaison, droit: 'liaison.gerer', compteOnglet });
  AK.ecransRapports = { fenetreNouveau, fenetreInfra, resumeTexte };

  /* =====================================================================================
     Actions
     ===================================================================================== */
  AK.actions.def({
    /* ----- Rapports officiels ----- */
    'rap-off-choix': (el) => allerPropre(R_OFF, { ...AK.shell.params(), rap: el.dataset.v }),
    'rap-off-imprimer'() {
      AK.perm.exiger('rapports.officiels');
      const st = etatOfficiel(AK.shell.params()), bloquant = controlesOfficiel(st).find(([t]) => t === 'erreur');
      if (bloquant) throw E(String(bloquant[1]).replace(/<[^>]*>/g, ''));
      const per = st.cle === 'compo' ? '-' + C.evCourt(st.ev) : st.cle === 'mensuel' ? '-' + libMois(st.mois) : st.cle === 'resultats' ? `-${st.classe}-${C.evCourt(st.ev)}` : '';
      return AK.docs.ouvrir(st.modele, [st.ctx], { nomFichier: slug(st.lib + per) });
    },
    'rap-off-copier'() {
      const st = etatOfficiel(AK.shell.params());
      const r = generateur.creer({ modele: st.cle, ev: st.ev, mois: st.mois, classe: st.classe || '' });
      allerPropre(R_GEN, { id: r.id });
      ui.toast(`Copie modifiable créée : « ${r.titre} ». Le rapport officiel reste inchangé.`);
    },

    /* ----- Générateur ----- */
    'rap-gen-nouveau': () => (AK.perm.exiger('rapports.generateur'), fenetreNouveau()),
    'rap-gen-choisir': (el) => allerPropre(R_GEN, { id: el.dataset.id }),
    'rap-gen-ajouter'(el) {
      const sel = $('#rap-gen-type'), b = generateur.ajouterBloc(el.dataset.id, sel ? sel.value : '');
      ui.toast(`Bloc « ${BL()[b.type].lab} » ajouté.`);
      setTimeout(() => {
        const t = document.getElementById('rap-bt-' + b.id);
        if (t) t.focus();
      }, 80);
    },
    'rap-gen-deplacer'(el) {
      const sens = Number(el.dataset.sens);
      if (!generateur.deplacerBloc(el.dataset.id, el.dataset.bid, sens)) return;
      // le focus suit le bloc déplacé (clavier) : même bouton, ou l'autre s'il a disparu en bout de liste
      setTimeout(() => {
        const b = document.getElementById(`rap-mv-${el.dataset.bid}-${sens < 0 ? 'h' : 'b'}`) || document.getElementById(`rap-mv-${el.dataset.bid}-${sens < 0 ? 'b' : 'h'}`);
        if (b) b.focus();
      }, 80);
    },
    async 'rap-gen-retirer'(el) {
      const r = rapportParams(el), b = blocsDe(r).find((x) => x.id === el.dataset.bid);
      if (!b) throw E('Bloc introuvable : il a peut-être déjà été retiré.');
      const B = BL()[b.type], texte = String(S().redac[cleTexte(r.id, b.id)] || '').trim();
      if (texte && !(await ui.confirmer({ titre: 'Retirer une zone rédigée', danger: true, ok: 'Retirer le bloc', message: html`Ce bloc contient un texte rédigé (${u.pluriel(texte.length, 'caractère')}). Le retirer efface ce texte ; vous pourrez annuler juste après.` }))) return;
      const sauv = generateur.retirerBloc(r.id, b.id);
      ui.toast(`Bloc « ${B ? B.lab : b.type} » retiré.`, { action: { lib: 'Annuler', f: secu(() => generateur.remettreBloc(sauv)) }, duree: 10000 });
    },
    'rap-gen-dupliquer'(el) {
      const c = generateur.dupliquer(el.dataset.id);
      allerPropre(R_GEN, { id: c.id });
      ui.toast(`Copie créée : « ${c.titre} ».`);
    },
    async 'rap-gen-supprimer'(el) {
      AK.perm.exiger('rapports.generateur');
      const r = rapportParams(el);
      if (!(await ui.confirmer({ titre: 'Supprimer le rapport', danger: true, ok: 'Supprimer', message: html`Supprimer le rapport « <b>${r.titre || 'sans titre'}</b> » (${u.pluriel(blocsDe(r).length, 'bloc')}) et ses textes rédigés ? Vous pourrez annuler juste après.` }))) return;
      const sauv = generateur.supprimer(r.id);
      allerPropre(R_GEN, {});
      ui.toast(`Rapport « ${r.titre || 'sans titre'} » supprimé.`, {
        action: { lib: 'Annuler', f: secu(() => { generateur.restaurer(sauv); allerPropre(R_GEN, { id: sauv.rapport.id }); }) }, duree: 12000
      });
    },
    'rap-gen-imprimer'(el) {
      AK.perm.exiger('rapports.generateur');
      const r = rapportParams(el);
      if (!blocsDe(r).some((b) => BL()[b.type])) throw E('Ce rapport est vide : ajoutez au moins un bloc avant de l’imprimer.');
      return AK.docs.ouvrir('rapport-perso', [{ rapport: r }], { reglages: reglagesPerso(r), titre: `Rapport · ${r.titre || 'sans titre'}`, nomFichier: slug(r.titre) });
    },

    /* ----- Statistiques ----- */
    'rap-stats-ev': (el) => allerPropre(R_STATS, { ...AK.shell.params(), ev: el.dataset.v }),
    'rap-stats-liste'(el) {
      AK.perm.exiger('stats.voir');
      const d = AK.modeles.get(el.dataset.modele);
      if (!d) throw E('Modèle de document inconnu.');
      const ctx = d.sujet === 'classe' ? X().niveaux().map((c) => ({ classe: c })) : [{}];
      if (!ctx.length) throw E('Aucune classe ouverte : renseignez d’abord les niveaux de l’école.');
      return AK.docs.ouvrir(d.id, ctx, { titre: ctx.length > 1 ? `${d.lib} · ${u.pluriel(ctx.length, 'classe')}` : d.lib, nomFichier: slug(d.lib) });
    },
    async 'rap-stats-ages-csv'() {
      AK.perm.exiger('stats.voir');
      const G = R().groupes();
      const lignes = [['Âge', ...G.flatMap(([l]) => [`${l} G`, `${l} F`, `${l} T`])], ...R().donneesAges().map((r) => [`${r[0]} ans`, ...r.slice(1)])];
      await AK.sauvegarde.csv(`eleves-par-age-${u.aujourdhui()}.csv`, lignes, 'élèves par âge, niveau et sexe');
      ui.toast('Fichier Excel (CSV) enregistré.');
    },
    'rap-infra-modifier': () => fenetreInfra(),
    'rap-infra-imprimer'() {
      AK.perm.exiger('stats.voir');
      return AK.docs.ouvrir('rapport-infrastructures', [{}], { nomFichier: 'rapport-infrastructures' });
    },
    'rap-synthese'() {
      if (!peut('stats.voir') && !peut('liaison.gerer')) throw new AK.ErreurDroits();
      return AK.docs.ouvrir('synthese-iepp', [{}], { nomFichier: 'synthese-iepp' });
    },

    /* ----- Transmission IEPP ----- */
    'rap-liaison-fiche'() {
      AK.perm.exiger('liaison.gerer');
      const n = evDe(AK.shell.params().ev);
      return AK.docs.ouvrir('fiche-transmission', [{ ev: n }], { nomFichier: `fiche-transmission-${slug(C.evCourt(n))}` });
    },
    async 'rap-liaison-fichier'() {
      AK.perm.exiger('liaison.gerer');
      const n = evDe(AK.shell.params().ev), pk = AK.pro.paquetIEPP(n);
      if (!pk.effectifs.length) throw E('Aucune classe ouverte : rien à transmettre.');
      if (S().meta.demo) pk.demonstration = 'Données fictives de l’école de démonstration';
      const nom = `transmission-iepp-${slug(S().school.name || 'ecole').slice(0, 24)}-${slug(C.evCourt(n))}-${u.aujourdhui()}.json`;
      const r = await AK.hote.fichier(nom, JSON.stringify(pk, null, 1), 'application/json');
      if (r === '' || r === false) return ui.toast('Enregistrement annulé : aucune transmission notée.', { type: 'avert' });
      AK.pro.noterTransmission(`${libEv(n)} · ${nom}`);
      ui.toast(`Fichier enregistré : ${nom}. Remettez-le à l’IEPP (clé USB, courriel ou WhatsApp).`);
    },
    'rap-liaison-json'() {
      AK.perm.exiger('liaison.gerer');
      const n = evDe(AK.shell.params().ev), pk = AK.pro.paquetIEPP(n);
      ui.fenetre({
        titre: `Contenu du fichier · ${C.evCourt(n)}`, icone: 'eye', taille: 'lg', ok: false, annuler: 'Fermer', proteger: false,
        corps: html`<div class="pile"><p class="mut petit mb0">Données exactes enregistrées dans le fichier (format JSON, lisible par l’IEPP et par un tableur).</p>${F.zone({ lib: 'Contenu du fichier', nom: 'json', id: 'rap-liaison-json-texte', val: JSON.stringify(pk, null, 2), lignes: 18, attrs: { readonly: true, spellcheck: 'false' } })}</div>`
      });
    },
    'rap-liaison-resume'() {
      AK.perm.exiger('liaison.gerer');
      const n = evDe(AK.shell.params().ev), texte = resumeTexte(n, AK.pro.paquetIEPP(n));
      ui.fenetre({
        titre: 'Résumé à copier', icone: 'copy', ok: false, annuler: 'Fermer', proteger: false,
        corps: html`<div class="pile">${F.zone({ lib: 'Résumé de la transmission', nom: 'texte', id: 'rap-liaison-resume-texte', val: texte, lignes: 10, attrs: { maxlength: 4000 }, aide: 'Modifiable avant de le copier. L’application n’envoie rien elle-même : collez ce texte dans votre courriel ou votre messagerie, avec le fichier.' })}
          <div class="ligne"><button type="button" class="btn btn-pri" data-rap-copier>${ic('copy')}Copier le texte</button></div></div>`,
        apres(racine) {
          const zone = $('#rap-liaison-resume-texte', racine);
          $('[data-rap-copier]', racine).addEventListener('click', async () => {
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
            ui.toast(ok ? 'Texte copié : collez-le dans votre courriel ou votre messagerie.' : 'Copie impossible : sélectionnez le texte puis Ctrl+C.', { type: ok ? 'ok' : 'avert' });
          });
        }
      });
    }
  });

  AK.actions.defChange({
    'rap-off-param': (el) => allerPropre(R_OFF, { ...AK.shell.params(), [el.dataset.f]: el.value }),
    'rap-liaison-ev': (el) => allerPropre(R_LIAISON, { ...AK.shell.params(), ev: el.value }),
    'rap-gen-depart'(el) {
      const v = el.value;
      el.value = '';
      if (v) fenetreNouveau(v);
    },
    /** Réglage du rapport modifié : enregistré à la sortie du champ ; erreur sous le champ. */
    'rap-gen-champ'(el) {
      const form = el.form;
      if (form) ui.effacerErreurs(form);
      try {
        generateur.modifier(el.dataset.id, { [el.name]: el.value });
      } catch (e) {
        if (e && e.name === 'ErreurMetier' && form) return ui.erreurChamp(form, e.champ || el.name, e.message);
        throw e;
      }
    },
    'rap-gen-bloc'(el) {
      try {
        generateur.modifierBloc(el.dataset.id, el.dataset.bid, { [el.dataset.k]: el.value });
      } catch (e) {
        AK.shell.redessiner(); // valeur refusée : l'écran reprend la valeur enregistrée
        throw e;
      }
    }
  });
  AK.actions.defEnvoi({
    /* Entrée dans un réglage : tout le formulaire est enregistré. */
    'rap-gen-reglages'(form) {
      ui.effacerErreurs(form);
      const d = ui.lireFormulaire(form);
      try {
        generateur.modifier(form.dataset.id, { titre: d.titre, sous: d.sous, pay: d.pay, ajuster: d.ajuster });
        ui.toast('Réglages du rapport enregistrés.');
      } catch (e) {
        if (e && e.name === 'ErreurMetier') return ui.erreurChamp(form, e.champ, e.message);
        throw e;
      }
    }
  });
})(window.AK);
