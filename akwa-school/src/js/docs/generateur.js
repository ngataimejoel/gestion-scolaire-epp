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
   * options : { reglages (brouillon d'éditeur), apercu (sans émission, SPÉCIMEN), brouillon (aperçu avant
   *             émission : référence et QR réservés), copie, reutiliser, duplicataDe, statutForce }
   * Renvoie { feuilles, cartes, docs, avertissements }.
   */
  /**
   * Droit de produire ce document pour ce sujet, vérifié pour tout modèle (avec ou sans inscription au
   * registre) : un enseignant n'obtient que les documents de ses classes, ses propres documents de
   * personnel, et aucun document de toute l'école (sauf espace enseignant seul).
   */
  function autoriser(d, contextes) {
    if (AK.session.estDirecteur()) return;
    const moi = AK.session.agent();
    const ok = contextes.every((c) => {
      const classe = c.eleve ? c.eleve.classe : c.classe;
      if (d.sujet === 'agent') return !!(moi && c.agent && c.agent.id === moi.id);
      if (d.sujet === 'ecole' && !classe) return AK.perm.peut('document.ecole');
      return !!classe && AK.perm.peut('document.imprimerClasse', { classe });
    });
    if (!ok) throw new AK.ErreurDroits('Ce document ne concerne pas votre classe : il est réservé au directeur.');
  }

  async function generer(idModele, contextes, options = {}) {
    const d = AK.modeles.get(idModele);
    if (!d) throw new AK.ErreurMetier('Modèle de document inconnu.');
    autoriser(d, contextes);
    const r = options.reglages ? AK.modeles.valider(idModele, options.reglages) : AK.modeles.reglages(idModele);
    const feuilles = [], cartes = [], docs = [], avertissements = [];
    for (const [i, ctx0] of contextes.entries()) {
      const ctx = { ...ctx0 };
      if ((d.sujet === 'eleve' && !ctx.eleve) || (d.sujet === 'agent' && !ctx.agent) || (d.sujet === 'classe' && !ctx.classe))
        throw new AK.ErreurMetier(`Document « ${d.lib} » : ${d.sujet === 'eleve' ? 'élève' : d.sujet === 'agent' ? 'membre du personnel' : 'classe'} non précisé(e).`);
      const refus = d.refuser ? d.refuser(ctx, r) : null;
      if (refus) {
        avertissements.push(refus);
        continue;
      }
      if (d.emission && d.emission.extra) ctx.cleExtra = d.emission.extra(ctx);
      let statut = options.statutForce || (S().meta.demo ? 'specimen' : null);
      let qrTexte = '', doc = null;
      const idSujet = ctx.eleve ? ctx.eleve.id : ctx.agent ? ctx.agent.id : null;
      const deja = options.reutiliser ? (idSujet ? options.reutiliser.find((x) => x.sujet && x.sujet.id === idSujet) : options.reutiliser[i]) : null;
      if (d.emission && deja) {
        // réimpression d'un document déjà émis (copie, ou exemplaire d'archive d'un document annulé)
        const res = AK.registre.reimprimer(deja.ref, options.copie ? 'copie' : 'reimpression');
        doc = res.doc;
        qrTexte = doc.qr || '';
        statut = options.statutForce || res.statutFiligrane || statut;
        docs.push(doc);
      } else if (d.emission && !options.apercu && !options.brouillon) {
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
      } else if (d.emission && options.brouillon) {
        doc = { ref: 'attribuée à l’impression', kid: null, brouillon: true, expire: d.emission.expire ? d.emission.expire(ctx, r) : null };
        qrTexte = AK.qr.BROUILLON;
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
      ctx._statutCarte = statut;
      const res = d.rendu(ctx, r, outils());
      if (res.avertissement) avertissements.push(res.avertissement);
      if (res.carte) {
        cartes.push({ html: res.carte, verso: res.verso || null, statut, format: res.format || r.format });
        continue;
      }
      let pages;
      if (res.liste) pages = M().paginer(r, res.liste);
      else if (res.blocs) pages = M().decouper(r, res.blocs, { suite: res.suite || '', garder: res.garder || 1 });
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

  /**
   * Génère puis ouvre l'aperçu. Pour un document inscrit au registre, l'aperçu est un brouillon :
   * la référence, la signature et le QR code ne sont créés qu'au moment d'imprimer ou d'exporter
   * (fermer l'aperçu n'inscrit donc rien au registre).
   */
  async function ouvrir(idModele, contextes, options = {}) {
    const d = AK.modeles.get(idModele);
    if (!d) throw new AK.ErreurMetier('Modèle de document inconnu.');
    if (!contextes.length) throw new AK.ErreurMetier('Aucun document à produire.');
    const differer = !!d.emission && !options.apercu && !options.reutiliser;
    if (differer && !AK.perm.peut('document.emettre') && !(d.emission.politique === 'unique' && contextes.every((c) => AK.perm.peut('document.imprimerClasse', { classe: c.eleve ? c.eleve.classe : c.classe }))))
      throw new AK.ErreurDroits('L’émission de ce document est réservée au directeur.');
    const attente = contextes.length > 8 ? AK.ui.toast(`Préparation de ${contextes.length} documents…`, { type: 'attente', duree: 0 }) : null;
    const feuillesDe = (g) => (g.cartes.length ? AK.cartes.planches(g.cartes, options.planche || {}) : g.feuilles);
    const resumeDe = (g) => (g.docs.length ? `${u.pluriel(g.docs.length, 'document')} inscrit(s) au registre${g.docs.some((x) => x.signe) ? ', signé(s) électroniquement' : ''}${g.docs.length === 1 ? ' · ' + g.docs[0].ref : ''}` : '');
    try {
      const g = await generer(idModele, contextes, differer ? { ...options, brouillon: true } : options);
      if (!g.feuilles.length && !g.cartes.length) throw new AK.ErreurMetier([...new Set(g.avertissements)].join(' ') || 'Aucun document à produire.');
      const r = g.reglages;
      let final = differer ? null : g;
      const preparer = async () => {
        if (!final) {
          final = await generer(idModele, contextes, options);
          if (options.surEmission) options.surEmission(final);
          if (AK.shell && AK.session.ouverte()) AK.shell.redessiner(); // registre, fiches : à jour sous l'aperçu
        }
        return { feuilles: feuillesDe(final), resume: resumeDe(final) };
      };
      AK.impression.apercu({
        titre: options.titre || (contextes.length > 1 ? `${d.lib} · ${contextes.length} documents` : d.lib),
        feuilles: feuillesDe(g),
        format: g.cartes.length ? (options.planche && options.planche.mode === 'unitaire' ? 'cartes à l’unité' : 'planche A4') : `${r.page.papier || 'A4'} ${r.page.orientation === 'paysage' ? 'paysage' : 'portrait'}`,
        papier: r.page.papier || 'A4',
        resume: differer ? 'Aperçu : la référence et le QR code seront attribués à l’impression' : resumeDe(g),
        avertissement: [...new Set(g.avertissements)].join(' ') || null,
        exporter: options.exporter,
        nomFichier: options.nomFichier,
        preparer: differer ? preparer : null,
        copie: d.emission && !options.apercu && AK.perm.peut('document.registre') && !options.copie ? async () => {
          await preparer();
          if (!final.docs.length) return null;
          const c = await generer(idModele, contextes, { ...options, copie: true, apercu: false, reutiliser: final.docs });
          return feuillesDe(c);
        } : null
      });
      return g;
    } finally {
      if (attente) attente.fermer();
    }
  }

  /** Contexte de génération d'un document du registre (pour une copie ou un duplicata). */
  function contexteDe(doc) {
    const ctx = {};
    if (doc.sujet && doc.sujet.type === 'eleve') {
      ctx.eleve = AK.eleves.trouver(doc.sujet.id);
      if (!ctx.eleve) throw new AK.ErreurMetier('L’élève de ce document n’est plus dans le registre des élèves (supprimé ou archivé).');
    } else if (doc.sujet && doc.sujet.type === 'agent') {
      ctx.agent = AK.personnel.trouver(doc.sujet.id);
      if (!ctx.agent) throw new AK.ErreurMetier('Le membre du personnel de ce document n’est plus enregistré.');
    }
    if (doc.type === 'BUL' && doc.cleUnique) ctx.periode = Number(String(doc.cleUnique).split('|')[3]) || 1;
    return ctx;
  }
  /**
   * Une copie conforme n'est possible que si les données du document n'ont pas changé depuis
   * l'émission (même empreinte). Sinon il faut émettre un nouveau document (ou une nouvelle version).
   */
  async function conforme(doc) {
    const d = AK.modeles.get(doc.modele);
    if (!d) return { ok: false, motif: 'Modèle de document introuvable.' };
    const ctx = contexteDe(doc);
    if (d.emission && d.emission.extra) ctx.cleExtra = d.emission.extra(ctx);
    if (S().school.year !== doc.annee) return { ok: false, ctx, motif: `Document de l’année ${doc.annee || '?'} : les données de l’année ont changé, une copie fidèle n’est plus possible.` };
    const H = await AK.qr.empreinteTitulaire({ ...canonDe(ctx), type: doc.type, ref: doc.ref });
    return H === doc.H ? { ok: true, ctx } : { ok: false, ctx, motif: 'Les données de ce document ont changé depuis son émission (dossier modifié, note corrigée…). Une copie ne serait pas fidèle à l’original : émettez un nouveau document.' };
  }

  AK.docs = { generer, ouvrir, canonDe, contexteDe, conforme };
})(window.AK);
