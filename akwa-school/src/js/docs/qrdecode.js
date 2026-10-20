/* =====================================================================================
   Lecture de QR codes à partir d'une image (caméra ou photo), entièrement hors ligne.
   Écrit pour AKWA SCHOOL (aucune bibliothèque téléchargeable) ; s'appuie sur les tables
   éprouvées de la bibliothèque de génération (blocs Reed-Solomon, codes BCH, masques).

   Étapes : niveaux de gris → seuillage adaptatif → repérage des trois motifs de position →
   motif d'alignement → transformation perspective → échantillonnage → format et version →
   démasquage → codes correcteurs (Reed-Solomon) → segments (numérique, alphanumérique, octets).
   Si l'API BarcodeDetector du navigateur existe, elle est essayée d'abord (plus rapide).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const Q = () => AK.vendor.qr;

  /* ---------- Image → matrice binaire ---------- */
  function binariser(img) {
    const { data, width: w, height: h } = img;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const seuils = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        let min = 255, max = 0, som = 0, n = 0;
        for (let y = by * B; y < Math.min(h, by * B + B); y++)
          for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
            const v = lum[y * w + x];
            som += v;
            n++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        let moy = som / n;
        if (max - min <= 24) {
          moy = min / 2;
          if (by > 0 && bx > 0) {
            const voisins = (seuils[(by - 1) * bw + bx] + 2 * seuils[by * bw + bx - 1] + seuils[(by - 1) * bw + bx - 1]) / 4;
            if (min < voisins) moy = voisins;
          }
        }
        seuils[by * bw + bx] = moy;
      }
    const noir = new Uint8Array(w * h);
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        let s = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const yy = by + dy, xx = bx + dx;
            if (yy >= 0 && xx >= 0 && yy < bh && xx < bw) {
              s += seuils[yy * bw + xx];
              n++;
            }
          }
        const t = s / n;
        for (let y = by * B; y < Math.min(h, by * B + B); y++)
          for (let x = bx * B; x < Math.min(w, bx * B + B); x++) noir[y * w + x] = lum[y * w + x] <= t ? 1 : 0;
      }
    return { w, h, noir, inverse: false, get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? noir[y * w + x] ^ (this.inverse ? 1 : 0) : 0; } };
  }

  /* ---------- Motifs de position (1:1:3:1:1) ---------- */
  function ratioOk(c, tol = 0.5) {
    const total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (total < 7) return false;
    const m = total / 7, v = m * tol;
    return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v;
  }
  const centreDe = (c, fin) => fin - c[4] - c[3] - c[2] / 2;
  function croiserVertical(M, cx, cy, maxCompte, total) {
    const c = [0, 0, 0, 0, 0];
    let y = cy;
    while (y >= 0 && M.get(cx, y)) { c[2]++; y--; }
    if (y < 0) return NaN;
    while (y >= 0 && !M.get(cx, y) && c[1] <= maxCompte) { c[1]++; y--; }
    if (y < 0 || c[1] > maxCompte) return NaN;
    while (y >= 0 && M.get(cx, y) && c[0] <= maxCompte) { c[0]++; y--; }
    if (c[0] > maxCompte) return NaN;
    y = cy + 1;
    while (y < M.h && M.get(cx, y)) { c[2]++; y++; }
    if (y === M.h) return NaN;
    while (y < M.h && !M.get(cx, y) && c[3] < maxCompte) { c[3]++; y++; }
    if (y === M.h || c[3] >= maxCompte) return NaN;
    while (y < M.h && M.get(cx, y) && c[4] < maxCompte) { c[4]++; y++; }
    if (c[4] >= maxCompte) return NaN;
    const t = c[0] + c[1] + c[2] + c[3] + c[4];
    if (5 * Math.abs(t - total) >= 2 * total) return NaN;
    return ratioOk(c) ? centreDe(c, y) : NaN;
  }
  function croiserHorizontal(M, cx, cy, maxCompte, total) {
    const c = [0, 0, 0, 0, 0];
    let x = cx;
    while (x >= 0 && M.get(x, cy)) { c[2]++; x--; }
    if (x < 0) return NaN;
    while (x >= 0 && !M.get(x, cy) && c[1] <= maxCompte) { c[1]++; x--; }
    if (x < 0 || c[1] > maxCompte) return NaN;
    while (x >= 0 && M.get(x, cy) && c[0] <= maxCompte) { c[0]++; x--; }
    if (c[0] > maxCompte) return NaN;
    x = cx + 1;
    while (x < M.w && M.get(x, cy)) { c[2]++; x++; }
    if (x === M.w) return NaN;
    while (x < M.w && !M.get(x, cy) && c[3] < maxCompte) { c[3]++; x++; }
    if (x === M.w || c[3] >= maxCompte) return NaN;
    while (x < M.w && M.get(x, cy) && c[4] < maxCompte) { c[4]++; x++; }
    if (c[4] >= maxCompte) return NaN;
    const t = c[0] + c[1] + c[2] + c[3] + c[4];
    if (5 * Math.abs(t - total) >= total) return NaN;
    return ratioOk(c) ? centreDe(c, x) : NaN;
  }
  function chercherMotifs(M) {
    const cands = [];
    const ajouter = (x, y, taille) => {
      const ex = cands.find((p) => Math.abs(p.x - x) <= taille && Math.abs(p.y - y) <= taille && Math.abs(p.m - taille) <= Math.max(1, p.m) * 0.7);
      if (ex) {
        ex.x = (ex.x * ex.n + x) / (ex.n + 1);
        ex.y = (ex.y * ex.n + y) / (ex.n + 1);
        ex.m = (ex.m * ex.n + taille) / (ex.n + 1);
        ex.n++;
      } else cands.push({ x, y, m: taille, n: 1 });
    };
    const pas = Math.max(1, Math.floor(M.h / 300));
    for (let y = 0; y < M.h; y += pas) {
      const c = [0, 0, 0, 0, 0];
      let etat = 0;
      for (let x = 0; x < M.w; x++) {
        const n = M.get(x, y);
        if (n) {
          if (etat & 1) etat++;
          c[etat]++;
        } else if (!(etat & 1)) {
          if (etat === 4) {
            if (ratioOk(c)) {
              const total = c[0] + c[1] + c[2] + c[3] + c[4];
              let cx = centreDe(c, x);
              const cy = croiserVertical(M, Math.floor(cx), y, c[2], total);
              if (!isNaN(cy)) {
                cx = croiserHorizontal(M, Math.floor(cx), Math.floor(cy), c[2], total);
                if (!isNaN(cx)) ajouter(cx, cy, total / 7);
              }
              c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0;
              etat = 3;
              continue;
            }
            c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0;
            etat = 3;
          } else c[++etat]++;
        } else c[etat]++;
      }
      if (ratioOk(c)) {
        const total = c[0] + c[1] + c[2] + c[3] + c[4];
        const cx = centreDe(c, M.w);
        const cy = croiserVertical(M, Math.floor(cx), y, c[2], total);
        if (!isNaN(cy)) ajouter(cx, cy, total / 7);
      }
    }
    return cands.filter((p) => p.n >= 2 || cands.length <= 3).sort((a, b) => b.n - a.n).slice(0, 12);
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  /** Choix de trois motifs formant un triangle rectangle isocèle ; renvoie [hautGauche, hautDroit, basGauche]. */
  function trier(cands) {
    let meilleur = null, score = Infinity;
    for (let i = 0; i < cands.length; i++)
      for (let j = i + 1; j < cands.length; j++)
        for (let k = j + 1; k < cands.length; k++) {
          const P = [cands[i], cands[j], cands[k]];
          const m = (P[0].m + P[1].m + P[2].m) / 3;
          if (P.some((p) => Math.abs(p.m - m) > m * 0.5)) continue;
          const d = [dist(P[1], P[2]), dist(P[0], P[2]), dist(P[0], P[1])];
          const h = d.indexOf(Math.max(...d)); // hypoténuse opposée au coin haut-gauche
          const a = P[h], b = P[(h + 1) % 3], c = P[(h + 2) % 3];
          const db = dist(a, b), dc = dist(a, c);
          if (db < m * 14 || dc < m * 14) continue; // au moins 21 modules : distance entre centres ≥ 14
          const s = Math.abs(db - dc) / Math.max(db, dc) + Math.abs(d[h] - Math.hypot(db, dc)) / d[h];
          if (s < score) {
            score = s;
            meilleur = [a, b, c];
          }
        }
    if (!meilleur || score > 0.35) return null;
    let [hg, b, c] = meilleur;
    const croix = (b.x - hg.x) * (c.y - hg.y) - (b.y - hg.y) * (c.x - hg.x);
    if (croix < 0) [b, c] = [c, b];
    return [hg, b, c];
  }

  /* ---------- Transformation perspective (carré → quadrilatère) ---------- */
  function carreVersQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
  }
  function adjointe(m) {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
    return [a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31, a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32, a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21];
  }
  function produit(a, b) {
    const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = a, [b11, b21, b31, b12, b22, b32, b13, b23, b33] = b;
    return [a11 * b11 + a21 * b12 + a31 * b13, a11 * b21 + a21 * b22 + a31 * b23, a11 * b31 + a21 * b32 + a31 * b33, a12 * b11 + a22 * b12 + a32 * b13, a12 * b21 + a22 * b22 + a32 * b23, a12 * b31 + a22 * b32 + a32 * b33, a13 * b11 + a23 * b12 + a33 * b13, a13 * b21 + a23 * b22 + a33 * b23, a13 * b31 + a23 * b32 + a33 * b33];
  }
  /* Quadrilatère source (coordonnées en modules) → quadrilatère image */
  function quadVersQuad(src, dst) {
    const q2s = adjointe(carreVersQuad(...src));
    const s2q = carreVersQuad(...dst);
    const m = produit(s2q, q2s);
    return (x, y) => {
      const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
      const d = a13 * x + a23 * y + a33;
      return [(a11 * x + a21 * y + a31) / d, (a12 * x + a22 * y + a32) / d];
    };
  }

  /* ---------- Motif d'alignement ---------- */
  function chercherAlignement(M, ex, ey, m) {
    const rayon = Math.ceil(m * 5);
    let meilleur = null, md = Infinity;
    for (let y = Math.max(0, Math.round(ey - rayon)); y <= Math.min(M.h - 1, Math.round(ey + rayon)); y++) {
      let x = Math.max(0, Math.round(ex - rayon));
      const xf = Math.min(M.w - 1, Math.round(ex + rayon));
      while (x <= xf) {
        if (!M.get(x, y)) { x++; continue; }
        let a = x;
        while (a <= xf && M.get(a, y)) a++;
        const noirL = a - x;
        if (noirL <= m * 1.8 && noirL >= m * 0.4) {
          // clair - noir - clair horizontal et vertical autour d'un module noir central
          const cx = (x + a - 1) / 2;
          const ok = (dx, dy) => {
            let l1 = 0, k = 1;
            while (k < m * 3 && !M.get(Math.round(cx + dx * (noirL / 2 + k)), Math.round(y + dy * (noirL / 2 + k)))) { l1++; k++; }
            return l1 >= m * 0.4 && l1 <= m * 1.8 && M.get(Math.round(cx + dx * (noirL / 2 + k)), Math.round(y + dy * (noirL / 2 + k)));
          };
          if (ok(1, 0) && ok(-1, 0) && ok(0, 1) && ok(0, -1)) {
            const d = Math.hypot(cx - ex, y - ey);
            if (d < md) {
              md = d;
              meilleur = { x: cx, y };
            }
          }
        }
        x = a;
      }
    }
    return meilleur;
  }

  /* ---------- Échantillonnage ---------- */
  function echantillonner(M, f, dim) {
    const m = [];
    for (let y = 0; y < dim; y++) {
      const L = [];
      for (let x = 0; x < dim; x++) {
        const [px, py] = f(x + 0.5, y + 0.5);
        L.push(M.get(Math.floor(px), Math.floor(py)) === 1);
      }
      m.push(L);
    }
    return m;
  }

  /* ---------- Lecture du contenu ---------- */
  const poids = (n) => {
    let c = 0;
    while (n) { c += n & 1; n >>>= 1; }
    return c;
  };
  function lireFormat(m) {
    const n = m.length;
    let a = 0, b = 0;
    for (let i = 0; i < 15; i++) {
      const v = i < 6 ? m[i][8] : i < 8 ? m[i + 1][8] : m[n - 15 + i][8];
      const hz = i < 8 ? m[8][n - i - 1] : i < 9 ? m[8][7] : m[8][14 - i];
      if (v) a |= 1 << i;
      if (hz) b |= 1 << i;
    }
    let meilleur = null, md = 99;
    for (let ec = 0; ec < 4; ec++)
      for (let mk = 0; mk < 8; mk++) {
        const code = Q().bchTypeInfo((ec << 3) | mk);
        const d = Math.min(poids(code ^ a), poids(code ^ b));
        if (d < md) {
          md = d;
          meilleur = { ec, masque: mk };
        }
      }
    return md <= 3 ? meilleur : null;
  }
  function lireVersion(m) {
    const n = m.length, v0 = (n - 17) / 4;
    if (v0 < 7) return v0;
    let a = 0, b = 0;
    for (let i = 0; i < 18; i++) {
      if (m[Math.floor(i / 3)][(i % 3) + n - 11]) a |= 1 << i;
      if (m[(i % 3) + n - 11][Math.floor(i / 3)]) b |= 1 << i;
    }
    let meilleur = v0, md = 99;
    for (let v = 7; v <= 40; v++) {
      const code = Q().bchTypeNumber(v), d = Math.min(poids(code ^ a), poids(code ^ b));
      if (d < md) {
        md = d;
        meilleur = v;
      }
    }
    return md <= 3 ? meilleur : v0;
  }
  function reserves(v) {
    const n = v * 4 + 17, R = Array.from({ length: n }, () => new Uint8Array(n));
    const zone = (r0, c0, h, l) => {
      for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + l; c++) if (r >= 0 && c >= 0 && r < n && c < n) R[r][c] = 1;
    };
    zone(0, 0, 9, 9);
    zone(0, n - 8, 9, 8);
    zone(n - 8, 0, 8, 9);
    for (let i = 0; i < n; i++) R[6][i] = R[i][6] = 1;
    const pos = Q().patternPosition(v);
    pos.forEach((r) => pos.forEach((c) => {
      const surFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (!surFinder) zone(r - 2, c - 2, 5, 5);
    }));
    if (v >= 7) {
      zone(0, n - 11, 6, 3);
      zone(n - 11, 0, 3, 6);
    }
    return R;
  }
  function lireOctets(m, v, masque) {
    const n = m.length, R = reserves(v), octets = [];
    let cur = 0, nb = 0, inc = -1, row = n - 1;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          const x = col - c;
          if (!R[row][x]) {
            let bit = m[row][x];
            if (Q().mask(masque, row, x)) bit = !bit;
            cur = (cur << 1) | (bit ? 1 : 0);
            if (++nb === 8) {
              octets.push(cur);
              cur = 0;
              nb = 0;
            }
          }
        }
        row += inc;
        if (row < 0 || row >= n) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
    return octets;
  }

  /* Reed-Solomon sur GF(256) (polynôme 0x11D, racines α^0 … α^(n-1)) */
  const mul = (a, b) => (a && b ? Q().gexp(Q().glog(a) + Q().glog(b)) : 0);
  const div = (a, b) => (a ? Q().gexp(Q().glog(a) - Q().glog(b) + 255) : 0);
  const pow = (k) => Q().gexp(((k % 255) + 255) % 255);
  function evalAsc(p, x) {
    let r = 0;
    for (let i = p.length - 1; i >= 0; i--) r = mul(r, x) ^ p[i];
    return r;
  }
  function corriger(bloc, nEc) {
    const N = bloc.length, S = [];
    let erreur = false;
    for (let j = 0; j < nEc; j++) {
      let s = 0;
      const a = pow(j);
      for (let k = 0; k < N; k++) s = mul(s, a) ^ bloc[k];
      S.push(s);
      if (s) erreur = true;
    }
    if (!erreur) return bloc;
    let C = [1], B = [1], L = 0, m = 1, b = 1;
    for (let n = 0; n < nEc; n++) {
      let d = S[n];
      for (let i = 1; i <= L; i++) d ^= mul(C[i] || 0, S[n - i]);
      if (d === 0) {
        m++;
        continue;
      }
      const coef = div(d, b), T = C.slice();
      const nouveau = C.slice();
      for (let i = 0; i < B.length; i++) {
        while (nouveau.length <= i + m) nouveau.push(0);
        nouveau[i + m] ^= mul(coef, B[i]);
      }
      C = nouveau;
      if (2 * L <= n) {
        L = n + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else m++;
    }
    const lambda = C.slice(0, L + 1);
    const positions = [];
    for (let i = 0; i < N; i++) if (evalAsc(lambda, pow(-i)) === 0) positions.push(i);
    if (positions.length !== L) throw new Error('trop d’erreurs');
    const omega = [];
    for (let i = 0; i < nEc; i++) {
      let v = 0;
      for (let j = 0; j <= i; j++) v ^= mul(S[j], lambda[i - j] || 0);
      omega.push(v);
    }
    const derivee = lambda.map((c, i) => (i & 1 ? c : 0)).slice(1);
    const r = bloc.slice();
    positions.forEach((i) => {
      const X = pow(i), Xi = pow(-i);
      const den = evalAsc(derivee, Xi);
      if (!den) throw new Error('correction impossible');
      const e = mul(X, div(evalAsc(omega, Xi), den));
      r[N - 1 - i] ^= e;
    });
    return r;
  }
  function desentrelacer(octets, v, ec) {
    const blocs = Q().rsBlocks(v, ec);
    const maxD = Math.max(...blocs.map((b) => b.data)), maxE = Math.max(...blocs.map((b) => b.total - b.data));
    const D = blocs.map(() => []), E2 = blocs.map(() => []);
    let k = 0;
    for (let i = 0; i < maxD; i++) blocs.forEach((b, r) => i < b.data && D[r].push(octets[k++]));
    for (let i = 0; i < maxE; i++) blocs.forEach((b, r) => i < b.total - b.data && E2[r].push(octets[k++]));
    const donnees = [];
    blocs.forEach((b, r) => {
      const c = corriger([...D[r], ...E2[r]], b.total - b.data);
      donnees.push(...c.slice(0, b.data));
    });
    return donnees;
  }
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function segments(octets, v) {
    let pos = 0;
    const lire = (n) => {
      let r = 0;
      for (let i = 0; i < n; i++) {
        const o = octets[pos >> 3];
        r = (r << 1) | (o == null ? 0 : (o >> (7 - (pos & 7))) & 1);
        pos++;
      }
      return r;
    };
    const lg = (mode) => {
      const t = v < 10 ? 0 : v < 27 ? 1 : 2;
      return { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16], 8: [8, 10, 12] }[mode][t];
    };
    const bytes = [];
    let texte = '';
    const viderOctets = () => {
      if (bytes.length) {
        texte += new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        bytes.length = 0;
      }
    };
    while (pos + 4 <= octets.length * 8) {
      const mode = lire(4);
      if (mode === 0) break;
      if (mode === 7) {
        const a = lire(8);
        if ((a & 0x80) && !(a & 0x40)) lire(8);
        else if ((a & 0xc0) === 0xc0) lire(16);
        continue;
      }
      if (![1, 2, 4, 8].includes(mode)) break;
      let n = lire(lg(mode));
      if (mode === 4) {
        while (n--) bytes.push(lire(8));
        continue;
      }
      viderOctets();
      if (mode === 1) {
        while (n >= 3) { texte += String(lire(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) texte += String(lire(7)).padStart(2, '0');
        else if (n === 1) texte += String(lire(4));
      } else if (mode === 2) {
        while (n >= 2) { const x = lire(11); texte += ALNUM[Math.floor(x / 45)] + ALNUM[x % 45]; n -= 2; }
        if (n === 1) texte += ALNUM[lire(6)];
      } else {
        while (n--) { const x = lire(13); const a = Math.floor(x / 0xc0), b = x % 0xc0; texte += String.fromCharCode(a * 0x100 + b); }
      }
    }
    viderOctets();
    return texte;
  }

  function decoderMatrice(m) {
    const f = lireFormat(m);
    if (!f) throw new Error('format illisible');
    const v = lireVersion(m);
    if (v < 1 || v > 40 || m.length !== v * 4 + 17) throw new Error('version incohérente');
    return segments(desentrelacer(lireOctets(m, v, f.masque), v, f.ec), v);
  }

  function essayer(M) {
    const P = trier(chercherMotifs(M));
    if (!P) return null;
    const [hg, hd, bg] = P;
    const m = (hg.m + hd.m + bg.m) / 3;
    let dim = Math.round((dist(hg, hd) / m + dist(hg, bg) / m) / 2) + 7;
    switch (dim & 3) {
      case 0: dim++; break;
      case 2: dim--; break;
      case 3: dim -= 2; break;
    }
    const dims = [dim, dim + 4, dim - 4].filter((d) => d >= 21 && d <= 177);
    for (const d of dims) {
      const bdx = hd.x - hg.x + bg.x, bdy = hd.y - hg.y + bg.y;
      const cands = [];
      if (d > 21) {
        const corr = 1 - 3 / (d - 7);
        const ax = hg.x + corr * (bdx - hg.x), ay = hg.y + corr * (bdy - hg.y);
        const al = chercherAlignement(M, ax, ay, m);
        if (al) cands.push(quadVersQuad([3.5, 3.5, d - 3.5, 3.5, d - 6.5, d - 6.5, 3.5, d - 3.5], [hg.x, hg.y, hd.x, hd.y, al.x, al.y, bg.x, bg.y]));
      }
      cands.push(quadVersQuad([3.5, 3.5, d - 3.5, 3.5, d - 3.5, d - 3.5, 3.5, d - 3.5], [hg.x, hg.y, hd.x, hd.y, bdx, bdy, bg.x, bg.y]));
      for (const f of cands) {
        try {
          return decoderMatrice(echantillonner(M, f, d));
        } catch (e) { /* stratégie suivante */ }
      }
    }
    return null;
  }

  /** Décode un QR code dans une image (ImageData) ; renvoie le texte ou null. */
  function decoder(img) {
    const M = binariser(img);
    let r = essayer(M);
    if (r == null) {
      M.inverse = true; // QR clair sur fond sombre
      r = essayer(M);
    }
    return r;
  }

  /** Image (fichier, vidéo, canvas) → ImageData réduite (côté ≤ max). */
  function imageData(source, max = 1000) {
    const w0 = source.videoWidth || source.naturalWidth || source.width, h0 = source.videoHeight || source.naturalHeight || source.height;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
  }
  let detecteur = null;
  async function lireSource(source) {
    if ('BarcodeDetector' in window) {
      try {
        detecteur = detecteur || new window.BarcodeDetector({ formats: ['qr_code'] });
        const r = await detecteur.detect(source);
        if (r && r[0] && r[0].rawValue) return r[0].rawValue;
      } catch (e) { /* lecteur intégré indisponible : décodeur AKWA */ }
    }
    for (const max of [1000, 640, 1600]) {
      const t = decoder(imageData(source, max));
      if (t != null) return t;
    }
    return null;
  }
  async function lireFichier(fichier) {
    const url = URL.createObjectURL(fichier);
    try {
      const im = new Image();
      await new Promise((ok, ko) => {
        im.onload = ok;
        im.onerror = () => ko(new AK.ErreurMetier('Image illisible.'));
        im.src = url;
      });
      return await lireSource(im);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  AK.qrdecode = { decoder, decoderMatrice, imageData, lireSource, lireFichier, _interne: { binariser, chercherMotifs, trier, corriger } };
})(window.AK);
