/* =====================================================================================
   Journalisation technique et diagnostic.
   - Erreurs JavaScript et promesses rejetées capturées (sans données personnelles).
   - Rapport de diagnostic exportable (version, stockage, quotas, erreurs récentes).
   Le journal des opérations métier (qui a fait quoi) est dans AK.audit (data/store.js).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const MAX = 200;
  const tampon = [];

  /* Retire les éléments personnels possibles d'un message (adresses de fichiers, nombres longs). */
  const nettoyer = (s) =>
    String(s || '')
      .replace(/data:[^\s"')]+/g, 'data:…')
      .replace(/file:\/\/\/[^\s"')]+/g, 'file:…')
      .replace(/\b\d{8,}\b/g, '…')
      .slice(0, 600);

  function noter(niveau, message, contexte) {
    tampon.push({ t: Date.now(), niveau, message: nettoyer(message), contexte: contexte ? nettoyer(contexte) : '' });
    if (tampon.length > MAX) tampon.shift();
  }

  const diag = {
    info: (m, c) => noter('info', m, c),
    avert: (m, c) => noter('avert', m, c),
    erreur(e, contexte) {
      const msg = e && e.message ? e.message : String(e);
      const pile = e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : '';
      noter('erreur', msg, (contexte || '') + (pile ? ' :: ' + pile : ''));
      if (window.console) console.error('[AKWA]', contexte || '', e);
    },
    liste: () => tampon.slice().reverse(),
    vider: () => (tampon.length = 0),
    async rapport() {
      const S = AK.store && AK.store.etat;
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
      const persiste = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
      return {
        application: AK.NOM + ' ' + AK.VERSION,
        genere: new Date().toISOString(),
        navigateur: navigator.userAgent,
        adresse: location.protocol,
        contexteSecurise: window.isSecureContext,
        webCrypto: !!(window.crypto && crypto.subtle),
        stockage: AK.stockage ? AK.stockage.description() : 'inconnu',
        quota: est ? { utilise: est.usage, total: est.quota } : null,
        persistant: persiste,
        hote: AK.hote ? AK.hote.type : 'inconnu',
        schema: S && S.meta ? S.meta.schema : null,
        volumes: S ? { eleves: S.students.length, personnel: S.teachers.length, notes: Object.keys(S.grades).length, documents: (S.docs && S.docs.items.length) || 0 } : null,
        erreurs: diag.liste().slice(0, 50)
      };
    }
  };
  AK.diag = diag;

  window.addEventListener('error', (e) => diag.erreur(e.error || e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && (r.name === 'ErreurMetier' || r.name === 'ErreurDroits')) return; // déjà montrées à l'utilisateur
    diag.erreur(r, 'promesse non gérée');
  });
})(window.AK);
