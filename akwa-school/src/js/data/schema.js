/* =====================================================================================
   Schéma des données, assainissement, migration et contrôle d'intégrité.

   Compatibilité : la structure reste celle d'AKWA SCHOOL 1.x (v: 5 : élèves, personnel,
   notes « id|évaluation|matière », appels, demandes…), complétée de rubriques nouvelles
   (meta, securite, docs, modeles, cles, corbeille). Une sauvegarde 1.x s'ouvre sans perte ;
   l'export « format 1.x » permet de revenir vers les applications existantes.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u;
  const SCHEMA = 6;

  function proVide() {
    return {
      edt: {}, cahier: [], incidents: [], soins: [], events: [],
      frais: {}, paiements: [], depenses: [],
      cantine: { inscrits: {}, prix: 100, menu: C.JOURS_EDT.map(([, j]) => ({ j, p: '' })), repas: {} },
      livres: [], prets: [], cepe: {}, sms: [], annonces: [], transmis: [],
      seq: { rec: 1 }, journal: []
    };
  }

  /** État vierge d'une nouvelle école. */
  function vierge() {
    return {
      v: 5,
      meta: { schema: SCHEMA, app: AK.VERSION, cree: new Date().toISOString(), installId: u.uid() + u.uid(), migreDe: null, demo: false },
      school: { ...u.clone(C.ECOLE) },
      students: [], teachers: [], grades: {}, compAbs: {}, att: {}, appel: {}, auth: [], conges: [],
      redac: {}, persoReps: [], archives: {}, lastBackup: '', log: [], messages: [], attente: {}, saisie: {},
      cpMat: {}, cpExtra: [], pro: proVide(),
      securite: { admin: null, secours: null, comptes: {}, verrouMin: C.SECU.VERROU_MIN, forcerChangement: false, aSecourir: false },
      docs: { seq: {}, items: [] },
      modeles: {},
      cles: { liste: [], active: null },
      corbeille: []
    };
  }

  /* ---------- Assainissement des données venues d'ailleurs (sauvegarde, import, migration) ----------
     Rien ne doit pouvoir s'exécuter : images limitées aux images intégrées (PNG, JPEG, GIF, WebP),
     identifiants limités aux lettres, chiffres, - et _, clés dangereuses (__proto__…) écartées.
     Le texte est conservé tel quel : l'affichage échappe systématiquement le HTML. */
  const CH_IMG = new Set(['photo', 'extraitPhoto', 'avis', 'logoEcole', 'logoIepp', 'armoiries', 'signatureImg']);
  const CH_ID = new Set(['id', 'tid', 'sid', 'pid', 'livre']);
  const INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_TEXTE = 20000;
  function assainir(v, cle, profondeur = 0) {
    if (profondeur > 40) return null;
    if (typeof v === 'string') {
      if (CH_IMG.has(cle)) return u.IMG_OK.test(v) ? v : '';
      if (CH_ID.has(cle)) return v.replace(/[^\w-]/g, '').slice(0, 64);
      return v.length > MAX_TEXTE ? v.slice(0, MAX_TEXTE) : v;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v == null) return v;
    if (Array.isArray(v)) return v.map((x) => assainir(x, cle, profondeur + 1));
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        if (INTERDITES.has(k)) continue;
        out[k] = assainir(v[k], k, profondeur + 1);
      }
      return out;
    }
    return null;
  }

  const SANS_PARENT = { nom: '', prenoms: '', profession: '', tel: '', domicile: '' };
  const tableau = (x) => (Array.isArray(x) ? x : []);
  const objet = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

  /** Complète un élève (champs ajoutés au fil des versions). */
  function completerEleve(s) {
    s.id = s.id || u.uid();
    s.nom = String(s.nom || '');
    s.prenoms = String(s.prenoms || '');
    s.pere = { ...SANS_PARENT, ...objet(s.pere) };
    s.mere = { ...SANS_PARENT, ...objet(s.mere) };
    ['sang', 'allergies', 'entree', 'motifDepart', 'lieu', 'parent', 'tel', 'mat', 'photo', 'decision'].forEach((k) => {
      if (s[k] == null) s[k] = '';
    });
    const natRef = AK.ref.NATIONALITES.find((x) => u.norm(x[1]) === u.norm(s.nationalite));
    s.nationalite = natRef ? natRef[1] : String(s.nationalite || '').trim().toUpperCase() || C.NAT_DEFAUT;
    if (s.matNat == null) s.matNat = /^AK-/i.test(s.mat || '') ? '' : s.mat || '';
    s.parcours = tableau(s.parcours);
    s.acte = { num: '', date: '', centre: '', sp: '', ...objet(s.acte) };
    s.extrait = !!s.extrait;
    s.redoublant = !!s.redoublant;
    if (!C.STATUTS.includes(s.statut)) s.statut = 'Inscrit';
    if (s.sexe !== 'Masculin' && s.sexe !== 'Féminin') s.sexe = s.sexe ? (/^m/i.test(s.sexe) ? 'Masculin' : 'Féminin') : '';
    return s;
  }
  function completerAgent(t) {
    t.id = t.id || u.uid();
    t.nom = String(t.nom || '');
    if (!Array.isArray(t.classes)) t.classes = t.classe ? [t.classe] : [];
    t.classes = t.classes.filter((c) => C.TOUS_NIVEAUX.includes(c));
    t.classe = t.classes[0] || '';
    if (t.compte === undefined) t.compte = null;
    if (t.actif == null) t.actif = true;
    ['matricule', 'fonction', 'grade', 'echelon', 'tel', 'fonct', 'fonctAutre', 'photo'].forEach((k) => {
      if (t[k] == null) t[k] = '';
    });
    return t;
  }

  /**
   * Migration contrôlée vers le schéma courant. Ne supprime aucune donnée métier.
   * Renvoie { etat, notes } ; « notes » décrit ce qui a été transformé (affiché à l'utilisateur).
   * Les secrets en clair (mot de passe « adminPwd », code de secours) sont retirés ici et
   * convertis en empreintes par AK.auth.migrerSecrets() (opération asynchrone).
   */
  function migrer(source) {
    const notes = [];
    if (!source || typeof source !== 'object' || !Array.isArray(source.students)) throw new AK.ErreurMetier('Données illisibles : ce fichier ne contient pas de liste d’élèves.');
    const o = assainir(source);
    const base = vierge();
    const ancien = !o.meta || !o.meta.schema;
    if (o.meta && o.meta.schema > SCHEMA) throw new AK.ErreurMetier(`Ces données viennent d’une version plus récente d’AKWA SCHOOL (schéma ${o.meta.schema}). Mettez l’application à jour avant de les ouvrir.`);

    const S = { ...base, ...o };
    S.v = 5;
    S.meta = { ...base.meta, ...objet(o.meta), schema: SCHEMA, app: AK.VERSION };
    if (ancien) {
      S.meta.migreDe = '1.x';
      S.meta.installId = base.meta.installId;
      notes.push('Données AKWA SCHOOL 1.x converties au format 2.0.');
    }
    S.school = { ...u.clone(C.ECOLE), ...objet(o.school) };
    if (!Array.isArray(S.school.niveaux) || !S.school.niveaux.length) S.school.niveaux = C.TOUS_NIVEAUX.slice();
    S.school.niveaux = C.TOUS_NIVEAUX.filter((c) => S.school.niveaux.includes(c));
    if (!S.school.year) S.school.year = '';
    if (S.school.accent && !C.ACCENTS.some((a) => a[0] === S.school.accent)) S.school.accent = 'navy';
    if (![1, 2, 3, 4].includes(Number(S.school.evalCourante))) S.school.evalCourante = 1;
    S.school.evalCourante = Number(S.school.evalCourante);

    /* Secrets en clair d'AKWA SCHOOL 1.x : mis de côté pour être convertis en empreintes. */
    S.securite = { ...base.securite, ...objet(o.securite) };
    S.securite.comptes = objet(S.securite.comptes);
    const ancienMdp = typeof S.school.adminPwd === 'string' ? S.school.adminPwd : null;
    if (ancienMdp != null) {
      S._mdpEnClair = ancienMdp; // retiré par AK.auth.migrerSecrets(), jamais enregistré
      notes.push('Mot de passe administrateur converti en empreinte (il n’est plus conservé en clair).');
    }
    if (S.school.secours) notes.push('Ancien code de secours retiré : un nouveau code personnel sera créé.');
    delete S.school.adminPwd;
    delete S.school.secours;
    delete S.session;

    // entrées illisibles (null, texte…) d'un fichier abîmé : ignorées et signalées, jamais bloquantes
    const fiches = (x, lib) => {
      const L = tableau(x), ok = L.filter((e) => e && typeof e === 'object' && !Array.isArray(e));
      if (ok.length < L.length) notes.push(`${L.length - ok.length} entrée(s) illisible(s) ignorée(s) dans : ${lib}.`);
      return ok;
    };
    S.students = fiches(o.students, 'élèves').map(completerEleve);
    S.teachers = fiches(o.teachers, 'personnel').map(completerAgent);
    S.grades = objet(o.grades);
    Object.keys(S.grades).forEach((k) => {
      if (typeof S.grades[k] !== 'number') delete S.grades[k];
    });
    ['compAbs', 'att', 'appel', 'redac', 'archives', 'attente', 'saisie', 'cpMat'].forEach((k) => (S[k] = objet(o[k])));
    [['auth', 'autorisations'], ['conges', 'calendrier'], ['persoReps', 'rapports personnalisés'], ['log', 'journal'], ['messages', 'messages'], ['corbeille', 'corbeille']].forEach(([k, lib]) => (S[k] = fiches(o[k], lib)));
    S.cpExtra = tableau(o.cpExtra).filter((m) => typeof m === 'string');
    S.messages.forEach((m) => (m.lus = objet(m.lus)));
    S.auth.forEach((a) => {
      if (!a.id) a.id = u.uid();
    });
    S.conges.forEach((c) => {
      if (!c.id) c.id = u.uid();
      c.lib = c.lib || c.motif || c.nom || 'Congé';
    });
    const pv = proVide(), po = objet(o.pro);
    S.pro = { ...pv, ...po };
    S.pro.cantine = { ...pv.cantine, ...objet(po.cantine) };
    S.pro.cantine.inscrits = objet(S.pro.cantine.inscrits);
    S.pro.cantine.repas = objet(S.pro.cantine.repas);
    if (!Array.isArray(S.pro.cantine.menu) || S.pro.cantine.menu.length !== C.JOURS_EDT.length) S.pro.cantine.menu = pv.cantine.menu;
    ['cahier', 'incidents', 'soins', 'events', 'paiements', 'depenses', 'livres', 'prets', 'sms', 'annonces', 'transmis', 'journal'].forEach((k) => (S.pro[k] = fiches(S.pro[k], 'vie scolaire / finances / services')));
    ['edt', 'frais', 'cepe'].forEach((k) => (S.pro[k] = objet(S.pro[k])));
    S.pro.seq = { rec: 1, ...objet(S.pro.seq) };
    // numéro de reçu suivant : jamais en dessous du plus grand numéro existant
    const maxRec = S.pro.paiements.reduce((m, p) => Math.max(m, parseInt(String(p.ref || '').split('-').pop(), 10) || 0), 0);
    if (S.pro.seq.rec <= maxRec) S.pro.seq.rec = maxRec + 1;

    S.docs = { seq: objet(objet(o.docs).seq), items: fiches(objet(o.docs).items, 'registre des documents') };
    S.modeles = objet(o.modeles);
    S.cles = { liste: tableau(objet(o.cles).liste), active: objet(o.cles).active || null };
    if (o.infra) S.infra = objet(o.infra);
    return { etat: S, notes };
  }

  /**
   * Contrôle d'intégrité : signale sans rien supprimer.
   * Chaque problème : { code, gravite: 'erreur'|'avert', message, ids }
   */
  function verifier(S) {
    const P = [];
    const niveaux = S.school.niveaux || C.TOUS_NIVEAUX;
    const vus = new Map(), matsNat = new Map();
    S.students.forEach((s) => {
      if (vus.has(s.id)) P.push({ code: 'id-double', gravite: 'erreur', message: `Identifiant d’élève en double (${s.nom} ${s.prenoms}).`, ids: [s.id] });
      vus.set(s.id, s);
      if (s.statut === 'Inscrit' && !niveaux.includes(s.classe))
        P.push({ code: 'classe-invalide', gravite: 'erreur', message: `${s.nom} ${s.prenoms} : classe « ${s.classe || 'aucune'} » absente des niveaux de l’école.`, ids: [s.id] });
      const m = u.norm(s.matNat);
      if (m) {
        if (matsNat.has(m)) P.push({ code: 'matricule-double', gravite: 'avert', message: `Matricule national ${s.matNat} attribué à deux élèves.`, ids: [matsNat.get(m), s.id] });
        else matsNat.set(m, s.id);
      }
      if (!s.sexe) P.push({ code: 'sexe-manquant', gravite: 'avert', message: `${s.nom} ${s.prenoms} : sexe non renseigné.`, ids: [s.id] });
    });
    let orphelines = 0;
    Object.keys(S.grades).forEach((k) => {
      if (!vus.has(k.split('|')[0])) orphelines++;
    });
    if (orphelines) P.push({ code: 'notes-orphelines', gravite: 'avert', message: `${u.pluriel(orphelines, 'note')} sans élève correspondant (élèves supprimés).`, ids: [] });
    const agents = new Set(S.teachers.map((t) => t.id));
    S.auth.forEach((a) => {
      const ok = a.qui === 'eleve' ? vus.has(a.pid) : agents.has(a.pid);
      if (!ok) P.push({ code: 'demande-orpheline', gravite: 'avert', message: `Demande ${a.ref} : personne introuvable (supprimée ?).`, ids: [a.id] });
    });
    const refs = new Set();
    (S.docs.items || []).forEach((d) => {
      if (refs.has(d.ref)) P.push({ code: 'reference-double', gravite: 'erreur', message: `Référence documentaire en double : ${d.ref}.`, ids: [d.ref] });
      refs.add(d.ref);
    });
    return P;
  }

  AK.schema = { SCHEMA, vierge, proVide, assainir, migrer, verifier, completerEleve, completerAgent };
})(window.AK);
