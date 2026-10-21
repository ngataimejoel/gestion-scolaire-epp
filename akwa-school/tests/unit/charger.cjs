/* =====================================================================================
   Chargement des modules d'AKWA SCHOOL sous Node (tests unitaires, sans navigateur).
   Les scripts sont exécutés tels quels dans un contexte isolé qui imite le strict nécessaire
   de « window » (WebCrypto, TextEncoder, minuteries). Aucune dépendance.

   AKWA_SRC=<dossier src> permet de tester une copie (tests par mutation) ; défaut : ../../src
   Usage : const { charger } = require('./charger.cjs');
           const AK = charger(['js/core/ns.js', 'js/core/util.js', ...], { etat });
   ===================================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = process.env.AKWA_SRC ? path.resolve(process.env.AKWA_SRC) : path.resolve(__dirname, '../../src');

/** Modules de base dans l'ordre du manifeste. */
const BASE = ['js/core/ns.js', 'js/core/util.js', 'js/core/icons.js', 'js/core/config.js', 'js/core/referentiels.js', 'js/core/validate.js', 'js/core/diag.js'];

function contexte() {
  const auditeurs = {};
  const fenetre = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams, Blob: globalThis.Blob, atob, btoa,
    crypto: globalThis.crypto, performance: globalThis.performance, structuredClone,
    navigator: { userAgent: 'node', language: 'fr-FR' },
    location: { hash: '', href: 'file:///test.html', protocol: 'file:' },
    addEventListener: (t, f) => (auditeurs[t] = auditeurs[t] || []).push(f),
    removeEventListener() {},
    dispatchEvent() { return true; },
    localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; })(),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: {
      documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} },
      addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {}, insertAdjacentHTML() {} }
    },
    _auditeurs: auditeurs
  };
  fenetre.window = fenetre;
  fenetre.self = fenetre;
  fenetre.globalThis = fenetre;
  return vm.createContext(fenetre);
}

/**
 * Charge les modules demandés (après les modules de base) et renvoie AK.
 * options.etat : objet d'état branché sur AK.store (pour les modules qui lisent AK.store.etat).
 */
function charger(modules = [], options = {}) {
  const ctx = contexte();
  const liste = [...BASE, ...modules.filter((m) => !BASE.includes(m))];
  for (const m of liste) {
    const code = fs.readFileSync(path.join(SRC, m), 'utf8');
    vm.runInContext(code, ctx, { filename: m });
  }
  const AK = ctx.AK;
  if (options.etat !== undefined) {
    AK.store = AK.store || {};
    AK.store.etat = options.etat;
    if (!AK.store.modifier) AK.store.modifier = (libelle, f) => f(AK.store.etat);
    if (!AK.store.journaliser) AK.store.journaliser = () => {};
  }
  return AK;
}

module.exports = { charger, SRC, BASE };
