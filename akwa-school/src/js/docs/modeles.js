/* =====================================================================================
   Bibliothèque de modèles de documents (versionnée) et personnalisation par l'école.

   Un modèle déclare : identifiant, version, format de page, réglages par défaut (titre, texte
   rédigé avec des champs dynamiques, en-tête, champs affichés, signatures, filigrane, QR,
   pied de page) et une fonction de rendu. L'école enregistre seulement ses différences
   (S.modeles[id]) ; « Restaurer le modèle par défaut » les efface.

   Sécurité : le texte personnalisé n'accepte AUCUN HTML. Seuls les champs dynamiques listés
   ({eleve.nom}…) et le gras (**texte**) sont interprétés ; tout le reste est échappé.
   Un modèle ne peut ni modifier les données ni changer les droits : il ne fait que dessiner.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const defs = new Map();

  /* ---------- Champs dynamiques (jetons) documentés ---------- */
  const JETONS = {
    ecole: [
      ['ecole', 'Nom de l’école'], ['ecole.nomLong', 'Nom développé (École primaire publique de …)'], ['ecole.code', 'Code de l’école'], ['iepp', 'IEPP'], ['drenaet', 'DRENAET'],
      ['localite', 'Localité'], ['annee', 'Année scolaire'], ['directeur', 'Directeur (civilité et nom)'], ['directeur.titre', '« Directeur » ou « Directrice »'],
      ['date', 'Date du jour en toutes lettres'], ['date.courte', 'Date du jour (jj/mm/aaaa)'], ['reference', 'Référence du document']
    ],
    eleve: [
      ['eleve.nomComplet', 'Nom et prénoms'], ['eleve.nom', 'Nom'], ['eleve.prenoms', 'Prénoms'], ['eleve.matricule', 'Matricule'], ['eleve.classe', 'Classe'],
      ['eleve.naissance', 'Date de naissance'], ['eleve.lieuNaissance', 'Lieu de naissance'], ['eleve.ne', '« né » ou « née »'], ['eleve.sexe', 'Sexe'],
      ['eleve.nationalite', 'Nationalité'], ['eleve.entree', 'Date d’entrée à l’école'], ['eleve.statut', 'Statut'], ['eleve.motifDepart', 'Motif de départ'],
      ['eleve.lelui', '« le » ou « la » (l’élève)'], ['eleve.inscrit', '« inscrit » ou « inscrite »']
    ],
    agent: [['agent.nom', 'Nom et prénoms (avec civilité)'], ['agent.fonction', 'Fonction'], ['agent.matricule', 'Matricule'], ['agent.emploi', 'Emploi / grade'], ['agent.classes', 'Classe(s) tenue(s)'], ['agent.entree', 'Date de prise de service']]
  };
  function valeursJetons(ctx) {
    const sc = S().school, s = ctx.eleve, t = ctx.agent, x = X();
    const directrice = /^(mme|mlle)/i.test(sc.director || '');
    const v = {
      ecole: sc.name || '', 'ecole.nomLong': String(sc.name || '').replace(/^EPP\s+/i, 'École primaire publique ') || '', 'ecole.code': sc.codeecole || '', iepp: sc.iepp || '', drenaet: sc.drenaet || '',
      localite: u.capitale(sc.localite || sc.sp || ''), annee: sc.year || '', directeur: sc.director || '', 'directeur.titre': directrice ? 'Directrice' : 'Directeur',
      date: u.fmtDateLongue(u.aujourdhui()), 'date.courte': u.fmtDate(u.aujourdhui()), reference: ctx.ref || '[référence]'
    };
    if (s) {
      const fille = s.sexe === 'Féminin';
      Object.assign(v, {
        'eleve.nomComplet': x.nomComplet(s), 'eleve.nom': s.nom, 'eleve.prenoms': s.prenoms, 'eleve.matricule': x.matOf(s), 'eleve.classe': s.classe,
        'eleve.naissance': s.ageEstime ? x.fmtNaissance(s) : u.fmtDateLongue(s.naissance), 'eleve.lieuNaissance': s.lieu || '…', 'eleve.ne': fille ? 'née' : 'né', 'eleve.sexe': s.sexe,
        'eleve.nationalite': u.capitale(s.nationalite || ''), 'eleve.entree': s.entree ? u.fmtDateLongue(s.entree) : '…', 'eleve.statut': s.statut, 'eleve.motifDepart': s.motifDepart || '',
        'eleve.lelui': fille ? 'la' : 'le', 'eleve.inscrit': fille ? 'inscrite' : 'inscrit'
      });
    }
    if (t) Object.assign(v, { 'agent.nom': t.nom, 'agent.fonction': t.fonction || '', 'agent.matricule': t.matricule || '', 'agent.emploi': x.emploiGrade(t), 'agent.classes': x.clsTxt(t), 'agent.entree': t.dateEntree ? u.fmtDateLongue(t.dateEntree) : '…' });
    return v;
  }
  /** Texte rédigé → Html sûr : échappement, jetons connus remplacés, **gras**, paragraphes. */
  function rediger(texte, ctx) {
    const v = valeursJetons(ctx);
    const parts = String(texte || '').split(/\n{2,}/).map((p) => {
      let h = u.esc(p).replace(/\{([a-zA-Z.]+)\}/g, (m, k) => (k in v ? `<b class="jeton">${u.esc(v[k])}</b>` : ''));
      h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
      return `<p>${h}</p>`;
    });
    return raw(parts.join(''));
  }
  function jetonsInconnus(texte, sujet) {
    const ok = new Set([...JETONS.ecole, ...(JETONS[sujet] || [])].map(([k]) => k));
    return [...String(texte || '').matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !ok.has(k));
  }
  /** Remplacement simple (texte brut) pour les noms de signataires : « {directeur} ». */
  const texteJetons = (t, ctx) => {
    const v = valeursJetons(ctx || {});
    return String(t || '').replace(/\{([a-zA-Z.]+)\}/g, (m, k) => (k in v ? v[k] : ''));
  };

  /* ---------- Réglages ---------- */
  const fusion = (a, b) => {
    if (Array.isArray(b)) return b.slice();
    if (!b || typeof b !== 'object') return b === undefined ? a : b;
    const o = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
    Object.keys(b).forEach((k) => {
      if (k === '__proto__' || k === 'constructor') return;
      o[k] = fusion(o[k], b[k]);
    });
    return o;
  };
  const DEFAUT_COMMUN = {
    titre: '', sousTitre: '', texte: '',
    page: { orientation: 'portrait', marges: { h: 14, d: 14, b: 12, g: 14 } },
    entete: { officiel: true, logos: true, armoiries: true, compact: false, ligneSup: '' },
    champs: {},
    lieuDate: true,
    signatures: [{ role: 'Le Directeur', nom: '{directeur}', cachet: true }],
    hauteurSignature: 24,
    filigrane: { type: 'aucun' },
    qr: { actif: true, identite: false, taille: 22 },
    pied: { texte: '', reference: true, numeros: true },
    couleur: '#1f4e8c'
  };
  function reglages(id) {
    const d = defs.get(id);
    if (!d) throw new Error('Modèle inconnu : ' + id);
    const perso = (S() && S().modeles[id]) || null;
    const base = fusion(DEFAUT_COMMUN, d.defauts || {});
    return fusion(base, perso ? perso.reglages : {});
  }
  const borne = (v, a, b, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : def;
  };
  /** Contrôle et normalisation des réglages avant enregistrement. */
  function valider(id, r) {
    const d = defs.get(id);
    const E = (m, c) => new AK.ErreurMetier(m, c);
    const o = fusion(fusion(DEFAUT_COMMUN, d.defauts || {}), r);
    o.titre = String(o.titre || '').trim().slice(0, 90);
    o.sousTitre = String(o.sousTitre || '').trim().slice(0, 140);
    o.texte = String(o.texte || '').slice(0, 4000);
    const inc = jetonsInconnus(o.texte, d.sujet);
    if (inc.length) throw E(`Champ dynamique inconnu : {${inc[0]}}. Utilisez les champs proposés sous le texte.`, 'texte');
    if (/<[a-z!/]/i.test(o.texte) || /<[a-z!/]/i.test(o.titre)) throw E('Le HTML n’est pas accepté dans les modèles : utilisez **texte** pour le gras.', 'texte');
    o.page.orientation = d.orientations && d.orientations.includes(o.page.orientation) ? o.page.orientation : (d.defauts && d.defauts.page && d.defauts.page.orientation) || 'portrait';
    o.page.papier = (d.papiers || ['A4']).includes(o.page.papier) ? o.page.papier : (d.defauts && d.defauts.page && d.defauts.page.papier) || 'A4';
    ['h', 'd', 'b', 'g'].forEach((k) => (o.page.marges[k] = borne(o.page.marges[k], 5, 35, 14)));
    o.entete.ligneSup = String(o.entete.ligneSup || '').slice(0, 140);
    o.signatures = (Array.isArray(o.signatures) ? o.signatures : []).slice(0, 4).map((s) => ({ role: String(s.role || '').slice(0, 60), nom: String(s.nom || '').slice(0, 80), cachet: !!s.cachet, cadre: !!s.cadre }));
    o.hauteurSignature = borne(o.hauteurSignature, 10, 50, 24);
    o.filigrane = AK.filigrane.normaliser(o.filigrane);
    o.qr = { actif: o.qr.actif !== false, identite: !!o.qr.identite, taille: borne(o.qr.taille, 14, 40, 22) };
    o.pied = { texte: String(o.pied.texte || '').slice(0, 160), reference: o.pied.reference !== false, numeros: o.pied.numeros !== false };
    o.couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : '#1f4e8c';
    Object.keys(o.champs || {}).forEach((k) => (o.champs[k] = !!o.champs[k]));
    if (d.valider) d.valider(o);
    return o;
  }
  /** Différences par rapport au modèle par défaut (seules elles sont enregistrées). */
  function differences(base, o) {
    if (Array.isArray(o) || typeof o !== 'object' || o == null) return JSON.stringify(base) === JSON.stringify(o) ? undefined : o;
    const r = {};
    Object.keys(o).forEach((k) => {
      const v = differences(base ? base[k] : undefined, o[k]);
      if (v !== undefined) r[k] = v;
    });
    return Object.keys(r).length ? r : undefined;
  }

  const modeles = {
    JETONS, rediger, texteJetons, jetonsInconnus, valeursJetons,
    /** Déclare un modèle (fichiers docs/modeles/*.js). */
    def(d) {
      defs.set(d.id, { categorie: 'eleve', sujet: 'eleve', version: 1, ...d });
    },
    get: (id) => defs.get(id),
    liste: () => [...defs.values()],
    reglages,
    valider,
    estPersonnalise: (id) => !!(S().modeles[id] && S().modeles[id].reglages && Object.keys(S().modeles[id].reglages).length),
    enregistrer(id, r) {
      AK.perm.exiger('modeles.gerer');
      const d = defs.get(id);
      const o = valider(id, r);
      const diff = differences(fusion(DEFAUT_COMMUN, d.defauts || {}), o) || {};
      const prec = S().modeles[id];
      AK.store.modifier(`Modèle « ${d.lib} » enregistré`, (s) => (s.modeles[id] = { version: d.version, rev: ((prec && prec.rev) || 0) + 1, maj: new Date().toISOString(), par: AK.session.libelle(), reglages: diff }), { categorie: 'modeles' });
      return o;
    },
    reinitialiser(id) {
      AK.perm.exiger('modeles.gerer');
      const d = defs.get(id);
      AK.store.modifier(`Modèle « ${d.lib} » remis par défaut`, (s) => delete s.modeles[id], { categorie: 'modeles' });
    },
    /** Le modèle par défaut a évolué depuis la personnalisation ? */
    aJour(id) {
      const p = S().modeles[id];
      return !p || p.version >= defs.get(id).version;
    }
  };
  AK.modeles = modeles;
})(window.AK);
