/* =====================================================================================
   Blocs des rapports officiels (mêmes calculs que 1.7.0) : chaque tableau est une fonction,
   réutilisée par les rapports officiels, le générateur de rapports et les statistiques.
   Les zones à rédiger sont modifiables à l'écran et imprimées sous forme de texte.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, C = AK.cfg;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const T = 'doc-tab serre';
  const sx = (L) => X().compteSexe(L).map((v, i) => html`<td${i === 2 ? raw(' style="font-weight:800"') : ''}>${v}</td>`);
  const sxHead = (labels, premier) => html`<tr><th rowspan="2">${premier}</th>${labels.map((l) => html`<th colspan="3">${l}</th>`)}</tr><tr>${labels.map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr>`;
  const taux = (a, p) => X().compteSexe(a).map((v, i) => {
    const d = X().compteSexe(p)[i];
    return html`<td${i === 2 ? raw(' style="font-weight:800"') : ''}>${d ? Math.round((v / d) * 100) : '—'}</td>`;
  });

  /** Zone à rédiger : champ à l'écran (edit), texte à l'impression. */
  function zone(rap, cle, champ, titre, lignes = 3, edit = false) {
    const k = `${rap}|${cle}|${champ}`, v = S().redac[k] || '';
    return html`<div class="doc-zone">${titre ? html`<b>${titre}</b>` : ''}${edit ? html`<textarea rows="${lignes}" data-change="redac" data-input="redac-frappe" data-k="${k}" placeholder="À rédiger…" aria-label="${titre || 'Zone à rédiger'}">${v}</textarea>` : html`<div class="z" style="min-height:${lignes * 1.5}em">${v}</div>`}</div>`;
  }
  AK.actions.defChange({
    redac(el) {
      AK.store.modifier(null, (s) => (s.redac[el.dataset.k] = el.value.slice(0, 3000)), { rendu: el.type === 'number' });
    }
  });
  AK.actions.defSaisie({
    'redac-frappe'(el) {
      clearTimeout(el._t);
      el._t = setTimeout(() => AK.store.modifier(null, (s) => (s.redac[el.dataset.k] = el.value.slice(0, 3000)), { rendu: false }), 500);
    }
  });

  /* ---------- Personnel ---------- */
  function fonctStats() {
    const x = X(), ens = S().teachers.filter((t) => t.actif !== false && x.clsDe(t).length);
    const L = C.FONCTS.map(([k, l]) => ({ k, l, ens: ens.filter((t) => t.fonct === k) }));
    L.push({ k: '', l: 'Non renseigné', ens: ens.filter((t) => !t.fonct) });
    return L.filter((z) => z.k || z.ens.length);
  }
  function blocFonct(cls = T) {
    const L = fonctStats(), x = X();
    return html`<table class="${cls}"><thead><tr><th class="g">Type de fonctionnement</th>${L.map((z) => html`<th>${z.l}</th>`)}<th>Total</th></tr></thead><tbody><tr><td class="g">Nombre de classes</td>${L.map((z) => html`<td>${z.ens.length}</td>`)}<td><b>${L.reduce((a, z) => a + z.ens.length, 0)}</b></td></tr><tr><td class="g">Niveaux concernés</td>${L.map((z) => html`<td>${z.ens.map(x.clsTxt).join(' ; ') || '—'}</td>`)}<td></td></tr></tbody></table>`;
  }
  function blocEnseignants() {
    const x = X(), ens = S().teachers.filter((t) => t.actif !== false && (x.clsDe(t).length || /Instit/.test(t.fonction))), fem = ens.filter(x.estFemme).length;
    return html`<table class="${T}"><thead><tr><th>N°</th><th class="g">Nom et prénoms</th><th>Matricule</th><th>Fonction</th><th>Genre</th><th>Emploi / grade</th><th>Cours tenu</th><th>Fonctionnement</th><th>Contact</th></tr></thead><tbody>${ens.map((t, i) => html`<tr><td>${i + 1}</td><td class="nom">${t.nom}</td><td>${t.matricule}</td><td>${t.fonction}</td><td>${x.estFemme(t) ? 'F' : 'M'}</td><td>${x.emploiGrade(t)}</td><td>${x.clsTxt(t) || '—'}</td><td>${x.fonctTxt(t) || '—'}</td><td>${t.tel}</td></tr>`)}</tbody></table>
      <p class="doc-note">Personnel enseignant : <b>${ens.length}</b> dont <b>${fem}</b> femme(s).</p>${blocFonct()}`;
  }

  /* ---------- Effectifs, compositions ---------- */
  function blocEffectifs() {
    const x = X(), act = x.actifs(), nv = x.niveaux();
    const f = { nred: (c) => act.filter((s) => s.classe === c && !s.redoublant), red: (c) => act.filter((s) => s.classe === c && s.redoublant), tot: (c) => act.filter((s) => s.classe === c) };
    const ligne = (lib, g) => html`<tr><td><b>${lib}</b></td>${nv.map((c) => sx(g(c)))}${sx(nv.flatMap(g))}</tr>`;
    return html`<table class="${T}"><thead>${sxHead([...nv, 'TOTAL'], 'COURS')}</thead><tbody>${ligne('N.RED', f.nred)}${ligne('RED', f.red)}${ligne('TOTAL', f.tot)}</tbody></table><p class="doc-note">Contrôle : non redoublants + redoublants = ${act.length} = effectif inscrit.</p>`;
  }
  function blocCompo(n) {
    const x = X(), act = x.actifs(), nv = x.niveaux(), cls = (c) => act.filter((s) => s.classe === c);
    const M = [['INSCRITS', (L) => L], ['PRÉSENTS', (L) => L.filter((s) => !x.estAbsent(s.id, n) && x.moyEval(s, n) != null)], ['ABSENTS', (L) => L.filter((s) => x.estAbsent(s.id, n))], ['ADMIS', (L) => L.filter((s) => !x.estAbsent(s.id, n) && (x.moyEval(s, n) ?? -1) >= x.info(s.classe).seuil)]];
    const lignes = M.map(([lib, g]) => html`<tr><td><b>${lib}</b></td>${nv.map((c) => sx(g(cls(c))))}${sx(g(act))}</tr>`);
    return html`<table class="${T}"><thead>${sxHead([...nv, 'TOTAL'], '')}</thead><tbody>${lignes}<tr><td><b>TAUX D’ADMIS (%)</b></td>${[...nv.map(cls), act].map((L) => taux(M[3][1](L), M[1][1](L)))}</tr></tbody></table>
      <p class="doc-note">Admis : moyenne de la composition égale ou supérieure au seuil de la classe (5/10 du CP1 au CM1, 10/20 au CM2).</p>`;
  }
  function blocTop3(n) {
    const x = X();
    const L = x.niveaux().map((c) => {
      const w = x.classement(c, n).w.slice(0, 3);
      return html`<tr><td><b>${c}</b></td>${[0, 1, 2].map((i) => (w[i] ? html`<td class="nom">${x.nomComplet(w[i].s)}</td><td>${u.fmtNote(w[i].avg)}</td>` : html`<td></td><td></td>`))}</tr>`;
    });
    return html`<table class="${T}"><thead><tr><th rowspan="2"></th><th colspan="2">PREMIER</th><th colspan="2">DEUXIÈME</th><th colspan="2">TROISIÈME</th></tr><tr>${[0, 1, 2].map(() => html`<th>NOM ET PRÉNOMS</th><th>MOY</th>`)}</tr></thead><tbody>${L}</tbody></table>`;
  }
  const absMois = (L, mm) => Object.entries(S().att).filter(([d]) => d.startsWith(mm)).reduce((k, [, o]) => k + L.filter((s) => o[s.id]).length, 0);
  function blocFreq(m) {
    const x = X(), { mm, jours } = x.moisInfo(m), act = x.actifs();
    const ligne = (c) => {
      const ins = S().students.filter((s) => s.classe === c), ab = ins.filter((s) => s.statut !== 'Inscrit'), pr = ins.filter((s) => s.statut === 'Inscrit');
      const abs = absMois(pr, mm), t = pr.length && jours ? Math.max(0, 1 - abs / (pr.length * jours)) : null;
      return html`<tr><td><b>${c}</b></td>${sx(ins)}${sx(ab)}<td>${t == null ? '—' : (t * 100).toFixed(1).replace('.', ',')}</td><td class="g">${abs ? u.pluriel(abs, 'jour') + ' d’absence' : ''}</td></tr>`;
    };
    const a = absMois(act, mm);
    return html`<table class="${T}"><thead><tr><th rowspan="2">COURS</th><th colspan="3">EFFECTIFS / RENTRÉE</th><th colspan="3">ABANDONS</th><th rowspan="2">TAUX DE FRÉQUENTATION (%)</th><th rowspan="2">OBSERVATIONS</th></tr><tr>${[0, 1].map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr></thead>
      <tbody>${['PS', 'MS', 'GS'].map((c) => html`<tr><td><b>${c}</b></td>${raw('<td>—</td>'.repeat(6))}<td>—</td><td></td></tr>`)}${x.niveaux().map(ligne)}<tr><td><b>TOTAL</b></td>${sx(S().students)}${sx(S().students.filter((s) => s.statut !== 'Inscrit'))}<td>${act.length && jours ? (Math.max(0, 1 - a / (act.length * jours)) * 100).toFixed(1).replace('.', ',') : '—'}</td><td></td></tr></tbody></table>
      <p class="doc-note">Taux de fréquentation = 1 − jours d’absence ÷ (effectif présent × jours de classe du mois : ${jours}).</p>`;
  }
  function blocPersonnel(m) {
    const x = X(), { mm } = x.moisInfo(m);
    const absP = (t) => S().auth.filter((a) => a.pid === t.id && a.statut === 'Accordée').reduce((k, a) => k + x.joursClasse(a.du, a.au).filter((d) => d.startsWith(mm)).length, 0);
    return html`<table class="${T}"><thead><tr><th>N°</th><th class="g">Nom et prénoms</th><th>Cours tenu</th><th>Jours d’absence autorisés</th><th>Observations</th></tr></thead><tbody>${S().teachers.filter((t) => t.actif !== false).map((t, i) => html`<tr><td>${i + 1}</td><td class="nom">${t.nom}</td><td>${x.clsTxt(t) || '—'}</td><td>${absP(t)}</td><td></td></tr>`)}</tbody></table>`;
  }
  function blocEvalsMois(m) {
    const x = X(), { mm } = x.moisInfo(m);
    return html`<table class="${T}"><thead><tr><th>COURS</th><th>EFFECTIF</th><th>COMPOSÉS</th><th>MOYENNE</th><th>TAUX DE RÉUSSITE</th></tr></thead><tbody>${x.niveaux().map((c) => {
      const n = [1, 2, 3, 4].find((k) => x.evalDate(c, k).startsWith(mm)), L = x.actifsDe(c);
      if (!n) return html`<tr><td><b>${c}</b></td><td>${L.length}</td><td colspan="3">Pas d’évaluation ce mois</td></tr>`;
      const v = L.map((s) => x.score(s, n)).filter((z) => z != null);
      return html`<tr><td><b>${c}</b></td><td>${L.length}</td><td>${v.length}</td><td>${u.fmtNote(v.length ? u.moyenne(v) : null)} / ${x.echelle(c)}</td><td>${u.pct(v.filter((z) => z >= x.info(c).seuil).length, v.length)}</td></tr>`;
    })}</tbody></table>`;
  }
  function blocSynthese(edit) {
    const x = X(), nv = x.niveaux(), nouveaux = Number(S().redac['FIN||nouveauxCP1'] || 0);
    const D = (c) => {
      const ins = S().students.filter((s) => s.classe === c), pr = ins.filter((s) => s.statut === 'Inscrit');
      return { ins, pr, ab: ins.filter((s) => s.statut !== 'Inscrit'), adm: pr.filter((s) => x.decision(s) === 'Admis'), red: pr.filter((s) => x.decision(s) === 'Redoublant') };
    };
    const prob = (c) => {
      const i = C.TOUS_NIVEAUX.indexOf(c), prec = C.TOUS_NIVEAUX[i - 1];
      return D(c).red.length + (i === 0 ? nouveaux : prec && nv.includes(prec) ? D(prec).adm.length : 0);
    };
    const lignes = nv.map((c) => {
      const d = D(c);
      return html`<tr><td><b>${c}</b></td>${sx(d.ins)}${sx(d.pr)}<td>${d.ab.length}</td><td>${x.info(c).seuil}/${x.echelle(c)}</td>${sx(d.adm)}${taux(d.adm, d.pr)}${sx(d.red)}<td><b>${prob(c)}</b></td></tr>`;
    });
    const Tt = nv.map(D).reduce((a, d) => ({ ins: [...a.ins, ...d.ins], pr: [...a.pr, ...d.pr], ab: [...a.ab, ...d.ab], adm: [...a.adm, ...d.adm], red: [...a.red, ...d.red] }), { ins: [], pr: [], ab: [], adm: [], red: [] });
    return html`<table class="${T}"><thead><tr><th rowspan="2">COURS</th><th colspan="3">INSCRITS</th><th colspan="3">EFFECTIF PRÉSENT</th><th rowspan="2">ABAN-DONS</th><th rowspan="2">SEUIL MGA</th><th colspan="3">ADMIS</th><th colspan="3">TAUX D’ADMISSION (%)</th><th colspan="3">REDOUBLANTS</th><th rowspan="2">EFFECTIF PROBABLE ANNÉE SUIVANTE</th></tr><tr>${[0, 1, 2, 3, 4].map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr></thead>
      <tbody>${lignes}<tr><td><b>TOTAL</b></td>${sx(Tt.ins)}${sx(Tt.pr)}<td>${Tt.ab.length}</td><td></td>${sx(Tt.adm)}${taux(Tt.adm, Tt.pr)}${sx(Tt.red)}<td><b>${nv.reduce((k, c) => k + prob(c), 0)}</b></td></tr></tbody></table>
      <p class="doc-note">• Taux d’admission = admis ÷ effectif présent. • Effectif probable = redoublants + admis de la classe précédente ; CP1 = redoublants + nouveaux CP1 attendus (${edit ? html`<input type="number" min="0" max="999" value="${nouveaux}" data-change="redac" data-k="FIN||nouveauxCP1" style="width:60px" aria-label="Nouveaux CP1 attendus">` : nouveaux}). • Les admis du CM2 entrent en 6e.</p>`;
  }
  function blocDecisions() {
    const x = X();
    return html`<table class="${T}"><thead><tr><th>COURS</th>${C.DECISIONS.map((d) => html`<th>${d.toUpperCase()}</th>`)}<th>MGA INCOMPLÈTE</th></tr></thead><tbody>${x.niveaux().map((c) => {
      const pr = x.actifsDe(c);
      return html`<tr><td><b>${c}</b></td>${C.DECISIONS.map((d) => html`<td>${(d === 'Admis' || d === 'Redoublant' ? pr : S().students.filter((s) => s.classe === c)).filter((s) => x.decision(s) === d).length}</td>`)}<td>${pr.filter((s) => !x.decision(s)).length}</td></tr>`;
    })}</tbody></table>`;
  }
  function blocCM2() {
    const x = X(), L = S().students.filter((s) => s.classe === 'CM2').sort(x.parNom), { w } = x.classement('CM2', 'A'), pr = L.filter((s) => s.statut === 'Inscrit'), adm = pr.filter((s) => x.decision(s) === 'Admis');
    return html`<table class="${T}"><thead><tr><th>N°</th><th>Matricule</th><th class="g">Nom et prénoms</th><th>Sexe</th><th>Statut</th>${[1, 2, 3, 4].map((n) => html`<th>${x.evalLabel('CM2', n)} (/20)</th>`)}<th>MGA (/20)</th><th>Décision</th><th>Rang</th><th>Observation</th></tr></thead>
      <tbody>${L.map((s, i) => {
        const m = s.statut === 'Inscrit' ? x.mga(s) : null, r = w.find((z) => z.s.id === s.id), d = x.decision(s);
        return html`<tr><td>${i + 1}</td><td>${x.matOf(s)}</td><td class="nom">${x.nomComplet(s)}</td><td>${s.sexe ? s.sexe[0] : ''}</td><td>${s.statut === 'Inscrit' ? 'PRÉSENT' : s.statut.toUpperCase()}</td>${[1, 2, 3, 4].map((n) => html`<td>${s.statut !== 'Inscrit' ? '' : x.estAbsent(s.id, n) ? 'Abs.' : u.fmtNote(x.moyEval(s, n))}</td>`)}<td><b>${u.fmtNote(m)}</b></td><td>${(d || '').toUpperCase()}</td><td>${r ? x.rangTxt(r.rank) : ''}</td><td>${d === 'Admis' ? x.mention(m, 'CM2') : d === 'Redoublant' ? 'Insuffisant' : ''}</td></tr>`;
      })}</tbody></table>
      <p class="doc-note">Présents : <b>${pr.length}</b> (${x.compteSexe(pr)[0]} G, ${x.compteSexe(pr)[1]} F) · Admis en 6e : <b>${adm.length}</b> · Taux d’admission : <b>${u.pct(adm.length, pr.length)}</b>. MGA = moyenne des 4 évaluations (toutes saisies) ; admis si MGA ≥ 10/20.</p>`;
  }
  function blocResClasse(c, n) {
    const x = X(), M = x.matieres(c, n).slice().sort((a, b) => {
      const i = C.ORDRE_MAT.indexOf(a[0]), j = C.ORDRE_MAT.indexOf(b[0]);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
    });
    const L = x.actifsDe(c).sort(x.parNom), e = x.echelle(c), seuil = x.info(c).seuil;
    const lignes = L.map((s, i) => {
      const r = x.resultat(s, n), ab = x.estAbsent(s.id, n);
      return html`<tr><td>${i + 1}</td><td>${x.matOf(s)}</td><td class="nom">${x.nomComplet(s)}</td>${M.map(([m]) => html`<td>${ab ? '' : u.fmtSaisie(x.note(s.id, n, m))}</td>`)}<td>${ab ? '' : r ? u.fmtSaisie(r.total) : ''}</td><td><b>${ab ? 'Abs.' : r ? u.fmtNote(r.moy) : ''}</b></td><td>${ab ? 'Absent' : r ? (r.moy >= seuil ? x.mention(r.moy, c) : 'Insuffisant') : ''}</td></tr>`;
    });
    const pres = L.filter((s) => !x.estAbsent(s.id, n) && x.moyEval(s, n) != null), adm = pres.filter((s) => x.moyEval(s, n) >= seuil);
    const [ig, ifi, it] = x.compteSexe(L), [pg, pf, pt] = x.compteSexe(pres), [ag, af, at] = x.compteSexe(adm);
    const pc = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
    const recap = html`<table class="${T}"><thead><tr><th></th><th>Garçons</th><th>Filles</th><th>TOTAL</th></tr></thead><tbody><tr><td class="g"><b>Inscrits</b></td>${sx(L)}</tr><tr><td class="g"><b>Présents</b></td>${sx(pres)}</tr><tr><td class="g"><b>Absents</b></td>${sx(L.filter((s) => !pres.includes(s)))}</tr><tr><td class="g"><b>Taux de présence</b></td><td>${pc(pg, ig)}</td><td>${pc(pf, ifi)}</td><td><b>${pc(pt, it)}</b></td></tr><tr><td class="g"><b>Admis</b></td>${sx(adm)}</tr><tr><td class="g"><b>Non admis</b></td>${sx(pres.filter((s) => !adm.includes(s)))}</tr><tr><td class="g"><b>Taux d’admission</b></td><td>${pc(ag, pg)}</td><td>${pc(af, pf)}</td><td><b>${pc(at, pt)}</b></td></tr></tbody></table>`;
    return {
      table: html`<table class="${T}"><thead><tr><th>N°</th><th>MATRICULE</th><th class="g">NOM ET PRÉNOMS</th>${M.map(([m, w]) => html`<th>${C.MAT_COURT[m] || m}<br><span style="font-weight:400">/${x.noteMax(c, w)}</span></th>`)}<th>TOTAL</th><th>MOYENNE<br><span style="font-weight:400">/${e}</span></th><th>OBS</th></tr></thead><tbody>${lignes.length ? lignes : html`<tr><td colspan="${M.length + 6}">Aucun élève inscrit.</td></tr>`}</tbody></table>`,
      recap
    };
  }

  /* ---------- Âges et extraits ---------- */
  const groupes = () => {
    const nv = X().niveaux(), cp = nv.filter((c) => c === 'CP1' || c === 'CP2');
    return [...nv.map((c) => [c, [c]]), ...(cp.length ? [['Total CP', cp]] : []), ['Total école', nv]];
  };
  const tranche = (a) => (a == null ? null : a <= 5 ? '≤5' : a >= 13 ? '≥13' : String(a));
  function donneesAges() {
    const x = X(), act = x.actifs(), G = groupes();
    return C.BINS.map((b) => [b, ...G.flatMap(([, cl]) => x.compteSexe(act.filter((s) => cl.includes(s.classe) && tranche(x.ageDe(s)) === b)))]);
  }
  function tableAges(cls = 'doc-tab serre') {
    const G = groupes(), rows = donneesAges(), tot = G.flatMap((_, gi) => [0, 1, 2].map((k) => rows.reduce((n, r) => n + r[1 + gi * 3 + k], 0)));
    return html`<table class="${cls}"><thead><tr><th rowspan="2">Âge</th>${G.map(([l]) => html`<th colspan="3">${l}</th>`)}</tr><tr>${G.map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr><td><b>${r[0]} ans</b></td>${r.slice(1).map((v, i) => html`<td${i % 3 === 2 ? raw(' style="font-weight:800"') : ''}>${v || '·'}</td>`)}</tr>`)}</tbody><tfoot><tr><td>Total</td>${tot.map((v) => html`<td>${v}</td>`)}</tr></tfoot></table>`;
  }
  function tableExtraits(cls = 'doc-tab serre') {
    const x = X(), act = x.actifs(), cell = (cl, ex) => x.compteSexe(act.filter((s) => cl.includes(s.classe) && s.extrait === ex));
    return html`<table class="${cls}"><thead><tr><th rowspan="2">Niveau</th><th colspan="3">Avec extrait</th><th colspan="3">Sans extrait</th><th rowspan="2">Effectif</th></tr><tr>${[0, 1].map(() => html`<th>G</th><th>F</th><th>T</th>`)}</tr></thead><tbody>${groupes().map(([l, cl]) => {
      const a = cell(cl, true), b = cell(cl, false);
      return html`<tr${l.startsWith('Total') ? raw(' class="total"') : ''}><td class="g">${l}</td>${[...a, ...b].map((v) => html`<td>${v}</td>`)}<td><b>${a[2] + b[2]}</b></td></tr>`;
    })}</tbody></table>`;
  }

  /* ---------- Infrastructures ---------- */
  function infra() {
    const fus = (a, b) => {
      for (const k in b) {
        if (k === '__proto__') continue;
        const v = b[k];
        if (v && typeof v === 'object' && a[k] && typeof a[k] === 'object') fus(a[k], v);
        else a[k] = v;
      }
      return a;
    };
    return fus(u.clone(C.INFRA0), S().infra || {});
  }
  const iN = (v) => (v === '' || v == null ? null : Math.max(0, parseInt(v, 10) || 0));
  const iT = (v) => (v === '' || v == null ? '—' : String(v).replace('.', ','));
  const iL = (L, v) => (L.find((a) => a[0] === v) || [, '—'])[1];
  const iSom = (...v) => (v.some((z) => iN(z) != null) ? v.reduce((a, z) => a + (iN(z) || 0), 0) : null);
  const iRat = (a, b) => (a && b ? String(Math.round((a / b) * 10) / 10).replace('.', ',') : '—');
  const iNF = (n, f) => {
    const a = iN(n), b = iN(f);
    return [iT(n), iT(f), a != null && b != null ? Math.max(0, a - b) : '—'];
  };
  const iTab = (h, rows) => html`<table class="${T}">${h ? html`<thead><tr>${h.map((z) => html`<th>${z}</th>`)}</tr></thead>` : ''}<tbody>${rows.map((r) => html`<tr>${r.map((z, i) => (i ? html`<td>${z}</td>` : html`<td class="g"><b>${z}</b></td>`))}</tr>`)}</tbody></table>`;
  const iVide = (v) => html`<p class="doc-note">${v === 'non' ? 'Aucun à l’école.' : 'Non renseigné.'}</p>`;
  function sectionsInfra(I) {
    const x = X(), act = x.actifs(), eff = act.length, fil = act.filter((s) => s.sexe === 'Féminin').length, ens = S().teachers.filter((t) => t.actif !== false && x.clsDe(t).length).length, Tt = I.toil, E = I.eau, el = Tt.eleves;
    const sal = iSom(I.salles.agglo, I.salles.prov), tb = iN(I.mob.tb), bon = iN(I.mob.tbBon), cab = Tt.existe === 'oui' ? iN(el.fonct) : null;
    const sep = (o, a, b, cnt) => (o.sep === 'oui' ? `Oui (${a} / ${b}${cnt ? ` : ${iT(o.nf)} / ${iT(o.ng)}` : ''})` : iL(C.ON, o.sep));
    const nv = x.niveaux();
    const man = nv.map((c) => {
      const m = I.manuels[c] || {}, n = x.actifsDe(c).length;
      return [c, n, iT(m.lec), iRat(n, iN(m.lec)), iT(m.mat), iRat(n, iN(m.mat))];
    });
    const ml = iSom(...nv.map((c) => (I.manuels[c] || {}).lec)), mm = iSom(...nv.map((c) => (I.manuels[c] || {}).mat));
    const R = [['Élèves par salle de classe', iRat(eff, sal)], ['Élèves par enseignant', iRat(eff, ens)], ['Élèves par table-banc', iRat(eff, tb)], ['Élèves par cabine fonctionnelle', iRat(eff, cab)]];
    if (Tt.existe === 'oui' && el.sep === 'oui') R.push(['Filles par cabine des filles', iRat(fil, iN(el.nf))], ['Garçons par cabine des garçons', iRat(eff - fil, iN(el.ng))]);
    R.push(['Élèves par manuel de lecture', iRat(eff, ml)], ['Élèves par manuel de mathématiques', iRat(eff, mm)]);
    return [
      ['Bâtiments et salles de classe', iTab(['', 'En dur (agglos)', 'Matériaux provisoires', 'Total'], [['Bâtiments', iT(I.bat.agglo), iT(I.bat.prov), iT(iSom(I.bat.agglo, I.bat.prov))], ['Salles de classe', iT(I.salles.agglo), iT(I.salles.prov), iT(sal)]])],
      ['Toilettes', Tt.existe !== 'oui' ? iVide(Tt.existe) : iTab(['Pour', 'Type', 'Cabines', 'Fonctionnelles', 'Non fonctionnelles', 'Séparées'], [['Élèves', el.type || '—', ...iNF(el.n, el.fonct), sep(el, 'filles', 'garçons', 1)], ['Enseignants', Tt.ens.type || '—', ...iNF(Tt.ens.n, Tt.ens.fonct), sep(Tt.ens, 'hommes', 'femmes')]])],
      ['Points d’eau', E.existe !== 'oui' ? iVide(E.existe) : iTab(['Type', 'Nombre', 'Fonctionnels', 'Non fonctionnels'], [...C.EAUX.map(([k, l]) => [l, ...iNF(E[k].n, E[k].fonct)]), ['Total', ...iNF(iSom(...C.EAUX.map(([k]) => E[k].n)), iSom(...C.EAUX.map(([k]) => E[k].fonct)))]])],
      ['Électricité', iTab(null, [['Dans le village', iL(C.ON, I.elec.village)], ['À l’école', iL(C.ON, I.elec.ecole)], ['Dans les salles de classe', iL(C.ONP, I.elec.salles)]])],
      ['Logements des enseignants', iTab(null, [['Logements', I.loge.existe === 'oui' ? `Oui : ${iT(I.loge.n)}` : iL(C.ON, I.loge.existe)]])],
      ['Mobilier', iTab(null, [['Tables-bancs', iT(tb)], ['Dont en bon état', iT(bon)], ['Dont en mauvais état', tb != null && bon != null ? Math.max(0, tb - bon) : '—'], ['Bureaux de maître', iT(I.mob.bureaux)], ['Tableaux', iT(I.mob.tableaux)]])],
      ['Cantine scolaire', I.cant.existe !== 'oui' ? iVide(I.cant.existe) : iTab(null, [['Fonctionnelle', iL(C.ON, I.cant.fonct)], ['Rationnaires', iT(I.cant.ration)], ['Partenaire', I.cant.partenaire || '—']])],
      ['Autres locaux', iTab(null, C.LOCAUX.map(([k, l, p]) => [l, iL(p ? C.ONP : C.ON, I.locaux[k])]))],
      ['Manuels scolaires', iTab(['Niveau', 'Élèves', 'Manuels de lecture', 'Élèves par manuel', 'Manuels de mathématiques', 'Élèves par manuel'], [...man, ['Total', eff, iT(ml), iRat(eff, ml), iT(mm), iRat(eff, mm)]])],
      ['Accès et sécurité', iTab(null, [['Distance jusqu’à l’IEPP', I.acces.dist === '' ? '—' : `${iT(I.acces.dist)} km`], ['État de la route', iL(C.ROUTES, I.acces.route)], ['Réseau téléphone', iL(C.RESEAUX, I.acces.reseau)], ['Rampe pour handicapés', iL(C.ON, I.acces.rampe)], ['Boîte à pharmacie', iL(C.ON, I.acces.pharma)]])],
      ['Ratios', iTab(['Indicateur', 'Valeur'], R)]
    ];
  }
  /** Lecture du formulaire d'infrastructures : objet complet ou ErreurMetier. */
  function lireInfra(d) {
    const I = infra();
    Object.entries(d).forEach(([k, v]) => {
      const p = k.split('.');
      if (p.some((z) => z === '__proto__' || z === 'constructor')) return;
      let o = I;
      p.slice(0, -1).forEach((z) => (o = o[z] = o[z] || {}));
      o[p[p.length - 1]] = String(v).trim().slice(0, 40);
    });
    const L = [[I.toil.eleves, 'Toilettes des élèves', 'toil.eleves.fonct'], [I.toil.ens, 'Toilettes des enseignants', 'toil.ens.fonct'], ...C.EAUX.map(([k, l]) => [I.eau[k], l, `eau.${k}.fonct`])];
    for (const [o, l, ch] of L) if ((iN(o.fonct) || 0) > (iN(o.n) || 0)) throw new AK.ErreurMetier(`${l} : le nombre « dont fonctionnels » dépasse le nombre total.`, ch);
    const el = I.toil.eleves;
    if (el.sep === 'oui' && (iN(el.nf) || 0) + (iN(el.ng) || 0) > (iN(el.n) || 0)) throw new AK.ErreurMetier('Toilettes des élèves : cabines des filles et des garçons supérieures au total.', 'toil.eleves.nf');
    if ((iN(I.mob.tbBon) || 0) > (iN(I.mob.tb) || 0)) throw new AK.ErreurMetier('Tables-bancs : plus en bon état que le total.', 'mob.tbBon');
    I.maj = u.aujourdhui();
    return I;
  }

  AK.rapports = {
    zone, sx, sxHead, fonctStats, blocFonct, blocEnseignants, blocEffectifs, blocCompo, blocTop3, blocFreq, blocPersonnel, blocEvalsMois,
    blocSynthese, blocDecisions, blocCM2, blocResClasse, donneesAges, tableAges, tableExtraits, groupes, infra, sectionsInfra, lireInfra, iN, iT, iL, iSom, iRat
  };
})(window.AK);
