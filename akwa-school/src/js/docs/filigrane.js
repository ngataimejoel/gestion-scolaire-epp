/* =====================================================================================
   Filigranes : décoratifs (logo, nom de l'école, mention libre) et mentions de STATUT
   (COPIE, DUPLICATA, SPÉCIMEN, ANNULÉ, PROVISOIRE) déterminées par l'état réel du document.
   Dessinés en SVG sous le contenu : ils ne recouvrent ni la photo, ni le QR code, ni les
   signatures (blocs opaques au-dessus). Ce n'est PAS une protection cryptographique.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;

  /* Réglages par défaut d'un filigrane décoratif */
  const DEFAUT = { type: 'aucun', texte: '', opacite: 6, taille: 60, rotation: -32, position: 'centre', couleur: '#1f4e8c', repetition: false, logo: 'ecole', ecran: true, impression: true };
  const TYPES = [
    ['aucun', 'Aucun'],
    ['logo', 'Logo en arrière-plan'],
    ['nom', 'Nom de l’établissement en diagonale'],
    ['officiel', 'Mention « DOCUMENT OFFICIEL »'],
    ['texte', 'Texte personnalisé']
  ];
  /* Mentions de statut : imposées par l'état du document, non modifiables par un modèle */
  const STATUTS = {
    specimen: { texte: 'SPÉCIMEN', couleur: '#b2352c', opacite: 13 },
    annule: { texte: 'DOCUMENT ANNULÉ', couleur: '#b2352c', opacite: 15 },
    duplicata: { texte: 'DUPLICATA', couleur: '#555555', opacite: 11 },
    copie: { texte: 'COPIE', couleur: '#555555', opacite: 11 },
    provisoire: { texte: 'DOCUMENT PROVISOIRE', couleur: '#965803', opacite: 11 }
  };

  const borne = (v, a, b, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
  };
  /** Contrôle des réglages (valeurs bornées, couleur au format #rrggbb). */
  function normaliser(f) {
    const o = { ...DEFAUT, ...(f || {}) };
    if (!TYPES.some(([k]) => k === o.type)) o.type = 'aucun';
    o.texte = String(o.texte || '').slice(0, 60);
    o.opacite = borne(o.opacite, 2, 30, DEFAUT.opacite);
    o.taille = borne(o.taille, 20, 100, DEFAUT.taille);
    o.rotation = borne(o.rotation, -90, 90, DEFAUT.rotation);
    o.position = ['centre', 'haut', 'bas'].includes(o.position) ? o.position : 'centre';
    o.couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : DEFAUT.couleur;
    o.repetition = !!o.repetition;
    o.logo = ['ecole', 'iepp', 'armoiries', 'akwa'].includes(o.logo) ? o.logo : 'ecole';
    o.ecran = o.ecran !== false;
    o.impression = o.impression !== false;
    return o;
  }

  const imageLogo = (cle) => {
    const sc = AK.store.etat ? AK.store.etat.school : {};
    return cle === 'iepp' ? sc.logoIepp : cle === 'armoiries' ? sc.armoiries || AK.assets.armoiries : cle === 'akwa' ? AK.assets.logo : sc.logoEcole || AK.assets.logo;
  };

  /** Texte en diagonale ou répété ; largeur/hauteur en mm de la zone. */
  function svgTexte(t, { couleur, opacite, taille, rotation, position, repetition }, l, h) {
    const cx = l / 2, cy = position === 'haut' ? h * 0.3 : position === 'bas' ? h * 0.72 : h / 2;
    // taille demandée, plafonnée pour que le texte tienne entier dans la feuille selon l'angle
    const a = (Math.abs(rotation) * Math.PI) / 180;
    const demi = Math.min(Math.abs(Math.cos(a)) > 1e-6 ? l / 2 / Math.abs(Math.cos(a)) : Infinity, Math.abs(Math.sin(a)) > 1e-6 ? (position === 'centre' ? h / 2 : h * 0.28) / Math.abs(Math.sin(a)) : Infinity);
    const fs = Math.min((Math.min(l, h) * (taille / 100)) / Math.max(4, t.length * 0.55), repetition ? Infinity : (2 * demi * 0.8) / Math.max(1, t.length * 0.72));
    const style = `font-family:Arial,'Liberation Sans',sans-serif;font-weight:800;letter-spacing:${fs * 0.06}`;
    if (repetition) {
      const pas = fs * 4.2, lignes = [];
      for (let y = -h; y < h * 2; y += pas)
        for (let x = -l; x < l * 2; x += t.length * fs * 0.75 + fs * 2) lignes.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${(fs * 0.5).toFixed(2)}" style="${style}">${u.esc(t)}</text>`);
      return `<g fill="${couleur}" fill-opacity="${opacite / 100}" transform="rotate(${rotation} ${cx} ${cy})">${lignes.join('')}</g>`;
    }
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${fs.toFixed(2)}" fill="${couleur}" fill-opacity="${opacite / 100}" style="${style}" transform="rotate(${rotation} ${cx} ${cy})">${u.esc(t)}</text>`;
  }

  /**
   * Calques de filigrane d'une feuille (Html) : décoratif (réglages du modèle) puis statut.
   * l, h : dimensions de la feuille en mm.
   */
  function calques(reglages, statut, l, h) {
    const f = normaliser(reglages);
    const out = [];
    const sc = AK.store.etat ? AK.store.etat.school : {};
    const classes = (o) => `filigrane${o.ecran ? '' : ' fil-ecran-non'}${o.impression ? '' : ' fil-impr-non'}`;
    if (f.type !== 'aucun') {
      let corps = '';
      if (f.type === 'logo') {
        const src = imageLogo(f.logo);
        const t = Math.min(l, h) * (f.taille / 100);
        const y = f.position === 'haut' ? h * 0.3 - t / 2 : f.position === 'bas' ? h * 0.72 - t / 2 : (h - t) / 2;
        if (src && u.IMG_OK.test(src)) corps = `<image href="${src}" x="${(l - t) / 2}" y="${y}" width="${t}" height="${t}" opacity="${f.opacite / 100}" preserveAspectRatio="xMidYMid meet"/>`;
      } else {
        const t = f.type === 'nom' ? sc.name || 'AKWA SCHOOL' : f.type === 'officiel' ? 'DOCUMENT OFFICIEL' : f.texte;
        if (t) corps = svgTexte(t, f, l, h);
      }
      if (corps) out.push(`<div class="${classes(f)}" aria-hidden="true"><svg viewBox="0 0 ${l} ${h}" preserveAspectRatio="none">${corps}</svg></div>`);
    }
    const st = statut && STATUTS[statut];
    if (st) {
      const o = { couleur: st.couleur, opacite: st.opacite, taille: 92, rotation: -32, position: 'centre', repetition: false };
      out.push(`<div class="filigrane statut" aria-hidden="true"><svg viewBox="0 0 ${l} ${h}" preserveAspectRatio="none">${svgTexte(st.texte, o, l, h)}</svg></div>`);
    }
    return u.raw(out.join(''));
  }

  AK.filigrane = { DEFAUT, TYPES, STATUTS, normaliser, calques, libelleStatut: (s) => (STATUTS[s] ? STATUTS[s].texte : '') };
})(window.AK);
