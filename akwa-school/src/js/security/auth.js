/* =====================================================================================
   Comptes, session et confirmation par mot de passe.

   Version navigateur : les mots de passe du directeur et des enseignants sont conservés sous
   forme d'empreintes PBKDF2 dans les données (jamais en clair, jamais dans les sauvegardes
   en clair). LIMITE : tout est dans le navigateur de cet ordinateur ; une personne qui a accès
   à la session Windows et aux outils du navigateur peut lire les données. Les mots de passe
   protègent l'usage de l'application, pas les fichiers. Voir docs/SECURITE.md.

   Version bureau : la connexion et les mots de passe sont gérés par l'application Windows.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, K = AK.crypto, V = AK.valid;
  const S = () => AK.store.etat;
  const bureau = () => AK.hote.type === 'bureau';

  /* ---------- Session ---------- */
  let session = null;
  let derniereConfirmation = 0;
  let derniereActivite = Date.now();

  const sessionApi = {
    courante: () => session,
    ouverte: () => !!session,
    estDirecteur: () => !!session && session.role === 'dir',
    estEnseignant: () => !!session && session.role === 'ens',
    solo: () => !!session && session.role === 'ens' && !!(S() && S().school.solo),
    agent() {
      if (!session || session.role !== 'ens') return null;
      return S().teachers.find((t) => t.id === session.tid) || null;
    },
    /** Classes visibles : toutes pour le directeur, les siennes pour un enseignant. */
    classes() {
      const niveaux = AK.calc.niveaux();
      if (!session || session.role === 'dir') return niveaux;
      const a = sessionApi.agent();
      return a ? niveaux.filter((c) => AK.calc.clsDe(a).includes(c)) : [];
    },
    ouvrir(s) {
      session = { ...s, depuis: Date.now() };
      derniereActivite = Date.now();
      AK.bus.emit('session', session);
    },
    fermer() {
      session = null;
      derniereConfirmation = 0;
      AK.bus.emit('session', null);
    },
    activite() {
      derniereActivite = Date.now();
    },
    inactifDepuis: () => Date.now() - derniereActivite,
    libelle() {
      if (!session) return '';
      if (session.role === 'dir') return S().school.director || 'Directeur';
      const a = sessionApi.agent();
      return a ? a.nom : 'Enseignant';
    }
  };
  AK.session = sessionApi;

  /* ---------- Directeur (administrateur) ---------- */
  const auth = {
    /** Création de l'école : mot de passe du directeur et code de secours (affiché une seule fois). */
    async configurerAdmin(mdp) {
      const e = V.motDePasse(mdp);
      if (e) throw new AK.ErreurMetier(e, 'mdp');
      const code = K.codeLisible(3);
      const [h, hs] = await Promise.all([K.empreinteSecret(mdp), K.empreinteSecret(K.normCode(code))]);
      AK.store.modifier('Compte administrateur créé', (s) => {
        s.securite.admin = h;
        s.securite.secours = hs;
        s.securite.forcerChangement = false;
        s.securite.aSecourir = false;
      }, { rendu: false });
      return code;
    },
    aUnAdmin: () => bureau() || !!(S() && S().securite.admin),
    async verifierAdmin(mdp) {
      if (bureau()) return !!(await AK.hote.verifierAdmin(mdp));
      return K.verifierSecret(mdp, S().securite.admin);
    },
    async changerAdmin(ancien, nouveau) {
      if (bureau()) {
        const err = await AK.hote.appel('changerAdmin', ancien, nouveau);
        if (err) throw new AK.ErreurMetier(err);
        await AK.cles.rechiffrer(ancien, nouveau).catch(() => {});
        return;
      }
      if (!(await auth.verifierAdmin(ancien))) throw new AK.ErreurMetier('Mot de passe actuel incorrect.', 'old');
      const e = V.motDePasse(nouveau, 'Nouveau mot de passe');
      if (e) throw new AK.ErreurMetier(e, 'nw');
      if (ancien === nouveau) throw new AK.ErreurMetier('Le nouveau mot de passe doit être différent de l’ancien.', 'nw');
      const h = await K.empreinteSecret(nouveau);
      await AK.cles.rechiffrer(ancien, nouveau);
      AK.store.modifier('Mot de passe administrateur changé', (s) => {
        s.securite.admin = h;
        s.securite.forcerChangement = false;
      });
      derniereConfirmation = Date.now();
    },
    /** Nouveau code de secours (l'ancien ne sert plus) : renvoie le code à montrer une fois. */
    async nouveauSecours(mdp) {
      if (bureau()) {
        if (!(await auth.verifierAdmin(mdp))) throw new AK.ErreurMetier('Mot de passe incorrect.', 'pwd');
        const r = JSON.parse(await AK.hote.appel('nouveauSecours'));
        if (r.erreur) throw new AK.ErreurMetier(r.erreur);
        return r.code;
      }
      if (!(await auth.verifierAdmin(mdp))) throw new AK.ErreurMetier('Mot de passe incorrect.', 'pwd');
      const code = K.codeLisible(3);
      const hs = await K.empreinteSecret(K.normCode(code));
      AK.store.modifier('Nouveau code de secours créé', (s) => {
        s.securite.secours = hs;
        s.securite.aSecourir = false;
      });
      return code;
    },
    /** Mot de passe oublié : code de secours + nouveau mot de passe. Renvoie le nouveau code. */
    async recupererAdmin(code, nouveau) {
      if (bureau()) {
        const r = JSON.parse(await AK.hote.appel('recupererAdmin', code, nouveau));
        if (r.erreur) throw new AK.ErreurMetier(r.erreur);
        return r.code;
      }
      const sec = S().securite.secours;
      if (!sec || !(await K.verifierSecret(K.normCode(code), sec))) throw new AK.ErreurMetier('Code de secours incorrect.', 'code');
      const e = V.motDePasse(nouveau, 'Nouveau mot de passe');
      if (e) throw new AK.ErreurMetier(e, 'nw');
      const nouveauCode = K.codeLisible(3);
      const [h, hs] = await Promise.all([K.empreinteSecret(nouveau), K.empreinteSecret(K.normCode(nouveauCode))]);
      await AK.cles.recupererParSecours(code, nouveau, nouveauCode);
      AK.store.modifier('Mot de passe administrateur changé avec le code de secours', (s) => {
        s.securite.admin = h;
        s.securite.secours = hs;
        s.securite.forcerChangement = false;
        s.securite.aSecourir = false;
      });
      return nouveauCode;
    },

    /* ---------- Comptes des enseignants (version navigateur) ---------- */
    loginDe(nom) {
      const p = V.civ.sans(nom).split(/\s+/);
      return (((p[1] || '')[0] || '') + (p[0] || '')).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, 24);
    },
    async creerCompte(tid, login) {
      AK.perm.exiger('comptes.gerer');
      const t = S().teachers.find((x) => x.id === tid);
      if (!t) throw new AK.ErreurMetier('Enseignant introuvable.');
      login = String(login || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9._-]{2,23}$/.test(login)) throw new AK.ErreurMetier('Identifiant : 3 à 24 caractères (lettres minuscules, chiffres, . _ -), commençant par une lettre.', 'login');
      if (S().teachers.some((x) => x !== t && x.compte && x.compte.login === login)) throw new AK.ErreurMetier('Identifiant déjà utilisé.', 'login');
      if (bureau()) {
        const r = JSON.parse(await AK.hote.appel('creerCompte', tid, login));
        if (r.erreur) throw new AK.ErreurMetier(r.erreur);
        AK.store.modifier(`Compte enseignant créé : ${login}`, () => (t.compte = { login, actif: true, cree: AK.u.aujourdhui() }));
        return r.mdp;
      }
      const mdp = 'Prov-' + K.codeLisible(2).replace('-', '');
      const h = await K.empreinteSecret(mdp);
      AK.store.modifier(`Compte enseignant créé : ${login}`, (s) => {
        t.compte = { login, actif: true, cree: AK.u.aujourdhui() };
        s.securite.comptes[tid] = { ...h, provisoire: true };
      });
      return mdp;
    },
    async reinitCompte(tid) {
      AK.perm.exiger('comptes.gerer');
      const t = S().teachers.find((x) => x.id === tid);
      if (!t || !t.compte) throw new AK.ErreurMetier('Ce membre du personnel n’a pas de compte.');
      if (bureau()) {
        const r = JSON.parse(await AK.hote.appel('reinitCompte', tid));
        if (r.erreur) throw new AK.ErreurMetier(r.erreur);
        AK.store.journaliser(`Mot de passe réinitialisé : ${t.compte.login}`);
        return r.mdp;
      }
      const mdp = 'Prov-' + K.codeLisible(2).replace('-', '');
      const h = await K.empreinteSecret(mdp);
      AK.store.modifier(`Mot de passe réinitialisé : ${t.compte.login}`, (s) => (s.securite.comptes[tid] = { ...h, provisoire: true }));
      return mdp;
    },
    /** Connexion (version navigateur). Renvoie { role, tid?, login?, provisoire? }. */
    async connecter(identifiant, mdp) {
      identifiant = String(identifiant || '').trim().toLowerCase();
      if (!identifiant || identifiant === 'directeur' || identifiant === 'admin') {
        if (!(await auth.verifierAdmin(mdp))) throw new AK.ErreurMetier('Mot de passe incorrect.', 'mdp');
        AK.cles.deverrouiller(mdp).catch((e) => AK.diag.erreur(e, 'clé de signature'));
        return { role: 'dir', provisoire: !!S().securite.forcerChangement };
      }
      const t = S().teachers.find((x) => x.compte && x.compte.login === identifiant);
      const rec = t && S().securite.comptes[t.id];
      // même délai que pour un compte existant : on ne révèle pas si l'identifiant existe
      const ok = await K.verifierSecret(mdp, rec || (await K.empreinteSecret('—')));
      if (!t || !rec || !ok) throw new AK.ErreurMetier('Identifiant ou mot de passe incorrect.', 'mdp');
      if (t.actif === false || !t.compte.actif) throw new AK.ErreurMetier('Ce compte est désactivé. Adressez-vous au directeur.', 'login');
      return { role: 'ens', tid: t.id, login: t.compte.login, provisoire: !!rec.provisoire };
    },
    async changerMotDePasseEnseignant(tid, ancien, nouveau) {
      const rec = S().securite.comptes[tid];
      if (!rec || !(await K.verifierSecret(ancien, rec))) throw new AK.ErreurMetier('Mot de passe actuel incorrect.', 'old');
      const e = V.motDePasse(nouveau, 'Nouveau mot de passe');
      if (e) throw new AK.ErreurMetier(e, 'nw');
      const h = await K.empreinteSecret(nouveau);
      AK.store.modifier('Mot de passe enseignant changé', (s) => (s.securite.comptes[tid] = { ...h, provisoire: false }));
    },

    /**
     * Données AKWA SCHOOL 1.x : le mot de passe en clair devient une empreinte.
     * Un mot de passe faible (dont « admin », valeur d'origine) devra être changé à la connexion.
     */
    async migrerSecrets(etat) {
      if (etat._mdpEnClair == null) return;
      const ancien = String(etat._mdpEnClair);
      delete etat._mdpEnClair;
      if (bureau()) return;
      if (!etat.securite.admin && ancien) etat.securite.admin = await K.empreinteSecret(ancien);
      etat.securite.forcerChangement = !!V.motDePasse(ancien) || ancien === 'admin';
      etat.securite.aSecourir = true;
    },

    /* ---------- Confirmation par mot de passe pour les opérations sensibles ---------- */
    /** Demande le mot de passe administrateur (sauf confirmation récente). Renvoie true/false. */
    async confirmer(message, { forcer = false } = {}) {
      if (!forcer && Date.now() - derniereConfirmation < C.SECU.GRACE_SEC * 1000 && sessionApi.estDirecteur()) return true;
      const ok = await AK.ui.demanderMotDePasse(message);
      if (ok) derniereConfirmation = Date.now();
      return ok;
    },
    oublierConfirmation: () => (derniereConfirmation = 0)
  };
  AK.auth = auth;
})(window.AK);
