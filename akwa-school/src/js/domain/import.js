/* =====================================================================================
   Import des élèves depuis Excel (.xls des exports nationaux, .xlsx) ou CSV, sans bibliothèque.
   Lecteurs repris d'AKWA SCHOOL 1.7.0 (format BIFF8 et archive OOXML), entourés de contrôles :
   taille maximale, lignes vides, doublons (base et fichier), aperçu ligne par ligne avant import.
   Rattachement de l'espace d'un enseignant seul à l'école.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u, V = AK.valid, X = AK.calc;
  const S = () => AK.store.etat;
  const E = (m) => new AK.ErreurMetier(m);
  const TAILLE_MAX = 15 * 1024 * 1024;

  function parseCSV(t) {
    t = t.replace(/^﻿/, '');
    const first = t.split(/\r?\n/)[0] || '';
    const sep = first.split(';').length >= first.split(',').length ? ';' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"') {
          if (t[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) {
        row.push(cur);
        cur = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else cur += c;
    }
    if (cur || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  /* Excel 97-2003 (.xls) : conteneur OLE2 puis enregistrements BIFF8 ; première feuille. */
  function lireXLS(buf) {
    const uu = new Uint8Array(buf), dv = new DataView(buf), u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    if (u32(0) !== 0xe011cfd0) throw E('Ce fichier n’est pas un classeur .xls.');
    const ss = 1 << u16(30), mss = 1 << u16(32), nFat = u32(44), dir0 = u32(48), miniCut = u32(56), mfat0 = u32(60), difat0 = u32(68), nDifat = u32(72);
    const off = (s) => 512 + s * ss, difat = [];
    for (let i = 0; i < 109; i++) difat.push(u32(76 + i * 4));
    for (let d = difat0, k = 0; k < nDifat && d < 0xfffffffa; k++) {
      for (let i = 0; i < ss / 4 - 1; i++) difat.push(u32(off(d) + i * 4));
      d = u32(off(d) + ss - 4);
    }
    const fat = [];
    difat.slice(0, nFat).forEach((s) => {
      for (let i = 0; i < ss / 4; i++) fat.push(u32(off(s) + i * 4));
    });
    const chaine = (s, t) => {
      const r = [];
      for (let k = 0; s < 0xfffffffa && k < 1e6; k++) {
        r.push(s);
        s = t[s];
      }
      return r;
    };
    const gros = (s) => {
      const c = chaine(s, fat), o = new Uint8Array(c.length * ss);
      c.forEach((x, i) => o.set(uu.subarray(off(x), off(x) + ss), i * ss));
      return o;
    };
    const dirB = gros(dir0), dd = new DataView(dirB.buffer), ents = [];
    for (let p = 0; p + 128 <= dirB.length; p += 128) {
      const nl = dd.getUint16(p + 64, true);
      let n = '';
      for (let i = 0; i < nl / 2 - 1; i++) n += String.fromCharCode(dd.getUint16(p + i * 2, true));
      ents.push({ n, t: dirB[p + 66], s: dd.getUint32(p + 116, true), z: dd.getUint32(p + 120, true) });
    }
    const racine = ents[0], e = ents.find((x) => x.n === 'Workbook' || x.n === 'Book');
    if (!e) throw E('Classeur introuvable dans ce fichier .xls.');
    let wb;
    if (e.z < miniCut) {
      const ms = gros(racine.s), mfat = [];
      chaine(mfat0, fat).forEach((s) => {
        for (let i = 0; i < ss / 4; i++) mfat.push(u32(off(s) + i * 4));
      });
      const c = chaine(e.s, mfat);
      wb = new Uint8Array(c.length * mss);
      c.forEach((x, i) => wb.set(ms.subarray(x * mss, x * mss + mss), i * mss));
    } else wb = gros(e.s);
    wb = wb.subarray(0, e.z);
    const w = new DataView(wb.buffer, wb.byteOffset, wb.byteLength), w16 = (o) => w.getUint16(o, true);
    const recs = [];
    for (let p = 0; p + 4 <= wb.length;) {
      const t = w16(p), l = w16(p + 2);
      recs.push({ t, p: p + 4, l });
      p += 4 + l;
    }
    const sst = [], rows = [];
    let feuille = -1;
    const rk = (v) => {
      const x = v & 2 ? v >> 2 : (() => {
        const b = new DataView(new ArrayBuffer(8));
        b.setUint32(4, v & 0xfffffffc, true);
        return b.getFloat64(0, true);
      })();
      return v & 1 ? x / 100 : x;
    };
    const put = (r, c, v) => ((rows[r] || (rows[r] = []))[c] = v);
    const num = (x) => String(Math.round(x * 1e6) / 1e6);
    for (let i = 0; i < recs.length; i++) {
      const R = recs[i];
      if (R.t === 0x0809) {
        feuille++;
        if (feuille > 1) break;
        continue;
      }
      if (R.t === 0x00fc) {
        const parts = [R];
        for (let j = i + 1; j < recs.length && recs[j].t === 0x003c; j++) parts.push(recs[j]);
        let pi = 0, p = R.p + 8, fin = R.p + R.l;
        const n = w.getUint32(R.p + 4, true);
        const besoin = (k) => {
          if (p + k > fin && pi < parts.length - 1) {
            pi++;
            p = parts[pi].p;
            fin = p + parts[pi].l;
          }
        };
        for (let k = 0; k < n; k++) {
          besoin(3);
          const cch = w16(p);
          let fl = wb[p + 2];
          p += 3;
          let rt = 0, sz = 0;
          if (fl & 8) {
            rt = w16(p);
            p += 2;
          }
          if (fl & 4) {
            sz = w.getUint32(p, true);
            p += 4;
          }
          let s = '', reste = cch;
          while (reste > 0) {
            if (p >= fin) {
              pi++;
              p = parts[pi].p;
              fin = p + parts[pi].l;
              fl = wb[p];
              p++;
            }
            const large = fl & 1, peut = Math.min(reste, Math.floor((fin - p) / (large ? 2 : 1)));
            for (let q = 0; q < peut; q++) {
              s += String.fromCharCode(large ? w16(p) : wb[p]);
              p += large ? 2 : 1;
            }
            reste -= peut;
          }
          let saut = rt * 4 + sz;
          while (saut > 0) {
            if (p >= fin) {
              pi++;
              p = parts[pi].p;
              fin = p + parts[pi].l;
            }
            const t = Math.min(saut, fin - p);
            p += t;
            saut -= t;
          }
          sst.push(s);
        }
        continue;
      }
      if (feuille < 1) continue;
      if (R.t === 0x00fd) put(w16(R.p), w16(R.p + 2), sst[w.getUint32(R.p + 6, true)]);
      else if (R.t === 0x0203) put(w16(R.p), w16(R.p + 2), num(w.getFloat64(R.p + 6, true)));
      else if (R.t === 0x027e) put(w16(R.p), w16(R.p + 2), num(rk(w.getUint32(R.p + 6, true))));
      else if (R.t === 0x00bd) {
        const r = w16(R.p), c0 = w16(R.p + 2), n = (R.l - 6) / 6;
        for (let k = 0; k < n; k++) put(r, c0 + k, num(rk(w.getUint32(R.p + 4 + k * 6 + 2, true))));
      } else if (R.t === 0x0204) {
        const r = w16(R.p), c = w16(R.p + 2), n = w16(R.p + 6), large = wb[R.p + 8] & 1;
        let s = '';
        for (let k = 0; k < n; k++) s += String.fromCharCode(large ? w16(R.p + 9 + k * 2) : wb[R.p + 9 + k]);
        put(r, c, s);
      } else if (R.t === 0x0006) {
        const r = w16(R.p), c = w16(R.p + 2);
        if (w16(R.p + 12) !== 0xffff) put(r, c, num(w.getFloat64(R.p + 6, true)));
        else if (wb[R.p + 6] === 0 && recs[i + 1] && recs[i + 1].t === 0x0207) {
          const S2 = recs[i + 1], n = w16(S2.p), large = wb[S2.p + 2] & 1;
          let s = '';
          for (let k = 0; k < n; k++) s += String.fromCharCode(large ? w16(S2.p + 3 + k * 2) : wb[S2.p + 3 + k]);
          put(r, c, s);
        }
      }
    }
    return Array.from(rows, (r) => Array.from(r || [], (v) => (v == null ? '' : String(v))));
  }

  /* Excel 2007+ (.xlsx) : archive ZIP ; décompression par le navigateur (DecompressionStream). */
  async function lireXLSX(buf) {
    const uu = new Uint8Array(buf), dv = new DataView(buf);
    let e = uu.length - 22;
    while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e <= 0) throw E('Archive .xlsx illisible.');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const fichiers = {};
    for (let k = 0; k < n; k++) {
      const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      fichiers[new TextDecoder().decode(uu.subarray(p + 46, p + 46 + nl))] = { m, cs, lo };
      p += 46 + nl + xl + cl;
    }
    const lire = async (nom) => {
      const f = fichiers[nom];
      if (!f) return '';
      const q = f.lo, d = q + 30 + dv.getUint16(q + 26, true) + dv.getUint16(q + 28, true), brut = uu.subarray(d, d + f.cs);
      if (f.m === 0) return new TextDecoder().decode(brut);
      if (typeof DecompressionStream !== 'function') throw E('Ce navigateur ne sait pas ouvrir les .xlsx : enregistrez le fichier en .xls ou .csv.');
      return new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    };
    const X2 = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const sst = [...X2((await lire('xl/sharedStrings.xml')) || '<a/>').getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    const feuille = Object.keys(fichiers).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/), 10) - parseInt(b.match(/\d+/), 10))[0];
    if (!feuille) throw E('Aucune feuille dans ce classeur.');
    const rows = [];
    [...X2(await lire(feuille)).getElementsByTagName('c')].forEach((c) => {
      const ref = c.getAttribute('r'), m = ref && ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) return;
      const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +m[2] - 1, t = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0], v = vEl ? vEl.textContent : '';
      const val = t === 's' ? sst[+v] : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v;
      (rows[row] || (rows[row] = []))[col] = val;
    });
    return Array.from(rows, (r) => Array.from(r || [], (v) => (v == null ? '' : String(v))));
  }

  async function lireTableur(f) {
    if (f.size > TAILLE_MAX) throw E('Fichier trop volumineux (15 Mo au maximum).');
    const buf = await f.arrayBuffer(), t = new Uint8Array(buf.slice(0, 4));
    if (t[0] === 0xd0 && t[1] === 0xcf) return lireXLS(buf);
    if (t[0] === 0x50 && t[1] === 0x4b) return lireXLSX(buf);
    let s = new TextDecoder('utf-8').decode(buf);
    if (s.includes('�')) s = new TextDecoder('windows-1252').decode(buf);
    return parseCSV(s);
  }

  const vide0 = (v) => {
    v = String(v || '').trim();
    return /^(aucun|neant|néant|0)$/i.test(v) ? '' : v;
  };
  const coupeNom = (v) => {
    const p = vide0(v).split(/\s+/).filter(Boolean);
    return { nom: p[0] || '', prenoms: p.slice(1).join(' ') };
  };

  /** Analyse des lignes : chaque ligne devient { s, etat: 'ok'|'doublon'|'erreur', motif, ligne }. */
  function analyser(rows) {
    if (typeof rows === 'string') rows = parseCSV(rows);
    rows = rows.filter((r) => r.some((x) => String(x).trim()));
    if (rows.length < 2) return { erreur: 'Fichier vide ou sans ligne de données.' };
    if (rows.length > 5001) return { erreur: 'Plus de 5 000 lignes : découpez le fichier.' };
    const H = rows[0].map(u.norm), ix = (...n) => H.findIndex((h) => n.includes(h));
    const c = {
      nom: ix('nom'), pre: ix('prenoms', 'prenom'), cl: ix('niveau', 'classe'), sx: ix('sexe', 'genre'), na: ix('naissance', 'datedenaissance'),
      j: ix('jour'), m: ix('mois'), y: ix('annee'), mat: ix('matricule'), pa: ix('parent', 'tuteur', 'nomduparent'), tel: ix('telephone', 'tel'),
      ex: ix('extrait', 'dossier'), an: ix('nacte', 'actenum', 'numeroacte', 'ndelacte'), ad: ix('actedate', 'datedelacte'), ac: ix('lieuacte', 'centreetatcivil', 'centre'),
      nat: ix('nationalite'), lo: ix('localite', 'lieu', 'lieudenaissance'), sp: ix('sp', 'sousprefecture'), pe: ix('pere'), me: ix('mere'), re: ix('residence', 'domicile')
    };
    if (c.nom < 0 || c.pre < 0 || c.cl < 0 || c.sx < 0) return { erreur: 'Colonnes obligatoires manquantes : nom, prenoms, niveau (ou classe), sexe.' };
    const g = (r, k) => (c[k] >= 0 ? String(r[c[k]] ?? '') : '').trim();
    const mats = new Set(S().students.flatMap((o) => [u.norm(o.mat), u.norm(o.matNat)]).filter(Boolean)), vus = new Set();
    const niveaux = X.niveaux();
    return {
      items: rows.slice(1).map((r, i) => {
        const cl = g(r, 'cl').toUpperCase().replace(/\s/g, ''), sx = u.norm(g(r, 'sx'));
        const sexe = ['m', 'masculin', 'garcon', 'g', 'h', 'homme'].includes(sx) ? 'Masculin' : ['f', 'feminin', 'fille'].includes(sx) ? 'Féminin' : '';
        const na = c.y >= 0 && g(r, 'y') ? u.versISO(`${g(r, 'j')}/${g(r, 'm')}/${g(r, 'y')}`) : u.versISO(g(r, 'na'));
        const num = vide0(g(r, 'an')), exv = u.norm(g(r, 'ex')), ex = c.ex >= 0 && exv ? ['oui', '1', 'true', 'complet', 'x'].includes(exv) : !!num;
        const pe = coupeNom(g(r, 'pe')), me = coupeNom(g(r, 'me')), dom = vide0(g(r, 're'));
        const natRef = AK.ref.NATIONALITES.find((x) => u.norm(x[1]) === u.norm(g(r, 'nat')));
        const s = AK.schema.completerEleve({
          id: u.uid(), nom: u.majNom(g(r, 'nom')), prenoms: u.majPrenoms(g(r, 'pre')), classe: cl, sexe, naissance: na, ageEstime: false,
          matNat: g(r, 'mat').replace(/\s/g, '').toUpperCase(), lieu: vide0(g(r, 'lo')), nationalite: natRef ? natRef[1] : g(r, 'nat').toUpperCase() || C.NAT_DEFAUT,
          redoublant: false, mat: '', parent: g(r, 'pa'), tel: V.telPropre(g(r, 'tel')), extrait: ex,
          acte: { num, date: u.versISO(g(r, 'ad')), centre: vide0(g(r, 'ac')), sp: vide0(g(r, 'sp')) },
          pere: { nom: u.majNom(pe.nom), prenoms: u.majPrenoms(pe.prenoms), profession: '', tel: '', domicile: dom },
          mere: { nom: u.majNom(me.nom), prenoms: u.majPrenoms(me.prenoms), profession: '', tel: '', domicile: dom },
          statut: 'Inscrit', photo: '', decision: '', entree: '', inscritLe: u.aujourdhui()
        });
        let etat = 'ok', motif = '';
        const km = u.norm(s.matNat);
        if (!s.nom || !s.prenoms) [etat, motif] = ['erreur', 'nom ou prénoms manquant'];
        else if (V.nom(s.nom, 'Nom', 1) || V.nom(s.prenoms, 'Prénoms', 1)) [etat, motif] = ['erreur', 'nom ou prénoms illisible'];
        else if (!niveaux.includes(cl)) [etat, motif] = ['erreur', cl ? `classe ${cl} non ouverte` : 'classe manquante'];
        else if (!sexe) [etat, motif] = ['erreur', 'sexe illisible'];
        else if (s.matNat && V.matNat(s.matNat)) [etat, motif] = ['erreur', 'matricule national invalide'];
        else if (!AK.perm.peut('eleve.importer', { classe: cl })) [etat, motif] = ['erreur', 'classe hors de votre espace'];
        else if (km && mats.has(km)) [etat, motif] = ['doublon', 'matricule déjà présent'];
        else if (km && vus.has(km)) [etat, motif] = ['doublon', 'matricule en double dans le fichier'];
        else if (S().students.some((o) => u.norm(o.nom + o.prenoms) === u.norm(s.nom + s.prenoms) && (!s.naissance || o.naissance === s.naissance))) [etat, motif] = ['doublon', 'déjà inscrit'];
        if (!na && etat === 'ok') motif = 'date de naissance absente';
        if (km) vus.add(km);
        return { s, etat, motif, ligne: i + 2 };
      })
    };
  }

  const imports = {
    parseCSV, lireXLS, lireXLSX, lireTableur, analyser,
    async importer(analyse) {
      AK.perm.exiger('eleve.importer');
      const ok = analyse.items.filter((i) => i.etat === 'ok');
      if (!ok.length) throw E('Aucune ligne à importer.');
      await AK.store.copieAvant('avant-import');
      AK.store.modifier(`Import Excel : ${u.pluriel(ok.length, 'élève')}`, (st) => {
        ok.forEach((i) => {
          if (!i.s.mat) {
            i.s.mat = AK.eleves.prochainMatricule();
          }
          st.students.push(i.s);
        });
      }, { categorie: 'eleves' });
      return ok.length;
    },
    /** Le directeur rattache à l'école la sauvegarde d'un espace enseignant seul. */
    async rattacher(o) {
      AK.perm.exiger('donnees.rattacher');
      const src = AK.schema.assainir(o && o.donnees ? o.donnees : o);
      const m = src && src.school && src.school.solo && Array.isArray(src.students) && (src.teachers || []).find((z) => z.id === src.school.solo.tid);
      if (!m || !X.clsDe(m).length) throw E('Ce fichier n’est pas la sauvegarde d’un espace enseignant.');
      if (S().school.solo) throw E('Le rattachement se fait dans l’espace du directeur de l’école.');
      const classes = X.clsDe(m).filter((c) => X.niveaux().includes(c));
      if (!classes.length) throw E(`Les classes de cet espace (${X.clsTxt(m)}) ne sont pas ouvertes dans l’école.`);
      await AK.store.copieAvant('avant-rattachement');
      let nE = 0, nN = 0;
      AK.store.modifier(`Espace enseignant rattaché : ${m.nom} (${classes.join(', ')})`, (st) => {
        let ens = st.teachers.find((z) => u.norm(V.civ.sans(z.nom)) === u.norm(V.civ.sans(m.nom)));
        if (!ens) {
          ens = AK.schema.completerAgent({ ...m, id: u.uid(), compte: null, actif: true });
          st.teachers.push(ens);
        }
        st.teachers.forEach((z) => {
          if (z !== ens && X.clsDe(z).some((c) => classes.includes(c))) AK.personnel.poserClasses(z, X.clsDe(z).filter((k) => !classes.includes(k)));
        });
        AK.personnel.poserClasses(ens, [...X.clsDe(ens), ...classes]);
        const ids = {};
        src.students.forEach((s0) => {
          const s = AK.schema.completerEleve(s0);
          const k = st.students.find((z) => (s.matNat && z.matNat === s.matNat) || (u.norm(X.nomComplet(z)) === u.norm(X.nomComplet(s)) && z.classe === s.classe));
          if (k) ids[s.id] = k.id;
          else {
            const n = { ...s, id: u.uid(), mat: AK.eleves.prochainMatricule() };
            st.students.push(n);
            ids[s.id] = n.id;
            nE++;
          }
        });
        const cle = (k) => {
          const [a, ...r] = k.split('|');
          return ids[a] ? [ids[a], ...r].join('|') : null;
        };
        Object.entries(src.grades || {}).forEach(([k, v]) => {
          const n = cle(k);
          if (n && st.grades[n] == null && typeof v === 'number') {
            st.grades[n] = v;
            nN++;
          }
        });
        Object.keys(src.compAbs || {}).forEach((k) => {
          const n = cle(k);
          if (n) st.compAbs[n] = true;
        });
        Object.entries(src.att || {}).forEach(([d, L]) => Object.entries(L || {}).forEach(([id, v]) => {
          if (ids[id]) {
            const j = st.att[d] || (st.att[d] = {});
            if (j[ids[id]] == null) j[ids[id]] = v;
          }
        }));
        Object.entries(src.appel || {}).forEach(([d, L]) => classes.forEach((c) => {
          if (L && L[c]) (st.appel[d] || (st.appel[d] = {}))[c] = true;
        }));
        (src.auth || []).forEach((a) => {
          const pid = a.qui === 'eleve' ? ids[a.pid] : a.pid === m.id ? ens.id : '';
          if (!pid || st.auth.some((z) => z.id === a.id)) return;
          const n = st.auth.reduce((k, z) => Math.max(k, parseInt(String(z.ref).split('-').pop(), 10) || 0), 0) + 1;
          st.auth.push({ ...a, pid, ref: `AUT-${X.anneeRentree()}-${u.pad(n, 3)}` });
        });
        classes.forEach((c) => {
          if (src.cpMat && src.cpMat[c] && !st.cpMat[c]) st.cpMat[c] = src.cpMat[c];
        });
        st.cpExtra = [...new Set([...(st.cpExtra || []), ...(src.cpExtra || [])])];
      }, { categorie: 'donnees' });
      return { nom: m.nom, eleves: nE, notes: nN };
    }
  };
  AK.imports = imports;
})(window.AK);
