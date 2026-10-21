/* =====================================================================================
   QR codes des documents : contenu minimal, canonique et vérifiable.

   Format (version 1), champs dans cet ordre, séparés par « ; » :
     AKS1 ; T=<type> ; R=<référence> ; E=<émission AAAA-MM-JJ> ; X=<expiration> ; H=<empreinte>
          [; N=<NOM PRÉNOMS>] [; M=<matricule>] ; K=<clé> ; S=<signature>
   - Jamais de photo, de téléphone, de donnée médicale ni de détail d'acte de naissance.
   - N et M (nom et matricule, déjà imprimés sur le document) seulement si le modèle le prévoit
     (cartes d'identification par défaut) : ils permettent une vérification hors ligne sans base.
   - H : empreinte SHA-256 (80 bits, base 32) des données du titulaire au moment de l'émission.
   - S : signature ECDSA P-256 du texte qui précède « ;S= » (absente si aucune clé n'est créée).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;
  const PREFIXE = 'AKS1';
  const ORDRE = ['T', 'R', 'E', 'X', 'H', 'N', 'M', 'K'];

  /** Valeur sûre dans le QR : majuscules sans accents, sans « ; » ni « = ». */
  const propre = (v) => u.sansAccents(String(v || '')).toUpperCase().replace(/[;=\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

  /** Données canoniques du titulaire → empreinte H (texte de 16 caractères). */
  async function empreinteTitulaire(canon) {
    const t = ['type', 'ref', 'nom', 'prenoms', 'matricule', 'classe', 'annee', 'ecole', 'extra'].map((k) => propre(canon[k])).join('|');
    if (!AK.crypto.dispo()) return '';
    return AK.crypto.b32((await AK.crypto.sha256(t)).slice(0, 10));
  }

  /** Texte signé (sans la signature). */
  function message(c) {
    const parts = [PREFIXE];
    ORDRE.forEach((k) => {
      if (c[k] != null && c[k] !== '') parts.push(`${k}=${k === 'R' ? String(c[k]).toUpperCase() : propre(c[k])}`);
    });
    return parts.join(';');
  }
  function texte(c) {
    const m = message(c);
    return c.S ? `${m};S=${c.S}` : m;
  }
  /** Lecture tolérante (espaces, minuscules, saisie au clavier) ; null si ce n'est pas un QR AKWA. */
  function lire(brut) {
    let s = String(brut || '').trim();
    try {
      if (/%[0-9A-F]{2}/i.test(s)) s = decodeURIComponent(s);
    } catch (e) { /* texte laissé tel quel */ }
    const i = s.toUpperCase().indexOf(PREFIXE + ';');
    if (i < 0) return null;
    s = s.slice(i);
    const champs = {};
    const morceaux = s.split(';');
    for (const p of morceaux.slice(1)) {
      const k = p.indexOf('=');
      if (k < 1) continue;
      const cle = p.slice(0, k).trim().toUpperCase();
      champs[cle] = p.slice(k + 1).trim();
    }
    if (!champs.T || !champs.R) return null;
    const sansSig = { ...champs };
    delete sansSig.S;
    return { champs, message: message(sansSig), signature: champs.S || null };
  }

  /** Emplacement réservé dans un aperçu : le vrai QR (référence, signature) est créé à l'impression. */
  const BROUILLON = '@brouillon';
  const SVG_BROUILLON = u.raw('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="QR code créé à l’impression"><rect x="1" y="1" width="38" height="38" rx="2" fill="#fff" stroke="#8a94a6" stroke-width=".8" stroke-dasharray="2 1.6"/><path d="M6 6h9v9H6zM25 6h9v9h-9zM6 25h9v9H6z" fill="none" stroke="#8a94a6" stroke-width="1.4"/><text x="20" y="22" font-size="4.2" text-anchor="middle" fill="#5c687a" font-family="sans-serif">QR</text><text x="27" y="31" font-size="3.2" text-anchor="middle" fill="#5c687a" font-family="sans-serif">à l’impression</text></svg>');

  /** Matrice → SVG vectoriel (zone de silence de 4 modules), net à toutes les tailles. */
  function svg(texteQR, { niveau = 'M', titre = 'QR code' } = {}) {
    if (texteQR === BROUILLON) return SVG_BROUILLON;
    const m = AK.vendor.qr.matrix(texteQR, niveau);
    const n = m.size;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (m.rows[r][c]) {
          let l = 1;
          while (c + l < n && m.rows[r][c + l]) l++;
          d += `M${c + 4} ${r + 4}h${l}v1h-${l}z`;
          c += l;
        } else c++;
      }
    }
    const t = n + 8;
    return u.raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="${u.esc(titre)}"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`);
  }

  AK.qr = { PREFIXE, BROUILLON, propre, empreinteTitulaire, message, texte, lire, svg };
})(window.AK);
