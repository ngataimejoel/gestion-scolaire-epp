/* =====================================================================================
   Mise en page des documents : feuille aux dimensions physiques, en-tête officiel, titre,
   signatures, bloc de vérification (QR), pied de page, pagination des longs tableaux
   (en-tête de tableau répété, signatures jamais orphelines), ajustement sur une page.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u;
  const S = () => AK.store.etat;
  const FORMATS = { A4: { l: 210, h: 297 }, A5: { l: 148, h: 210 } };

  const dims = (r) => {
    const f = FORMATS[r.page && r.page.papier] || FORMATS.A4;
    return r.page && r.page.orientation === 'paysage' ? { l: f.h, h: f.l } : { l: f.l, h: f.h };
  };

  /** En-tête officiel (lignes modifiables dans Paramètres › École). */
  function entete(r = {}) {
    const sc = S().school, e = r.entete || {};
    if (e.officiel === false) {
      return html`<div class="doc-entete${e.compact ? ' compact' : ''}"><div class="ge"><span class="ecole">${sc.name}</span>${sc.adresse || sc.telephone ? html`<span style="font-weight:400;text-transform:none">${[sc.adresse, sc.telephone].filter(Boolean).join(' · ')}</span>` : ''}</div><div class="dr"><span class="annee">Année scolaire ${sc.year || '…'}</span></div></div>`;
    }
    const logos = e.logos === false ? [] : [sc.logoIepp, sc.logoEcole].filter((x) => x && u.IMG_OK.test(x));
    const sep = raw('<span class="sep"></span>');
    return html`<div class="doc-entete${e.compact ? ' compact' : ''}"><div class="ge"><span>${sc.ministere}</span>${sep}<span>${sc.direction}</span>${sep}<span>${sc.inspection}</span>${sep}<span class="ecole">${sc.name}</span>${logos.length ? html`<span class="logos">${logos.map((x) => html`<img src="${x}" alt="">`)}</span>` : ''}</div>
      <div class="dr"><span class="rep">${sc.republique || AK.cfg.ENTETE.republique}</span><span class="devise">${sc.devise || AK.cfg.ENTETE.devise}</span>${e.armoiries === false ? '' : html`<img src="${sc.armoiries && u.IMG_OK.test(sc.armoiries) ? sc.armoiries : AK.assets.armoiries}" alt="Armoiries">`}<span class="annee">Année scolaire ${sc.year || '…'}</span></div></div>${e.ligneSup || sc.entete ? html`<div class="doc-entete-x">${e.ligneSup || sc.entete}</div>` : ''}`;
  }
  const titre = (t, sous, { cadre = false } = {}) => html`<div class="doc-titre${cadre ? ' cadre' : ''}"><h1>${t}</h1>${sous ? html`<div class="sous">${sous}</div>` : ''}${cadre ? '' : raw('<div class="filet"></div>')}</div>`;
  const infos = (paires, { une = false } = {}) => html`<div class="doc-infos${une ? ' une' : ''}">${paires.filter(Boolean).map(([l, v]) => html`<div class="c"><span class="l">${l} :</span><span class="v">${v || '—'}</span></div>`)}</div>`;
  const lieuDate = () => {
    const sc = S().school;
    return html`<div class="doc-fait">Fait à ${u.capitale(sc.localite || sc.sp || (String(sc.name).match(/EPP\s+(\S+)/i) || [, '……'])[1])}, le ${u.fmtDate(u.aujourdhui())}</div>`;
  };
  /** Signatures : zones vides pour signature manuscrite et cachet (jamais d'imitation). */
  function signatures(r, ctx) {
    const L = (r.signatures || []).filter((s) => s.role);
    if (!L.length) return '';
    return html`${r.lieuDate !== false ? lieuDate() : ''}<div class="doc-signatures" style="--n:${L.length};--h-sig:${r.hauteurSignature || 24}mm">${L.map((s) => html`<div class="doc-sig"><span class="role">${s.role}</span><span class="espace${s.cadre ? ' cadre' : ''}">${s.cachet ? raw('<span class="cachet">Cachet de l’établissement</span>') : ''}</span><span class="nom">${AK.modeles.texteJetons(s.nom, ctx)}</span></div>`)}</div>`;
  }
  /** Bloc de vérification : QR + référence + état de la signature électronique. */
  function verification(qrTexte, doc, taille = 22) {
    if (!qrTexte) return '';
    const cle = doc && doc.kid ? AK.cles.liste().find((c) => c.id === doc.kid) : null;
    return html`<div class="doc-verif"><div class="qr" style="width:${taille}mm;height:${taille}mm">${AK.qr.svg(qrTexte, { titre: 'QR code de vérification ' + (doc ? doc.ref : '') })}</div><div class="txt"><b>Document vérifiable</b><br>Réf. <span class="ref">${doc ? doc.ref : ''}</span><br>${cle ? html`Signé électroniquement (clé ${cle.id} · ${cle.empreinte})` : 'Contrôle par le registre de l’école'}<br>AKWA SCHOOL › Vérifier un document</div></div>`;
  }
  function pied(r, { ref, page, total, statut } = {}) {
    const sc = S().school, p = r.pied || {};
    const gauche = [p.reference !== false && ref ? `Réf. ${ref}` : '', statut ? '' : ''].filter(Boolean).join(' · ');
    return html`<div class="doc-pied"><span>${gauche}${statut ? html` · <span class="statut">${statut}</span>` : ''}</span><span class="m">${p.texte || [sc.adresse, sc.telephone, sc.email].filter(Boolean).join(' · ')}</span><span>${p.numeros !== false && total > 1 ? `Page ${page} / ${total}` : ''}</span></div>`;
  }

  /**
   * Feuille complète. o = { reglages, contenu (Html), statut (filigrane de statut), ref, page, total, classe }
   */
  function feuille(o) {
    const r = o.reglages, d = dims(r), m = (r.page && r.page.marges) || { h: 14, d: 14, b: 12, g: 14 };
    const paysage = r.page && r.page.orientation === 'paysage';
    const a5 = r.page && r.page.papier === 'A5';
    const st = o.statut ? AK.filigrane.libelleStatut(o.statut) : '';
    return html`<section class="feuille${paysage ? ' paysage' : ''}${a5 ? ' a5' : ''}${o.classe ? ' ' + o.classe : ''}" style="--mt:${m.h}mm;--mr:${m.d}mm;--mb:${m.b}mm;--ml:${m.g}mm;--doc-accent:${r.couleur || '#1f4e8c'}${a5 ? ';width:' + d.l + 'mm;height:' + d.h + 'mm' : ''}" data-l="${d.l}" data-h="${d.h}">${AK.filigrane.calques(r.filigrane, o.statut, d.l, d.h)}<div class="zone"><div class="corps">${o.contenu}</div>${o.sansPied ? '' : pied(r, { ref: o.ref, page: o.page || 1, total: o.total || 1, statut: st })}</div></section>`;
  }

  /* ---------- Mesure hors écran (mêmes styles que l'impression) ---------- */
  let mesureur = null;
  function zoneMesure(r) {
    if (!mesureur) {
      mesureur = document.createElement('div');
      mesureur.setAttribute('aria-hidden', 'true');
      mesureur.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout';
      document.body.appendChild(mesureur);
    }
    u.poser(mesureur, feuille({ reglages: r, contenu: '', ref: 'AK-XXX-0000-000000-X', total: 2 }));
    return mesureur.querySelector('.corps');
  }

  /**
   * Pagination d'un document « liste » : avant (en-tête, titre, infos), tableau (tête + lignes),
   * apres (récapitulatif, signatures : gardés ensemble sur la dernière page).
   * Renvoie la liste des contenus de page (Html).
   */
  function paginer(r, { avant = '', tete = '', lignes = [], apres = '', classeTab = 'doc-tab', suite = '' }) {
    const corps = zoneMesure(r);
    const max = corps.clientHeight;
    const pages = [];
    const tableau = (L) => (L.length ? html`<table class="${classeTab}"><thead>${tete}</thead><tbody>${L}</tbody></table>` : '');
    let courant = [];
    let entetePage = avant;
    const tient = (contenu) => {
      u.poser(corps, contenu);
      return corps.scrollHeight <= max + 1;
    };
    for (let i = 0; i < lignes.length; i++) {
      const essai = [...courant, lignes[i]];
      if (tient(html`${entetePage}${tableau(essai)}`)) courant = essai;
      else {
        if (!courant.length) {
          courant = [lignes[i]]; // ligne plus haute qu'une page : forcée
          pages.push(html`${entetePage}${tableau(courant)}`);
          courant = [];
        } else {
          pages.push(html`${entetePage}${tableau(courant)}`);
          courant = [lignes[i]];
        }
        entetePage = suite;
      }
    }
    // fin : tableau restant + bloc final ; si le bloc final ne tient pas, il passe seul page suivante
    if (tient(html`${entetePage}${tableau(courant)}${apres}`)) pages.push(html`${entetePage}${tableau(courant)}${apres}`);
    else {
      // garder au moins 3 lignes avec le bloc final pour éviter une page de signature seule
      let reste = [];
      while (courant.length > 3 && !tient(html`${suite}${tableau(reste)}${apres}`)) reste.unshift(courant.pop());
      while (courant.length > 0 && reste.length < 3) {
        reste.unshift(courant.pop());
        if (!tient(html`${suite}${tableau(reste)}${apres}`)) {
          courant.push(reste.shift());
          break;
        }
      }
      if (courant.length || entetePage !== suite) pages.push(html`${entetePage}${tableau(courant)}`);
      pages.push(html`${suite}${tableau(reste)}${apres}`);
    }
    u.poser(corps, '');
    return pages;
  }

  /**
   * Répartition de blocs (Html) sur des pages successives : un bloc n'est jamais coupé ;
   * « garder » : nombre de blocs finaux à garder ensemble (signatures avec la conclusion).
   */
  function decouper(r, blocs, { suite = '', garder = 1 } = {}) {
    const corps = zoneMesure(r);
    const max = corps.clientHeight;
    const tient = (L) => {
      u.poser(corps, L);
      return corps.scrollHeight <= max + 1;
    };
    const pages = [];
    let courant = [];
    const fin = blocs.length - garder;
    for (let i = 0; i < blocs.length; i++) {
      const lot = i === fin && garder > 1 ? blocs.slice(i) : [blocs[i]];
      const entete = pages.length ? [suite] : [];
      if (tient([...entete, ...courant, ...lot])) courant.push(...lot);
      else if (!courant.length) courant.push(...lot);
      else {
        pages.push(html`${entete}${courant}`);
        courant = [...lot];
      }
      if (lot.length > 1) break;
    }
    if (courant.length) pages.push(html`${pages.length ? suite : ''}${courant}`);
    u.poser(corps, '');
    return pages;
  }

  /** Mise à l'échelle d'un contenu pour tenir sur une seule page (réduction plafonnée à 72 %). */
  const ZMIN = 0.72;
  function ajuster(r, contenu) {
    const corps = zoneMesure(r);
    const max = corps.clientHeight, larg = corps.clientWidth;
    const essai = (z) => {
      u.poser(corps, html`<div class="ajuste-interne" style="width:${larg / z}px;transform:scale(${z})">${contenu}</div>`);
      return corps.firstElementChild.scrollHeight * z <= max + 1;
    };
    let z = 1;
    if (!essai(1)) {
      if (!essai(ZMIN)) z = ZMIN;
      else {
        let a = ZMIN, b = 1;
        for (let i = 0; i < 9; i++) {
          const c = (a + b) / 2;
          if (essai(c)) a = c;
          else b = c;
        }
        z = a;
      }
    }
    u.poser(corps, '');
    return { z, contenu: z < 0.999 ? html`<div class="ajuste-interne" style="width:${(100 / z).toFixed(3)}%;transform:scale(${z.toFixed(4)})">${contenu}</div>` : contenu, deborde: z <= ZMIN + 0.001 };
  }

  AK.mise = { FORMATS, dims, entete, titre, infos, lieuDate, signatures, verification, pied, feuille, paginer, decouper, ajuster, ZMIN };
})(window.AK);
