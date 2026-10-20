/* =====================================================================================
   Cartes d'identification : formats, planches A4 avec traits de coupe, recto-verso.
   ID-1 (85,6 × 53,98 mm) : 10 cartes par feuille A4 (2 × 5), gouttière de 2 mm.
   Impression « à l'unité » : une carte par page au format exact (imprimante à cartes).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u;
  const FORMATS = {
    id1: { lib: 'ID-1 paysage · 85,6 × 54 mm (format carte bancaire)', l: 85.6, h: 53.98, classe: '', page: 'carte' },
    id1p: { lib: 'ID-1 portrait · 54 × 85,6 mm', l: 53.98, h: 85.6, classe: 'portrait', page: 'carteP' },
    badge: { lib: 'Badge portrait · 70 × 100 mm', l: 70, h: 100, classe: 'portrait', page: 'badge' },
    perso: { lib: 'Dimensions personnalisées', l: 85.6, h: 53.98, classe: '', page: 'cperso' }
  };
  /** Format effectif (personnalisé : bornes 40–150 mm). */
  function format(r) {
    const c = (r && r.carte) || {};
    const f = FORMATS[c.format] || FORMATS.id1;
    if (c.format !== 'perso') return { ...f, cle: c.format || 'id1' };
    const l = Math.min(150, Math.max(40, Number(c.l) || 85.6)), h = Math.min(150, Math.max(40, Number(c.h) || 53.98));
    return { ...f, l, h, classe: h > l ? 'portrait' : '', cle: 'perso' };
  }

  const TRAIT = 3.5, ECART_TRAIT = 1;
  function traits(x, y, l, h) {
    const T = [];
    const add = (x1, y1, w, hh) => T.push(`<span class="trait" style="left:${x1.toFixed(2)}mm;top:${y1.toFixed(2)}mm;width:${w}mm;height:${hh}mm"></span>`);
    [[x, y], [x + l, y], [x, y + h], [x + l, y + h]].forEach(([cx, cy], i) => {
      const gauche = i % 2 === 0, haut = i < 2;
      add(gauche ? cx - ECART_TRAIT - TRAIT : cx + ECART_TRAIT, cy - 0.1, TRAIT, 0.2);
      add(cx - 0.1, haut ? cy - ECART_TRAIT - TRAIT : cy + ECART_TRAIT, 0.2, TRAIT);
    });
    return T.join('');
  }

  /**
   * Assemble les cartes en feuilles.
   * cartes : [{ html, verso, statut, format }] ; o = { mode: 'planche'|'unitaire', traits: true, verso: false, debut: 0 }
   */
  function planches(cartes, o = {}) {
    const f = cartes[0] && cartes[0].format ? cartes[0].format : FORMATS.id1;
    if (o.mode === 'unitaire') {
      const perso = f.cle === 'perso' ? raw(`<style>@page cperso { size: ${f.l}mm ${f.h}mm; margin: 0 }</style>`) : '';
      const pages = [];
      cartes.forEach((c) => {
        pages.push(html`<section class="feuille carte-seule${f.classe ? ' portrait-c' : ''}${f.cle === 'badge' ? ' badge-c' : ''}" style="width:${f.l}mm;height:${f.h}mm;page:${f.page}" data-l="${f.l}" data-h="${f.h}">${c.html}</section>`);
        if (o.verso && c.verso) pages.push(html`<section class="feuille carte-seule${f.classe ? ' portrait-c' : ''}" style="width:${f.l}mm;height:${f.h}mm;page:${f.page}" data-l="${f.l}" data-h="${f.h}">${c.verso}</section>`);
      });
      if (pages.length) pages[0] = html`${perso}${pages[0]}`;
      return pages;
    }
    const A4 = { l: 210, h: 297 }, gout = 2, marge = 8;
    const col = Math.max(1, Math.floor((A4.l - 2 * marge + gout) / (f.l + gout)));
    const lig = Math.max(1, Math.floor((A4.h - 2 * marge - 6 + gout) / (f.h + gout)));
    const parPage = col * lig;
    const x0 = (A4.l - (col * f.l + (col - 1) * gout)) / 2, y0 = (A4.h - (lig * f.h + (lig - 1) * gout)) / 2 - 2;
    const debut = Math.min(parPage - 1, Math.max(0, Number(o.debut) || 0));
    const pages = [];
    const cases = [...Array(debut).fill(null), ...cartes];
    for (let p = 0; p < cases.length; p += parPage) {
      const lot = cases.slice(p, p + parPage);
      const pose = (verso) => lot.map((c, i) => {
        if (!c) return '';
        const r = Math.floor(i / col);
        let k = i % col;
        if (verso) k = col - 1 - k; // retournement sur le bord long
        const x = x0 + k * (f.l + gout), y = y0 + r * (f.h + gout);
        return html`<div class="emplacement" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;width:${f.l}mm;height:${f.h}mm">${verso ? c.verso || '' : c.html}</div>${o.traits !== false ? raw(traits(x, y, f.l, f.h)) : ''}`;
      });
      const leg = `AKWA SCHOOL · planche de ${u.pluriel(lot.filter(Boolean).length, 'carte')} ${f.l.toString().replace('.', ',')} × ${f.h.toString().replace('.', ',')} mm · imprimer à 100 % (sans ajustement)`;
      pages.push(html`<section class="feuille planche" data-l="210" data-h="297">${pose(false)}<div class="legende-planche">${leg}</div></section>`);
      if (o.verso && lot.some((c) => c && c.verso)) pages.push(html`<section class="feuille planche" data-l="210" data-h="297">${pose(true)}<div class="legende-planche">Verso · insérer la feuille imprimée côté recto, retournement sur le bord long</div></section>`);
    }
    return pages;
  }

  /** Validité d'une carte : fin d'année scolaire (31 juillet), date fixe ou aucune. */
  function expiration(r) {
    const c = (r && r.carte) || {};
    if (c.expiration === 'aucune') return null;
    if (c.expiration === 'date' && u.estISO(c.dateExpiration)) return c.dateExpiration;
    const an = AK.calc.anneeRentree();
    return `${an + 1}-07-31`;
  }

  AK.cartes = { FORMATS, format, planches, expiration };
})(window.AK);
