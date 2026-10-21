/* =====================================================================================
   Données & sauvegarde : l'écran de la stratégie de protection des données.
     - Sauvegarde & restauration : état de la protection (dernière sauvegarde sur clé USB,
       enregistrement automatique, copies de sécurité locales, stockage), sauvegarde avec
       empreinte SHA-256, vérification d'un fichier, restauration avec aperçu détaillé (refus
       d'un fichier altéré, confirmation tapée, mot de passe, copie de sécurité préalable),
       copies locales (restauration, enregistrement en fichier, copie à la demande), contrôle
       d'intégrité, rattachement d'un espace enseignant, export compatible 1.x.
     - Exports : fichiers CSV pour Excel (élèves, notes, absences, personnel, finances,
       documents émis, modèle d'import).
     - Journal des opérations : recherche, filtres (catégorie, auteur, période), export.
     - Corbeille : restauration, suppression définitive (confirmation tapée + mot de passe).

   Les opérations passent par les fonctions métier (AK.sauvegarde, AK.imports, AK.personnel,
   et AK.donnees ci-dessous pour ce qui manquait) : elles vérifient les droits avant d'agir ;
   masquer un bouton n'est qu'un confort d'affichage.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ, V = AK.valid;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);
  const E = (m, champ) => new AK.ErreurMetier(m, champ);
  const R_SAUV = 'donnees/sauvegarde', R_EXP = 'donnees/export', R_JOUR = 'donnees/journal', R_CORB = 'donnees/corbeille';
  const TAILLE_MAX = 300 * 1024 * 1024; // au-delà, ce n'est pas une sauvegarde d'école primaire

  /* =====================================================================================
     Outils
     ===================================================================================== */
  const auj = () => u.aujourdhui();
  const octets = (n) => {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n < 1024) return n + ' o';
    if (n < 1048576) return Math.max(1, Math.round(n / 1024)).toLocaleString('fr-FR') + ' Ko';
    if (n < 1073741824) return (n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
    return (n / 1073741824).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go';
  };
  const ilYa = (j) => (j <= 0 ? 'aujourd’hui' : j === 1 ? 'hier' : `il y a ${j} jours`);
  const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sexe = (s) => (s.sexe === 'Masculin' ? 'G' : s.sexe === 'Féminin' ? 'F' : '');
  const bureau = () => AK.hote.type === 'bureau';
  /** Les copies de sécurité locales n'existent qu'avec IndexedDB (navigateur) ou les fichiers de l'APK. */
  const copiesPossibles = () => {
    const a = AK.stockage.actif;
    return !bureau() && !!a && (a.nom === 'IndexedDB' || /Android/.test(a.nom || ''));
  };
  /** Champs transitoires (préfixe « _ ») retirés comme dans AK.sauvegarde.construire(). */
  const sansTransitoire = (o) => JSON.parse(JSON.stringify(o, function (k, v) {
    return this === o && k.startsWith('_') ? undefined : v;
  }));
  /** Un enseignant ne voit que ses classes ; le directeur voit tout, y compris une classe fermée depuis. */
  const classeVisible = (c) => AK.session.estDirecteur() || AK.session.classes().includes(c);

  function libelleMotif(m) {
    if (m === 'jour') return 'Copie quotidienne automatique';
    if (m === 'manuelle') return 'Copie faite à la demande';
    if (m === 'avant-restauration') return 'Avant une restauration';
    if (m === 'avant-import') return 'Avant un import Excel';
    if (m === 'avant-rattachement') return 'Avant un rattachement d’espace enseignant';
    if (m === 'avant-vidage-corbeille') return 'Avant le vidage de la corbeille';
    const p = /^avant-passage-(.+)$/.exec(m || '');
    if (p) return `Avant le passage à l’année ${p[1]}`;
    return m || 'Copie de sécurité';
  }

  /** Dernière sauvegarde exportée : date (S().lastBackup) et heure retrouvée au journal. */
  function derniereSauvegarde() {
    const e = (S().pro.journal || []).find((j) => j.m === 'Sauvegarde complète exportée');
    const date = S().lastBackup || (e ? u.iso(new Date(e.t)) : '');
    if (!date || !u.estISO(date)) return null;
    return { date, t: e && u.iso(new Date(e.t)) === date ? e.t : null, jours: Math.max(0, u.ecartJours(date, auj())) };
  }

  /** Contenu des données actuelles, compté comme le résumé d'une sauvegarde. */
  function contenuActuel() {
    const d = S(), imgs = new Set();
    JSON.stringify(d, (k, v) => {
      if (typeof v === 'string' && v.startsWith('data:image/')) imgs.add(u.empreinte(v));
      return v;
    });
    return {
      eleves: d.students.length, inscrits: d.students.filter((s) => s.statut === 'Inscrit').length, personnel: d.teachers.length,
      notes: Object.keys(d.grades || {}).length, documents: ((d.docs && d.docs.items) || []).length, images: imgs.size
    };
  }

  /* =====================================================================================
     Fonctions métier manquantes (droits vérifiés, validation avant toute écriture)
     ===================================================================================== */
  const donnees = {
    copiesPossibles,

    /** Copie de sécurité locale faite à la demande (point de retour avant une manipulation). */
    async copieManuelle() {
      AK.perm.exiger('donnees.sauvegarder');
      if (!copiesPossibles()) throw E('Ce stockage ne permet pas de copie de sécurité locale : exportez une sauvegarde sur clé USB.');
      const id = await AK.store.copieAvant('manuelle');
      if (!id) throw E('La copie de sécurité n’a pas pu être faite (espace de stockage plein ?). Exportez une sauvegarde sur clé USB.');
      AK.store.modifier('Copie de sécurité locale faite à la demande', () => {}, { categorie: 'donnees', rendu: false });
      return id;
    },

    /** Enregistre une copie de sécurité locale dans un fichier .akwa.json (même format et même empreinte qu'une sauvegarde). */
    async exporterCopie(id) {
      AK.perm.exiger('donnees.sauvegarder');
      if (!copiesPossibles()) throw E('Copies de sécurité indisponibles sur cet appareil.');
      const c = (await AK.sauvegarde.copies()).find((x) => x.id === id);
      if (!c) throw E('Copie de sécurité introuvable : elle a peut-être été remplacée par une copie plus récente.');
      const a = await AK.sauvegarde.analyserCopie(id);
      const d = sansTransitoire(a.etat);
      const texte = JSON.stringify(d);
      const h = AK.crypto.dispo() ? AK.crypto.hex(await AK.crypto.sha256(texte)) : null;
      const env = {
        format: AK.sauvegarde.FORMAT, version: 2, application: AK.NOM + ' ' + AK.VERSION, schema: d.meta.schema,
        creeLe: new Date(c.t).toISOString(), installId: d.meta.installId,
        ecole: { nom: d.school.name, annee: d.school.year }, contenu: a.infos.contenu,
        empreinte: h ? { algo: 'SHA-256', valeur: h } : null,
        copieLocale: { motif: c.motif, exporteeLe: new Date().toISOString() },
        donnees: d
      };
      const dt = new Date(c.t);
      const nom = `akwa-school-${u.norm(d.school.name || 'ecole').slice(0, 24) || 'ecole'}-copie-${u.iso(dt)}-${u.pad(dt.getHours())}h${u.pad(dt.getMinutes())}.akwa.json`;
      const corps = JSON.stringify(env);
      const ou = await AK.hote.fichier(nom, new Blob([corps], { type: 'application/json' }), 'application/json');
      if (ou === '' || ou == null) return null; // annulé (application de bureau)
      AK.store.modifier(`Copie de sécurité du ${u.fmtHorodatage(c.t)} enregistrée en fichier`, () => {}, { categorie: 'donnees', rendu: false });
      return { nom, octets: corps.length };
    },

    /** Contrôle d'intégrité (lecture seule) : rien n'est modifié. */
    controler() {
      AK.perm.exiger('donnees.sauvegarder');
      return AK.schema.verifier(S());
    },

    /** Vide la corbeille (éléments confirmés par l'utilisateur) après une copie de sécurité locale. */
    async viderCorbeille(ids) {
      AK.perm.exiger('parametres.gerer');
      const set = new Set(ids || []);
      const L = S().corbeille.filter((c) => set.has(c.id));
      if (!L.length) throw E('La corbeille est déjà vide.');
      await AK.store.copieAvant('avant-vidage-corbeille');
      AK.store.modifier(`Corbeille vidée : ${u.pluriel(L.length, 'élément supprimé', 'éléments supprimés')} définitivement`, (s) => (s.corbeille = s.corbeille.filter((c) => !set.has(c.id))), { categorie: 'donnees' });
      return L.length;
    },

    /** Export CSV : droits, lignes, refus d'un fichier vide, enregistrement, journal. */
    async exporter(type, o = {}) {
      const d = EXPORTS[type];
      if (!d) throw E('Export inconnu.');
      AK.perm.exiger('donnees.exporter');
      if (d.droit) AK.perm.exiger(d.droit);
      const oo = { ...defautsExport(type), ...o };
      const lignes = d.lignes(oo);
      if (lignes.length < 2) throw E('Aucune donnée à exporter pour ces critères.');
      const nom = d.nom(oo);
      await AK.sauvegarde.csv(nom, lignes, d.libelle);
      AK.store.modifier(null, () => {}, { rendu: false }); // enregistre l'entrée « Export : … » du journal
      return { nom, n: lignes.length - 1 };
    }
  };
  AK.donnees = donnees;

  /* =====================================================================================
     Exports CSV
     ===================================================================================== */
  function lignesElevesListe(o) {
    const x = X();
    if (o.classe && !classeVisible(o.classe)) throw new AK.ErreurDroits('Cette classe ne vous est pas affectée.');
    const L = S().students.filter((s) => classeVisible(s.classe) && (!o.classe || s.classe === o.classe) && (o.statut === 'tous' || s.statut === 'Inscrit')).sort(x.parClasse);
    const nomP = (p) => `${(p && p.nom) || ''} ${(p && p.prenoms) || ''}`.trim();
    return [['Matricule de l’école', 'Matricule national', 'Nom', 'Prénoms', 'Sexe', 'Né(e) le', 'Lieu de naissance', 'Nationalité', 'Classe', 'Redoublant', 'Statut', 'Motif de départ', 'Entrée dans l’école', 'Extrait de naissance', 'N° de l’acte', 'Date de l’acte', 'Centre d’état civil', 'Père', 'Téléphone du père', 'Mère', 'Téléphone de la mère', 'Parent / tuteur', 'Téléphone du parent'],
      ...L.map((s) => [s.mat, s.matNat, s.nom, s.prenoms, s.sexe, s.naissance ? x.fmtNaissance(s) : '', s.lieu, s.nationalite, s.classe, s.redoublant ? 'Oui' : 'Non', s.statut, s.motifDepart, s.entree ? u.fmtDate(s.entree) : '',
        s.extrait ? 'Oui' : 'Non', (s.acte && s.acte.num) || '', s.acte && s.acte.date ? u.fmtDate(s.acte.date) : '', (s.acte && s.acte.centre) || '',
        nomP(s.pere), (s.pere && s.pere.tel) || '', nomP(s.mere), (s.mere && s.mere.tel) || '', s.parent, s.tel])];
  }

  function lignesNotes(o) {
    const x = X();
    if (o.classe && !classeVisible(o.classe)) throw new AK.ErreurDroits('Cette classe ne vous est pas affectée.');
    const evals = o.periode === 'tout' ? [1, 2, 3, 4] : [[1, 2, 3, 4].includes(Number(o.periode)) ? Number(o.periode) : 1];
    if (o.format === 'tableau') {
      if (!o.classe) throw E('Choisissez une classe : les matières diffèrent d’un niveau à l’autre.', 'classe');
      if (evals.length > 1) throw E('Choisissez une seule évaluation pour le tableau par élève.', 'periode');
      const c = o.classe, n = evals[0], mats = x.matieres(c, n);
      const rangs = new Map(x.classement(c, n).w.map((r) => [r.s.id, r.rank]));
      return [['Classe', 'Matricule', 'Nom et prénoms', 'Sexe', 'Évaluation', ...mats.map(([m, w]) => `${m} (sur ${x.noteMax(c, w)})`), 'Total', `Moyenne (sur ${x.echelle(c)})`, 'Rang'],
        ...x.actifsDe(c).sort(x.parNom).map((s) => {
          const abs = x.estAbsent(s.id, n), r = abs ? null : x.resultat(s, n);
          return [c, x.matOf(s), x.nomComplet(s), sexe(s), x.evalLabel(c, n), ...mats.map(([m]) => (abs ? 'Absent' : u.fmtSaisie(x.note(s.id, n, m)))),
            r ? u.fmtSaisie(r.total) : '', abs ? 'Absent' : r ? u.fmtSaisie(r.moy) : '', rangs.has(s.id) ? x.rangTxt(rangs.get(s.id)) : ''];
        })];
    }
    const L = [['Classe', 'Matricule', 'Nom et prénoms', 'Sexe', 'Évaluation', 'Matière', 'Note', 'Sur', 'Moyenne de l’évaluation']];
    const classes = o.classe ? [o.classe] : AK.session.estDirecteur() ? C.TOUS_NIVEAUX : AK.session.classes();
    classes.forEach((c) => x.actifsDe(c).sort(x.parNom).forEach((s) => evals.forEach((n) => {
      const ev = x.evalLabel(c, n);
      if (x.estAbsent(s.id, n)) {
        L.push([c, x.matOf(s), x.nomComplet(s), sexe(s), ev, '', 'Absent', '', '']);
        return;
      }
      const r = x.resultat(s, n);
      if (!r) return;
      x.matieres(c, n).forEach(([m, w]) => {
        const v = x.note(s.id, n, m);
        if (v != null) L.push([c, x.matOf(s), x.nomComplet(s), sexe(s), ev, m, u.fmtSaisie(v), x.noteMax(c, w), u.fmtSaisie(r.moy)]);
      });
    })));
    return L;
  }

  function lignesAbsences(o) {
    const x = X();
    if (o.classe && !classeVisible(o.classe)) throw new AK.ErreurDroits('Cette classe ne vous est pas affectée.');
    let e = V.date(o.du, 'Début de la période', { requise: true });
    if (e) throw E(e, 'du');
    if ((e = V.date(o.au, 'Fin de la période', { requise: true }))) throw E(e, 'au');
    if ((e = V.periode(o.du, o.au))) throw E(e, 'au');
    const garde = (s) => !!s && classeVisible(s.classe) && (!o.classe || s.classe === o.classe);
    const jours = Object.keys(S().att).filter((d) => d >= o.du && d <= o.au).sort();
    if (o.format === 'recap') {
      const cpt = new Map();
      jours.forEach((d) => Object.entries(S().att[d] || {}).forEach(([sid, v]) => {
        const k = cpt.get(sid) || { A: 0, J: 0 };
        k[v === 'J' ? 'J' : 'A']++;
        cpt.set(sid, k);
      }));
      const L = S().students.filter((s) => garde(s) && (s.statut === 'Inscrit' || cpt.has(s.id))).sort(x.parClasse);
      return [['Classe', 'Matricule', 'Nom et prénoms', 'Sexe', 'Statut', 'Jours d’absence', 'dont justifiés', 'dont non justifiés'],
        ...L.map((s) => {
          const k = cpt.get(s.id) || { A: 0, J: 0 };
          return [s.classe, x.matOf(s), x.nomComplet(s), sexe(s), s.statut, k.A + k.J, k.J, k.A];
        })];
    }
    const L = [['Date', 'Jour', 'Classe', 'Matricule', 'Nom et prénoms', 'Sexe', 'Absence']];
    jours.forEach((d) => {
      const jour = u.parseISO(d).toLocaleDateString('fr-FR', { weekday: 'long' });
      Object.entries(S().att[d] || {}).map(([sid, v]) => [AK.eleves.trouver(sid), v]).filter(([s]) => garde(s)).sort(([a], [b]) => x.parClasse(a, b))
        .forEach(([s, v]) => L.push([u.fmtDate(d), jour, s.classe, x.matOf(s), x.nomComplet(s), sexe(s), v === 'J' ? 'Justifiée' : 'Non justifiée']));
    });
    return L;
  }

  function lignesPersonnel() {
    const x = X();
    return [['Nom et prénoms', 'Matricule', 'Fonction', 'Emploi', 'Grade', 'Classe(s)', 'Fonctionnement de la classe', 'Téléphone', 'Prise de service', 'Identifiant de connexion', 'Fiche'],
      ...S().teachers.slice().sort((a, b) => V.civ.sans(a.nom).localeCompare(V.civ.sans(b.nom), 'fr')).map((t) => [t.nom, t.matricule, t.fonction, t.grade, t.echelon, x.clsTxt(t), x.fonctTxt(t), t.tel, t.dateEntree ? u.fmtDate(t.dateEntree) : '', t.compte ? t.compte.login : '', t.actif === false ? 'Désactivée' : 'Active'])];
  }

  function lignesPaiements() {
    const x = X();
    const L = S().pro.paiements.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.ref).localeCompare(String(b.ref)));
    return [['Reçu', 'Date', 'Élève', 'Matricule', 'Classe', 'Objet', 'Mode de paiement', 'Montant (F CFA)', 'Versé par', 'État'],
      ...L.map((p) => {
        const s = AK.eleves.trouver(p.sid);
        return [p.ref, u.fmtDate(p.date), s ? x.nomComplet(s) : 'Élève supprimé', s ? x.matOf(s) : '', s ? s.classe : '', p.objet, p.mode, Math.round(+p.montant || 0), p.payeur,
          p.annule ? `Annulé le ${u.fmtDate(String(p.annule.le || '').slice(0, 10))} : ${p.annule.motif || ''}` : 'Valide'];
      })];
  }

  function lignesDepenses() {
    const L = S().pro.depenses.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    return [['Date', 'Libellé', 'Catégorie', 'Montant (F CFA)', 'Fournisseur', 'Justificatif'],
      ...L.map((d) => [u.fmtDate(d.date), d.libelle, d.cat, Math.round(+d.montant || 0), d.fournisseur, d.justif])];
  }

  const STATUTS_DOC = { valide: 'En vigueur', annule: 'Annulé', remplace: 'Remplacé', expire: 'Expiré' };
  function lignesDocuments() {
    const R = AK.registre;
    const L = (S().docs.items || []).slice().sort((a, b) => String(a.emisLe).localeCompare(String(b.emisLe)));
    return [['Référence', 'Document', 'Concerne', 'Émis le', 'Émis par', 'Année scolaire', 'État', 'Signé électroniquement', 'Impressions', 'Duplicata de'],
      ...L.map((d) => {
        const st = R.statutEffectif(d);
        return [d.ref, R.libelleType(d.type), d.sujet ? d.sujet.libelle : '', d.emisLe ? u.fmtHorodatage(d.emisLe) : '', d.emisPar || '', d.annee || '', (STATUTS_DOC[st] || st) + (d.demo ? ' (spécimen)' : ''), d.signe ? 'Oui' : 'Non', (d.impressions || []).length, d.duplicataDe || ''];
      })];
  }

  function lignesModeleImport() {
    const sc = S().school;
    return [C.COLS_ELEVES, [sc.codedren || '', sc.codeiep || '', String(sc.iepp || '').replace(/^IEPP\s+/i, ''), sc.codeecole || '', sc.name || '', '', 'EXEMPLE', 'LIGNE A REMPLACER', 'FEMININ', '14', '5', '2018', 'IVOIRIENNE', 'OUANINOU', 'SP000725', 'OUANINOU', 'KOUADIO KOFFI', 'YAO AYA', '245', 'OUANINOU', 'OUANINOU', 'CE1']];
  }

  /* Catalogue des exports : titre, description, droit propre (en plus de donnees.exporter), lignes, nom du fichier. */
  const EXPORTS = {
    'eleves-national': {
      titre: 'Élèves · format national', icone: 'users', libelle: 'élèves (format national)',
      desc: 'Élèves inscrits avec les colonnes du fichier national ELEVES (codes DREN, IEP et école, matricule, naissance, filiation, niveau) : à transmettre ou à réimporter.',
      lignes: () => AK.sauvegarde.lignesEleves(), nom: () => `eleves-format-national-${auj()}.csv`
    },
    'eleves-liste': {
      titre: 'Élèves · liste détaillée', icone: 'list', libelle: 'liste détaillée des élèves', options: ['classe', 'statut'],
      desc: 'Identité, naissance, extrait, statut et contacts des parents. Les données de santé ne sont pas exportées.',
      lignes: lignesElevesListe, nom: (o) => `eleves-${o.classe ? u.norm(o.classe) + '-' : ''}${auj()}.csv`
    },
    notes: {
      titre: 'Notes par évaluation', icone: 'award', libelle: 'notes', options: ['periode', 'classe', 'format-notes'],
      desc: 'Une ligne par note (toutes classes) ou un tableau par élève avec total, moyenne et rang (une classe, une évaluation).',
      lignes: lignesNotes, nom: (o) => `notes-${o.periode === 'tout' ? 'annee' : 'evaluation-' + (o.periode || 1)}${o.classe ? '-' + u.norm(o.classe) : ''}-${auj()}.csv`
    },
    absences: {
      titre: 'Absences des élèves', icone: 'cal', libelle: 'absences des élèves', options: ['du', 'au', 'classe', 'format-abs'],
      desc: 'Absences relevées à l’appel sur une période : le détail jour par jour ou le total par élève.',
      lignes: lignesAbsences, nom: (o) => `absences-${o.du || ''}-au-${o.au || ''}.csv`
    },
    personnel: {
      titre: 'Personnel', icone: 'brief', libelle: 'personnel', droit: 'personnel.voir',
      desc: 'Enseignants et agents : matricule, fonction, emploi et grade, classes tenues, téléphone, identifiant de connexion.',
      lignes: lignesPersonnel, nom: () => `personnel-${auj()}.csv`
    },
    paiements: {
      titre: 'Versements (frais scolaires)', icone: 'coin', libelle: 'versements', droit: 'finances.gerer',
      desc: 'Tous les reçus émis, y compris les reçus annulés (avec le motif) : pour la comptabilité du COGES.',
      lignes: lignesPaiements, nom: () => `versements-${auj()}.csv`
    },
    depenses: {
      titre: 'Dépenses', icone: 'coin', libelle: 'dépenses', droit: 'finances.gerer',
      desc: 'Dépenses de l’école avec catégorie, fournisseur et justificatif.',
      lignes: lignesDepenses, nom: () => `depenses-${auj()}.csv`
    },
    documents: {
      titre: 'Documents émis', icone: 'archive', libelle: 'registre des documents', droit: 'document.registre',
      desc: 'Registre des documents officiels : référence, type, titulaire, date, état (en vigueur, annulé, remplacé), signature.',
      lignes: lignesDocuments, nom: () => `documents-emis-${auj()}.csv`
    },
    'modele-import': {
      titre: 'Modèle d’import des élèves', icone: 'filePlus', libelle: 'modèle d’import des élèves',
      desc: 'Fichier vierge aux colonnes du fichier national, avec les codes de l’école. La 2e ligne est un exemple : remplacez-la par vos élèves.',
      lignes: lignesModeleImport, nom: () => 'modele-import-eleves.csv'
    }
  };
  const optsExport = {};
  function defautsExport(type) {
    const rentree = `${X().anneeRentree()}-09-01`;
    const d = {
      'eleves-liste': { classe: '', statut: 'inscrits' },
      notes: { periode: String(S().school.evalCourante || 1), classe: '', format: 'detail' },
      absences: { du: rentree < auj() ? rentree : auj(), au: auj(), classe: '', format: 'detail' }
    }[type] || {};
    return { ...d, ...(optsExport[type] || {}) };
  }

  /* =====================================================================================
     État de l'écran Sauvegarde (informations lues de façon asynchrone)
     ===================================================================================== */
  const ecran = { t: 0, chargement: false, relire: false, copies: null, persiste: null, estimation: null, volume: null };
  async function chargerInfos(force) {
    if (ecran.chargement) {
      if (force) ecran.relire = true; // une lecture est en cours : on relira juste après
      return;
    }
    if (!force && ecran.t && Date.now() - ecran.t < 20000) return;
    ecran.chargement = true;
    try {
      const st = navigator.storage || {};
      const [copies, persiste, estimation] = await Promise.all([
        copiesPossibles() ? AK.sauvegarde.copies().catch(() => null) : Promise.resolve([]),
        typeof st.persisted === 'function' ? st.persisted().catch(() => null) : Promise.resolve(null),
        typeof st.estimate === 'function' ? st.estimate().catch(() => null) : Promise.resolve(null)
      ]);
      const { texte, images } = AK.stockage.serialiser(S());
      let oi = 0;
      images.forEach((v) => (oi += v.length));
      Object.assign(ecran, { copies, persiste, estimation, volume: { texte: texte.length, images: images.size, octetsImages: oi, total: texte.length + oi }, t: Date.now() });
    } catch (e) {
      AK.diag.erreur(e, 'informations de stockage');
      ecran.t = Date.now();
    } finally {
      ecran.chargement = false;
    }
    if (ecran.relire) {
      ecran.relire = false;
      return chargerInfos(true);
    }
    if (AK.session.ouverte() && AK.shell.routeCourante() === R_SAUV) AK.shell.redessiner();
  }

  /* =====================================================================================
     Écran : Sauvegarde & restauration
     ===================================================================================== */
  const ENTREES = { restaurer: 'donnees-f-restaurer', verifier: 'donnees-f-verifier', rattacher: 'donnees-f-rattacher' };
  const peutRattacher = () => peut('donnees.rattacher') && !S().school.solo;

  function point(etat, titre, detail, action) {
    const [icone, mot] = { ok: ['checkCircle', 'Fait'], avert: ['warn', 'À surveiller'], mauvais: ['xCircle', 'À faire'], neutre: ['info', 'Information'] }[etat];
    return html`<li class="${etat}">${ic(icone)}<span><b>${titre} <span class="sr">(${mot})</span></b><small>${detail}</small>${action ? html`<span class="donnees-action-point">${action}</span>` : ''}</span></li>`;
  }

  function planSauvegarde(ds, st) {
    const copies = ecran.copies || [];
    const jour = copies.find((c) => c.motif === 'jour' && u.iso(new Date(c.t)) === auj());
    const enreg = st.statut === 'erreur' || st.statut === 'ephemere' ? 'mauvais' : 'ok';
    return html`<ul class="donnees-plan">
      ${point(enreg, 'Enregistrement automatique sur cet appareil', st.statut === 'erreur' ? st.message : st.statut === 'ephemere' ? 'Navigation privée ou stockage bloqué : rien n’est conservé à la fermeture.' : bureau() ? 'Base de données de l’application Windows.' : `Chaque modification est enregistrée (${AK.stockage.description()}).`)}
      ${bureau() ? point('neutre', 'Copies de sécurité locales', 'Gérées par l’application Windows.') : !copiesPossibles() ? point('mauvais', 'Copies de sécurité locales', 'Indisponibles avec ce stockage : la sauvegarde sur clé USB est la seule protection.') : point(ecran.copies == null ? 'neutre' : jour ? 'ok' : 'avert', 'Copie de sécurité du jour', ecran.copies == null ? 'Lecture des copies en cours…' : jour ? `Faite à ${heure(jour.t)} sur cet appareil.` : 'Elle est faite au premier enregistrement de la journée.')}
      ${point(!ds || ds.jours > 7 ? 'mauvais' : 'ok', 'Sauvegarde sur clé USB cette semaine', ds ? `Dernière : ${ilYa(ds.jours)} (${u.fmtDate(ds.date)}${ds.t ? ' à ' + heure(ds.t) : ''}).` : 'Aucune sauvegarde exportée pour l’instant.', !ds || ds.jours > 7 ? html`<button type="button" class="btn btn-sm btn-pri" data-action="donnees-exporter">${ic('down')}Sauvegarder maintenant</button>` : '')}
      ${bureau() ? '' : ecran.persiste === true ? point('ok', 'Conservation durable', 'Le navigateur s’est engagé à ne pas effacer ces données pour libérer de la place.') : ecran.persiste === false ? point('avert', 'Conservation durable', 'Non accordée : en cas de manque de place, le navigateur pourrait effacer les données. Les sauvegardes sur clé USB restent indispensables.', html`<button type="button" class="btn btn-sm" data-action="donnees-conserver">${ic('shield')}Demander au navigateur</button>`) : point('neutre', 'Conservation durable', ecran.t ? 'Information non disponible dans ce navigateur.' : 'Lecture en cours…')}
    </ul>`;
  }

  function carteCopies() {
    if (bureau()) return ui.carte('Copies de sécurité locales', html`<p class="mb0 mut">Avec l’application Windows, les copies de sécurité sont faites par l’application elle-même.</p>`);
    if (!copiesPossibles()) return ui.carte('Copies de sécurité locales', ui.encadre(html`<b>Indisponibles avec ce stockage</b> (${AK.stockage.description()}). Sauvegardez sur clé USB après chaque séance de travail.`, 'avert'));
    const L = ecran.copies;
    const actions = html`<div class="ligne"><button type="button" class="btn btn-sm" data-action="donnees-copies-actualiser" aria-label="Actualiser la liste des copies">${ic('refresh')}Actualiser</button><button type="button" class="btn btn-sm" data-action="donnees-copie-creer">${ic('save')}Faire une copie maintenant</button></div>`;
    const corps = L == null
      ? html`<p class="mut mb0" role="status">${ecran.chargement || !ecran.t ? 'Lecture des copies de sécurité…' : 'La liste des copies n’a pas pu être lue.'}</p>`
      : ui.tableau({
        id: 'donnees-copies', lignes: L, unite: 'copie', parPage: 30, triDefaut: { cle: 't', sens: 'desc' },
        colonnes: [
          { cle: 't', lib: 'Date', tri: (c) => c.t, rendu: (c) => html`<b>${u.fmtHorodatage(c.t)}</b>` },
          { cle: 'motif', lib: 'Motif', tri: (c) => libelleMotif(c.motif), rendu: (c) => html`<span class="donnees-texte">${libelleMotif(c.motif)}</span>`, cls: 'texte' },
          { cle: 'eleves', lib: 'Élèves', tri: (c) => c.eleves, cls: 'r num', rendu: (c) => String(c.eleves ?? '—') },
          { cle: 'octets', lib: 'Taille', tri: (c) => c.octets, cls: 'r num', rendu: (c) => octets(c.octets) },
          { cle: 'act', lib: '', cls: 'droite', rendu: (c) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap">${peut('donnees.restaurer') ? html`<button type="button" class="btn btn-sm" data-action="donnees-copie-restaurer" data-id="${c.id}" aria-label="Restaurer la copie du ${u.fmtHorodatage(c.t)}">${ic('rotate')}Restaurer…</button>` : ''}<button type="button" class="btn-ic" data-action="donnees-copie-fichier" data-id="${c.id}" aria-label="Enregistrer la copie du ${u.fmtHorodatage(c.t)} dans un fichier" data-bulle="Enregistrer dans un fichier">${ic('down')}</button></div>` }
        ],
        vide: ui.vide('Aucune copie de sécurité', 'La première copie est faite au premier enregistrement de la journée.')
      });
    return ui.carte('Copies de sécurité locales', html`<div class="pile-sm donnees-pile"><p class="mut petit mb0">Faites automatiquement sur cet appareil : une par jour (14 jours gardés) et avant chaque opération à risque (10 gardées). Elles protègent d’une erreur de manipulation, <b>pas</b> d’une panne ou d’un vol de l’appareil.</p>${corps}</div>`, { actions, cls: 'donnees-carte-copies' });
  }

  function carteIntegrite() {
    const pb = donnees.controler(), err = pb.filter((p) => p.gravite === 'erreur'), av = pb.filter((p) => p.gravite !== 'erreur');
    const st = S();
    // la fiche ne s'ouvre que pour un élève d'une classe ouverte (voir eleves.js) : sinon, renvoi vers les classes ouvertes
    const fiche = (p) => {
      const s = (p.ids || []).map((k) => AK.eleves.trouver(k)).find(Boolean);
      if (s && AK.session.classes().includes(s.classe)) return html`<button type="button" class="btn btn-sm btn-ghost" data-action="fiche-eleve" data-id="${s.id}">${ic('user')}Ouvrir la fiche</button>`;
      if (s && p.code === 'classe-invalide' && AK.ecrans.existe('parametres/ecole') && peut('parametres.gerer')) return html`<a class="btn btn-sm btn-ghost" href="#parametres/ecole">${ic('settings')}Classes ouvertes</a>`;
      return '';
    };
    const ligne = (p) => html`<li>${p.gravite === 'erreur' ? ui.tag('Erreur', 'mauvais', 'alert') : ui.tag('À vérifier', 'avert', 'warn')}<span class="donnees-texte flex1">${p.message}</span>${fiche(p)}</li>`;
    const corps = pb.length
      ? html`<div class="pile-sm"><div class="ligne">${err.length ? ui.tag(u.pluriel(err.length, 'erreur'), 'mauvais', 'alert') : ui.tag('Aucune erreur', 'ok', 'check')}${av.length ? ui.tag(u.pluriel(av.length, 'point à vérifier', 'points à vérifier'), 'avert', 'warn') : ''}</div>
        <details class="donnees-details"${err.length ? html` open` : ''}><summary>Afficher le détail (${pb.length})</summary><ul class="donnees-problemes">${pb.slice(0, 80).map(ligne)}</ul>${pb.length > 80 ? html`<p class="mut petit mb0">… et ${pb.length - 80} autre(s) : exportez la liste complète.</p>` : ''}</details>
        <div><button type="button" class="btn btn-sm" data-action="donnees-integrite-csv">${ic('down')}Exporter la liste (CSV)</button></div></div>`
      : ui.encadre(html`<b>Aucune incohérence détectée.</b> ${u.pluriel(st.students.length, 'élève')}, ${u.pluriel(st.teachers.length, 'membre')} du personnel, ${u.pluriel(Object.keys(st.grades).length, 'note')} et ${u.pluriel((st.docs.items || []).length, 'document')} contrôlés.`, 'ok', 'shieldCheck');
    return ui.carte('Contrôle d’intégrité des données', html`<div class="pile-sm donnees-pile"><p class="mut petit mb0">Recherche à chaque affichage des identifiants ou matricules en double, des classes non ouvertes, des notes sans élève, des demandes orphelines et des références documentaires en double. Rien n’est modifié.</p>${corps}</div>`);
  }

  function carteStockage(st) {
    const e = ecran.estimation, v = ecran.volume;
    return ui.carte('Stockage sur cet appareil', html`<dl class="kv">
      <dt>Application</dt><dd>${AK.hote.libelle} · ${AK.NOM} ${AK.VERSION}</dd>
      <dt>Stockage</dt><dd>${bureau() ? 'Base de données de l’application Windows' : AK.stockage.description()}</dd>
      <dt>Données de l’école</dt><dd>${v ? html`${octets(v.texte)} de texte · ${u.pluriel(v.images, 'image')}${v.images ? ` (${octets(v.octetsImages)})` : ''}` : 'Calcul en cours…'}</dd>
      ${e && e.quota ? html`<dt>Espace du navigateur</dt><dd>${octets(e.usage)} utilisés sur ${octets(e.quota)} disponibles</dd>` : ''}
      <dt>Dernière modification</dt><dd>${st.meta && st.meta.majLe ? u.fmtHorodatage(st.meta.majLe) : '—'}</dd>
      ${st.meta && st.meta.restaureLe ? html`<dt>Dernière restauration</dt><dd>${u.fmtHorodatage(st.meta.restaureLe)}</dd>` : ''}
      ${st.meta && st.meta.migreDe ? html`<dt>Origine</dt><dd>Données reprises d’AKWA SCHOOL ${st.meta.migreDe}</dd>` : ''}
    </dl>`);
  }

  function rendreSauvegarde() {
    const st = S(), ds = derniereSauvegarde(), enr = AK.store.sauvegarde, solo = !!st.school.solo;
    const L = ecran.copies, derniere = L && L.length ? L.reduce((a, c) => (c.t > a.t ? c : a)) : null;
    const tonDs = !ds || ds.jours > 7 ? 'mauvais' : ds.jours > 3 ? 'avert' : '';
    const enrKo = enr.statut === 'erreur' || enr.statut === 'ephemere';
    const restaurer = peut('donnees.restaurer');
    return html`${ui.pageTete('Sauvegarde et restauration', 'Les données sont enregistrées sur cet appareil. Une sauvegarde sur clé USB, chaque semaine, les protège d’une panne, d’un vol ou d’un effacement du navigateur.', html`${restaurer ? html`<button type="button" class="btn" data-action="donnees-choisir" data-usage="restaurer">${ic('up')}Restaurer…</button>` : ''}<button type="button" class="btn btn-pri" data-action="donnees-exporter">${ic('down')}Exporter une sauvegarde</button>`)}
      ${!ds || ds.jours > 7 ? html`<div class="mb">${ui.encadre(html`<b>${ds ? `Dernière sauvegarde sur clé USB ${ilYa(ds.jours)}` : 'Aucune sauvegarde sur clé USB pour l’instant'}.</b> Une panne, un vol ou l’effacement des données du navigateur ferait perdre tout le travail de l’école. Exportez une sauvegarde et copiez-la sur une clé USB.`, 'erreur')}</div>` : ''}
      <div class="grille donnees-kpis mb">
        ${ui.kpi({ icone: 'save', lib: 'Sauvegarde sur clé USB', val: ds ? majuscule(ilYa(ds.jours)) : 'Jamais', sous: ds ? `le ${u.fmtDate(ds.date)}${ds.t ? ' à ' + heure(ds.t) : ''}` : 'Aucun fichier exporté', ton: tonDs })}
        ${ui.kpi({ icone: 'database', lib: 'Enregistrement automatique', val: enr.statut === 'erreur' ? 'En échec' : enr.statut === 'ephemere' ? 'Impossible' : 'Actif', sous: bureau() ? 'Application Windows' : AK.stockage.description(), ton: enrKo ? 'mauvais' : '' })}
        ${ui.kpi({ icone: 'history', lib: 'Copies de sécurité locales', val: bureau() || !copiesPossibles() ? '—' : L == null ? '…' : String(L.length), sous: bureau() ? 'Gérées par l’application Windows' : !copiesPossibles() ? 'Indisponibles avec ce stockage' : derniere ? `Dernière : ${u.fmtHorodatage(derniere.t)}` : L == null ? 'Lecture en cours' : 'Aucune copie pour l’instant', ton: !bureau() && !copiesPossibles() ? 'avert' : '' })}
        ${ui.kpi({ icone: 'layers', lib: 'Volume des données', val: ecran.volume ? octets(ecran.volume.total) : '…', sous: `${u.pluriel(st.students.length, 'élève')} · ${u.pluriel(Object.keys(st.grades).length, 'note')}` })}
      </div>
      <div class="grille g-2-1 mb">
        <div class="pile donnees-col">
          ${ui.carte('Sauvegarder sur clé USB', html`<div class="pile-sm">
            <ol class="donnees-etapes">
              <li>Cliquez sur <b>Exporter une sauvegarde</b> : un fichier <span class="mono petit donnees-texte">${AK.sauvegarde.nomFichier()}</span> est enregistré ${AK.hote.type === 'navigateur' ? 'dans le dossier Téléchargements' : 'à l’endroit choisi'}.</li>
              <li>Copiez-le sur une clé USB, puis sur une seconde clé gardée hors de l’école.</li>
              <li>Contrôlez la copie avec <b>Vérifier un fichier</b> : l’empreinte d’intégrité est recalculée.</li>
            </ol>
            <div class="donnees-actions"><button type="button" class="btn btn-pri" data-action="donnees-exporter">${ic('down')}Exporter une sauvegarde</button><button type="button" class="btn" data-action="donnees-choisir" data-usage="verifier">${ic('shieldCheck')}Vérifier un fichier</button></div>
            <p class="mut petit mb0">Le fichier contient les données personnelles des élèves et les empreintes des mots de passe (jamais un mot de passe en clair) : rangez la clé en lieu sûr.</p></div>`, { sous: 'Fichier .akwa.json avec empreinte d’intégrité SHA-256' })}
          ${restaurer ? ui.carte('Restaurer une sauvegarde', html`<div class="pile-sm">
            <p class="mb0">Après une panne, un changement d’ordinateur ou une erreur grave. Rien n’est remplacé avant votre confirmation :</p>
            <ol class="donnees-etapes"><li>choix du fichier et contrôle de son empreinte (un fichier altéré est refusé) ;</li><li>aperçu détaillé : école, date, contenu comparé aux données actuelles ;</li><li>confirmation écrite et mot de passe du directeur ;</li><li>copie de sécurité de l’état actuel, puis restauration.</li></ol>
            <div class="donnees-actions"><button type="button" class="btn" data-action="donnees-choisir" data-usage="restaurer">${ic('up')}Choisir un fichier de sauvegarde…</button></div>
            <p class="mut petit mb0">Accepte les sauvegardes AKWA SCHOOL 2 (.akwa.json) et les sauvegardes .json d’AKWA SCHOOL 1.x.</p></div>`) : ''}
        </div>
        <div class="pile donnees-col">
          ${ui.carte('Plan de sauvegarde', planSauvegarde(ds, enr), { sous: 'État de la protection des données' })}
          ${ui.carte('Bonnes pratiques', html`<ul class="donnees-conseils">
            <li><b>Trois copies</b> : cet appareil, une clé USB à l’école, une seconde clé chez le directeur.</li>
            <li><b>Chaque semaine</b>, par exemple le vendredi soir, et avant toute opération importante (passage d’année, import, restauration).</li>
            <li><b>Gardez plusieurs sauvegardes</b> datées : n’écrasez pas toujours le même fichier.</li>
            <li><b>Ne modifiez jamais</b> un fichier de sauvegarde : son empreinte le rendrait inutilisable.</li>
            <li><b>Vérifiez</b> de temps en temps qu’une sauvegarde se relit (bouton « Vérifier un fichier »).</li></ul>`)}
        </div>
      </div>
      <div class="mb">${carteCopies()}</div>
      <div class="grille g2 mb">${carteIntegrite()}${carteStockage(st)}</div>
      ${ui.carte('Échanges avec d’autres installations', html`<div class="grille g2">
        ${peutRattacher() ? html`<div class="pile-sm"><h3 class="petit">${ic('link')} Rattacher un espace enseignant</h3><p class="mut petit mb0">Un enseignant qui a tenu sa classe dans un « espace enseignant » vous remet sa sauvegarde : ses élèves, notes et absences sont ajoutés à l’école sans doublon (aperçu avant confirmation, copie de sécurité préalable).</p><div><button type="button" class="btn btn-sm" data-action="donnees-choisir" data-usage="rattacher">${ic('users')}Choisir la sauvegarde de l’enseignant…</button></div></div>` : solo ? html`<div class="pile-sm"><h3 class="petit">${ic('link')} Remettre votre classe au directeur</h3><p class="mut petit mb0">Exportez une sauvegarde et remettez-la au directeur : il la rattachera à l’école (Données › Sauvegarde › Rattacher un espace enseignant).</p></div>` : ''}
        ${peut('donnees.exporter') ? html`<div class="pile-sm"><h3 class="petit">${ic('history')} Export compatible AKWA SCHOOL 1.x</h3><p class="mut petit mb0">Pour les applications existantes (version 1.x, Android 1.x) : élèves, notes, absences, personnel et vie de l’école, <b>sans</b> mots de passe, registre des documents, modèles, clés de signature ni corbeille.</p><div><button type="button" class="btn btn-sm" data-action="donnees-export1x">${ic('down')}Exporter au format 1.x</button></div></div>` : ''}
      </div>`)}
      ${restaurer ? html`<input type="file" id="${ENTREES.restaurer}" accept=".json,application/json" hidden tabindex="-1" data-change="donnees-fichier" data-usage="restaurer">` : ''}
      <input type="file" id="${ENTREES.verifier}" accept=".json,application/json" hidden tabindex="-1" data-change="donnees-fichier" data-usage="verifier">
      ${peutRattacher() ? html`<input type="file" id="${ENTREES.rattacher}" accept=".json,application/json" hidden tabindex="-1" data-change="donnees-fichier" data-usage="rattacher">` : ''}`;
  }

  /* ---------- Aperçu d'une sauvegarde (fichier ou copie locale) ---------- */
  function apercu(a, o, restaurer) {
    const inf = a.infos || {}, c = inf.contenu || {}, ec = inf.ecole || {}, act = contenuActuel();
    const verdict = {
      ok: ui.encadre(html`<b>Intégrité vérifiée.</b> L’empreinte SHA-256 correspond au contenu : le fichier n’a pas été modifié depuis la sauvegarde.`, 'ok', 'shieldCheck'),
      absente: ui.encadre(html`<b>Pas d’empreinte d’intégrité.</b> ${a.type === 'akwa1' ? 'Les sauvegardes d’AKWA SCHOOL 1.x n’en comportent pas' : 'Ce fichier n’en comporte pas ou ce navigateur ne peut pas la vérifier'} : le contenu n’est pas garanti. Contrôlez l’aperçu avant de continuer.`, 'avert', 'shield'),
      alteree: ui.encadre(html`<b>Fichier ALTÉRÉ : restauration refusée.</b> L’empreinte SHA-256 ne correspond pas au contenu : le fichier a été modifié ou est incomplet (copie interrompue, clé USB défectueuse). Utilisez une autre sauvegarde.`, 'erreur', 'shieldX'),
      locale: ui.encadre(html`<b>Copie de sécurité locale</b> faite par AKWA SCHOOL sur cet appareil.`, 'info', 'history')
    }[a.integrite] || '';
    const format = a.type === 'akwa2' ? `AKWA SCHOOL 2 · ${inf.application || 'version non indiquée'}` : a.type === 'akwa1' ? 'AKWA SCHOOL 1.x (converti au format 2 à la restauration)' : `Copie locale · ${AK.NOM} ${AK.VERSION}`;
    const date = inf.creeLe ? Date.parse(inf.creeLe) : o.copie ? o.copie.t : null;
    const majLe = S().meta && S().meta.majLe;
    const lignes = [['Élèves', 'eleves'], ['dont inscrits', 'inscrits'], ['Personnel', 'personnel'], ['Notes', 'notes'], ['Documents émis', 'documents'], ['Images (photos, extraits, logos)', 'images']];
    const ecart = (v, w) => (v == null ? '—' : v === w ? '=' : (v > w ? '+' : '−') + Math.abs(v - w));
    const autreEcole = ec.nom && S().school.name && u.norm(ec.nom) !== u.norm(S().school.name);
    return html`<div class="pile donnees-pile">
      ${verdict}
      <dl class="kv">
        ${o.fichier ? html`<dt>Fichier</dt><dd><span class="donnees-texte">${o.fichier.nom}</span> · ${octets(o.fichier.taille)}</dd>` : ''}
        ${o.copie ? html`<dt>Copie</dt><dd>${libelleMotif(o.copie.motif)} · ${octets(o.copie.octets)}</dd>` : ''}
        <dt>École</dt><dd>${ec.nom || '—'}</dd>
        <dt>Année scolaire</dt><dd>${ec.annee || '—'}</dd>
        <dt>${o.copie ? 'Faite le' : 'Sauvegardée le'}</dt><dd>${date ? u.fmtHorodatage(date) : 'Date non indiquée (format 1.x)'}</dd>
        <dt>Format</dt><dd>${format}</dd>
      </dl>
      <div class="tab-cadre"><table class="tab donnees-comparaison"><caption class="sr">Contenu de la sauvegarde comparé aux données actuelles</caption>
        <thead><tr><th scope="col">Contenu</th><th scope="col" class="r">${a.valide ? 'Sauvegarde' : 'Annoncé'}</th><th scope="col" class="r">Actuel</th><th scope="col" class="r">Écart</th></tr></thead>
        <tbody>${lignes.map(([l, k]) => html`<tr><td class="donnees-texte">${l}</td><td class="r num">${c[k] ?? '—'}</td><td class="r num">${act[k]}</td><td class="r num">${ecart(c[k], act[k])}</td></tr>`)}</tbody></table></div>
      ${!a.valide ? ui.encadre('Les chiffres « annoncés » sont ceux inscrits dans le fichier : ils ne peuvent pas être vérifiés.', 'info') : ''}
      ${autreEcole ? ui.encadre(html`<b>Autre école :</b> cette sauvegarde concerne « ${ec.nom} », alors que les données actuelles sont celles de « ${S().school.name} ».`, 'avert') : ''}
      ${a.valide && date && majLe && date < majLe ? ui.encadre(html`Cette sauvegarde date du <b>${u.fmtHorodatage(date)}</b> ; les données actuelles ont été modifiées depuis (dernière modification le ${u.fmtHorodatage(majLe)}). Ces modifications seraient remplacées.`, 'info', 'clock') : ''}
      ${(a.notes || []).length && a.valide ? ui.encadre(html`<b>Conversion :</b><ul class="donnees-liste">${a.notes.map((n) => html`<li>${n}</li>`)}</ul>`, 'info') : ''}
      ${(a.problemes || []).length ? ui.encadre(html`<b>${u.pluriel(a.problemes.length, 'incohérence')} dans cette sauvegarde</b> (la restauration reste possible ; elles seront signalées par le contrôle d’intégrité) :<ul class="donnees-liste">${a.problemes.slice(0, 5).map((p) => html`<li>${p.message}</li>`)}</ul>${a.problemes.length > 5 ? html`<span class="petit">… et ${a.problemes.length - 5} autre(s).</span>` : ''}`, 'avert') : ''}
      ${restaurer ? html`<section class="pile-sm donnees-confirmation" aria-labelledby="donnees-titre-conf"><h3 class="petit" id="donnees-titre-conf">Confirmer la restauration</h3>
        ${ui.encadre(html`<b>Toutes les données actuelles de cet appareil seront remplacées</b> par celles de ${o.copie ? 'cette copie' : 'ce fichier'}. ${copiesPossibles() ? 'Une copie de sécurité de l’état actuel est faite juste avant : vous pourrez y revenir depuis « Copies de sécurité locales ».' : html`<b>Cet appareil ne permet pas de copie de sécurité automatique</b> : exportez d’abord l’état actuel.`} ${AK.hote.authentificationLocale ? 'Vous devrez ensuite vous reconnecter avec le mot de passe enregistré dans la sauvegarde.' : 'La session est ensuite rouverte.'}`, 'avert')}
        ${copiesPossibles() ? '' : html`<div><button type="button" class="btn btn-sm" data-action="donnees-exporter">${ic('down')}Exporter d’abord l’état actuel</button></div>`}
        <div class="champ"><label for="donnees-saisie">Pour confirmer, tapez <b>RESTAURER</b></label><input id="donnees-saisie" class="inp" name="saisie" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20"></div>
      </section>` : ''}
    </div>`;
  }

  function fenetreApercu(a, o) {
    const restaurer = o.mode === 'restaurer' && a.valide && peut('donnees.restaurer');
    ui.fenetre({
      titre: o.copie ? `Copie de sécurité du ${u.fmtHorodatage(o.copie.t)}` : o.mode === 'verifier' ? 'Vérification d’une sauvegarde' : 'Restaurer une sauvegarde',
      icone: a.valide ? 'shieldCheck' : 'shieldX', taille: 'lg', danger: restaurer || !a.valide, proteger: false,
      corps: apercu(a, o, restaurer),
      ok: restaurer ? 'Restaurer ces données' : 'Fermer', okStyle: restaurer ? 'dng' : 'pri', annuler: restaurer ? 'Annuler' : false,
      surValider: restaurer ? (d) => executerRestauration(a, d, o) : undefined
    });
  }

  async function executerRestauration(a, d, o) {
    if (String(d.saisie || '').trim().toUpperCase() !== 'RESTAURER') throw E('Tapez exactement RESTAURER pour confirmer.', 'saisie');
    AK.perm.exiger('donnees.restaurer');
    const quoi = o.copie ? `la copie de sécurité du ${u.fmtHorodatage(o.copie.t)}` : `le fichier « ${o.fichier.nom} »`;
    if (!(await AK.auth.confirmer(`Remplacer toutes les données actuelles par ${quoi}.`, { forcer: true }))) return false;
    // une copie n'a pas de date de création : on la renseigne pour le journal (« fichier 1.x » sinon)
    if (o.copie && a.infos && !a.infos.creeLe) a.infos.creeLe = new Date(o.copie.t).toISOString();
    const debut = Date.now();
    await AK.sauvegarde.restaurer(a, o.copie ? 'Copie de sécurité locale restaurée' : 'Sauvegarde restaurée');
    let copie = null;
    try {
      copie = (await AK.sauvegarde.copies()).find((c) => c.motif === 'avant-restauration' && c.t >= debut - 2000);
    } catch (e) { /* liste indisponible : signalé ci-dessous */ }
    const c = (a.infos && a.infos.contenu) || {};
    const mdp = !AK.hote.authentificationLocale ? '' : a.type === 'akwa1' ? ' Reconnectez-vous avec l’ancien mot de passe administrateur d’AKWA SCHOOL 1.x.' : ' Reconnectez-vous avec le mot de passe de la sauvegarde.';
    const msg = `Données restaurées : ${u.pluriel(c.eleves || 0, 'élève')}, ${u.pluriel(c.notes || 0, 'note')}. ${copie ? 'L’état précédent est gardé dans les copies de sécurité locales.' : 'Aucune copie de l’état précédent n’a pu être faite sur cet appareil.'}${mdp}`;
    setTimeout(() => reconnecter(msg), 30);
  }

  /** Après une restauration : la session repart de zéro avec les comptes et mots de passe restaurés. */
  async function reconnecter(message) {
    AK.session.fermer();
    AK.cles.oublier();
    AK.auth.oublierConfirmation();
    ui.fermerTiroir();
    document.querySelectorAll('dialog[open]').forEach((d) => d.remove());
    ecran.t = 0;
    ecran.copies = null;
    await AK.app.installer(S(), [message]);
  }

  /* ---------- Rattachement d'un espace enseignant ---------- */
  function fenetreRattachement(a, fichier) {
    const e = a.etat, solo = e && e.school && e.school.solo;
    const m = solo && (e.teachers || []).find((t) => t.id === solo.tid);
    if (!m) throw E('Ce fichier n’est pas la sauvegarde d’un espace enseignant. Pour remplacer toutes les données par une sauvegarde de l’école, utilisez « Restaurer ».');
    if (S().school.solo) throw E('Le rattachement se fait dans l’espace du directeur de l’école.');
    const x = X(), cls = x.clsDe(m), ouvertes = cls.filter((c) => x.niveaux().includes(c)), fermees = cls.filter((c) => !ouvertes.includes(c));
    const meme = (t) => u.norm(V.civ.sans(t.nom)) === u.norm(V.civ.sans(m.nom));
    const autres = S().teachers.filter((t) => !meme(t) && x.clsDe(t).some((c) => ouvertes.includes(c)));
    const connu = (s) => S().students.some((z) => (s.matNat && z.matNat === s.matNat) || (u.norm(x.nomComplet(z)) === u.norm(x.nomComplet(s)) && z.classe === s.classe));
    const nConnus = e.students.filter(connu).length;
    const nAbs = Object.values(e.att || {}).reduce((k, j) => k + Object.keys(j || {}).length, 0);
    const possible = ouvertes.length > 0;
    ui.fenetre({
      titre: `Rattacher l’espace de ${m.nom}`, icone: 'link', taille: 'lg', proteger: false,
      ok: possible ? 'Rattacher à l’école' : 'Fermer', annuler: possible ? 'Annuler' : false,
      corps: html`<div class="pile">
        ${a.integrite === 'ok' ? ui.encadre('Intégrité vérifiée : le fichier n’a pas été modifié depuis la sauvegarde.', 'ok', 'shieldCheck') : ui.encadre('Ce fichier ne comporte pas d’empreinte d’intégrité : son contenu n’est pas garanti.', 'avert', 'shield')}
        <dl class="kv">
          <dt>Fichier</dt><dd><span class="donnees-texte">${fichier.nom}</span> · ${octets(fichier.taille)}</dd>
          <dt>Enseignant</dt><dd>${m.nom}</dd>
          <dt>Classe(s)</dt><dd><span class="ligne">${cls.map((c) => (ouvertes.includes(c) ? ui.tag(c, 'pri') : ui.tag(`${c} : non ouverte`, 'mauvais')))}</span></dd>
          <dt>Sauvegardé le</dt><dd>${a.infos && a.infos.creeLe ? u.fmtHorodatage(a.infos.creeLe) : 'Date non indiquée'}</dd>
          <dt>Élèves</dt><dd>${e.students.length}${nConnus ? ` (dont ${nConnus} déjà présent(s) dans l’école : reconnus, sans doublon)` : ''}</dd>
          <dt>Notes</dt><dd>${Object.keys(e.grades || {}).length} (seules celles qui manquent à l’école sont ajoutées)</dd>
          <dt>Absences</dt><dd>${nAbs}</dd>
        </dl>
        ${!possible ? ui.encadre(html`<b>Rattachement impossible :</b> aucune des classes de cet espace (${x.clsTxt(m)}) n’est ouverte dans l’école. Ouvrez-la dans Paramètres › École, puis recommencez.`, 'erreur') : ''}
        ${possible && fermees.length ? ui.encadre(`Classe(s) non ouverte(s) dans l’école, ignorée(s) : ${fermees.join(', ')}.`, 'avert') : ''}
        ${possible && autres.length ? ui.encadre(html`${autres.map((t) => `${t.nom} (${x.clsDe(t).filter((c) => ouvertes.includes(c)).join(', ')})`).join(' ; ')} : ${autres.length > 1 ? 'ces classes leur seront retirées' : 'cette classe lui sera retirée'} au profit de ${m.nom}.`, 'avert') : ''}
        ${possible ? ui.encadre('Une copie de sécurité de l’état actuel est faite avant le rattachement. Le mot de passe du directeur est demandé.', 'info', 'history') : ''}
      </div>`,
      surValider: possible ? async () => {
        if (!(await AK.auth.confirmer(`Rattacher à l’école l’espace enseignant de ${m.nom}.`))) return false;
        const r = await AK.imports.rattacher(e);
        ecran.t = 0;
        ui.toast(`Espace de ${r.nom} rattaché : ${u.pluriel(r.eleves, 'élève ajouté', 'élèves ajoutés')}, ${u.pluriel(r.notes, 'note ajoutée', 'notes ajoutées')}.`);
      } : undefined
    });
  }

  /** Lecture d'un fichier choisi, puis analyse (aucune modification des données). */
  async function lireFichier(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return null;
    if (f.size > TAILLE_MAX) throw E('Fichier trop volumineux (plus de 300 Mo) : ce n’est pas une sauvegarde AKWA SCHOOL.');
    if (!f.size) throw E('Ce fichier est vide.');
    return { nom: f.name, taille: f.size, texte: await f.text() };
  }
  function refus(titre, message) {
    ui.info(titre, html`<div class="pile">${ui.encadre(message, 'erreur')}<p class="mut petit mb0">Les données actuelles n’ont pas été modifiées. Une sauvegarde AKWA SCHOOL est un fichier « .akwa.json » (ou « .json » pour la version 1.x) exporté depuis cet écran.</p></div>`, { icone: 'alert' });
  }

  /* =====================================================================================
     Écran : Exports
     ===================================================================================== */
  function champsExport(type, k, o) {
    const id = (c) => `donnees-x-${type}-${c}`;
    const classes = AK.session.estDirecteur() ? X().niveaux() : AK.session.classes();
    const radios = (nom, val, opts) => html`<fieldset class="champ plein donnees-radios"><legend>Présentation</legend><div class="choix-carte">${opts.map(([v, l]) => html`<label for="${id(nom + '-' + v)}"><input type="radio" id="${id(nom + '-' + v)}" name="${nom}" value="${v}"${v === val ? html` checked` : ''}> ${l}</label>`)}</div></fieldset>`;
    switch (k) {
      case 'classe': return F.choix({ lib: 'Classe', nom: 'classe', id: id('classe'), val: o.classe, options: classes, vide: 'Toutes les classes' });
      case 'statut': return F.choix({ lib: 'Élèves', nom: 'statut', id: id('statut'), val: o.statut, options: [['inscrits', 'Élèves inscrits'], ['tous', 'Tous, y compris les élèves partis']] });
      case 'periode': return F.choix({ lib: 'Évaluation', nom: 'periode', id: id('periode'), val: o.periode, options: [...[1, 2, 3, 4].map((n) => [String(n), C.EV_GEN[n - 1]]), ['tout', 'Toutes les évaluations']] });
      case 'du': return F.date({ lib: 'Du', nom: 'du', id: id('du'), val: o.du, req: true });
      case 'au': return F.date({ lib: 'Au', nom: 'au', id: id('au'), val: o.au, req: true });
      case 'format-notes': return radios('format', o.format, [['detail', 'Une ligne par note'], ['tableau', 'Tableau par élève']]);
      case 'format-abs': return radios('format', o.format, [['detail', 'Détail jour par jour'], ['recap', 'Total par élève']]);
      default: return '';
    }
  }

  function carteExport(type) {
    const d = EXPORTS[type], o = defautsExport(type);
    let n = null, pb = '';
    try {
      n = d.lignes(o).length - 1;
    } catch (e) {
      if (!(e && e.name && /^Erreur/.test(e.name))) throw e;
      pb = e.message;
    }
    return html`<section class="carte donnees-export-carte" aria-labelledby="donnees-t-${type}">
      <div class="donnees-export-tete">${ic(d.icone)}<div><h2 id="donnees-t-${type}">${d.titre}</h2><p class="mut petit mb0">${d.desc}</p></div></div>
      <form class="donnees-export-form" novalidate data-submit="donnees-export" data-change="donnees-export-option" data-type="${type}">
        ${d.options ? html`<div class="form-grille">${d.options.map((k) => champsExport(type, k, o))}</div>` : ''}
        <p class="petit mb0" id="donnees-n-${type}" role="status">${pb ? html`${ic('info', 'i-sm')} ${pb}` : n ? html`${ic('file', 'i-sm')} ${u.pluriel(n, 'ligne')} à exporter` : html`${ic('info', 'i-sm')} ${d.options ? 'Aucune donnée pour ces critères' : 'Aucune donnée pour l’instant'}`}</p>
        ${d.options || n ? html`<div><button type="submit" class="btn${n ? ' btn-pri' : ''}">${ic('down')}Télécharger (Excel CSV)</button></div>` : ''}
      </form></section>`;
  }

  function rendreExports() {
    const L = Object.keys(EXPORTS).filter((k) => !EXPORTS[k].droit || peut(EXPORTS[k].droit));
    return html`${ui.pageTete('Exports vers Excel', 'Fichiers CSV (séparateur point-virgule, accents conservés) qu’Excel, LibreOffice ou Google Sheets ouvrent directement. Chaque export est inscrit au journal.')}
      ${ui.encadre(html`Ces fichiers servent à travailler ailleurs (tableaux, transmissions) : <b>ils ne remplacent pas une sauvegarde</b>, qui seule permet de tout restaurer. ${peut('donnees.sauvegarder') ? html`<a href="#${R_SAUV}">Sauvegarde et restauration</a>.` : ''}`, 'info')}
      <div class="donnees-export mt">${L.map(carteExport)}</div>`;
  }

  /* =====================================================================================
     Écran : Journal des opérations
     ===================================================================================== */
  const CATS = [['eleves', 'Élèves'], ['notes', 'Notes et résultats'], ['absences', 'Appel et absences'], ['personnel', 'Personnel et comptes'], ['documents', 'Documents'], ['finances', 'Finances'], ['vie', 'Vie scolaire'], ['donnees', 'Données et sauvegardes'], ['securite', 'Connexions et sécurité'], ['parametres', 'Paramètres et modèles'], ['autres', 'Autres']];
  const GROUPES = {
    eleve: 'eleves', eleves: 'eleves', notes: 'notes', annee: 'notes', appel: 'absences', absence: 'absences', absences: 'absences', autorisations: 'absences',
    personnel: 'personnel', comptes: 'personnel', messages: 'personnel', documents: 'documents', carte: 'documents', liste: 'documents', rapport: 'documents', verification: 'documents',
    finance: 'finances', finances: 'finances', cantine: 'finances', vie: 'vie', services: 'vie', biblio: 'vie', cepe: 'notes', liaison: 'documents', transmission: 'documents',
    donnees: 'donnees', modeles: 'parametres', parametres: 'parametres', ecole: 'parametres', calendrier: 'parametres', securite: 'securite', cles: 'securite'
  };
  /** Catégorie d'une entrée : celle enregistrée, sinon déduite du libellé (anciennes entrées, opérations système). */
  function categorie(e) {
    if (e.c) return GROUPES[e.c] || 'autres';
    const m = String(e.m || '');
    if (/^(Connexion|Déconnexion|Mot de passe|Code de secours|Session)/i.test(m)) return 'securite';
    if (/(sauvegarde|^Export|copie de sécurité|restaur|corbeille|rattach)/i.test(m)) return 'donnees';
    if (/^(Élève|Import Excel)/.test(m)) return 'eleves';
    if (/^(Personnel|Membre)/.test(m)) return 'personnel';
    return 'autres';
  }
  const libCat = (e) => (CATS.find(([k]) => k === categorie(e)) || CATS[CATS.length - 1])[1];
  const PERIODES = [['jour', 'Aujourd’hui'], ['7', '7 derniers jours'], ['30', '30 derniers jours']];
  const debutPeriode = (p) => (p === 'jour' ? u.parseISO(auj()).getTime() : p === '7' || p === '30' ? Date.now() - Number(p) * 864e5 : 0);

  function journal() {
    const J = S().pro.journal && S().pro.journal.length ? S().pro.journal : (S().log || []).map((e) => ({ ...e, qui: e.qui || '', c: e.c || '' }));
    return J.filter((e) => e && Number.isFinite(e.t));
  }

  function rendreJournal(p) {
    const J = journal();
    const debut = debutPeriode(p.per);
    const L = J.filter((e) => (!p.c || categorie(e) === p.c) && (!p.qui || (e.qui || '') === p.qui) && (!debut || e.t >= debut));
    const auteurs = [...new Set(J.map((e) => e.qui || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const cats = CATS.filter(([k]) => J.some((e) => categorie(e) === k));
    const jour = debutPeriode('jour'), sem = debutPeriode('7'), mois = debutPeriode('30');
    const refus = J.filter((e) => e.t >= mois && /^Mot de passe administrateur refusé/.test(e.m)).length;
    const filtres = html`<select class="inp inp-sm" id="donnees-j-c" data-change="donnees-journal-filtre" data-f="c" aria-label="Catégorie">${ui.options(cats, p.c, 'Toutes les catégories')}</select>
      <select class="inp inp-sm" id="donnees-j-qui" data-change="donnees-journal-filtre" data-f="qui" aria-label="Auteur">${ui.options(auteurs, p.qui, 'Tous les auteurs')}</select>
      <select class="inp inp-sm" id="donnees-j-per" data-change="donnees-journal-filtre" data-f="per" aria-label="Période">${ui.options(PERIODES, p.per, 'Toute la période')}</select>
      ${p.c || p.qui || p.per ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="donnees-journal-tout">${ic('x')}Effacer les filtres</button>` : ''}`;
    return html`${ui.pageTete('Journal des opérations', 'Chaque modification importante est datée, avec son auteur, pour le suivi et les contrôles. Les 2 000 dernières opérations sont conservées ; le journal ne contient aucun mot de passe.')}
      <div class="grille donnees-kpis mb">
        ${ui.kpi({ icone: 'list', lib: 'Opérations conservées', val: J.length.toLocaleString('fr-FR'), sous: J.length ? `depuis le ${u.fmtDate(u.iso(new Date(J.reduce((m, e) => Math.min(m, e.t), Infinity))))}` : 'Journal vide' })}
        ${ui.kpi({ icone: 'clock', lib: 'Aujourd’hui', val: String(J.filter((e) => e.t >= jour).length), sous: 'opérations depuis minuit' })}
        ${ui.kpi({ icone: 'cal', lib: '7 derniers jours', val: String(J.filter((e) => e.t >= sem).length), sous: 'opérations' })}
        ${ui.kpi({ icone: 'lock', lib: 'Mots de passe refusés', val: String(refus), sous: 'sur les 30 derniers jours', ton: refus ? 'avert' : '' })}
      </div>
      ${ui.tableau({
        id: 'donnees-journal', lignes: L, unite: 'opération', exporter: 'journal-des-operations', parPage: 50, triDefaut: { cle: 't', sens: 'desc' }, filtres,
        recherche: (e) => `${e.m} ${e.qui || ''} ${libCat(e)}`, placeholder: 'Rechercher une opération, un nom, une référence…', legende: 'Journal des opérations',
        cleId: (e) => String(e.t) + e.m,
        colonnes: [
          { cle: 't', lib: 'Date et heure', tri: (e) => e.t, rendu: (e) => html`<span class="num">${u.fmtHorodatage(e.t)}</span>`, csv: (e) => new Date(e.t).toLocaleString('fr-FR') },
          { cle: 'm', lib: 'Opération', cls: 'texte', tri: (e) => e.m, rendu: (e) => html`<span class="donnees-texte">${e.m}</span>`, csv: (e) => e.m },
          { cle: 'c', lib: 'Catégorie', tri: (e) => libCat(e), rendu: (e) => ui.tag(libCat(e)), csv: (e) => libCat(e) },
          { cle: 'qui', lib: 'Par', tri: (e) => e.qui || '', rendu: (e) => e.qui || '—', csv: (e) => e.qui || '' }
        ],
        vide: ui.vide('Aucune opération', J.length ? 'Aucune opération ne correspond à ces critères.' : 'Le journal est vide.')
      })}`;
  }

  /* =====================================================================================
     Écran : Corbeille
     ===================================================================================== */
  const TYPES_CORB = { eleve: ['Élève', 'pri', 'user'], agent: ['Personnel', 'acc', 'brief'] };
  const libType = (c) => (TYPES_CORB[c.type] || ['Autre'])[0];
  /** Restauration permise : élève de sa classe (enseignant d'un espace seul) ou directeur. */
  function restaurable(c) {
    if (c.type === 'eleve') return !!(c.donnees && c.donnees.s) && peut('eleve.supprimer', { classe: c.donnees.s.classe });
    if (c.type === 'agent') return !!(c.donnees && c.donnees.t) && peut('personnel.gerer');
    return false;
  }
  const visibleCorbeille = (c) => AK.session.estDirecteur() || restaurable(c);
  const corbeille = () => (S().corbeille || []).filter(visibleCorbeille).slice().sort((a, b) => (b.t || 0) - (a.t || 0));
  function contenuCorbeille(c) {
    const d = c.donnees || {};
    if (c.type === 'eleve') {
      const nN = Object.keys(d.notes || {}).length, nA = Object.keys(d.abs || {}).length;
      return `${u.pluriel(nN, 'note')} · ${u.pluriel(nA, 'jour')} d’absence`;
    }
    if (c.type === 'agent') return d.compte ? 'Avec son compte de connexion' : 'Sans compte de connexion';
    return 'Restauration non prise en charge pour ce type d’élément';
  }
  /** Auteur de la suppression, retrouvé au journal (même instant, à quelques secondes près). */
  function auteurSuppression(c) {
    const e = (S().pro.journal || []).find((j) => Math.abs(j.t - c.t) < 5000 && /corbeille/i.test(j.m) && /supprim|retir/i.test(j.m));
    return e ? e.qui || '' : '';
  }
  const elementCorbeille = (id) => {
    const c = S().corbeille.find((x) => x.id === id);
    if (!c) throw E('Élément introuvable dans la corbeille (déjà restauré ou supprimé ?).');
    return c;
  };

  function rendreCorbeille() {
    const L = corbeille(), purge = peut('parametres.gerer');
    return html`${ui.pageTete('Corbeille', 'Les élèves et les membres du personnel supprimés restent ici, avec leurs notes, absences et comptes, jusqu’à leur suppression définitive. La corbeille est incluse dans les sauvegardes.', purge && L.length ? html`<button type="button" class="btn btn-dng" data-action="donnees-corbeille-vider">${ic('trash')}Vider la corbeille</button>` : '')}
      ${ui.tableau({
        id: 'donnees-corbeille', lignes: L, unite: 'élément', parPage: 50, triDefaut: { cle: 't', sens: 'desc' }, legende: 'Éléments de la corbeille',
        recherche: (c) => `${c.libelle} ${libType(c)}`, placeholder: 'Rechercher un nom, une classe…',
        colonnes: [
          { cle: 'type', lib: 'Type', tri: libType, rendu: (c) => { const [l, t, i] = TYPES_CORB[c.type] || ['Autre', '', 'file']; return ui.tag(l, t, i); } },
          { cle: 'lib', lib: 'Élément supprimé', cls: 'texte', tri: (c) => c.libelle, rendu: (c) => html`<b class="donnees-texte">${c.libelle || '—'}</b><br><span class="mut petit">${contenuCorbeille(c)}</span>`, csv: (c) => c.libelle },
          { cle: 't', lib: 'Supprimé le', tri: (c) => c.t, rendu: (c) => { const q = auteurSuppression(c); return html`${c.t ? u.fmtHorodatage(c.t) : '—'}${q ? html`<br><span class="mut petit">par ${q}</span>` : ''}`; } },
          { cle: 'act', lib: '', cls: 'droite', rendu: (c) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap">${restaurable(c) ? html`<button type="button" class="btn btn-sm" data-action="donnees-corbeille-restaurer" data-id="${c.id}" aria-label="Restaurer ${c.libelle}">${ic('rotate')}Restaurer</button>` : ''}${purge ? html`<button type="button" class="btn-ic" data-action="donnees-corbeille-supprimer" data-id="${c.id}" aria-label="Supprimer définitivement ${c.libelle}" data-bulle="Supprimer définitivement">${ic('trash')}</button>` : ''}</div>` }
        ],
        vide: ui.vide('La corbeille est vide', 'Les élèves et les membres du personnel supprimés apparaîtront ici et pourront être restaurés.')
      })}`;
  }

  /* =====================================================================================
     Déclaration des écrans
     ===================================================================================== */
  const compteOnglet = (r) => (r === R_CORB && peut('donnees.restaurer') ? corbeille().length || null : null);
  AK.ecrans.def(R_SAUV, { rendu: rendreSauvegarde, droit: 'donnees.sauvegarder', apres: () => chargerInfos(), compteOnglet });
  AK.ecrans.def(R_EXP, { rendu: rendreExports, droit: 'donnees.exporter', compteOnglet });
  AK.ecrans.def(R_JOUR, { rendu: rendreJournal, droit: 'journal.voir', compteOnglet });
  AK.ecrans.def(R_CORB, { rendu: rendreCorbeille, droit: 'donnees.restaurer', compteOnglet });

  /* =====================================================================================
     Actions
     ===================================================================================== */
  AK.actions.def({
    async 'donnees-exporter'() {
      const r = await AK.sauvegarde.exporter();
      if (!r) return ui.toast('Enregistrement annulé : aucune sauvegarde n’a été faite.', { type: 'avert' });
      ui.toast(`Sauvegarde enregistrée : ${r.nom} (${octets(r.octets)}). Copiez-la maintenant sur une clé USB.`);
    },
    'donnees-choisir'(el) {
      const i = document.getElementById(ENTREES[el.dataset.usage]);
      if (i) i.click();
    },
    async 'donnees-copie-creer'() {
      await donnees.copieManuelle();
      ui.toast('Copie de sécurité locale faite.');
      await chargerInfos(true);
    },
    'donnees-copies-actualiser': () => chargerInfos(true),
    async 'donnees-copie-restaurer'(el) {
      AK.perm.exiger('donnees.restaurer');
      const c = (ecran.copies || []).find((x) => x.id === el.dataset.id);
      if (!c) throw E('Copie de sécurité introuvable : actualisez la liste.');
      fenetreApercu(await AK.sauvegarde.analyserCopie(c.id), { mode: 'restaurer', copie: c });
    },
    async 'donnees-copie-fichier'(el) {
      const r = await donnees.exporterCopie(el.dataset.id);
      if (!r) return ui.toast('Enregistrement annulé.', { type: 'avert' });
      ui.toast(`Copie enregistrée : ${r.nom}.`);
    },
    async 'donnees-conserver'() {
      const st = navigator.storage;
      if (!st || typeof st.persist !== 'function') throw E('Ce navigateur ne permet pas de demander la conservation durable.');
      const ok = await st.persist().catch(() => false);
      ecran.persiste = ok;
      ui.toast(ok ? 'Conservation durable accordée par le navigateur.' : 'Le navigateur n’a pas accordé la conservation durable : continuez les sauvegardes sur clé USB.', { type: ok ? 'ok' : 'avert' });
      AK.shell.redessiner();
    },
    async 'donnees-export1x'() {
      const nom = await AK.sauvegarde.exporter1x();
      AK.store.modifier(null, () => {}, { rendu: false }); // enregistre l'entrée du journal
      ui.toast(`Fichier au format 1.x enregistré : ${nom}.`);
    },
    async 'donnees-integrite-csv'() {
      const pb = donnees.controler();
      if (!pb.length) throw E('Aucune incohérence à exporter.');
      await AK.sauvegarde.csv(`controle-integrite-${auj()}.csv`, [['Gravité', 'Problème', 'Code'], ...pb.map((p) => [p.gravite === 'erreur' ? 'Erreur' : 'À vérifier', p.message, p.code])], 'contrôle d’intégrité');
      AK.store.modifier(null, () => {}, { rendu: false });
      ui.toast('Liste des incohérences enregistrée.');
    },
    'donnees-journal-tout': () => AK.shell.aller(R_JOUR),
    async 'donnees-corbeille-restaurer'(el) {
      const c = elementCorbeille(el.dataset.id);
      const msg = c.type === 'agent'
        ? html`<p><b>${c.libelle}</b> sera réintégré(e) dans le personnel${c.donnees && c.donnees.compte ? ', avec son compte de connexion' : ''}.</p><p class="mb0">Ses anciennes classes ne lui sont rendues que si personne ne les tient aujourd’hui.</p>`
        : html`<p class="mb0"><b>${c.libelle}</b> sera réinscrit(e) avec ses notes, ses absences et ses dossiers.</p>`;
      if (!(await ui.confirmer({ titre: 'Restaurer depuis la corbeille', message: msg, ok: 'Restaurer', icone: 'rotate' }))) return;
      AK.personnel.restaurer(c.id);
      ui.toast(`${c.libelle} : restauré(e).`, c.type === 'eleve' && c.donnees && c.donnees.s ? { action: { lib: 'Voir la fiche', f: () => ui.ouvrirTiroir('eleve', c.donnees.s.id) } } : {});
    },
    async 'donnees-corbeille-supprimer'(el) {
      AK.perm.exiger('parametres.gerer');
      const c = elementCorbeille(el.dataset.id);
      if (!(await ui.confirmer({
        titre: 'Supprimer définitivement', danger: true, ok: 'Supprimer définitivement', saisie: 'SUPPRIMER',
        message: html`<p><b>${c.libelle}</b>${c.type === 'eleve' ? ', ses notes, ses absences et ses dossiers seront effacés' : ' sera effacé(e)'} de cet appareil.</p><p class="mb0"><b>Cette opération est irréversible</b>, sauf restauration d’une sauvegarde plus ancienne.</p>`
      }))) return;
      if (!(await AK.auth.confirmer(`Supprimer définitivement ${c.libelle}.`))) return;
      AK.personnel.viderCorbeilleElement(c.id);
      ui.toast('Élément supprimé définitivement.');
    },
    async 'donnees-corbeille-vider'() {
      AK.perm.exiger('parametres.gerer');
      const L = corbeille();
      if (!L.length) throw E('La corbeille est déjà vide.');
      if (!(await ui.confirmer({
        titre: 'Vider la corbeille', danger: true, ok: 'Vider la corbeille', saisie: 'VIDER',
        message: html`<p>${u.pluriel(L.length, 'élément sera supprimé', 'éléments seront supprimés')} définitivement, avec leurs notes, absences et comptes.</p><p class="mb0">${copiesPossibles() ? 'Une copie de sécurité locale est faite juste avant.' : html`<b>Aucune copie de sécurité automatique n’est possible sur cet appareil</b> : exportez d’abord une sauvegarde.`} <b>Opération irréversible.</b></p>`
      }))) return;
      if (!(await AK.auth.confirmer(`Vider la corbeille (${u.pluriel(L.length, 'élément')}).`))) return;
      const n = await donnees.viderCorbeille(L.map((c) => c.id));
      ui.toast(`Corbeille vidée : ${u.pluriel(n, 'élément supprimé', 'éléments supprimés')}.`);
    }
  });

  AK.actions.defChange({
    async 'donnees-fichier'(el) {
      const usage = el.dataset.usage;
      let f = null, a = null, attente = null;
      try {
        if (!el.files || !el.files[0]) return;
        attente = ui.toast('Lecture et vérification du fichier…', { type: 'attente', duree: 0 });
        f = await lireFichier(el);
        if (!f) return;
        a = await AK.sauvegarde.analyser(f.texte);
      } catch (err) {
        if (err && (err.name === 'ErreurMetier' || err.name === 'ErreurDroits')) return refus('Fichier refusé', err.message);
        AK.diag.erreur(err, 'analyse d’une sauvegarde');
        return refus('Fichier illisible', 'Ce fichier n’a pas pu être analysé : il est probablement abîmé ou incomplet.');
      } finally {
        if (attente) attente.fermer();
      }
      if (usage === 'rattacher') {
        if (!a.valide) return refus('Fichier refusé', (a.notes || [])[0] || 'Sauvegarde non valide.');
        try {
          fenetreRattachement(a, f);
        } catch (err) {
          if (err && err.name === 'ErreurMetier') return refus('Rattachement impossible', err.message);
          throw err;
        }
        return;
      }
      fenetreApercu(a, { mode: usage === 'verifier' ? 'verifier' : 'restaurer', fichier: f });
    },
    'donnees-export-option'(form) {
      optsExport[form.dataset.type] = ui.lireFormulaire(form);
      AK.shell.redessiner();
    },
    'donnees-journal-filtre'(el) {
      const p = { ...AK.shell.params(), [el.dataset.f]: el.value };
      Object.keys(p).forEach((k) => !p[k] && delete p[k]);
      AK.shell.aller(R_JOUR, p);
    }
  });

  AK.actions.defEnvoi({
    async 'donnees-export'(form) {
      ui.effacerErreurs(form);
      const type = form.dataset.type, o = ui.lireFormulaire(form);
      optsExport[type] = o;
      try {
        const r = await donnees.exporter(type, o);
        ui.toast(`Fichier enregistré : ${r.nom} (${u.pluriel(r.n, 'ligne')}).`);
      } catch (err) {
        if (err && err.name === 'ErreurMetier' && err.champ) ui.erreurChamp(form, err.champ, err.message);
        else throw err;
      }
    }
  });
})(window.AK);
