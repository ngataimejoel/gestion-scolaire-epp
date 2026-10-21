/* =====================================================================================
   Tableau de données : recherche, tri, pagination, sélection, export CSV.
   Usage : AK.ui.tableau({ id, lignes, colonnes, recherche, filtres, parPage, selection, vide, exporter })
   Les colonnes : { cle, lib, rendu(o) → Html, tri(o) → valeur, cls, csv(o) → texte, cache }.
   Seule la partie « résultats » est redessinée lors d'une frappe : la saisie garde le focus.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, ic = AK.ic;
  const ui = AK.ui;
  const etats = new Map();
  const configs = new Map();

  const etatDe = (id, cfg) => {
    if (!etats.has(id)) etats.set(id, { q: '', tri: cfg && cfg.triDefaut ? { ...cfg.triDefaut } : null, page: 1, choix: new Set() });
    return etats.get(id);
  };

  function filtrer(cfg, st) {
    let L = cfg.lignes;
    const q = u.norm(st.q);
    if (q && cfg.recherche) L = L.filter((o) => u.norm(cfg.recherche(o)).includes(q));
    if (st.tri) {
      const col = cfg.colonnes.find((c) => c.cle === st.tri.cle);
      if (col && col.tri) {
        const k = st.tri.sens === 'desc' ? -1 : 1;
        L = L.slice().sort((a, b) => {
          const x = col.tri(a), y = col.tri(b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * k;
        });
      }
    }
    return L;
  }

  function resultats(cfg) {
    const st = etatDe(cfg.id, cfg);
    const L = filtrer(cfg, st);
    const parPage = cfg.parPage || 50;
    const pages = Math.max(1, Math.ceil(L.length / parPage));
    if (st.page > pages) st.page = pages;
    const vue = L.slice((st.page - 1) * parPage, st.page * parPage);
    const cols = cfg.colonnes.filter((c) => !c.cache);
    const cleId = cfg.cleId || ((o) => o.id);
    const toutCoche = vue.length > 0 && vue.every((o) => st.choix.has(cleId(o)));
    const nbChoix = st.choix.size;
    const entete = html`<tr>${cfg.selection ? html`<th class="col-choix"><input type="checkbox" aria-label="Tout sélectionner sur cette page" data-change="tab-tout" data-tab="${cfg.id}"${toutCoche ? raw(' checked') : ''}></th>` : ''}${cols.map((c) => {
      const trie = st.tri && st.tri.cle === c.cle;
      const aria = trie ? (st.tri.sens === 'desc' ? 'descending' : 'ascending') : null;
      return html`<th class="${c.cls || ''}"${aria ? html` aria-sort="${aria}"` : ''}>${c.tri ? html`<button type="button" class="tri" data-action="tab-tri" data-tab="${cfg.id}" data-cle="${c.cle}">${c.lib}${ic(trie ? (st.tri.sens === 'desc' ? 'chevD' : 'chevU') : 'sort', 'i-sm')}</button>` : c.lib}</th>`;
    })}</tr>`;
    const corps = vue.length
      ? vue.map((o) => {
        const k = cleId(o);
        const sel = st.choix.has(k);
        return html`<tr class="${sel ? 'choisi' : ''}"${cfg.attrsLigne ? ui.attrs(cfg.attrsLigne(o)) : ''}>${cfg.selection ? html`<td class="col-choix"><input type="checkbox" aria-label="Sélectionner" data-change="tab-choix" data-tab="${cfg.id}" data-k="${k}"${sel ? raw(' checked') : ''}></td>` : ''}${cols.map((c) => html`<td class="${c.cls || ''}">${c.rendu ? c.rendu(o) : o[c.cle] ?? ''}</td>`)}</tr>`;
      })
      : html`<tr><td colspan="${cols.length + (cfg.selection ? 1 : 0)}" style="white-space:normal">${cfg.vide || ui.vide('Aucun résultat', st.q ? 'Aucune ligne ne correspond à la recherche.' : '')}</td></tr>`;
    return html`${cfg.selection && nbChoix ? html`<div class="selection-barre" role="status">${ic('checkCircle')}${u.pluriel(nbChoix, 'élément sélectionné', 'éléments sélectionnés')}<span class="espace"></span>${cfg.actionsSelection ? cfg.actionsSelection([...st.choix]) : ''}<button type="button" class="btn btn-sm btn-ghost" data-action="tab-vider" data-tab="${cfg.id}">Désélectionner</button></div>` : ''}
      <div class="tab-cadre"${cfg.hauteur ? html` style="max-height:${cfg.hauteur}"` : ''}><table class="tab"${cfg.legende ? html` aria-label="${cfg.legende}"` : ''}><thead>${entete}</thead><tbody>${corps}</tbody>${cfg.pied ? html`<tfoot>${cfg.pied}</tfoot>` : ''}</table></div>
      ${pages > 1 ? html`<nav class="pagination" aria-label="Pagination"><span>${(st.page - 1) * parPage + 1}–${Math.min(L.length, st.page * parPage)} sur ${L.length}</span>
        <button type="button" class="btn btn-sm" data-action="tab-page" data-tab="${cfg.id}" data-p="${st.page - 1}"${st.page <= 1 ? raw(' disabled') : ''} aria-label="Page précédente">${ic('chevL')}</button>
        <span>Page ${st.page} / ${pages}</span>
        <button type="button" class="btn btn-sm" data-action="tab-page" data-tab="${cfg.id}" data-p="${st.page + 1}"${st.page >= pages ? raw(' disabled') : ''} aria-label="Page suivante">${ic('chev')}</button></nav>` : ''}`;
  }

  ui.tableau = function (cfg) {
    configs.set(cfg.id, cfg);
    const st = etatDe(cfg.id, cfg);
    const total = cfg.lignes.length;
    const nb = filtrer(cfg, st).length;
    return html`<div class="tab-zone" id="tz-${cfg.id}">${cfg.recherche || cfg.filtres || cfg.exporter ? html`<div class="barre-outils">${cfg.recherche ? html`<div class="recherche-tab">${ic('search')}<input class="inp" type="search" value="${st.q}" placeholder="${cfg.placeholder || 'Rechercher…'}" aria-label="${cfg.placeholder || 'Rechercher'}" data-input="tab-q" data-tab="${cfg.id}"></div>` : ''}${cfg.filtres || ''}<span class="compte-res" id="tc-${cfg.id}">${nb === total ? u.pluriel(total, cfg.unite || 'ligne') : `${nb} sur ${total}`}</span>${cfg.exporter ? html`<button type="button" class="btn btn-sm" data-action="tab-csv" data-tab="${cfg.id}">${ic('down')}Excel (CSV)</button>` : ''}</div>` : ''}<div id="tr-${cfg.id}">${resultats(cfg)}</div></div>`;
  };
  ui.tableauEtat = (id) => etatDe(id);
  ui.tableauChoix = (id) => [...etatDe(id).choix];
  ui.tableauViderChoix = (id) => etatDe(id).choix.clear();
  function redessiner(id) {
    const cfg = configs.get(id), z = document.getElementById('tr-' + id);
    if (!cfg || !z) return;
    u.poser(z, resultats(cfg));
    const c = document.getElementById('tc-' + id), st = etatDe(id), nb = filtrer(cfg, st).length;
    if (c) c.textContent = nb === cfg.lignes.length ? u.pluriel(nb, cfg.unite || 'ligne') : `${nb} sur ${cfg.lignes.length}`;
  }
  ui.tableauRedessiner = redessiner;

  const minuteries = new Map();
  AK.actions.defSaisie({
    'tab-q'(el) {
      const id = el.dataset.tab, st = etatDe(id);
      st.q = el.value;
      st.page = 1;
      clearTimeout(minuteries.get(id));
      minuteries.set(id, setTimeout(() => redessiner(id), 140));
    }
  });
  AK.actions.def({
    'tab-tri'(el) {
      const st = etatDe(el.dataset.tab), k = el.dataset.cle;
      st.tri = st.tri && st.tri.cle === k ? (st.tri.sens === 'asc' ? { cle: k, sens: 'desc' } : null) : { cle: k, sens: 'asc' };
      redessiner(el.dataset.tab);
    },
    'tab-page'(el) {
      etatDe(el.dataset.tab).page = Math.max(1, Number(el.dataset.p));
      redessiner(el.dataset.tab);
      const z = document.getElementById('tz-' + el.dataset.tab);
      if (z) z.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    'tab-vider'(el) {
      etatDe(el.dataset.tab).choix.clear();
      redessiner(el.dataset.tab);
    },
    async 'tab-csv'(el) {
      const cfg = configs.get(el.dataset.tab);
      if (!cfg) return;
      const L = filtrer(cfg, etatDe(cfg.id));
      const cols = cfg.colonnes.filter((c) => c.csv !== false);
      const txt = (v) => (v instanceof u.Html ? new DOMParser().parseFromString(String(v), 'text/html').body.textContent : v);
      const lignes = [cols.map((c) => c.lib), ...L.map((o) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(o) : c.tri ? c.tri(o) : txt(c.rendu ? c.rendu(o) : o[c.cle]))))];
      const nom = await AK.sauvegarde.csv(`${cfg.exporter}-${u.aujourdhui()}.csv`, lignes, cfg.libelleExport || cfg.legende || cfg.exporter);
      if (nom) ui.toast('Fichier Excel (CSV) enregistré');
    }
  });
  AK.actions.defChange({
    'tab-choix'(el) {
      const st = etatDe(el.dataset.tab);
      if (el.checked) st.choix.add(el.dataset.k);
      else st.choix.delete(el.dataset.k);
      redessiner(el.dataset.tab);
    },
    'tab-tout'(el) {
      const cfg = configs.get(el.dataset.tab), st = etatDe(el.dataset.tab);
      const parPage = cfg.parPage || 50, L = filtrer(cfg, st).slice((st.page - 1) * parPage, st.page * parPage);
      const cleId = cfg.cleId || ((o) => o.id);
      L.forEach((o) => (el.checked ? st.choix.add(cleId(o)) : st.choix.delete(cleId(o))));
      redessiner(el.dataset.tab);
    }
  });
})(window.AK);
