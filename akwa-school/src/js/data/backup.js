/* =====================================================================================
   Sauvegarde et restauration.

   Stratégie (voir docs/GUIDE.md) :
     1. enregistrement continu dans le navigateur (IndexedDB) ;
     2. copie de sécurité locale automatique chaque jour + avant chaque opération à risque ;
     3. sauvegarde manuelle sur clé USB (fichier .akwa.json) avec empreinte SHA-256 ;
     4. vérification d'un fichier de sauvegarde avant toute restauration ;
     5. restauration avec aperçu, mot de passe, copie préalable de l'état actuel.
   Le fichier contient les empreintes des mots de passe et la clé de signature CHIFFRÉE,
   jamais un mot de passe ni une clé privée en clair.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, X = () => AK.calc;
  const S = () => AK.store.etat;
  const E = (m) => new AK.ErreurMetier(m);
  const FORMAT = 'akwa-school-sauvegarde';

  const sansTransitoire = (o) => JSON.parse(JSON.stringify(o, function (k, v) {
    return this === o && k.startsWith('_') ? undefined : v;
  }));
  function resume(d) {
    const imgs = new Set();
    JSON.stringify(d, (k, v) => {
      if (typeof v === 'string' && v.startsWith('data:image/')) imgs.add(u.empreinte(v));
      return v;
    });
    return {
      eleves: (d.students || []).length,
      inscrits: (d.students || []).filter((s) => s.statut === 'Inscrit').length,
      personnel: (d.teachers || []).length,
      notes: Object.keys(d.grades || {}).length,
      documents: ((d.docs && d.docs.items) || []).length,
      images: imgs.size
    };
  }

  const sauvegarde = {
    FORMAT,
    /** Construit le fichier de sauvegarde complet (texte JSON). */
    async construire() {
      AK.perm.exiger('donnees.sauvegarder');
      const donnees = sansTransitoire(S());
      const texte = JSON.stringify(donnees);
      const h = AK.crypto.dispo() ? AK.crypto.hex(await AK.crypto.sha256(texte)) : null;
      const env = {
        format: FORMAT, version: 2, application: AK.NOM + ' ' + AK.VERSION, schema: donnees.meta.schema,
        creeLe: new Date().toISOString(), installId: donnees.meta.installId,
        ecole: { nom: donnees.school.name, annee: donnees.school.year },
        contenu: resume(donnees),
        empreinte: h ? { algo: 'SHA-256', valeur: h } : null,
        donnees
      };
      return JSON.stringify(env);
    },
    nomFichier() {
      const n = u.norm(S().school.name || 'ecole').slice(0, 24) || 'ecole';
      const d = new Date();
      return `akwa-school-${n}-${u.iso(d)}-${u.pad(d.getHours())}h${u.pad(d.getMinutes())}.akwa.json`;
    },
    /** Sauvegarde manuelle : fichier à enregistrer sur clé USB. */
    async exporter() {
      const texte = await sauvegarde.construire();
      const nom = sauvegarde.nomFichier();
      const ou = await AK.hote.fichier(nom, new Blob([texte], { type: 'application/json' }), 'application/json');
      if (ou === '' || ou == null) return null; // annulé par l'utilisateur (application de bureau)
      AK.store.modifier('Sauvegarde complète exportée', (s) => (s.lastBackup = u.aujourdhui()));
      return { nom, octets: texte.length };
    },
    /**
     * Lit et vérifie un fichier de sauvegarde, SANS rien modifier.
     * Renvoie { type, valide, integrite: 'ok'|'absente'|'alteree', etat, notes, infos }.
     */
    async analyser(texte) {
      let o;
      try {
        o = JSON.parse(texte);
      } catch (e) {
        throw E('Ce fichier n’est pas une sauvegarde AKWA SCHOOL (contenu illisible ou incomplet).');
      }
      let donnees, integrite = 'absente', infos = {}, type;
      if (o && o.format === FORMAT) {
        type = 'akwa2';
        donnees = o.donnees;
        infos = { creeLe: o.creeLe, application: o.application, ecole: o.ecole, contenu: o.contenu };
        if (o.empreinte && o.empreinte.algo === 'SHA-256' && AK.crypto.dispo()) {
          const h = AK.crypto.hex(await AK.crypto.sha256(JSON.stringify(donnees)));
          integrite = h === o.empreinte.valeur ? 'ok' : 'alteree';
        }
      } else if (o && o.v === 5 && Array.isArray(o.students)) {
        type = 'akwa1';
        donnees = o;
        infos = { application: 'AKWA SCHOOL 1.x', ecole: { nom: o.school && o.school.name, annee: o.school && o.school.year } };
      } else if (o && o.format && /transmission/.test(o.format)) {
        throw E('Ce fichier est une transmission à l’IEPP, pas une sauvegarde.');
      } else throw E('Ce fichier n’est pas une sauvegarde AKWA SCHOOL.');
      if (integrite === 'alteree') return { type, valide: false, integrite, infos, notes: ['L’empreinte SHA-256 ne correspond pas : le fichier a été modifié ou est incomplet. Il ne sera pas restauré.'] };
      const { etat, notes } = AK.schema.migrer(donnees);
      const pb = AK.schema.verifier(etat).filter((p) => p.gravite === 'erreur');
      return { type, valide: true, integrite, infos: { ...infos, contenu: resume(etat) }, etat, notes, problemes: pb };
    },
    /** Remplace les données actuelles par une sauvegarde analysée (après confirmation de l'écran). */
    async restaurer(analyse, motif = 'Sauvegarde restaurée') {
      AK.perm.exiger('donnees.restaurer');
      if (!analyse || !analyse.valide) throw E('Sauvegarde non valide : restauration refusée.');
      await AK.store.copieAvant('avant-restauration');
      const etat = analyse.etat;
      await AK.auth.migrerSecrets(etat);
      if (AK.hote.type === 'bureau') etat.securite = S().securite; // comptes gérés par l'application Windows
      etat.meta.restaureLe = new Date().toISOString();
      AK.store.installer(etat);
      AK.store.journaliser(`${motif} (${analyse.infos && analyse.infos.creeLe ? 'fichier du ' + u.fmtHorodatage(analyse.infos.creeLe) : 'fichier 1.x'})`);
      await AK.store.maintenant();
      AK.cles.oublier();
      return true;
    },
    /** Copies de sécurité locales (navigateur) */
    copies: () => (AK.stockage.actif ? AK.stockage.actif.listeCopies() : Promise.resolve([])),
    async analyserCopie(id) {
      const etat = await AK.stockage.actif.lireCopie(id);
      const r = AK.schema.migrer(etat);
      return { type: 'copie', valide: true, integrite: 'locale', infos: { contenu: resume(r.etat), ecole: { nom: r.etat.school.name, annee: r.etat.school.year } }, etat: r.etat, notes: r.notes, problemes: [] };
    },
    /** Export au format AKWA SCHOOL 1.x (sans secret ni rubrique nouvelle) pour les applications existantes. */
    async exporter1x() {
      AK.perm.exiger('donnees.exporter');
      const d = sansTransitoire(S());
      ['meta', 'securite', 'docs', 'modeles', 'cles', 'corbeille'].forEach((k) => delete d[k]);
      d.v = 5;
      const nom = `akwa-school-format-1x-${u.aujourdhui()}.json`;
      await AK.hote.fichier(nom, new Blob([JSON.stringify(d)], { type: 'application/json' }), 'application/json');
      AK.store.journaliser('Export au format AKWA SCHOOL 1.x');
      return nom;
    },
    /* ---------- Exports CSV (Excel) ---------- */
    async csv(nom, lignes, libelle) {
      AK.perm.exiger('donnees.exporter');
      await AK.hote.fichier(nom, u.csv(lignes), 'text/csv');
      if (libelle) AK.store.journaliser('Export : ' + libelle);
    },
    lignesEleves() {
      const sc = S().school, x = X();
      const d = (v) => (v ? v.split('-') : ['', '', '']);
      return [AK.cfg.COLS_ELEVES, ...x.actifs().slice().sort(x.parClasse).map((s) => {
        const [y, m, j] = d(s.naissance), sp = s.acte && s.acte.sp ? String(s.acte.sp).replace(/^\s*sous[-\s]?pr[ée]fecture\s+(de\s+|d['’]\s*)?/i, '').toUpperCase() : '';
        const nom = (p) => `${(p && p.nom) || ''} ${(p && p.prenoms) || ''}`.trim();
        const code = (AK.ref.SOUS_PREFECTURES.find((z) => u.norm(z[1]) === u.norm(sp)) || [''])[0];
        return [sc.codedren, sc.codeiep, String(sc.iepp || '').replace(/^IEPP\s+/i, ''), sc.codeecole, sc.name, s.matNat || s.mat, s.nom, s.prenoms, s.sexe === 'Masculin' ? 'MASCULIN' : 'FEMININ',
          s.ageEstime ? '' : j ? String(+j) : '', s.ageEstime ? '' : m ? String(+m) : '', y || '', s.nationalite || AK.cfg.NAT_DEFAUT, (s.lieu || '').toUpperCase(), code, sp,
          nom(s.pere).toUpperCase(), nom(s.mere).toUpperCase(), s.extrait && s.acte && s.acte.num ? s.acte.num : '0', ((s.extrait && s.acte && s.acte.centre) || '').toUpperCase(), (s.pere && s.pere.domicile) || (s.mere && s.mere.domicile) || '', s.classe];
      })];
    }
  };
  AK.sauvegarde = sauvegarde;
})(window.AK);
