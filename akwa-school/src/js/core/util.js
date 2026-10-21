/* =====================================================================================
   Outils communs : HTML sûr, DOM, dates, nombres, textes, identifiants, fichiers.
   Règle de sécurité : tout texte inséré dans le HTML passe par html`…` (échappement automatique).
   Seul un fragment produit par html`…` (ou marqué AK.u.raw) est inséré tel quel.
   ===================================================================================== */
(function (AK) {
  'use strict';

  /* ---------- HTML sûr ---------- */
  class Html {
    constructor(s) {
      this.s = s;
    }
    toString() {
      return this.s;
    }
  }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
  function enHtml(v) {
    if (v == null || v === false) return '';
    if (v instanceof Html) return v.s;
    if (Array.isArray(v)) return v.map(enHtml).join('');
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    return esc(v);
  }
  /** Gabarit HTML : les valeurs interpolées sont échappées, sauf les fragments Html. */
  function html(chaines, ...vals) {
    let out = chaines[0];
    for (let i = 0; i < vals.length; i++) out += enHtml(vals[i]) + chaines[i + 1];
    return new Html(out);
  }
  /** Marque un texte comme HTML déjà sûr (à n'utiliser que pour du HTML produit par le code). */
  const raw = (s) => new Html(String(s ?? ''));
  const joindre = (liste, sep = '') => new Html(liste.map(enHtml).join(enHtml(sep)));

  /* ---------- DOM ---------- */
  const $ = (s, e = document) => e.querySelector(s);
  const $$ = (s, e = document) => [...e.querySelectorAll(s)];
  function poser(el, contenu) {
    el.innerHTML = enHtml(contenu);
    return el;
  }

  /* ---------- Dates (chaînes AAAA-MM-JJ, heure locale) ---------- */
  const pad = (n, k = 2) => String(n).padStart(k, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseISO = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const estISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(parseISO(s)) && iso(parseISO(s)) === s;
  const ajouterJours = (s, n) => {
    const d = parseISO(s);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const aujourdhui = () => iso(new Date());
  const ecartJours = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const fmtDate = (s) => {
    if (!s) return '—';
    const [y, m, d] = String(s).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(s);
  };
  const fmtDateLongue = (s) =>
    s ? parseISO(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const fmtJour = (s) => parseISO(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtHorodatage = (t) =>
    new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  /** « 14/05/2018 », « 14-5-2018 » ou « 2018-05-14 » → « 2018-05-14 » (sinon '') */
  function versISO(v) {
    v = String(v || '').trim();
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) v = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return estISO(v) ? v : '';
  }

  /* ---------- Nombres ---------- */
  /** Arrondi décimal au plus proche, demi vers le haut (10,075 → 10,08) : décalage par l'exposant, sans erreur binaire. */
  const arrondi = (x, n = 2) => {
    if (!Number.isFinite(x)) return x;
    // 12 chiffres significatifs : absorbe l'erreur binaire des sommes (10,01 + 10 = 20,009999…)
    const y = Number(x.toPrecision(12));
    const r = Number(Math.round(Number(y + 'e' + n)) + 'e-' + n);
    return Number.isFinite(r) ? r + 0 : Math.round(x * 10 ** n) / 10 ** n; // + 0 : jamais « -0 »
  };
  const moyenne = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const fmtNote = (n) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2).replace('.', ','));
  const fmtSaisie = (n) => (n == null ? '' : String(n).replace('.', ','));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
  const fcfa = (n) => (Math.round(n || 0) + 0).toLocaleString('fr-FR') + ' F';
  const pluriel = (n, a, b) => n + ' ' + (Math.abs(n) > 1 ? b || a + 's' : a);
  const entier = (v) => (v === '' || v == null ? null : Math.max(0, parseInt(v, 10) || 0));

  /* ---------- Textes ---------- */
  /** Forme de comparaison : minuscules, sans accents ni ponctuation. */
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const majNom = (v) => String(v || '').toUpperCase();
  const majPrenoms = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/(^|[\s\-'’])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
  const majNomComplet = (v) => {
    const m = String(v || '').match(/^(\s*\S+)([\s\S]*)$/);
    return m ? m[1].toUpperCase() + majPrenoms(m[2]) : '';
  };
  const capitale = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase());
  const tronquer = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

  /* ---------- Identifiants et empreintes ---------- */
  function uid() {
    if (window.crypto && crypto.getRandomValues) {
      const b = crypto.getRandomValues(new Uint8Array(9));
      return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 14);
  }
  /** Empreinte rapide (non cryptographique) d'un texte : clé des images en stockage. */
  function empreinte(str) {
    let h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') + '-' + str.length.toString(36);
  }
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  /* ---------- Temporisation ---------- */
  function differer(f, ms) {
    let t = null;
    const d = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => f(...a), ms);
    };
    d.annuler = () => clearTimeout(t);
    return d;
  }
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Fichiers ---------- */
  /** Téléchargement direct par le navigateur (l'hôte de bureau peut le remplacer). */
  function telechargerNavigateur(nom, contenu, type = 'text/plain') {
    const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /** CSV pour Excel (séparateur « ; », BOM UTF-8). */
  const csv = (lignes) =>
    '﻿' + lignes.map((r) => r.map((x) => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
  /** Image choisie par l'utilisateur, réduite (côté le plus long ≤ max) et recompressée. */
  function lireImage(fichier, max = 360, type = 'image/jpeg', qualite = 0.86) {
    return new Promise((ok, ko) => {
      if (!fichier || !/^image\//.test(fichier.type)) return ko(new AK.ErreurMetier('Ce fichier n’est pas une image.'));
      if (fichier.size > 25 * 1024 * 1024) return ko(new AK.ErreurMetier('Image trop volumineuse (25 Mo au maximum).'));
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          const k = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * k));
          c.height = Math.max(1, Math.round(im.height * k));
          const g = c.getContext('2d');
          if (type === 'image/jpeg') {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, c.width, c.height);
          }
          g.drawImage(im, 0, 0, c.width, c.height);
          ok(c.toDataURL(type, qualite));
        };
        im.onerror = () => ko(new AK.ErreurMetier('Image illisible.'));
        im.src = r.result;
      };
      r.onerror = () => ko(new AK.ErreurMetier('Fichier illisible.'));
      r.readAsDataURL(fichier);
    });
  }
  const IMG_OK = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;

  AK.u = {
    Html, html, raw, esc, joindre, enHtml, $, $$, poser,
    pad, iso, parseISO, estISO, ajouterJours, aujourdhui, ecartJours, fmtDate, fmtDateLongue, fmtJour, fmtHorodatage, versISO,
    arrondi, moyenne, fmtNote, fmtSaisie, pct, fcfa, pluriel, entier,
    norm, sansAccents, majNom, majPrenoms, majNomComplet, capitale, tronquer,
    uid, empreinte, clone, differer, attendre,
    telechargerNavigateur, csv, lireImage, IMG_OK
  };
})(window.AK);
