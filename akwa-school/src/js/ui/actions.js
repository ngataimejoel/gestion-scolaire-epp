/* =====================================================================================
   Délégation des événements : les éléments déclarent leur action dans le HTML
     data-action="nom"   (clic)      data-change="nom"   (changement)
     data-input="nom"    (frappe)    data-submit="nom"   (formulaire hors fenêtre)
   Chaque écran enregistre ses actions avec AK.actions.def({ nom: f }).
   Les erreurs métier sont affichées à l'utilisateur ; les autres sont journalisées.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const registre = { clic: new Map(), change: new Map(), saisie: new Map(), envoi: new Map() };

  async function executer(f, el, e, nom) {
    try {
      await f(el, e);
    } catch (err) {
      AK.ui.erreur(err, nom);
    }
  }
  function def(table, actions) {
    Object.entries(actions).forEach(([k, f]) => {
      if (table.has(k)) AK.diag.avert('Action redéfinie : ' + k);
      table.set(k, f);
    });
  }
  AK.actions = {
    def: (a) => def(registre.clic, a),
    defChange: (a) => def(registre.change, a),
    defSaisie: (a) => def(registre.saisie, a),
    defEnvoi: (a) => def(registre.envoi, a),
    existe: (nom) => registre.clic.has(nom),
    lancer(nom, el, e) {
      const f = registre.clic.get(nom);
      if (f) return executer(f, el || document.body, e, nom);
    },
    _registre: registre
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('[inert]')) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const f = registre.clic.get(el.dataset.action);
    if (!f) return;
    e.preventDefault();
    AK.session && AK.session.activite();
    executer(f, el, e, el.dataset.action);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const f = registre.change.get(el.dataset.change);
    if (f) executer(f, el, e, el.dataset.change);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (!el) return;
    const f = registre.saisie.get(el.dataset.input);
    if (f) executer(f, el, e, el.dataset.input);
  });
  document.addEventListener('submit', (e) => {
    const f0 = e.target;
    if (!f0.dataset || !f0.dataset.submit) return;
    e.preventDefault();
    const f = registre.envoi.get(f0.dataset.submit);
    if (f) executer(f, f0, e, f0.dataset.submit);
  });
  ['keydown', 'pointerdown'].forEach((t) => document.addEventListener(t, () => AK.session && AK.session.activite(), { passive: true }));
})(window.AK);
