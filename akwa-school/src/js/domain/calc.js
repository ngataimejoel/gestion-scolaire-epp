/* =====================================================================================
   Calculs scolaires (règles d'AKWA SCHOOL 1.7.0, inchangées) :
   âges, moyennes d'évaluation, MGA, rangs avec ex-aequo, décisions, seuils, effectifs.
   Fonctions pures sur l'état courant (AK.store.etat).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u;
  const S = () => AK.store.etat;

  /* ---------- Niveaux et grilles ---------- */
  /** Niveaux ouverts dans l'école, dans l'ordre CP1 → CM2. */
  const niveaux = () => {
    const n = (S() && S().school.niveaux) || [];
    const L = C.TOUS_NIVEAUX.filter((c) => n.includes(c));
    return L.length ? L : C.TOUS_NIVEAUX.slice();
  };
  /** Niveau suivant dans le cursus (CP1 → CP2…), indépendamment des niveaux ouverts ; null après le CM2. */
  const niveauSuivant = (c) => {
    const i = C.TOUS_NIVEAUX.indexOf(c);
    return i < 0 ? null : C.TOUS_NIVEAUX[i + 1] || null;
  };
  const info = (c) => C.CLASSE_INFO[c] || C.CLASSE_INFO.CP1;
  const grille = (c) => C.GRILLES[info(c).grille];
  const cpChoix = (c, n) => (S() && S().cpMat && S().cpMat[c] ? S().cpMat[c][n] : null);
  /** Matières d'une évaluation : [[matière, coefficient ou barème]] */
  function matieres(c, n) {
    const L = grille(c).mat(n);
    const ch = info(c).grille === 'CP' && cpChoix(c, n);
    if (!ch || !ch.length) return L;
    return [...L, ...(S().cpExtra || []).map((m) => [m, 1])].filter(([m]) => ch.includes(m));
  }
  const noteMax = (c, w) => (grille(c).mode === 'COEF' ? grille(c).max : w);
  const echelle = (c) => grille(c).echelle;
  const anneeRentree = () => parseInt(S() && S().school.year, 10) || new Date().getFullYear() - (new Date().getMonth() < 7 ? 1 : 0);
  const evalLabel = (c, n) => C.EVALUATIONS[info(c).cal][n - 1];
  const evalDate = (c, n) => {
    const [m, d, o] = C.EVAL_DATES[info(c).cal][n - 1];
    return `${anneeRentree() + o}-${u.pad(m)}-${u.pad(d)}`;
  };
  const perLabel = (p, c) => (p === 'A' ? 'Annuel (MGA)' : c ? evalLabel(c, p) : C.EV_GEN[p - 1]);

  /* ---------- Élèves ---------- */
  const actifs = () => S().students.filter((s) => s.statut === 'Inscrit');
  const actifsDe = (c) => actifs().filter((s) => s.classe === c);
  const parNom = (a, b) => (a.nom + ' ' + a.prenoms).localeCompare(b.nom + ' ' + b.prenoms, 'fr');
  const parClasse = (a, b) => C.TOUS_NIVEAUX.indexOf(a.classe) - C.TOUS_NIVEAUX.indexOf(b.classe) || parNom(a, b);
  const nomComplet = (s) => `${s.nom} ${s.prenoms}`.trim();
  /** Matricule imprimé : national (DESPS) s'il est connu, sinon celui de l'école */
  const matOf = (s) => s.matNat || s.mat || '';
  /** Âge au 1er octobre de l'année de rentrée */
  function ageDe(s) {
    if (!s.naissance) return null;
    const b = u.parseISO(s.naissance), r = new Date(anneeRentree(), 9, 1);
    let a = r.getFullYear() - b.getFullYear();
    if (r < new Date(r.getFullYear(), b.getMonth(), b.getDate())) a--;
    return a;
  }
  const ageAnormal = (s) => {
    const a = ageDe(s);
    return a != null && a - (C.AGE_NORMAL[s.classe] || 0) >= 3;
  };
  const fmtNaissance = (s) => (s.ageEstime && s.naissance ? `vers ${s.naissance.slice(0, 4)} (sans extrait)` : u.fmtDate(s.naissance));
  const estIvoirien = (s) => u.norm(s.nationalite || C.NAT_DEFAUT).startsWith('ivoir');
  const compteSexe = (L) => {
    const g = L.filter((s) => s.sexe === 'Masculin').length;
    return [g, L.length - g, L.length];
  };
  function initiales(p) {
    if (p.prenoms != null) return ((p.prenoms || '?')[0] + (p.nom || '?')[0]).toUpperCase();
    const w = AK.valid.civ.sans(p.nom || '?').split(' ').filter(Boolean);
    return ((w[0] || '?')[0] + ((w[1] || '')[0] || '')).toUpperCase();
  }

  /* ---------- Notes ---------- */
  const cle = (id, n, m) => `${id}|${n}|${m}`;
  const note = (id, n, m) => S().grades[cle(id, n, m)];
  const estAbsent = (id, n) => !!S().compAbs[id + '|' + n];
  /** Total et moyenne d'une évaluation. COEF : Σ note×coef ÷ Σ coef ; BARÈME : Σ notes ÷ Σ barèmes × échelle. Absent = 0. */
  function resultat(s, n) {
    if (estAbsent(s.id, n)) return { total: 0, moy: 0, abs: true };
    const L = matieres(s.classe, n).map(([m, w]) => [note(s.id, n, m), w]).filter(([v]) => v != null);
    if (!L.length) return null;
    const g = grille(s.classe), den = L.reduce((a, [, w]) => a + w, 0);
    if (g.mode === 'COEF') {
      const p = L.reduce((a, [v, w]) => a + v * w, 0);
      return { total: u.arrondi(p), moy: u.arrondi(p / den) };
    }
    const t = L.reduce((a, [v]) => a + v, 0);
    return { total: u.arrondi(t), moy: u.arrondi((t / den) * g.echelle) };
  }
  const moyEval = (s, n) => {
    const r = resultat(s, n);
    return r ? r.moy : null;
  };
  const moy3 = (s) => {
    const v = [1, 2, 3].map((n) => moyEval(s, n)).filter((x) => x != null);
    return v.length ? u.arrondi(u.moyenne(v)) : null;
  };
  /** MGA : CP1 à CM1 = (moyenne des 3 compositions + 2 × composition de passage) ÷ 3 ; CM2 = moyenne des 4 évaluations (toutes saisies) */
  function mga(s) {
    const m = [1, 2, 3, 4].map((n) => moyEval(s, n));
    if (info(s.classe).regle === 'MOYENNE4') return m.every((v) => v != null) ? u.arrondi(u.moyenne(m)) : null;
    const a = moy3(s);
    return a == null || m[3] == null ? null : u.arrondi((a + 2 * m[3]) / 3);
  }
  const score = (s, per) => (per === 'A' ? mga(s) : estAbsent(s.id, per) ? null : moyEval(s, per));
  /** Mention (note ramenée sur 10) */
  const mention = (v, c) => {
    if (v == null) return '—';
    const x = (v / echelle(c)) * 10;
    return x >= 8 ? 'Très bien' : x >= 7 ? 'Bien' : x >= 6 ? 'Assez bien' : x >= 5 ? 'Passable' : 'Insuffisant';
  };
  /** Classement d'une classe : { w : élèves classés (rang, ex-aequo), all : tous } */
  function classement(cls, per) {
    const L = actifsDe(cls).map((s) => ({ s, avg: score(s, per) }));
    const w = L.filter((x) => x.avg != null).sort((a, b) => b.avg - a.avg || parNom(a.s, b.s));
    w.forEach((x) => (x.rank = 1 + w.filter((o) => o.avg > x.avg).length));
    return { w, all: [...w, ...L.filter((x) => x.avg == null).sort((a, b) => parNom(a.s, b.s))] };
  }
  const rangTxt = (r) => (r ? r + (r === 1 ? 'er' : 'e') : '—');
  const moyClasse = (cls, per) => {
    const v = actifsDe(cls).map((s) => score(s, per)).filter((x) => x != null);
    return v.length ? u.arrondi(u.moyenne(v)) : null;
  };
  const reussite = (cls, per) => {
    const v = actifsDe(cls).map((s) => score(s, per)).filter((x) => x != null);
    return { n: v.length, ok: v.filter((x) => x >= info(cls).seuil).length };
  };
  const notesManquantes = (cls, n) =>
    actifs()
      .filter((s) => (!cls || s.classe === cls) && !estAbsent(s.id, n))
      .reduce((k, s) => k + matieres(s.classe, n).filter(([m]) => note(s.id, n, m) == null).length, 0);
  function decisionProposee(s) {
    if (s.statut !== 'Inscrit') return s.statut;
    const a = mga(s);
    return a == null ? '' : a >= info(s.classe).seuil ? 'Admis' : 'Redoublant';
  }
  const decision = (s) => s.decision || decisionProposee(s);

  /* ---------- Personnel et classes ---------- */
  const clsDe = (t) => (!t ? [] : Array.isArray(t.classes) && t.classes.length ? t.classes : t.classe ? [t.classe] : []);
  const clsTxt = (t) => clsDe(t).join(' / ');
  const enseignantDe = (c) => S().teachers.find((t) => t.actif !== false && clsDe(t).includes(c));
  const emploiGrade = (t) => [t.grade, t.echelon].filter(Boolean).join(' / ');
  const estFemme = (t) => /^(mme|mlle)/i.test(t.nom) || /ice$|rice|adjointe|Directrice/.test(t.fonction || '');
  const fonctTxt = (t) => (t.fonct === 'autre' ? t.fonctAutre || 'Autre' : (C.FONCTS.find((x) => x[0] === t.fonct) || [, ''])[1]);
  const fonctErr = (f, n, autre) =>
    !n ? ''
      : !f ? 'Choisissez d’abord le type de fonctionnement de la classe (simple, jumelée, multigrade ou autre).'
        : f === 'autre' && !String(autre || '').trim() ? 'Précisez le type de fonctionnement (Autre).'
          : f === 'simple' && n > 1 ? 'Une classe simple n’a qu’un niveau : choisissez jumelée ou multigrade.'
            : (f === 'jumelee' || f === 'multigrade') && n < 2 ? 'Une classe jumelée ou multigrade a au moins deux niveaux : cochez-les.'
              : f === 'jumelee' && n > 2 ? 'Une classe jumelée a deux niveaux ; au-delà, choisissez multigrade.' : '';

  /* ---------- Absences et calendrier ---------- */
  const estFerie = (d, cg) => (cg || S().conges).some((c) => d >= c.du && d <= (c.au || c.du));
  const estJourClasse = (d, cg) => C.JOURS_CLASSE.includes(u.parseISO(d).getDay()) && !estFerie(d, cg);
  function joursClasse(a, b, cg) {
    const r = [];
    if (!a || !b || b < a) return r;
    for (let d = a, k = 0; d <= b && k < 400; d = u.ajouterJours(d, 1), k++) if (estJourClasse(d, cg)) r.push(d);
    return r;
  }
  function derniersJoursClasse(n, fin, cg) {
    const r = [];
    let d = fin;
    for (let k = 0; r.length < n && k < 160; k++) {
      if (estJourClasse(d, cg)) r.unshift(d);
      d = u.ajouterJours(d, -1);
    }
    return r;
  }
  const absencesDe = (id) =>
    Object.entries(S().att).filter(([, m]) => m[id]).map(([d, m]) => ({ d, v: m[id] })).sort((a, b) => b.d.localeCompare(a.d));
  const moisCourant = () => {
    const m = new Date().getMonth() + 1;
    return C.JOURS_MOIS[m] ? m : 9;
  };
  const moisInfo = (m) => {
    const y = m >= 9 ? anneeRentree() : anneeRentree() + 1;
    return { y, mm: `${y}-${u.pad(m)}`, jours: C.JOURS_MOIS[m] || 0 };
  };

  AK.calc = {
    niveaux, niveauSuivant, info, grille, matieres, noteMax, echelle, anneeRentree, evalLabel, evalDate, perLabel,
    actifs, actifsDe, parNom, parClasse, nomComplet, matOf, ageDe, ageAnormal, fmtNaissance, estIvoirien, compteSexe, initiales,
    cle, note, estAbsent, resultat, moyEval, moy3, mga, score, mention, classement, rangTxt, moyClasse, reussite, notesManquantes,
    decisionProposee, decision,
    clsDe, clsTxt, enseignantDe, emploiGrade, estFemme, fonctTxt, fonctErr,
    estFerie, estJourClasse, joursClasse, derniersJoursClasse, absencesDe, moisCourant, moisInfo
  };
})(window.AK);
