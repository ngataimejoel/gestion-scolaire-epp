/* =====================================================================================
   Paramètres › Modèles de documents : liste des modèles par catégorie (version, révision,
   personnalisation) et éditeur en deux panneaux : réglages | aperçu réduit en direct.

   - L'éditeur travaille sur un BROUILLON gardé en mémoire, par modèle : un redessin de l'écran
     (bus « change ») ou un passage par un autre écran ne perd jamais la saisie ; quitter la
     page avec un brouillon non enregistré déclenche l'alerte du navigateur.
   - Enregistrer passe par AK.modeles.enregistrer (droit modeles.gerer, AK.modeles.valider :
     HTML refusé, champs dynamiques inconnus refusés, valeurs bornées) : nouvelle révision.
     Les contrôles faits ici avant (nombres hors bornes, champs obligatoires…) servent seulement
     à placer le message sous le bon champ ; ils ne remplacent jamais AK.modeles.valider.
   - Un modèle ne fait que dessiner : il ne peut ni exécuter de code, ni modifier des données
     ou des droits. L'aperçu appelle AK.docs.generer(…, { apercu: true }) : rien n'est émis,
     rien n'est inscrit au registre, filigrane SPÉCIMEN.
   - Seuls les réglages réellement utilisés par le modèle sont proposés : une « sonde » dessine
     une fois le modèle avec des marqueurs (titre, sous-titre, texte, signature) et regarde
     lesquels apparaissent. Aucun réglage sans effet n'est donc présenté comme actif.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const M = () => AK.modeles;
  const ROUTE = 'parametres/modeles';
  const MM = 96 / 25.4; // pixels CSS par millimètre

  const CATEGORIES = [
    ['eleve', 'Documents des élèves'], ['carte', 'Cartes d’identification'], ['personnel', 'Documents du personnel'],
    ['absence', 'Autorisations d’absence'], ['vie', 'Vie scolaire'], ['finance', 'Finances'], ['liste', 'Listes et états'], ['rapport', 'Rapports']
  ];
  const libCat = (c) => (CATEGORIES.find(([k]) => k === c) || [null, 'Autres documents'])[1];
  const ordreCat = (c) => {
    const i = CATEGORIES.findIndex(([k]) => k === c);
    return i < 0 ? CATEGORIES.length : i;
  };

  /* Bornes des réglages numériques : les mêmes que AK.modeles.valider et AK.filigrane.normaliser
     (qui ramènent sans prévenir une valeur hors bornes) ; ici l'erreur est montrée sous le champ. */
  const BORNES = {
    'page.marges.h': [5, 35, 'Marge du haut', 'mm'], 'page.marges.d': [5, 35, 'Marge de droite', 'mm'],
    'page.marges.b': [5, 35, 'Marge du bas', 'mm'], 'page.marges.g': [5, 35, 'Marge de gauche', 'mm'],
    hauteurSignature: [10, 50, 'Hauteur des zones de signature', 'mm'], 'qr.taille': [14, 40, 'Taille du QR code', 'mm'],
    'filigrane.opacite': [2, 30, 'Opacité du filigrane', '%'], 'filigrane.taille': [20, 100, 'Taille du filigrane', '%'],
    'filigrane.rotation': [-90, 90, 'Rotation du filigrane', '°'], 'carte.l': [40, 150, 'Largeur de la carte', 'mm'], 'carte.h': [40, 150, 'Hauteur de la carte', 'mm']
  };
  /* Réglages dont le changement modifie les champs affichés : l'éditeur est redessiné. */
  const STRUCTURELS = new Set(['filigrane.type', 'carte.format', 'carte.expiration', 'entete.officiel', 'qr.actif', 'lieuDate']);
  const LOGOS_FILIGRANE = [['ecole', 'Logo de l’école'], ['iepp', 'Logo de l’IEPP'], ['armoiries', 'Armoiries'], ['akwa', 'Logo AKWA SCHOOL']];
  const POSITIONS = [['centre', 'Centre'], ['haut', 'Haut'], ['bas', 'Bas']];
  const EXPIRATIONS = [['fin-annee', 'Fin de l’année scolaire (31 juillet)'], ['date', 'Date fixe'], ['aucune', 'Sans date de fin']];
  const MAX_SIGNATURES = 4;
  const HTML_INTERDIT = /<\s*[a-z!/?]/i;

  /* ---------- Petits outils ---------- */
  const idDe = (nom) => 'pm-' + String(nom).replace(/[^\w-]/g, '-');
  const lire = (o, chemin) => chemin.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function poser(o, chemin, v) {
    const k = chemin.split('.');
    let x = o;
    k.slice(0, -1).forEach((c) => {
      if (c === '__proto__' || c === 'constructor' || c === 'prototype') throw new Error('Clé interdite');
      if (!x[c] || typeof x[c] !== 'object') x[c] = {};
      x = x[c];
    });
    const fin = k[k.length - 1];
    if (fin === '__proto__' || fin === 'constructor' || fin === 'prototype') throw new Error('Clé interdite');
    x[fin] = v;
  }
  /* Nombre saisi : conservé tel quel s'il est vide ou illisible (le contrôle le signalera). */
  const nombre = (v) => {
    const t = String(v ?? '').trim().replace(',', '.');
    return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
  };

  /* Réglages enregistrés, normalisés (valeurs par défaut complètes) ; des réglages anciens refusés
     par la validation actuelle sont montrés tels quels pour être corrigés. */
  function reglagesNormalises(id) {
    const r = u.clone(M().reglages(id));
    try {
      return u.clone(M().valider(id, r));
    } catch (e) {
      r.filigrane = AK.filigrane.normaliser(r.filigrane);
      return r;
    }
  }

  /* ---------- Brouillons (un par modèle, en mémoire) ---------- */
  const brouillons = new Map(); // id → { r, modifie }
  function brouillonDe(id) {
    let b = brouillons.get(id);
    if (!b || !b.modifie) {
      b = { r: reglagesNormalises(id), modifie: false };
      brouillons.set(id, b);
    }
    return b;
  }
  const brouillonsModifies = () => [...brouillons.entries()].filter(([id, b]) => b.modifie && M().get(id));
  addEventListener('beforeunload', (e) => {
    if (brouillonsModifies().length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /** Valeurs du formulaire → nouveau brouillon (les réglages non affichés sont conservés). */
  function lireFormulaire(form, base) {
    const d = ui.lireFormulaire(form), r = u.clone(base);
    const sigs = [];
    Object.entries(d).forEach(([k, v]) => {
      const m = /^sig\.(\d+)\.(role|nom|cadre|cachet)$/.exec(k);
      if (m) {
        (sigs[+m[1]] = sigs[+m[1]] || { role: '', nom: '', cadre: false, cachet: false })[m[2]] = v;
        return;
      }
      if (!/^[a-zA-Z][\w.]*$/.test(k)) return;
      poser(r, k, BORNES[k] ? nombre(v) : v);
    });
    if (sigs.length) r.signatures = sigs.filter(Boolean);
    return r;
  }

  /* ---------- Contexte d'exemple de l'aperçu ---------- */
  const PAS_ENREGISTRE = 'exemple non enregistré';
  /**
   * Premier élève inscrit, premier membre du personnel, première classe ayant des élèves ;
   * pour les documents liés à une opération, la première opération réelle, sinon un exemple
   * construit en mémoire (jamais enregistré). Renvoie { ctx, libelle } ou { manque }.
   */
  function contexteExemple(d) {
    const x = X(), s0 = S(), auj = u.aujourdhui();
    const ctx = { periode: s0.school.evalCourante || 1, ev: s0.school.evalCourante || 1, mois: x.moisCourant() };
    const libs = [];
    const eleves = x.actifs().slice().sort(x.parClasse);
    const agents = s0.teachers.filter((t) => t.actif !== false).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
    if (d.sujet === 'eleve') {
      // reçu : de préférence un vrai versement (et son élève)
      const p = d.id === 'recu' ? s0.pro.paiements.find((z) => !z.annule && AK.eleves.trouver(z.sid)) : null;
      // certificat de transfert : de préférence un élève transféré (pas d'avertissement « encore inscrit »)
      const parti = d.id === 'certificat-transfert' ? s0.students.find((z) => z.statut === 'Transféré') : null;
      ctx.eleve = p ? AK.eleves.trouver(p.sid) : parti || eleves[0];
      if (!ctx.eleve) return { manque: 'Aucun élève inscrit : l’aperçu a besoin d’un élève d’exemple. Il apparaîtra dès la première inscription.' };
      libs.push(`${x.nomComplet(ctx.eleve)} · ${ctx.eleve.classe}`);
      if (d.id === 'recu') {
        ctx.paiement = p || { ref: `REC-${x.anneeRentree()}-EXEMPLE`, sid: ctx.eleve.id, montant: 5000, mode: C.MODES_PAIE[0], objet: C.OBJETS_PAIE[0], date: auj, payeur: '' };
        libs.push(p ? `reçu ${p.ref}` : `reçu fictif (${PAS_ENREGISTRE})`);
      }
    } else if (d.sujet === 'agent') {
      ctx.agent = agents[0];
      if (!ctx.agent) return { manque: 'Aucun membre du personnel enregistré : l’aperçu a besoin d’un exemple. Il apparaîtra dès le premier enregistrement.' };
      libs.push(ctx.agent.nom);
    } else if (d.sujet === 'classe') {
      ctx.classe = x.niveaux().find((c) => x.actifsDe(c).length) || x.niveaux()[0];
      if (!ctx.classe) return { manque: 'Aucune classe ouverte : renseignez les niveaux de l’école pour voir l’aperçu.' };
      libs.push('classe ' + ctx.classe);
    } else libs.push(s0.school.name || 'école');
    if (d.id === 'demande-absence-eleve' || d.id === 'demande-absence-personnel') {
      const qui = d.sujet === 'eleve' ? 'eleve' : 'personnel', pid = (ctx.eleve || ctx.agent).id;
      const a = s0.auth.find((z) => z.qui === qui && z.pid === pid);
      ctx.demande = a || { ref: 'AUT-EXEMPLE', qui, pid, nom: ctx.eleve ? x.nomComplet(ctx.eleve) : ctx.agent.nom, du: auj, au: u.ajouterJours(auj, 2), motif: 'Raisons familiales', precision: '', statut: 'En attente', cree: auj };
      libs.push(a ? `demande ${a.ref}` : `demande fictive (${PAS_ENREGISTRE})`);
    }
    if (d.id === 'convocation-parents') {
      const f = s0.pro.incidents.find((z) => z.sid === ctx.eleve.id);
      if (f) ctx.fait = f;
    }
    if (d.id === 'rapport-perso') {
      const rap = s0.persoReps.find((z) => z && Array.isArray(z.blocs) && z.blocs.every((b) => b && typeof b.type === 'string'));
      ctx.rapport = rap || { id: 'apercu', titre: 'Rapport personnalisé', sous: `Année scolaire ${s0.school.year || ''}`, ajuster: true, blocs: [{ id: 'b1', type: 'texte', titre: 'OBSERVATIONS', lignes: 3 }, { id: 'b2', type: 'signature', titre: '' }] };
      libs.push(rap ? `rapport « ${rap.titre || 'sans titre'} »` : `rapport fictif (${PAS_ENREGISTRE})`);
    }
    return { ctx, libelle: libs.join(' · ') };
  }

  /* ---------- Réglages utilisés par chaque modèle (sonde) ---------- */
  const MARQUES = { titre: 'ZQTITREQZ', sousTitre: 'ZQSOUSTITREQZ', texte: 'ZQTEXTEQZ', signature: 'ZQSIGNATUREQZ' };
  const capacites = new Map(); // id → { titre, sousTitre, texte, signatures, sure }
  const sondesEnCours = new Map();
  const aUnTexte = (d) => !!(d.defauts && d.defauts.texte);
  function capacitesSupposees(d) {
    const carte = d.categorie === 'carte';
    return { titre: !carte, sousTitre: !carte, texte: aUnTexte(d), signatures: !carte, sure: false };
  }
  /** Dessine une fois le modèle avec des marqueurs et note ceux qui apparaissent. */
  async function sonder(d) {
    const ex = contexteExemple(d);
    if (ex.manque) return capacitesSupposees(d);
    const r = reglagesNormalises(d.id);
    Object.assign(r, { titre: MARQUES.titre, sousTitre: MARQUES.sousTitre, signatures: [{ role: MARQUES.signature, nom: '', cadre: false, cachet: false }], lieuDate: true });
    if (aUnTexte(d)) r.texte = MARQUES.texte;
    r.champs = r.champs || {};
    (d.champsOptionnels || []).forEach(([k]) => (r.champs[k] = true)); // un champ masqué ne doit pas cacher un réglage
    if (r.carte) Object.assign(r.carte, { verso: true, expiration: 'fin-annee' });
    try {
      const g = await AK.docs.generer(d.id, [ex.ctx], { reglages: r, apercu: true, statutForce: 'specimen' });
      const h = [...g.feuilles, ...g.cartes.flatMap((c) => [c.html, c.verso || ''])].map(String).join('').toUpperCase();
      if (!h) return capacitesSupposees(d);
      return { titre: h.includes(MARQUES.titre), sousTitre: h.includes(MARQUES.sousTitre), texte: aUnTexte(d) && h.includes(MARQUES.texte), signatures: h.includes(MARQUES.signature), sure: true };
    } catch (e) {
      AK.diag.avert(`Modèle ${d.id} : analyse des réglages impossible (${e && e.message})`);
      return capacitesSupposees(d);
    }
  }
  function capacitesDe(d) {
    if (capacites.has(d.id)) return capacites.get(d.id);
    const ex = contexteExemple(d);
    if (ex.manque) return capacitesSupposees(d); // recalculé quand des données existeront
    if (!sondesEnCours.has(d.id))
      sondesEnCours.set(d.id, sonder(d).catch((e) => {
        AK.diag.avert(`Modèle ${d.id} : analyse des réglages impossible (${e && e.message})`);
        return capacitesSupposees(d);
      }).then((c) => {
        capacites.set(d.id, c);
        sondesEnCours.delete(d.id);
        if (AK.shell.routeCourante() === ROUTE && AK.shell.params().modele === d.id) AK.shell.redessiner();
      }));
    return null;
  }

  /* ---------- Contrôle avant enregistrement / aperçu ---------- */
  /**
   * Contrôles placés sous le champ concerné, puis AK.modeles.valider (toujours).
   * strict : contrôles d'enregistrement (champs obligatoires) ; sinon seulement le format.
   */
  function controler(d, r, caps, { strict = false } = {}) {
    const E = (m, c) => new AK.ErreurMetier(m, c);
    const textes = [['titre', 'Titre'], ['sousTitre', 'Sous-titre'], ['texte', 'Texte'], ['pied.texte', 'Pied de page'], ['filigrane.texte', 'Texte du filigrane']];
    textes.forEach(([k, lib]) => {
      if (HTML_INTERDIT.test(String(lire(r, k) || ''))) throw E(`${lib} : le HTML n’est pas accepté. Écrivez le texte simplement (**texte** met en gras).`, k);
    });
    [['titre', 'le titre'], ['sousTitre', 'le sous-titre'], ['pied.texte', 'le pied de page'], ['filigrane.texte', 'le filigrane']].forEach(([k, lib]) => {
      if (/\{[^}]*\}/.test(String(lire(r, k) || ''))) throw E(`Les champs dynamiques {…} ne sont pas remplacés dans ${lib} : seuls le texte rédigé et le nom des signataires les acceptent.`, k);
    });
    if (strict && caps.titre && !String(r.titre || '').trim()) throw E('Indiquez le titre du document.', 'titre');
    if (caps.texte) {
      const inc = M().jetonsInconnus(r.texte, d.sujet);
      if (inc.length) throw E(`Champ dynamique inconnu : {${inc[0]}}. Cliquez sur un des champs proposés sous le texte.`, 'texte');
    }
    Object.entries(BORNES).forEach(([k, [min, max, lib, unite]]) => {
      if (lire(r, k) === undefined) return;
      if (k.startsWith('carte.') && !(r.carte && r.carte.format === 'perso')) return;
      const v = lire(r, k);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw E(`${lib} : indiquez un nombre entre ${min} et ${max} ${unite}.`, k);
      if (v < min || v > max) throw E(`${lib} : ${String(v).replace('.', ',')} ${unite} est hors limites (${min} à ${max} ${unite}).`, k);
    });
    if (caps.signatures) {
      if ((r.signatures || []).length > MAX_SIGNATURES) throw E(`${MAX_SIGNATURES} signatures au plus.`);
      (r.signatures || []).forEach((s, i) => {
        if (HTML_INTERDIT.test(s.role) || HTML_INTERDIT.test(s.nom)) throw E('Le HTML n’est pas accepté dans les signatures.', HTML_INTERDIT.test(s.role) ? `sig.${i}.role` : `sig.${i}.nom`);
        if (strict && !String(s.role || '').trim()) throw E('Indiquez le rôle du signataire (ex. « Le Directeur ») ou retirez cette signature.', `sig.${i}.role`);
        if (/\{[^}]*\}/.test(s.role || '')) throw E('Les champs dynamiques ne sont acceptés que dans le nom du signataire.', `sig.${i}.role`);
        const inc = M().jetonsInconnus(s.nom, d.sujet);
        if (inc.length) throw E(`Champ dynamique inconnu : {${inc[0]}}. Exemple accepté : {directeur}.`, `sig.${i}.nom`);
      });
    }
    const fg = r.filigrane || {};
    if (strict && fg.type === 'texte' && !String(fg.texte || '').trim()) throw E('Indiquez le texte du filigrane, ou choisissez un autre type.', 'filigrane.texte');
    if (r.carte && r.carte.expiration === 'date') {
      if (!u.estISO(r.carte.dateExpiration)) throw E('Indiquez la date de fin de validité de la carte.', 'carte.dateExpiration');
      if (strict && r.carte.dateExpiration < u.aujourdhui()) throw E('Cette date de fin de validité est déjà passée : les cartes seraient expirées dès leur impression.', 'carte.dateExpiration');
    }
    return M().valider(d.id, r);
  }

  /* ---------- Liste des modèles ---------- */
  function rendreListe(p) {
    const tous = M().liste();
    const cats = [...new Set(tous.map((d) => d.categorie))].sort((a, b) => ordreCat(a) - ordreCat(b));
    const cat = cats.includes(p.cat) ? p.cat : '';
    const L = tous.filter((d) => !cat || d.categorie === cat).sort((a, b) => ordreCat(a.categorie) - ordreCat(b.categorie) || a.lib.localeCompare(b.lib, 'fr'));
    const perso = tous.filter((d) => M().estPersonnalise(d.id));
    const aRevoir = tous.filter((d) => !M().aJour(d.id));
    const enCours = brouillonsModifies();
    const enregistre = (d) => S().modeles[d.id] || null;
    const etat = (d) => html`${M().estPersonnalise(d.id) ? ui.tag('Personnalisé', 'acc', 'sliders') : ui.tag('Modèle d’origine')}${!M().aJour(d.id) ? html` ${ui.tag('Modèle d’origine mis à jour', 'avert', 'warn')}` : ''}${brouillons.get(d.id) && brouillons.get(d.id).modifie ? html` ${ui.tag('Brouillon non enregistré', 'avert', 'edit')}` : ''}`;
    const tableau = ui.tableau({
      id: 'pm-modeles', lignes: L, unite: 'modèle', exporter: 'modeles-documents', placeholder: 'Rechercher un modèle…', legende: 'Modèles de documents',
      recherche: (d) => `${d.lib} ${d.description || ''} ${libCat(d.categorie)} ${d.id}`,
      colonnes: [
        { cle: 'lib', lib: 'Modèle', cls: 'texte', tri: (d) => d.lib, csv: (d) => d.lib, rendu: (d) => html`<a href="#${ROUTE}?modele=${d.id}"><b>${d.lib}</b></a>${d.description ? html`<br><span class="mut petit">${d.description}</span>` : ''}` },
        { cle: 'cat', lib: 'Catégorie', tri: (d) => ordreCat(d.categorie), csv: (d) => libCat(d.categorie), rendu: (d) => libCat(d.categorie) },
        { cle: 'version', lib: 'Version', tri: (d) => d.version, csv: (d) => `v${d.version}${enregistre(d) ? ' révision ' + (enregistre(d).rev || 1) : ''}`, rendu: (d) => html`v${d.version}${enregistre(d) ? html`<span class="mut petit"> · révision ${enregistre(d).rev || 1}</span>` : ''}` },
        { cle: 'etat', lib: 'État', tri: (d) => (M().estPersonnalise(d.id) ? 0 : 1), csv: (d) => (M().estPersonnalise(d.id) ? 'Personnalisé' : 'Modèle d’origine') + (!M().aJour(d.id) ? ' (modèle d’origine mis à jour)' : ''), rendu: etat },
        { cle: 'maj', lib: 'Dernière modification', tri: (d) => (enregistre(d) ? enregistre(d).maj : null), csv: (d) => (enregistre(d) ? `${u.fmtHorodatage(enregistre(d).maj)} ${enregistre(d).par || ''}` : ''), rendu: (d) => (enregistre(d) ? html`${u.fmtHorodatage(enregistre(d).maj)}<br><span class="mut petit">${enregistre(d).par || ''}</span>` : html`<span class="mut">—</span>`) },
        { cle: 'act', lib: 'Action', cls: 'actions-l', csv: false, rendu: (d) => html`<a class="btn btn-sm" href="#${ROUTE}?modele=${d.id}" aria-label="Personnaliser : ${d.lib}">${ic('sliders')}Personnaliser</a>` }
      ]
    });
    return html`${ui.pageTete('Modèles de documents', 'Texte, mise en page, en-tête, signatures, filigrane et QR code de chaque document. Chaque enregistrement crée une nouvelle révision ; le modèle d’origine peut toujours être rétabli.')}
      <div class="grille g3 pm-kpis">${ui.kpi({ icone: 'file', lib: 'Modèles disponibles', val: tous.length, sous: u.pluriel(cats.length, 'catégorie') })}${ui.kpi({ icone: 'sliders', lib: 'Personnalisés', val: perso.length, sous: perso.length ? 'par votre école' : 'tous au modèle d’origine', ton: 'acc' })}${ui.kpi({ icone: 'warn', lib: 'À revoir', val: aRevoir.length, sous: aRevoir.length ? 'modèle d’origine mis à jour depuis votre personnalisation' : 'personnalisations à jour', ton: aRevoir.length ? 'avert' : '' })}</div>
      ${enCours.length ? ui.encadre(html`<b>${enCours.length > 1 ? 'Brouillons non enregistrés' : 'Brouillon non enregistré'} :</b> ${enCours.map(([id], i) => html`${i ? ', ' : ''}<a href="#${ROUTE}?modele=${id}">${M().get(id).lib}</a>`)}. Ouvrez le modèle pour enregistrer ou annuler les modifications.`, 'avert', 'edit') : ''}
      ${ui.encadre('Sécurité : un modèle ne fait que mettre en page. Il n’accepte ni HTML ni code, ne peut modifier aucune donnée ni aucun droit ; les champs dynamiques {…} sont remplacés à l’impression par les données du document.', '', 'shield')}
      <div class="barre-outils mt" role="group" aria-label="Filtrer par catégorie">${ui.pilules([['', 'Toutes'], ...cats.map((c) => [c, libCat(c)])], cat, 'pm-cat')}</div>
      ${tableau}`;
  }

  /* ---------- Éditeur ---------- */
  let ongletActif = 'contenu';
  let idEditeur = null;
  let defil = { id: null, reglages: 0, apercu: 0 }; // défilement des deux panneaux, conservé au redessin
  let dernierAccesTexte = false; // le texte a reçu le focus : insérer un champ au curseur

  const radios = (nom, lib, options, val, aide) => html`<fieldset class="champ pm-radios"><legend class="lib">${lib}</legend><div class="choix-carte">${options.map(([v, l]) => html`<label for="${idDe(nom)}-${v}"><input type="radio" id="${idDe(nom)}-${v}" name="${nom}" value="${v}"${String(v) === String(val) ? raw(' checked') : ''}> ${l}</label>`)}</div>${aide ? html`<div class="aide">${aide}</div>` : ''}</fieldset>`;
  const couleur = (nom, lib, val, aide) => html`<div class="champ"><label for="${idDe(nom)}">${lib}</label><div class="ligne"><input type="color" id="${idDe(nom)}" name="${nom}" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#1f4e8c'}"><span class="mut petit mono" aria-hidden="true">${val}</span></div>${aide ? html`<div class="aide">${aide}</div>` : ''}</div>`;
  const nombreChamp = (nom, val, extra = {}) => {
    const [min, max, lib, unite] = BORNES[nom];
    return F.nombre({ id: idDe(nom), nom, lib: `${extra.lib || lib} (${unite})`, val, aide: extra.aide || `De ${min} à ${max} ${unite}.`, attrs: { min, max, step: extra.step || 1 } });
  };
  const caseChamp = (nom, lib, coche, aide) => F.case({ id: idDe(nom), nom, lib, coche: !!coche, aide });
  const section = (titre, icone, corps) => html`<section class="section-form pm-section"><h3>${ic(icone)}${titre}</h3><div class="pile">${corps}</div></section>`;

  function ongletContenu(d, r, caps) {
    const sujet = d.sujet === 'agent' ? 'agent' : d.sujet === 'eleve' ? 'eleve' : null;
    const groupes = [['ecole', 'École et date'], ...(sujet ? [[sujet, sujet === 'eleve' ? 'Élève' : 'Membre du personnel']] : [])];
    const jetons = groupes.map(([g, lib]) => html`<div class="pm-jetons-groupe"><span class="mut petit">${lib}</span><div class="jetons">${M().JETONS[g].map(([k, l]) => html`<button type="button" data-action="pm-jeton" data-k="${k}" aria-label="Insérer le champ ${l}" data-bulle="${l}">{${k}}</button>`)}</div></div>`);
    const doc = html`<details class="pm-doc-jetons"><summary>Signification des champs dynamiques</summary><dl>${groupes.map(([g]) => M().JETONS[g].map(([k, l]) => html`<dt><code>{${k}}</code></dt><dd>${l}</dd>`))}</dl></details>`;
    const blocs = [];
    if (caps.titre || caps.sousTitre) blocs.push(html`<div class="form-grille">${caps.titre ? F.texte({ id: idDe('titre'), nom: 'titre', lib: 'Titre du document', val: r.titre, req: true, plein: !caps.sousTitre, attrs: { maxlength: 90, autocomplete: 'off' } }) : ''}${caps.sousTitre ? F.texte({ id: idDe('sousTitre'), nom: 'sousTitre', lib: 'Sous-titre', val: r.sousTitre, plein: !caps.titre, attrs: { maxlength: 140, autocomplete: 'off' }, aide: 'Facultatif.' }) : ''}</div>`);
    if (caps.texte)
      blocs.push(html`${F.zone({ id: 'pm-texte', nom: 'texte', lib: d.categorie === 'carte' ? 'Texte du verso' : 'Texte du document', val: r.texte, lignes: 9, plein: true, attrs: { maxlength: 4000, spellcheck: 'true' }, aide: 'Paragraphes séparés par une ligne vide. **texte** : gras. Les champs dynamiques entre accolades sont remplacés à l’impression. Le HTML n’est pas accepté.' })}
        <div class="pm-jetons" role="group" aria-label="Champs dynamiques à insérer dans le texte"><b class="petit">Insérer un champ dynamique (au curseur)</b>${jetons}${doc}</div>`);
    if ((d.champsOptionnels || []).length)
      blocs.push(html`<fieldset class="champ pm-radios"><legend class="lib">Éléments affichés</legend><div class="pile-sm">${d.champsOptionnels.map(([k, lib, def]) => caseChamp('champs.' + k, lib, r.champs[k] ?? def))}</div></fieldset>`);
    if (!blocs.length) blocs.push(ui.encadre(d.id === 'rapport-perso' ? 'Le titre et les blocs de ce rapport se composent dans Rapports › Générateur ; ici se règlent la mise en page, les signatures et le filigrane.' : 'Ce modèle n’a pas de texte rédigé : son contenu est calculé à partir des données de l’école. Réglez ici la mise en page, les signatures et le filigrane.'));
    return html`<div class="pile">${blocs}</div>`;
  }

  function ongletPage(d, r) {
    const papiers = d.papiers || [r.page.papier || 'A4'];
    const orientations = d.orientations || [r.page.orientation || 'portrait'];
    const LIB_PAPIER = { A4: 'A4 (210 × 297 mm)', A5: 'A5 (148 × 210 mm)' };
    const e = r.entete || {};
    return html`<div class="pile">
      ${section('Format', 'layout', html`<div class="form-grille">
        ${papiers.length > 1 ? F.choix({ id: idDe('page.papier'), nom: 'page.papier', lib: 'Papier', val: r.page.papier, options: papiers.map((x) => [x, LIB_PAPIER[x] || x]) }) : html`<p class="petit mb0">Papier : <b>${LIB_PAPIER[papiers[0]] || papiers[0]}</b><br><span class="mut">imposé par ce modèle</span></p>`}
        ${orientations.length > 1 ? radios('page.orientation', 'Orientation', orientations.map((o) => [o, o === 'paysage' ? 'Paysage' : 'Portrait']), r.page.orientation) : html`<p class="petit mb0">Orientation : <b>${orientations[0] === 'paysage' ? 'paysage' : 'portrait'}</b><br><span class="mut">imposée par ce modèle</span></p>`}</div>
        <div class="form-grille">${['h', 'd', 'b', 'g'].map((k) => nombreChamp('page.marges.' + k, r.page.marges[k], { lib: { h: 'Marge haut', d: 'Marge droite', b: 'Marge bas', g: 'Marge gauche' }[k], aide: '5 à 35 mm' }))}</div>
        <p class="mut petit mb0">Imprimez à l’échelle 100 % : les marges sont dessinées dans la feuille.</p>`)}
      ${section('En-tête', 'school', html`${caseChamp('entete.officiel', 'En-tête officiel (ministère, République, devise, armoiries)', e.officiel !== false, 'Sinon : nom, adresse et téléphone de l’école seulement.')}
        ${caseChamp('entete.compact', 'En-tête compact (moins haut)', !!e.compact)}
        ${e.officiel !== false ? html`${caseChamp('entete.logos', 'Logos de l’école et de l’IEPP (s’ils sont enregistrés)', e.logos !== false)}${caseChamp('entete.armoiries', 'Armoiries', e.armoiries !== false)}` : ''}
        <p class="mut petit mb0">Le texte des lignes officielles se modifie dans Paramètres › École.</p>`)}
      ${section('Pied de page et couleur', 'file', html`${F.texte({ id: idDe('pied.texte'), nom: 'pied.texte', lib: 'Texte du pied de page', val: r.pied.texte, attrs: { maxlength: 160, autocomplete: 'off' }, aide: 'Vide : adresse, téléphone et courriel de l’école.' })}
        ${caseChamp('pied.reference', 'Afficher la référence du document', r.pied.reference !== false)}
        ${caseChamp('pied.numeros', 'Numéroter les pages (documents de plusieurs pages)', r.pied.numeros !== false)}
        ${couleur('couleur', 'Couleur d’accent (filet sous le titre)', r.couleur)}`)}</div>`;
  }

  function ongletCarte(d, r) {
    const c = r.carte || {};
    const agent = d.sujet === 'agent';
    return html`<div class="pile">
      ${section('Format', 'idCard', html`${F.choix({ id: idDe('carte.format'), nom: 'carte.format', lib: 'Format de la carte', val: c.format, options: Object.entries(AK.cartes.FORMATS).map(([k, f]) => [k, f.lib]) })}
        ${c.format === 'perso' ? html`<div class="form-grille">${nombreChamp('carte.l', c.l, { step: 'any' })}${nombreChamp('carte.h', c.h, { step: 'any' })}</div>` : ''}
        ${caseChamp('carte.verso', 'Imprimer le verso (texte, coordonnées de l’école)', c.verso)}
        ${caseChamp('carte.eco', 'Bande claire (économie d’encre)', c.eco)}`)}
      ${section('Validité', 'cal', html`${radios('carte.expiration', 'Fin de validité', EXPIRATIONS, c.expiration)}
        ${c.expiration === 'date' ? F.date({ id: idDe('carte.dateExpiration'), nom: 'carte.dateExpiration', lib: 'Valable jusqu’au', val: c.dateExpiration, req: true, attrs: { min: u.aujourdhui() } }) : ''}`)}
      ${section('Couleurs', 'drop', html`<div class="form-grille">${agent ? '' : couleur('carte.bande', 'Bande supérieure', c.bande)}${couleur('carte.filet', 'Filet sous la bande', c.filet)}</div>
        ${agent ? html`<p class="mut petit mb0">La bande des cartes professionnelles reste bleu nuit (distinction avec les cartes d’élèves).</p>` : ''}`)}</div>`;
  }

  function ongletSignatures(d, r) {
    const L = r.signatures || [];
    const ligne = (s, i) => html`<div class="pm-sig" role="group" aria-label="Signature ${i + 1}">
      <div class="ligne-entre"><b class="petit">Signature ${i + 1}</b><span class="ligne">${i > 0 ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="pm-sig-monter" data-i="${i}" aria-label="Monter la signature ${i + 1}">${ic('chevU')}</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-action="pm-sig-retirer" data-i="${i}" aria-label="Retirer la signature ${i + 1}">${ic('trash')}Retirer</button></span></div>
      <div class="form-grille">${F.texte({ id: idDe(`sig.${i}.role`), nom: `sig.${i}.role`, lib: 'Rôle', val: s.role, req: true, attrs: { maxlength: 60, autocomplete: 'off', placeholder: 'Le Directeur' } })}${F.texte({ id: idDe(`sig.${i}.nom`), nom: `sig.${i}.nom`, lib: 'Nom imprimé', val: s.nom, attrs: { maxlength: 80, autocomplete: 'off', placeholder: '{directeur}' }, aide: 'Facultatif. {directeur} : nom du directeur.' })}</div>
      <div class="coches">${caseChamp(`sig.${i}.cadre`, 'Cadre autour de la zone', s.cadre)}${caseChamp(`sig.${i}.cachet`, 'Emplacement du cachet', s.cachet)}</div></div>`;
    return html`<div class="pile">
      ${ui.encadre('Les zones de signature et de cachet restent vides : elles sont signées et tamponnées à la main. L’application n’imite jamais une signature ni un cachet.', '', 'sign')}
      ${L.length ? L.map(ligne) : html`<p class="mut mb0">Aucune signature : le document n’aura pas de zone de signature.</p>`}
      ${L.length < MAX_SIGNATURES ? html`<div><button type="button" class="btn btn-sm" data-action="pm-sig-ajouter">${ic('plus')}Ajouter une signature</button> <span class="mut petit">${L.length} sur ${MAX_SIGNATURES} au plus</span></div>` : html`<p class="mut petit mb0">${MAX_SIGNATURES} signatures au plus.</p>`}
      ${L.length ? html`<div class="form-grille">${caseChamp('lieuDate', '« Fait à …, le … » au-dessus des signatures', r.lieuDate !== false)}${nombreChamp('hauteurSignature', r.hauteurSignature)}</div>` : ''}</div>`;
  }

  function ongletFiligrane(d, r) {
    // valeurs saisies telles quelles (même invalides, pour être corrigées), sinon valeurs normalisées
    const f0 = r.filigrane || {}, fn = AK.filigrane.normaliser(f0);
    const f = Object.fromEntries(Object.keys(fn).map((k) => [k, k !== 'type' && f0[k] !== undefined ? f0[k] : fn[k]]));
    const q = r.qr || {};
    const carte = d.categorie === 'carte';
    return html`<div class="pile">
      ${section('Filigrane décoratif', 'layers', html`${F.choix({ id: idDe('filigrane.type'), nom: 'filigrane.type', lib: 'Type', val: f.type, options: AK.filigrane.TYPES })}
        ${f.type === 'texte' ? F.texte({ id: idDe('filigrane.texte'), nom: 'filigrane.texte', lib: 'Texte du filigrane', val: f.texte, req: true, attrs: { maxlength: 60, autocomplete: 'off' } }) : ''}
        ${f.type === 'logo' ? F.choix({ id: idDe('filigrane.logo'), nom: 'filigrane.logo', lib: 'Image', val: f.logo, options: LOGOS_FILIGRANE, aide: 'Une image absente (logo non enregistré) n’est pas dessinée.' }) : ''}
        ${f.type !== 'aucun' ? html`<div class="form-grille">${nombreChamp('filigrane.opacite', f.opacite)}${nombreChamp('filigrane.taille', f.taille, { aide: 'Part de la feuille, 20 à 100 %' })}
          ${f.type !== 'logo' ? nombreChamp('filigrane.rotation', f.rotation, { aide: 'De −90 à 90°' }) : ''}${F.choix({ id: idDe('filigrane.position'), nom: 'filigrane.position', lib: 'Position', val: f.position, options: POSITIONS })}
          ${f.type !== 'logo' ? couleur('filigrane.couleur', 'Couleur', f.couleur) : ''}</div>
          <div class="pile-sm">${f.type !== 'logo' ? caseChamp('filigrane.repetition', 'Répéter le texte sur toute la feuille', f.repetition) : ''}${caseChamp('filigrane.ecran', 'Visible à l’écran (aperçu)', f.ecran)}${caseChamp('filigrane.impression', 'Imprimé', f.impression)}</div>` : ''}
        <p class="mut petit mb0">Les mentions d’état (SPÉCIMEN, COPIE, DUPLICATA, ANNULÉ, PROVISOIRE) sont ajoutées automatiquement selon l’état réel du document et ne se règlent pas ici. Un filigrane n’est pas une protection contre la falsification : c’est le QR code signé qui l’est.</p>`)}
      ${d.emission ? section('QR code de vérification', 'qr', html`${caseChamp('qr.actif', 'Imprimer le QR code de vérification', q.actif !== false, 'Il contient la référence, la date d’émission, une empreinte des données et la signature électronique de l’école.')}
        ${q.actif !== false ? html`${caseChamp('qr.identite', 'Ajouter le nom et le matricule dans le QR code', q.identite, 'Lisibles par n’importe quel lecteur de QR code. Jamais de téléphone, de santé ni de photo.')}${carte ? '' : nombreChamp('qr.taille', q.taille)}` : html`<p class="mut petit mb0">Sans QR code, le document reste inscrit au registre et vérifiable par sa référence.</p>`}`) : ''}</div>`;
  }

  function rendreEditeur(d, p) {
    const id = d.id;
    if (idEditeur !== id) {
      idEditeur = id;
      ongletActif = 'contenu';
    }
    const b = brouillonDe(id), r = b.r;
    const enr = S().modeles[id] || null;
    const perso = M().estPersonnalise(id);
    const carte = d.categorie === 'carte';
    const caps = capacitesDe(d);
    const ex = contexteExemple(d);
    const versionTxt = enr ? `Modèle v${d.version} · révision ${enr.rev || 1} enregistrée le ${u.fmtHorodatage(enr.maj)}${enr.par ? ' par ' + enr.par : ''}` : `Modèle d’origine v${d.version}`;
    const actions = html`<a class="btn btn-ghost" href="#${ROUTE}">${ic('chevL')}Tous les modèles</a>
      ${ex.manque ? '' : html`<button type="button" class="btn" data-action="pm-specimen" data-modele="${id}">${ic('print')}Imprimer un spécimen</button>`}
      ${b.modifie ? html`<button type="button" class="btn" data-action="pm-annuler" data-modele="${id}">${ic('rotate')}Annuler les modifications</button>` : ''}
      ${perso ? html`<button type="button" class="btn btn-dng" data-action="pm-retablir" data-modele="${id}">${ic('history')}Rétablir le modèle d’origine</button>` : ''}
      ${caps ? html`<button type="submit" class="btn btn-pri" form="pm-form">${ic('save')}Enregistrer</button>` : ''}`;
    let reglages;
    if (!caps) reglages = html`<div class="carte pm-attente" role="status">${ic('clock')} Analyse des réglages utilisés par ce modèle…</div>`;
    else {
      const onglets = [['contenu', 'Contenu', ongletContenu(d, r, caps)]];
      if (carte) onglets.push(['carte', 'Carte', ongletCarte(d, r)]);
      else onglets.push(['page', 'Page', ongletPage(d, r)]);
      if (caps.signatures) onglets.push(['signatures', 'Signatures', ongletSignatures(d, r)]);
      onglets.push(['filigrane', d.emission ? 'Filigrane & QR' : 'Filigrane', ongletFiligrane(d, r)]);
      reglages = html`<form id="pm-form" class="carte pm-form" novalidate autocomplete="off" data-submit="pm-enregistrer" data-input="pm-saisie" data-change="pm-change" data-modele="${id}" aria-label="Réglages du modèle ${d.lib}">
        ${caps.sure ? '' : ui.encadre('Sans donnée d’exemple, l’éditeur ne peut pas vérifier quels réglages ce modèle utilise : tous sont proposés, ceux qui ne s’appliquent pas sont ignorés à l’impression.', 'avert')}
        ${ui.ongletsForm(onglets)}
        <div class="pm-pied-form"><span class="petit ${b.modifie ? '' : 'mut'}" id="pm-etat" role="status">${b.modifie ? 'Modifications non enregistrées' : 'Aucune modification'}</span><span class="espace"></span><button type="submit" class="btn btn-pri">${ic('save')}Enregistrer</button></div></form>`;
    }
    return html`${ui.pageTete(html`Modèle : ${d.lib}`, html`${d.description || ''} <span class="mut">${versionTxt}.</span>`, actions)}
      ${!M().aJour(id) ? ui.encadre(html`<b>Le modèle d’origine a évolué</b> (v${d.version}) depuis votre personnalisation (v${enr ? enr.version : '?'}). Vérifiez l’aperçu puis enregistrez pour adopter la nouvelle version avec vos réglages.`, 'avert') : ''}
      ${b.modifie ? ui.encadre('Brouillon en cours : les modifications ne seront utilisées par les documents qu’après « Enregistrer ».', 'avert', 'edit') : ''}
      <div class="editeur-modele">
        <div class="panneau-reglages">${reglages}</div>
        <section class="carte pm-apercu-carte" aria-labelledby="pm-apercu-titre">
          <div class="carte-tete"><div><h2 id="pm-apercu-titre">Aperçu (spécimen)</h2><div class="sous">${ex.manque ? 'Aucun exemple disponible' : html`Exemple : ${ex.libelle}`}. Rien n’est émis ni inscrit au registre.</div></div></div>
          <div id="pm-apercu" class="pm-apercu" role="region" aria-label="Aperçu réduit du document" aria-busy="false">${apercu.id === id && apercu.corps ? apercu.corps : html`<p class="mut">${ic('clock')} Préparation de l’aperçu…</p>`}</div>
        </section>
      </div>`;
  }

  /* ---------- Aperçu en direct ---------- */
  let apercu = { id: null, cle: '', corps: null, gen: 0, duree: 0 };
  function zoomer(zone) {
    if (!zone) return;
    const dispo = Math.max(120, zone.clientWidth - 8);
    $$('.feuille-cadre', zone).forEach((c) => {
      const f = c.querySelector('[data-l]');
      if (!f) return;
      const l = Number(f.dataset.l || 210) * MM;
      const max = l < 400 ? 1.8 : 1; // une carte (85 mm) peut être agrandie pour rester lisible
      c.style.zoom = Math.min(max, dispo / l).toFixed(4);
    });
  }
  addEventListener('resize', u.differer(() => zoomer($('#pm-apercu')), 150));

  function corpsApercu(g) {
    const MAX = 3;
    const avert = g.avertissements.length ? ui.encadre([...new Set(g.avertissements)].join(' '), 'avert') : '';
    let pages, libelles;
    if (g.cartes.length) {
      const r = g.reglages;
      pages = AK.cartes.planches(g.cartes.slice(0, 1), { mode: 'unitaire', verso: !!(r.carte && r.carte.verso) });
      libelles = ['Recto', 'Verso'];
    } else {
      pages = g.feuilles;
      libelles = pages.map((x, i) => (pages.length > 1 ? `Page ${i + 1} / ${pages.length}` : ''));
    }
    if (!pages.length) return html`${avert}${ui.vide('Aucune page produite', 'Ce modèle n’a rien produit pour l’exemple choisi.')}`;
    return html`${avert}<div class="apercu"><div class="pages">${pages.slice(0, MAX).map((x, i) => html`<div class="feuille-cadre">${libelles[i] ? html`<span class="num-page">${libelles[i]}</span>` : ''}${x}</div>`)}</div></div>
      ${pages.length > MAX ? html`<p class="mut petit mt0">${u.pluriel(pages.length - MAX, 'autre page', 'autres pages')} non affichée(s) : « Imprimer un spécimen » montre le document entier.</p>` : ''}`;
  }

  async function dessinerApercu(id) {
    const zone = $('#pm-apercu');
    const d = M().get(id), b = brouillons.get(id);
    if (!zone || !d || !b) return;
    const cle = JSON.stringify(b.r);
    if (apercu.id === id && apercu.cle === cle && apercu.corps) {
      zoomer(zone);
      return;
    }
    const gen = ++apercu.gen;
    zone.setAttribute('aria-busy', 'true');
    const t0 = performance.now();
    let corps;
    try {
      const caps = capacites.get(id) || capacitesSupposees(d);
      const r = controler(d, b.r, caps);
      const ex = contexteExemple(d);
      if (ex.manque) corps = ui.vide('Aperçu indisponible', ex.manque);
      else corps = corpsApercu(await AK.docs.generer(id, [ex.ctx], { reglages: r, apercu: true, statutForce: 'specimen' }));
    } catch (e) {
      if (e instanceof AK.ErreurMetier) corps = ui.encadre(html`<b>Aperçu en attente :</b> ${e.message}`, 'avert');
      else {
        AK.diag.erreur(e, 'aperçu du modèle ' + id);
        corps = ui.encadre('L’aperçu n’a pas pu être dessiné (erreur inattendue, détail dans Paramètres › Diagnostic). Vos réglages ne sont pas perdus.', 'erreur');
      }
    }
    if (gen !== apercu.gen) return; // un aperçu plus récent est en préparation
    apercu = { id, cle, corps, gen, duree: performance.now() - t0 };
    const z = $('#pm-apercu');
    if (!z) return;
    u.poser(z, corps);
    z.setAttribute('aria-busy', 'false');
    zoomer(z);
    suivreDefilementApercu(z, id);
  }
  function suivreDefilementApercu(z, id) {
    const a = $('.apercu', z);
    if (!a) return;
    if (defil.id === id) a.scrollTop = defil.apercu;
    a.addEventListener('scroll', () => {
      if (defil.id !== id) defil = { id, reglages: 0, apercu: 0 };
      defil.apercu = a.scrollTop;
    }, { passive: true });
  }
  /* Document long (listes paginées) : l'aperçu attend une pause plus longue dans la frappe. */
  let minuterie = 0;
  function planifierApercu(id) {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => dessinerApercu(id), apercu.duree > 400 ? 1200 : 350);
  }

  function marquerModifie(form) {
    const el = $('#pm-etat', form);
    if (el && el.textContent !== 'Modifications non enregistrées') {
      el.textContent = 'Modifications non enregistrées';
      el.classList.remove('mut');
    }
  }

  function apresEditeur(racine, id) {
    const form = $('#pm-form', racine);
    if (form) {
      ui.activerOnglets(form);
      const t = $$('[role="tab"]', form);
      const voulu = t.find((x) => x.id.endsWith('-t-' + ongletActif));
      if (voulu && voulu.getAttribute('aria-selected') !== 'true') voulu.click();
      t.forEach((x) => x.addEventListener('click', () => (ongletActif = x.id.split('-t-').pop())));
      const tx = $('#pm-texte', form);
      if (tx) tx.addEventListener('focus', () => (dernierAccesTexte = true));
    }
    if (defil.id !== id) defil = { id, reglages: 0, apercu: 0 };
    const pan = $('.panneau-reglages', racine);
    if (pan) {
      pan.scrollTop = defil.reglages;
      pan.addEventListener('scroll', () => (defil.id === id ? (defil.reglages = pan.scrollTop) : null), { passive: true });
    }
    const z = $('#pm-apercu', racine);
    if (z) {
      zoomer(z);
      suivreDefilementApercu(z, id);
    }
    dessinerApercu(id);
  }

  function rendu(p) {
    if (p.modele) {
      const d = M().get(p.modele);
      if (d) return rendreEditeur(d, p);
      return html`${ui.encadre(html`Modèle introuvable : « ${p.modele} ». Choisissez un modèle dans la liste.`, 'avert')}${rendreListe({})}`;
    }
    idEditeur = null;
    return rendreListe(p);
  }

  /* ---------- Actions ---------- */
  const formulaire = () => $('#pm-form');
  const modeleCourant = (el) => {
    const id = (el && el.dataset.modele) || (formulaire() && formulaire().dataset.modele) || AK.shell.params().modele;
    const d = M().get(id);
    if (!d) throw new AK.ErreurMetier('Modèle introuvable.');
    return d;
  };
  /** Le brouillon reprend d'abord ce qui est saisi dans le formulaire. */
  function synchroniser(d) {
    const b = brouillonDe(d.id), f = formulaire();
    if (f && f.dataset.modele === d.id) b.r = lireFormulaire(f, b.r);
    return b;
  }
  function erreurSousChamp(err) {
    const f = formulaire();
    if (!(err instanceof AK.ErreurMetier) || !f) throw err;
    ui.effacerErreurs(f);
    ui.erreurChamp(f, err.champ && f.querySelector(`[name="${CSS.escape(err.champ)}"]`) ? err.champ : null, err.message);
    if (!err.champ || !f.querySelector(`[name="${CSS.escape(err.champ)}"]`)) ui.toast(err.message, { type: 'erreur' });
  }

  AK.actions.defSaisie({
    'pm-saisie'(form, e) {
      const d = M().get(form.dataset.modele);
      if (!d) return;
      const b = brouillonDe(d.id), premier = !b.modifie;
      b.r = lireFormulaire(form, b.r);
      b.modifie = true;
      marquerModifie(form);
      if (premier) AK.shell.redessiner(); // fait apparaître « Annuler les modifications » (le focus est conservé)
      const ch = e && e.target && e.target.closest('.champ');
      if (ch) $$('.erreur-champ', ch).forEach((x) => x.remove());
      if (e && e.target) e.target.removeAttribute('aria-invalid');
      const sp = e && e.target && e.target.type === 'color' && e.target.nextElementSibling;
      if (sp) sp.textContent = e.target.value;
      planifierApercu(d.id);
    }
  });
  AK.actions.defChange({
    'pm-change'(form, e) {
      const d = M().get(form.dataset.modele);
      if (!d) return;
      const b = brouillonDe(d.id), premier = !b.modifie;
      b.r = lireFormulaire(form, b.r);
      b.modifie = true;
      marquerModifie(form);
      if (premier || (e && e.target && STRUCTURELS.has(e.target.name))) AK.shell.redessiner();
      else planifierApercu(d.id);
    }
  });
  AK.actions.defEnvoi({
    'pm-enregistrer'(form) {
      const d = M().get(form.dataset.modele);
      if (!d) throw new AK.ErreurMetier('Modèle introuvable.');
      AK.perm.exiger('modeles.gerer');
      const b = synchroniser(d);
      ui.effacerErreurs(form);
      try {
        const o = controler(d, b.r, capacites.get(d.id) || capacitesSupposees(d), { strict: true });
        let avant = null;
        try {
          avant = JSON.stringify(M().valider(d.id, reglagesNormalises(d.id)));
        } catch (e) {
          avant = null; // réglages enregistrés devenus invalides : l'enregistrement les remplacera
        }
        if (M().aJour(d.id) && avant === JSON.stringify(o)) {
          brouillons.delete(d.id);
          AK.shell.redessiner();
          return ui.toast('Aucune modification à enregistrer : les réglages sont identiques à la dernière révision.', { type: 'avert' });
        }
        M().enregistrer(d.id, b.r);
      } catch (err) {
        return erreurSousChamp(err);
      }
      brouillons.delete(d.id);
      const enr = S().modeles[d.id];
      ui.toast(`Modèle « ${d.lib} » enregistré${enr ? ` (révision ${enr.rev})` : ''}. Les prochains documents l’utiliseront.`);
    }
  });
  AK.actions.def({
    'pm-cat'(el) {
      AK.shell.aller(ROUTE, el.dataset.v ? { cat: el.dataset.v } : undefined);
    },
    'pm-jeton'(el) {
      const t = $('#pm-texte');
      if (!t) return;
      const k = `{${el.dataset.k}}`;
      const a = dernierAccesTexte ? t.selectionStart : t.value.length, z = dernierAccesTexte ? t.selectionEnd : t.value.length;
      t.value = t.value.slice(0, a) + k + t.value.slice(z);
      t.focus();
      t.setSelectionRange(a + k.length, a + k.length);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'pm-sig-ajouter'(el) {
      const d = modeleCourant(el), b = synchroniser(d);
      if ((b.r.signatures || []).length >= MAX_SIGNATURES) throw new AK.ErreurMetier(`${MAX_SIGNATURES} signatures au plus.`);
      b.r.signatures = [...(b.r.signatures || []), { role: '', nom: '', cadre: false, cachet: false }];
      b.modifie = true;
      AK.shell.redessiner();
      setTimeout(() => {
        const i = $(`#${idDe(`sig.${b.r.signatures.length - 1}.role`)}`);
        if (i) i.focus();
      }, 60);
    },
    'pm-sig-retirer'(el) {
      const d = modeleCourant(el), b = synchroniser(d), i = Number(el.dataset.i);
      b.r.signatures = (b.r.signatures || []).filter((x, k) => k !== i);
      b.modifie = true;
      AK.shell.redessiner();
      ui.toast('Signature retirée du brouillon (« Annuler les modifications » la rétablit tant que rien n’est enregistré).', { type: 'ok' });
    },
    'pm-sig-monter'(el) {
      const d = modeleCourant(el), b = synchroniser(d), i = Number(el.dataset.i);
      const L = (b.r.signatures || []).slice();
      if (i < 1 || i >= L.length) return;
      [L[i - 1], L[i]] = [L[i], L[i - 1]];
      b.r.signatures = L;
      b.modifie = true;
      AK.shell.redessiner();
    },
    async 'pm-annuler'(el) {
      const d = modeleCourant(el);
      const ok = await ui.confirmer({ titre: 'Annuler les modifications', message: html`Les réglages de « ${d.lib} » modifiés depuis le dernier enregistrement seront perdus.`, ok: 'Annuler les modifications', annuler: 'Continuer la saisie', danger: true });
      if (!ok) return;
      brouillons.delete(d.id);
      apercu.cle = '';
      AK.shell.redessiner();
      ui.toast('Modifications annulées : réglages enregistrés rétablis.');
    },
    async 'pm-retablir'(el) {
      const d = modeleCourant(el);
      AK.perm.exiger('modeles.gerer');
      const enr = S().modeles[d.id];
      const b = brouillons.get(d.id);
      const ok = await ui.confirmer({
        titre: 'Rétablir le modèle d’origine', danger: true, ok: 'Rétablir le modèle d’origine',
        message: html`Toutes les personnalisations de « ${d.lib} »${enr ? ` (révision ${enr.rev || 1})` : ''} seront effacées : le modèle d’origine v${d.version} sera de nouveau utilisé pour les prochains documents.${b && b.modifie ? ' Le brouillon en cours sera aussi abandonné.' : ''} Les documents déjà émis ne changent pas. Vous pourrez annuler juste après.`
      });
      if (!ok) return;
      const avant = reglagesNormalises(d.id);
      M().reinitialiser(d.id);
      brouillons.delete(d.id);
      ui.toast(`Modèle « ${d.lib} » rétabli dans sa version d’origine.`, {
        duree: 12000,
        action: {
          lib: 'Annuler',
          f: () => {
            try {
              M().enregistrer(d.id, avant);
              ui.toast('Personnalisation rétablie (nouvelle révision).');
            } catch (e) {
              ui.erreur(e);
            }
          }
        }
      });
    },
    async 'pm-specimen'(el) {
      const d = modeleCourant(el), b = synchroniser(d);
      let r;
      try {
        r = controler(d, b.r, capacites.get(d.id) || capacitesSupposees(d));
      } catch (err) {
        return erreurSousChamp(err);
      }
      const ex = contexteExemple(d);
      if (ex.manque) throw new AK.ErreurMetier(ex.manque);
      await AK.docs.ouvrir(d.id, [ex.ctx], { apercu: true, reglages: r, statutForce: 'specimen', titre: `Spécimen · ${d.lib}${b.modifie ? ' (brouillon)' : ''}`, nomFichier: `specimen-${d.id}` });
    }
  });

  AK.ecrans.def(ROUTE, {
    rendu,
    droit: 'modeles.gerer',
    apres(racine, p) {
      const d = p && p.modele && M().get(p.modele);
      if (d) apresEditeur(racine, d.id);
    }
  });
})(window.AK);
