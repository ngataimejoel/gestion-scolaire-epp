/* =====================================================================================
   Génération des documents : modèle + réglages + données + registre → feuilles.

   Un modèle (AK.modeles.def) fournit rendu(ctx, reglages, outils) qui renvoie :
     { contenu }                  une page (option ajuster : réduite pour tenir sur une page)
     { pages: [Html] }            plusieurs pages déjà composées
     { liste: { avant, tete, lignes, apres, suite } }   tableau paginé automatiquement
     { carte: Html }              carte d'identification (assemblée ensuite en planche)
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u;
  const S = () => AK.store.etat;
  const M = () => AK.mise;

  const outils = () => ({
    entete: M().entete, titre: M().titre, infos: M().infos, signatures: M().signatures, verification: M().verification,
    lieuDate: M().lieuDate, rediger: AK.modeles.rediger, texteJetons: AK.modeles.texteJetons, qrSvg: AK.qr.svg
  });

  function canonDe(ctx) {
    const sc = S().school, X = AK.calc;
    if (ctx.eleve) {
      const s = ctx.eleve;
      return { nom: s.nom, prenoms: s.prenoms, matricule: X.matOf(s), classe: s.classe, annee: sc.year, ecole: sc.name, extra: ctx.cleExtra || '' };
    }
    if (ctx.agent) {
      const t = ctx.agent;
      return { nom: AK.valid.civ.sans(t.nom), prenoms: '', matricule: t.matricule || '', classe: X.clsTxt(t), annee: sc.year, ecole: sc.name, extra: ctx.cleExtra || '' };
    }
    return { nom: '', prenoms: '', matricule: '', classe: ctx.classe || '', annee: sc.year, ecole: sc.name, extra: ctx.cleExtra || '' };
  }

  /**
   * Génère les feuilles d'un modèle pour une liste de contextes.
   * options : { reglages (brouillon d'éditeur), apercu (sans émission, SPÉCIMEN), copie, duplicataDe, statutForce }
   * Renvoie { feuilles, cartes, docs, avertissements }.
   */
  async function generer(idModele, contextes, options = {}) {
    const d = AK.modeles.get(idModele);
    if (!d) throw new AK.ErreurMetier('Modèle de document inconnu.');
    const r = options.reglages ? AK.modeles.valider(idModele, options.reglages) : AK.modeles.reglages(idModele);
    const feuilles = [], cartes = [], docs = [], avertissements = [];
    for (const [i, ctx0] of contextes.entries()) {
      const ctx = { ...ctx0 };
      let statut = options.statutForce || (S().meta.demo ? 'specimen' : null);
      let qrTexte = '', doc = null;
      if (d.emission && options.reutiliser && options.reutiliser[i]) {
        // réimpression d'un document déjà émis (copie, ou exemplaire d'archive d'un document annulé)
        const res = AK.registre.reimprimer(options.reutiliser[i].ref, options.copie ? 'copie' : 'reimpression');
        doc = res.doc;
        qrTexte = doc.qr || '';
        statut = options.statutForce || res.statutFiligrane || statut;
        docs.push(doc);
      } else if (d.emission && !options.apercu) {
        const res = await AK.registre.emettre({
          type: d.emission.type, modele: d.id, version: d.version, politique: d.emission.politique || 'registre',
          cleUnique: d.emission.cleUnique ? d.emission.cleUnique(ctx) : null,
          sujet: ctx.eleve ? { type: 'eleve', id: ctx.eleve.id, libelle: AK.calc.nomComplet(ctx.eleve) } : ctx.agent ? { type: 'agent', id: ctx.agent.id, libelle: ctx.agent.nom } : null,
          canon: canonDe(ctx), expire: d.emission.expire ? d.emission.expire(ctx, r) : null, qr: r.qr, duplicataDe: options.duplicataDe
        });
        doc = res.doc;
        qrTexte = res.qrTexte;
        statut = options.statutForce || res.statutFiligrane || statut;
        docs.push(doc);
      } else if (d.emission && options.apercu) {
        const ref = AK.valid.reference(d.emission.type, new Date().getFullYear(), 0);
        doc = { ref, kid: null, emisLe: new Date().toISOString(), expire: d.emission.expire ? d.emission.expire(ctx, r) : null };
        qrTexte = r.qr.actif ? AK.qr.texte({ T: d.emission.type, R: ref, E: u.aujourdhui(), H: 'SPECIMENSPECIMEN', ...(r.qr.identite && ctx.eleve ? { N: AK.calc.nomComplet(ctx.eleve), M: AK.calc.matOf(ctx.eleve) } : {}) }) : '';
        statut = 'specimen';
      }
      if (options.copie && !options.reutiliser) statut = statut === 'specimen' ? statut : 'copie';
      ctx.ref = doc ? doc.ref : '';
      ctx.doc = doc;
      ctx.qrTexte = r.qr.actif ? qrTexte : '';
      if (d.statut) {
        const s2 = d.statut(ctx, r);
        if (s2 && !statut) statut = s2;
      }
      const res = d.rendu(ctx, r, outils());
      if (res.avertissement) avertissements.push(res.avertissement);
      if (res.carte) {
        cartes.push({ html: res.carte, verso: res.verso || null, statut, format: res.format || r.format });
        continue;
      }
      let pages;
      if (res.liste) pages = M().paginer(r, res.liste);
      else if (res.pages) pages = res.pages;
      else if (res.ajuster) {
        const a = M().ajuster(r, res.contenu);
        if (a.deborde) avertissements.push('Contenu trop long pour une seule page : réduit au maximum lisible (72 %). Retirez un bloc ou passez en paysage.');
        pages = [a.contenu];
      } else pages = [res.contenu];
      pages.forEach((p, i) => feuilles.push(M().feuille({ reglages: r, contenu: p, statut, ref: ctx.ref, page: i + 1, total: pages.length })));
    }
    return { feuilles, cartes, docs, avertissements, reglages: r, modele: d };
  }

  /** Génère puis ouvre l'aperçu. */
  async function ouvrir(idModele, contextes, options = {}) {
    const d = AK.modeles.get(idModele);
    if (!contextes.length) throw new AK.ErreurMetier('Aucun document à produire.');
    const attente = contextes.length > 8 ? AK.ui.toast(`Préparation de ${contextes.length} documents…`, { type: 'attente', duree: 0 }) : null;
    try {
      const g = await generer(idModele, contextes, options);
      let feuilles = g.feuilles;
      if (g.cartes.length) feuilles = AK.cartes.planches(g.cartes, options.planche || {});
      const r = g.reglages;
      AK.impression.apercu({
        titre: options.titre || (contextes.length > 1 ? `${d.lib} · ${contextes.length} documents` : d.lib),
        feuilles,
        format: g.cartes.length ? (options.planche && options.planche.mode === 'unitaire' ? 'cartes à l’unité' : 'planche A4') : `A4 ${r.page.orientation === 'paysage' ? 'paysage' : 'portrait'}`,
        resume: g.docs.length ? `${u.pluriel(g.docs.length, 'document')} inscrit(s) au registre${g.docs.some((x) => x.signe) ? ', signé(s) électroniquement' : ''}` : '',
        avertissement: [...new Set(g.avertissements)].join(' ') || null,
        exporter: options.exporter,
        copie: d.emission && g.docs.length === contextes.length && AK.perm.peut('document.registre') && !options.copie ? async () => {
          const c = await generer(idModele, contextes, { ...options, copie: true, apercu: false, reutiliser: g.docs });
          return c.cartes.length ? AK.cartes.planches(c.cartes, options.planche || {}) : c.feuilles;
        } : null
      });
      return g;
    } finally {
      if (attente) attente.fermer();
    }
  }

  AK.docs = { generer, ouvrir, canonDe };
})(window.AK);
