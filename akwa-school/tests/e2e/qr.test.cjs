/* Décodeur QR : génère des QR (moteur de l'application), les déforme (échelle, rotation,
   bruit, flou, perspective légère, erreurs injectées) puis vérifie le décodage exact. */
const { ouvrir, URL } = require('./outils.cjs');

(async () => {
  const { navigateur, page, erreurs } = await ouvrir();
  await page.goto(URL);
  await page.waitForFunction(() => window.AK && AK.qrdecode && AK.qr);
  const res = await page.evaluate(async () => {
    const charger = (svg) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const cas = [];
    const textes = [
      'AK-CEL-2026-000042-K',
      'AKS1;T=CEL;R=AK-CEL-2026-000042-7;E=2026-10-20;X=2027-07-31;H=ABCDEFGHJKLMNPQR;N=KONE AMINATA;M=12345678A;K=K1;S=' + 'A'.repeat(86),
      'Élève : KOUASSI Aÿ — 1234',
      '0123456789012345',
      'HELLO WORLD 123 $%*+-./:',
      'x'.repeat(300),
    ];
    const deformations = [
      { nom: 'net 4px', px: 4 },
      { nom: 'petit 2px', px: 2 },
      { nom: 'grand 9px rotation 17°', px: 9, rot: 17 },
      { nom: 'rotation 90°', px: 5, rot: 90 },
      { nom: 'rotation 200° + bruit', px: 5, rot: 200, bruit: 40 },
      { nom: 'flou + contraste faible', px: 6, flou: 1.2, gris: true },
      { nom: 'perspective', px: 6, persp: true },
      { nom: 'inversé', px: 5, inv: true },
      { nom: 'tache (≈8 % masqué)', px: 5, tache: true },
    ];
    for (const t of textes) {
      for (const d of deformations) {
        const svg = AK.qr.svg(t, { niveau: 'M' });
        const img = await charger(svg);
        const n = img.width || 200;
        const m = AK.vendor.qr.matrix(t, 'M').size + 8;
        const cote = m * d.px;
        const c = document.createElement('canvas');
        c.width = c.height = Math.round(cote * 1.8);
        const g = c.getContext('2d');
        g.fillStyle = d.inv ? '#000' : '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.save();
        g.translate(c.width / 2, c.height / 2);
        if (d.rot) g.rotate(d.rot * Math.PI / 180);
        if (d.persp) g.transform(1, 0.06, -0.08, 0.95, 0, 0);
        if (d.flou) g.filter = `blur(${d.flou}px)`;
        if (d.inv) g.filter = 'invert(1)';
        g.imageSmoothingEnabled = false;
        g.drawImage(img, -cote / 2, -cote / 2, cote, cote);
        g.restore();
        if (d.tache) { g.fillStyle = '#222'; const cx = c.width / 2, s2 = cote * 0.22; g.fillRect(cx + s2 * 0.2, cx + s2 * 0.4, s2 * 0.9, s2 * 0.6); }
        const id = g.getImageData(0, 0, c.width, c.height);
        if (d.gris || d.bruit) {
          let graine = 7;
          const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
          for (let i = 0; i < id.data.length; i += 4) {
            let v = id.data[i];
            if (d.gris) v = 90 + v * 0.4;
            if (d.bruit) v = Math.max(0, Math.min(255, v + (alea() - 0.5) * 2 * d.bruit));
            id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          }
        }
        let lu = null, err = null;
        const t0 = performance.now();
        try { lu = AK.qrdecode.decoder(id); } catch (e) { err = e.message; }
        cas.push({ texte: t.slice(0, 30), def: d.nom, ok: lu === t, lu: lu ? String(lu).slice(0, 40) : null, err, ms: Math.round(performance.now() - t0) });
      }
    }
    /* Correction d'erreurs : altération directe de modules (≤ capacité) */
    const t = 'AK-CEL-2026-000042-K';
    const mat = AK.vendor.qr.matrix(t, 'M');
    const rows = mat.rows.map((r) => r.slice());
    let k = 0;
    for (let y = 9; y < mat.size - 9 && k < 6; y += 3) { rows[y][mat.size - 3] = !rows[y][mat.size - 3]; k++; }
    let rs = null;
    try { rs = AK.qrdecode.decoderMatrice(rows); } catch (e) { rs = { err: e.message }; }
    /* Reed-Solomon au niveau des blocs : jusqu'à la capacité (nEc/2) d'octets faux, puis au-delà */
    const rsb = AK.vendor.qr.rsBlocks(5, 0)[0];
    const brut = AK.vendor.qr.matrix('X'.repeat(80), 'M');
    const essaisRS = [];
    for (const nb of [1, 6, 12, 13]) {
      const N = rsb.total, nEc = rsb.total - rsb.data;
      // mot de code valide : on le reconstruit par correction d'un bloc nul (toujours valide)
      const bloc = new Array(N).fill(0);
      const abime = bloc.slice();
      for (let i = 0; i < nb; i++) abime[(i * 7) % N] ^= (i * 37 + 11) & 255 || 1;
      let ok = false, err = null;
      try { ok = AK.qrdecode._interne.corriger(abime, nEc).every((x) => x === 0); } catch (e) { err = e.message; }
      essaisRS.push({ nb, capacite: nEc / 2, ok, err });
    }
    return { cas, essaisRS, rs: { ok: rs === t, lu: typeof rs === 'string' ? rs : null, err: rs && rs.err } };
  });
  let echecs = 0;
  for (const c of res.cas) {
    if (!c.ok) echecs++;
    console.log(`${c.ok ? 'OK   ' : 'ÉCHEC'} ${c.def.padEnd(26)} ${c.texte.padEnd(30)} ${c.ms} ms ${c.ok ? '' : (c.err || c.lu)}`);
  }
  console.log('Correction RS (6 modules altérés) :', JSON.stringify(res.rs));
  let rsKo = 0;
  for (const e of res.essaisRS) {
    const attendu = e.nb <= e.capacite;
    if (attendu !== e.ok) rsKo++;
    console.log(`RS bloc : ${e.nb} octet(s) faux / capacité ${e.capacite} → ${e.ok ? 'corrigé' : 'refusé (' + (e.err || 'résultat faux') + ')'} ${attendu === e.ok ? 'OK' : 'ÉCHEC'}`);
  }
  console.log(`${res.cas.length - echecs}/${res.cas.length} décodages exacts ; erreurs JS : ${erreurs.length ? erreurs.join(' | ') : 'aucune'}`);
  await navigateur.close();
  process.exit(echecs || rsKo || !res.rs.ok || erreurs.length ? 1 : 0);
})();
