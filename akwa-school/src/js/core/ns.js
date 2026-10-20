/* =====================================================================================
   AKWA SCHOOL 2 — espace de noms et amorçage
   Toute l'application vit sous window.AK, découpée en modules (un fichier = un module).
   Ordre de chargement : src/manifest.json. Les scripts sont « classiques » (pas de modules ES)
   pour fonctionner en ouvrant directement le fichier HTML (adresse file://).
   ===================================================================================== */
(function () {
  'use strict';
  const AK = (window.AK = window.AK || {});
  AK.VERSION = '2.0.0';
  AK.NOM = 'AKWA SCHOOL';
  AK.vendor = AK.vendor || {};

  /* Erreurs métier : message destiné à l'utilisateur, jamais une trace technique. */
  class ErreurMetier extends Error {
    constructor(message, champ) {
      super(message);
      this.name = 'ErreurMetier';
      this.champ = champ || null;
    }
  }
  class ErreurDroits extends ErreurMetier {
    constructor(message) {
      super(message || 'Cette opération n’est pas autorisée pour votre profil.');
      this.name = 'ErreurDroits';
    }
  }
  AK.ErreurMetier = ErreurMetier;
  AK.ErreurDroits = ErreurDroits;

  /* Petit bus d'événements : les modules s'écoutent sans se connaître. */
  const ecoutes = new Map();
  AK.bus = {
    on(nom, f) {
      if (!ecoutes.has(nom)) ecoutes.set(nom, new Set());
      ecoutes.get(nom).add(f);
      return () => ecoutes.get(nom).delete(f);
    },
    emit(nom, donnee) {
      (ecoutes.get(nom) || []).forEach((f) => {
        try {
          f(donnee);
        } catch (e) {
          if (AK.diag) AK.diag.erreur(e, 'bus:' + nom);
          else console.error(e);
        }
      });
    }
  };
})();
