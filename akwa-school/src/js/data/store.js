/* =====================================================================================
   Magasin de données : l'état de l'école en mémoire, ses modifications, son enregistrement.

   AK.store.modifier(libellé, f) est la seule porte d'écriture :
     1. f(S) applique la modification (les règles métier ont été vérifiées avant) ;
     2. l'opération est inscrite au journal (date, auteur, libellé sans donnée sensible) ;
     3. l'enregistrement est programmé (regroupé : une écriture toutes les 0,3 s au plus) ;
     4. l'écran est redessiné.
   Un échec d'enregistrement n'est jamais silencieux : bandeau rouge et notification.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;
  let S = null;
  let etatSauvegarde = { statut: 'ok', t: 0, message: '' };
  let enCours = null, enAttente = false, jourCopie = '', sale = false;
  const MAX_JOURNAL = 2000;

  function definirStatut(statut, message = '') {
    etatSauvegarde = { statut, t: Date.now(), message };
    AK.bus.emit('sauvegarde', etatSauvegarde);
  }

  async function ecrire() {
    if (!S) return;
    if (enCours) {
      enAttente = true;
      return enCours;
    }
    definirStatut('encours');
    sale = false;
    enCours = (async () => {
      try {
        S.meta.majLe = Date.now();
        await AK.hote.enregistrer(S);
        definirStatut(AK.stockage.actif && AK.stockage.actif.ephemere ? 'ephemere' : 'ok');
        const j = u.aujourdhui();
        if (jourCopie !== j && AK.stockage.actif && AK.hote.type !== 'bureau') {
          jourCopie = j;
          AK.stockage.actif.copie(S, 'jour').catch((e) => AK.diag.erreur(e, 'copie du jour'));
        }
      } catch (e) {
        sale = true;
        AK.diag.erreur(e, 'enregistrement');
        definirStatut('erreur', e && e.name === 'ErreurMetier' ? e.message : 'L’enregistrement a échoué : ' + (e && e.message ? e.message : e));
        AK.bus.emit('erreur-sauvegarde', etatSauvegarde);
      } finally {
        enCours = null;
        if (enAttente) {
          enAttente = false;
          ecrire();
        }
      }
    })();
    return enCours;
  }
  const programmer = u.differer(ecrire, 300);

  function auteur() {
    const s = AK.session && AK.session.courante();
    if (!s) return 'Système';
    return s.role === 'ens' ? 'Enseignant' + (s.login ? ' · ' + s.login : '') : 'Direction';
  }

  const store = {
    get etat() {
      return S;
    },
    get sauvegarde() {
      return etatSauvegarde;
    },
    installer(etat) {
      S = etat;
      jourCopie = '';
      AK.bus.emit('etat-installe', S);
    },
    /**
     * Modifie les données. libelle : texte du journal (null = pas d'entrée).
     * options : { rendu: false } pour ne pas redessiner l'écran ; { journal: false }.
     */
    modifier(libelle, f, options = {}) {
      if (!S) throw new Error('Données non chargées');
      const r = f(S);
      if (libelle && options.journal !== false) store.journaliser(libelle, options.categorie);
      sale = true;
      programmer();
      if (options.rendu !== false) AK.bus.emit('change', { libelle });
      return r;
    },
    journaliser(m, categorie) {
      const e = { t: Date.now(), m: String(m).slice(0, 300), qui: auteur(), c: categorie || '' };
      S.pro.journal.unshift(e);
      if (S.pro.journal.length > MAX_JOURNAL) S.pro.journal.length = MAX_JOURNAL;
      S.log.unshift({ t: e.t, m: e.m });
      if (S.log.length > 40) S.log.length = 40;
    },
    /** Enregistre immédiatement (fermeture, avant une opération à risque). */
    async maintenant() {
      programmer.annuler();
      await ecrire();
      if (enCours) await enCours;
      return etatSauvegarde.statut !== 'erreur';
    },
    /** Copie de sécurité locale avant une opération à risque (restauration, passage d'année…). */
    async copieAvant(motif) {
      if (!S || !AK.stockage.actif) return null;
      try {
        return await AK.stockage.actif.copie(S, motif);
      } catch (e) {
        AK.diag.erreur(e, 'copie avant ' + motif);
        return null;
      }
    },
    reessayer: () => ecrire()
  };
  AK.store = store;

  // enregistrement dès que la fenêtre passe en arrière-plan ; alerte si une écriture n'est pas finie
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S) {
      programmer.annuler();
      ecrire();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (sale || enCours) {
      ecrire();
      e.preventDefault();
      e.returnValue = '';
    }
  });
})(window.AK);
