/* =====================================================================================
   Aperçu avant impression et impression.
   L'aperçu montre les vraies feuilles (dimensions physiques), réduites à l'écran.
   L'impression n'envoie que ces feuilles (zone #impression) : jamais les menus ni les boutons.

   PDF : le navigateur ne sait pas écrire un fichier PDF seul. Le bouton « PDF » ouvre la boîte
   d'impression où l'on choisit « Enregistrer au format PDF » (Chrome, Edge) ou « Microsoft
   Print to PDF » (Windows). Ce n'est pas présenté comme une génération directe de PDF.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui;
  const MM = 96 / 25.4;
  let enCours = false;
  let generation = 0; // contenu de la zone d'impression : vidée après impression seulement s'il n'a pas changé

  function zoneImpression() {
    let z = document.getElementById('impression');
    if (!z) {
      z = document.createElement('div');
      z.id = 'impression';
      z.className = 'zone-impression';
      document.body.appendChild(z);
    }
    return z;
  }
  async function attendreImages(racine) {
    const imgs = $$('img', racine).filter((i) => !i.complete).map((i) => new Promise((r) => (i.onload = i.onerror = r)));
    await Promise.race([Promise.all([...imgs, document.fonts ? document.fonts.ready : null]), u.attendre(4000)]);
  }
  /** Envoie des feuilles à l'imprimante (ou au PDF) sans aperçu. */
  async function imprimer(feuilles) {
    if (enCours) return;
    enCours = true;
    const z = zoneImpression();
    generation++;
    u.poser(z, feuilles);
    try {
      await attendreImages(z);
      const paysage = !!z.querySelector('.feuille.paysage');
      AK.hote.imprimer(paysage);
    } finally {
      enCours = false;
    }
  }
  addEventListener('afterprint', () => {
    const g = generation;
    setTimeout(() => g === generation && u.poser(zoneImpression(), ''), 300);
  });

  function ajusterZoom(racine, facteur) {
    const pages = $('.pages', racine);
    if (!pages) return;
    const dispo = pages.clientWidth - 8;
    $$('.feuille-cadre', racine).forEach((c) => {
      const f = c.firstElementChild;
      const l = Number(f.dataset.l || 210) * MM;
      const z = Math.min(facteur || 1, dispo / l);
      c.style.zoom = z.toFixed(4);
    });
  }

  /**
   * Aperçu : o = { titre, feuilles: [Html], resume, format, papier, avertissement, exporter: [{ lib, f }],
   *              copie: f (imprimer une copie), nomFichier,
   *              preparer: async () → { feuilles, resume } (appelée une fois avant la première impression :
   *              émission au registre ; les feuilles définitives remplacent alors l'aperçu) }
   */
  const pagesHtml = (F) => F.map((p, i) => html`<div class="feuille-cadre"><span class="num-page">Page ${i + 1} / ${F.length}</span>${p}</div>`);

  function apercu(o) {
    let facteur = 1;
    const n = o.feuilles.length;
    let prete = !o.preparer;
    /* Émission (une seule fois) puis remplacement de l'aperçu par les feuilles définitives. */
    const definitives = async (corps) => {
      if (prete) return o.feuilles;
      const r = await o.preparer();
      o.feuilles = r.feuilles;
      prete = true;
      u.poser($('.pages', corps), pagesHtml(o.feuilles));
      const res = $('[data-resume]', corps);
      if (res) res.textContent = r.resume || '';
      const bc = $('[data-copie]', corps.closest('dialog') || corps);
      if (bc) bc.hidden = false; // une copie n'a de sens qu'après l'émission de l'original
      requestAnimationFrame(() => ajusterZoom(corps));
      return o.feuilles;
    };
    const f = ui.fenetre({
      titre: o.titre || 'Aperçu avant impression', icone: 'print', taille: 'plein dlg-apercu', sansPied: true, proteger: false,
      corps: html`<div class="pile">
        <div class="barre-apercu">
          <span class="puce">${ic('file')}${u.pluriel(n, 'page')}${o.format ? ' · ' + o.format : ''}</span><span class="mut petit" data-resume>${o.resume || ''}</span>
          <span class="espace"></span>
          <div class="groupe-btn"><button type="button" class="btn btn-sm" data-z="-" aria-label="Réduire">${ic('zoomOut')}</button><button type="button" class="btn btn-sm" data-z="0" aria-label="Ajuster à la largeur">Ajuster</button><button type="button" class="btn btn-sm" data-z="+" aria-label="Agrandir">${ic('zoomIn')}</button></div>
          ${(o.exporter || []).map((x, i) => html`<button type="button" class="btn btn-sm" data-exp="${i}">${ic('down')}${x.lib}</button>`)}
          ${o.copie ? html`<button type="button" class="btn btn-sm" data-copie${o.preparer ? raw(' hidden') : ''} data-bulle="Même référence, mention COPIE">${ic('copy')}Imprimer une copie</button>` : ''}
          <button type="button" class="btn btn-sm" data-pdf data-bulle="${typeof AK.hote.exporterPdf === 'function' ? 'Enregistre un fichier PDF' : 'Ouvre la boîte d’impression : choisissez « Enregistrer au format PDF »'}">${ic('down')}PDF</button>
          <button type="button" class="btn btn-pri" data-imprimer>${ic('print')}Imprimer</button>
        </div>
        ${o.avertissement ? ui.encadre(o.avertissement, 'avert') : ''}
        <div class="apercu"><div class="pages">${pagesHtml(o.feuilles)}</div></div>
        <p class="mut petit mb0">${ic('info', 'i-sm')} Réglages d’impression conseillés : papier ${o.papier || 'A4'}, échelle 100 %, marges « Aucune » ou « Par défaut », « Graphiques d’arrière-plan » activé pour les couleurs et filigranes.</p>
      </div>`,
      apres(racine) {
        const corps = $('.dlg-corps', racine);
        requestAnimationFrame(() => ajusterZoom(corps));
        racine.addEventListener('click', async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.z) {
            facteur = b.dataset.z === '0' ? 1 : Math.max(0.3, Math.min(2, facteur * (b.dataset.z === '+' ? 1.2 : 1 / 1.2)));
            if (b.dataset.z === '0') ajusterZoom(corps);
            else $$('.feuille-cadre', corps).forEach((c) => (c.style.zoom = facteur.toFixed(3)));
          } else if (b.hasAttribute('data-pdf') && typeof AK.hote.exporterPdf === 'function') {
            // vrai fichier PDF produit par l'emballage natif (APK / .exe)
            const z = zoneImpression();
            try {
              generation++;
              u.poser(z, await definitives(corps));
              await attendreImages(z);
              const nom = (o.nomFichier || o.titre || 'document').replace(/[^\p{L}\p{N} _.-]+/gu, '_').slice(0, 80) + '.pdf';
              const ou = await AK.hote.exporterPdf(nom, !!z.querySelector('.feuille.paysage'));
              if (ou) ui.toast('PDF enregistré : ' + ou);
            } catch (err) {
              ui.erreur(err);
            } finally {
              u.poser(z, '');
            }
          } else if (b.hasAttribute('data-imprimer') || b.hasAttribute('data-pdf')) {
            if (b.hasAttribute('data-pdf')) ui.toast('Dans la fenêtre qui s’ouvre, choisissez l’imprimante « Enregistrer au format PDF » (ou « Microsoft Print to PDF »).', { type: 'attente', duree: 7000 });
            try {
              imprimer(await definitives(corps));
            } catch (err) {
              ui.erreur(err);
            }
          } else if (b.hasAttribute('data-copie')) {
            try {
              const copies = await o.copie();
              if (copies) imprimer(copies);
              else ui.toast('Copie impossible : document non inscrit au registre.', { type: 'avert' });
            } catch (err) {
              ui.erreur(err);
            }
          } else if (b.dataset.exp != null) {
            try {
              await o.exporter[+b.dataset.exp].f();
            } catch (err) {
              ui.erreur(err);
            }
          }
        });
        addEventListener('resize', () => ajusterZoom(corps), { once: true });
      }
    });
    return f;
  }

  AK.impression = { apercu, imprimer, zoneImpression, attendreImages };
})(window.AK);
