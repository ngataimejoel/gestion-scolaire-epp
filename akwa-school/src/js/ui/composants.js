/* =====================================================================================
   Composants d'interface réutilisables (HTML sûr) : en-têtes de page, indicateurs, états
   vides, avatars, étiquettes, champs de formulaire libellés et accessibles.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, ic = AK.ic;
  const ui = (AK.ui = AK.ui || {});
  const X = () => AK.calc;

  /** Attributs HTML : { placeholder: 'x', required: true, maxlength: 20 } (valeurs échappées). */
  ui.attrs = (o = {}) =>
    raw(Object.entries(o).filter(([, v]) => v !== false && v != null).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${u.esc(v)}"`)).join(''));
  ui.options = (liste, sel, vide) =>
    html`${vide != null ? html`<option value="">${vide}</option>` : ''}${liste.map((v) => {
      const [val, lib] = Array.isArray(v) ? v : [v, v];
      return html`<option value="${val}"${String(val) === String(sel ?? '') ? raw(' selected') : ''}>${lib}</option>`;
    })}`;

  ui.pageTete = (titre, sous, actions) =>
    html`<header class="page-tete"><div><h1>${titre}</h1>${sous ? html`<p>${sous}</p>` : ''}</div>${actions ? html`<div class="actions">${actions}</div>` : ''}</header>`;

  ui.kpi = ({ lien, action, icone = 'chart', lib, val, sous = '', extra = '', ton = '' }) => {
    const corps = html`<span class="kpi-l">${ic(icone)}${lib}</span><span class="kpi-v">${val}</span><span class="kpi-s">${sous}</span>${extra}${lien || action ? html`<span class="fleche">${ic('chev')}</span>` : ''}`;
    if (lien) return html`<a class="kpi ${ton}" href="#${lien}">${corps}</a>`;
    if (action) return html`<button type="button" class="kpi ${ton}" data-action="${action.nom}"${ui.attrs(action.attrs)}>${corps}</button>`;
    return html`<div class="kpi ${ton}">${corps}</div>`;
  };

  const ILLU = raw('<svg class="illu" viewBox="0 0 84 64" aria-hidden="true"><ellipse cx="42" cy="58" rx="34" ry="4" fill="currentColor" opacity=".35"/><path d="M14 14h24c3 0 4 2 4 4v34c0-2-1-4-4-4H14z" fill="var(--surface)" stroke="currentColor" stroke-width="1.6"/><path d="M70 14H46c-3 0-4 2-4 4v34c0-2 1-4 4-4h24z" fill="var(--surface)" stroke="currentColor" stroke-width="1.6"/><path d="M19 22h17M19 28h17M19 34h12M47 22h17M47 28h17M47 34h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="66" cy="12" r="6" fill="var(--acc)" opacity=".8"/></svg>');
  ui.vide = (titre, texte, action) => html`<div class="vide">${ILLU}<b>${titre}</b>${texte ? html`<p>${texte}</p>` : ''}${action || ''}</div>`;

  ui.avatar = (p, taille = '') => {
    if (p && p.photo) return html`<img class="av ${taille}" src="${p.photo}" alt="">`;
    return html`<span class="av ${taille}" aria-hidden="true">${X().initiales(p || { nom: '?' })}</span>`;
  };
  ui.tag = (texte, ton = '', icone) => html`<span class="tag ${ton}">${icone ? ic(icone) : ''}${texte}</span>`;
  ui.tagDecision = (d) => (d ? ui.tag(d, d === 'Admis' ? 'ok' : d === 'Redoublant' ? 'avert' : 'mauvais') : ui.tag('MGA incomplète'));
  ui.tagStatut = (s) => ui.tag(s, s === 'Inscrit' ? 'ok' : 'mauvais');
  ui.lienClasse = (c) => html`<a class="tag pri" href="#eleves/liste?classe=${c}" data-bulle="Voir les élèves de ${c}">${c}</a>`;
  ui.nomEleve = (s) => html`<button type="button" class="lien" data-action="fiche-eleve" data-id="${s.id}">${X().nomComplet(s)}</button>`;
  ui.quiEleve = (s) => html`<div class="qui">${ui.avatar(s)}<span class="tronque">${ui.nomEleve(s)}<br><span class="mut petit">${s.classe} · ${X().matOf(s)}</span></span></div>`;
  ui.nomAgent = (t) => html`<button type="button" class="lien" data-action="fiche-agent" data-id="${t.id}">${t.nom}</button>`;
  ui.onglets = (liste, actif) =>
    html`<nav class="onglets" aria-label="Sections">${liste.map(([lien, lib, compte]) => html`<a href="#${lien}" class="${lien === actif ? 'actif' : ''}"${lien === actif ? raw(' aria-current="page"') : ''}>${lib}${compte ? html`<span class="compte">${compte}</span>` : ''}</a>`)}</nav>`;
  ui.pilules = (liste, actif, action, attrs = {}) =>
    html`<div class="pilules" role="group">${liste.map((x) => {
      const [v, l, extra] = Array.isArray(x) ? x : [x, x];
      return html`<button type="button" class="pilule" aria-pressed="${String(v) === String(actif)}" data-action="${action}" data-v="${v}"${ui.attrs(attrs)}>${l}${extra || ''}</button>`;
    })}</div>`;
  ui.encadre = (texte, ton = '', icone) => html`<div class="encadre ${ton}">${ic(icone || (ton === 'avert' ? 'warn' : ton === 'erreur' ? 'alert' : ton === 'ok' ? 'checkCircle' : 'info'))}<div>${texte}</div></div>`;
  ui.carte = (titre, corps, { sous, actions, cls = '' } = {}) =>
    html`<section class="carte ${cls}">${titre ? html`<div class="carte-tete"><div><h2>${titre}</h2>${sous ? html`<div class="sous">${sous}</div>` : ''}</div>${actions || ''}</div>` : ''}${corps}</section>`;

  /* ---------- Champs de formulaire ---------- */
  let n = 0;
  const id = () => 'ch' + ++n;
  const enveloppe = (o, controle, ident) =>
    html`<div class="champ${o.plein ? ' plein' : ''}"${o.cache ? raw(' hidden') : ''}${o.zone ? html` data-zone="${o.zone}"` : ''}><label for="${ident}">${o.lib}${o.req ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>${controle}${o.aide ? html`<div class="aide" id="${ident}-aide">${o.aide}</div>` : ''}</div>`;
  const F = {
    texte(o) {
      const i = o.id || id();
      return enveloppe(o, html`<input class="inp" id="${i}" name="${o.nom}" type="${o.type || 'text'}" value="${o.val ?? ''}"${ui.attrs({ required: !!o.req, 'aria-describedby': o.aide ? i + '-aide' : null, ...(o.attrs || {}) })}>`, i);
    },
    nombre: (o) => F.texte({ ...o, type: 'number', attrs: { inputmode: 'decimal', ...(o.attrs || {}) } }),
    date: (o) => F.texte({ ...o, type: 'date' }),
    tel: (o) => F.texte({ ...o, type: 'tel', attrs: { inputmode: 'tel', placeholder: '+225 07 00 00 00 00', autocomplete: 'off', ...(o.attrs || {}) } }),
    choix(o) {
      const i = o.id || id();
      return enveloppe(o, html`<select class="inp" id="${i}" name="${o.nom}"${ui.attrs({ required: !!o.req, ...(o.attrs || {}) })}>${ui.options(o.options, o.val, o.vide)}</select>`, i);
    },
    zone(o) {
      const i = o.id || id();
      return enveloppe(o, html`<textarea class="inp" id="${i}" name="${o.nom}" rows="${o.lignes || 3}"${ui.attrs({ required: !!o.req, ...(o.attrs || {}) })}>${o.val ?? ''}</textarea>`, i);
    },
    /** Case à cocher seule (valeur booléenne). */
    case(o) {
      const i = o.id || id();
      return html`<div class="champ${o.plein ? ' plein' : ''}"><label class="coche" for="${i}"><input type="checkbox" id="${i}" name="${o.nom}"${o.coche ? raw(' checked') : ''}${ui.attrs(o.attrs || {})}> ${o.lib}</label>${o.aide ? html`<div class="aide">${o.aide}</div>` : ''}</div>`;
    },
    /** Cases multiples (valeur : tableau). */
    cases(o) {
      return html`<fieldset class="champ${o.plein ? ' plein' : ''}" style="border:0;padding:0;margin:0"><legend class="lib" style="font-size:12.5px;font-weight:650;color:var(--ink-2);margin-bottom:6px">${o.lib}</legend><div class="coches">${o.options.map((x) => {
        const [v, l] = Array.isArray(x) ? x : [x, x];
        return html`<label class="coche"><input type="checkbox" name="${o.nom}" value="${v}" data-multiple${(o.valeurs || []).includes(v) ? raw(' checked') : ''}> ${l}</label>`;
      })}</div>${o.aide ? html`<div class="aide">${o.aide}</div>` : ''}</fieldset>`;
    },
    radios(o) {
      return html`<fieldset class="champ${o.plein ? ' plein' : ''}" style="border:0;padding:0;margin:0"><legend class="lib" style="font-size:12.5px;font-weight:650;color:var(--ink-2);margin-bottom:6px">${o.lib}</legend><div class="choix-carte">${o.options.map(([v, l]) => html`<label><input type="radio" name="${o.nom}" value="${v}"${String(v) === String(o.val) ? raw(' checked') : ''}> ${l}</label>`)}</div></fieldset>`;
    },
    /** Choix d'une image (photo, logo) : aperçu + bouton ; la valeur est mise dans un champ caché. */
    image(o) {
      const i = o.id || id();
      return html`<div class="champ${o.plein ? ' plein' : ''}"><span class="lib">${o.lib}</span><div class="ligne"><span class="apercu-img" id="${i}-ap">${o.val ? html`<img src="${o.val}" alt="" style="height:${o.h || 64}px;border-radius:8px;border:1px solid var(--line)">` : html`<span class="av lg" aria-hidden="true">${ic('image')}</span>`}</span>
        <label class="btn btn-sm">${ic('cam')}${o.bouton || 'Choisir une image'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-change="image-choisie" data-cible="${i}" data-max="${o.max || 360}" data-type="${o.typeImg || 'image/jpeg'}"></label>
        ${o.val ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="image-retirer" data-cible="${i}">Retirer</button>` : ''}
        <input type="hidden" name="${o.nom}" id="${i}" value="${o.val || ''}" data-image></div>${o.aide ? html`<div class="aide">${o.aide}</div>` : ''}</div>`;
    }
  };
  ui.champ = F;

  /** Onglets d'un formulaire : [[clé, libellé, Html]] */
  ui.ongletsForm = (liste) => {
    const base = 'of' + ++n;
    return html`<div class="onglets-form" role="tablist">${liste.map(([k, l], i) => html`<button type="button" role="tab" id="${base}-t-${k}" aria-controls="${base}-p-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${l}</button>`)}</div>${liste.map(([k, , corps], i) => html`<div role="tabpanel" id="${base}-p-${k}" aria-labelledby="${base}-t-${k}"${i ? raw(' hidden') : ''}>${corps}</div>`)}`;
  };

  /* Images choisies dans un formulaire : réduites puis placées dans le champ caché */
  AK.actions.defChange({
    async 'image-choisie'(el) {
      const f = el.files && el.files[0];
      if (!f) return;
      const url = await u.lireImage(f, Number(el.dataset.max) || 360, el.dataset.type || 'image/jpeg');
      const cible = document.getElementById(el.dataset.cible);
      cible.value = url;
      cible.dispatchEvent(new Event('change', { bubbles: true }));
      const ap = document.getElementById(el.dataset.cible + '-ap');
      if (ap) u.poser(ap, html`<img src="${url}" alt="" style="height:64px;border-radius:8px;border:1px solid var(--line)">`);
      el.value = '';
    }
  });
  AK.actions.def({
    'image-retirer'(el) {
      const cible = document.getElementById(el.dataset.cible);
      cible.value = '';
      cible.dispatchEvent(new Event('change', { bubbles: true }));
      const ap = document.getElementById(el.dataset.cible + '-ap');
      if (ap) u.poser(ap, html`<span class="av lg" aria-hidden="true">${ic('image')}</span>`);
      el.remove();
    }
  });
})(window.AK);
