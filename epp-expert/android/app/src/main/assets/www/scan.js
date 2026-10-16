/* AKWA SCHOOL – remise en ordre du texte lu sur une photo (scan).
 *
 * Le téléphone lit la photo (Scan.java : lignes de texte avec leur position). Ce module la restructure :
 *  - feuille de notes : tableau élève × matière, rapproché de la liste de la classe (noms comparés sans accents,
 *    lettres manquantes tolérées), colonnes repérées par les titres des matières, notes contrôlées (0 à la note
 *    maximale) ; une valeur douteuse est signalée, jamais enregistrée sans vérification ;
 *  - extrait de naissance : champs de l'inscription (nom et prénoms, sexe, date et lieu de naissance, parents).
 * Aucune dépendance : testé sur l'ordinateur avec Node (outils/test_scan.js).
 */
(function (racine) {
  "use strict";

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ").trim();
  }
  function mots(s) { return norm(s).split(" ").filter(function (m) { return m.length > 1; }); }

  /** Distance d'édition (lettres mal lues). */
  function distance(a, b) {
    if (a === b) { return 0; }
    var p = [], i, j;
    for (j = 0; j <= b.length; j++) { p[j] = j; }
    for (i = 1; i <= a.length; i++) {
      var prec = p[0];
      p[0] = i;
      for (j = 1; j <= b.length; j++) {
        var t = p[j];
        p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
        prec = t;
      }
    }
    return p[b.length];
  }
  function motProche(a, b) {
    if (a === b) { return true; }
    if (a.length < 4 || b.length < 4) { return false; }
    return distance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
  }
  /** Part des mots du nom attendu retrouvés dans le texte lu (0 à 1). */
  function ressemblance(attendu, lu) {
    var a = mots(attendu), l = mots(lu);
    if (!a.length || !l.length) { return 0; }
    var n = 0;
    a.forEach(function (m) { if (l.some(function (x) { return motProche(m, x); })) { n++; } });
    return n / a.length;
  }

  /** Nombre lu (virgule ou point, « 12/20 » → 12) ; lettres souvent confondues corrigées. */
  function nombre(t) {
    var s = String(t || "").trim().replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/,/g, ".");
    s = s.split("/")[0];
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) { return null; }
    return parseFloat(s);
  }

  function centre(b) { return { x: (b.x || 0) + (b.w || 0) / 2, y: (b.y || 0) + (b.h || 0) / 2 }; }
  function mediane(l) {
    if (!l.length) { return 0; }
    var s = l.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  /**
   * Feuille de notes.
   * eleves : [{iid, nom}] ; matieres : [{id, libelle, max}].
   * Renvoie {lignes: [{iid, nom, trouve, notes: {id: {v, douteux}}}], colonnes: n repérées, absents: [noms non lus]}.
   */
  function structurerNotes(ocr, eleves, matieres) {
    var lignes = (ocr && ocr.lignes) || [];
    var hauteur = mediane(lignes.map(function (l) { return l.h || 0; })) || 20;
    // 1. colonnes : titre de chaque matière
    var colonnes = {};
    matieres.forEach(function (m) {
      var meilleur = null, score = 0;
      lignes.forEach(function (l) {
        (l.mots && l.mots.length ? l.mots.concat([l]) : [l]).forEach(function (b) {
          var a = norm(m.libelle), t = norm(b.t);
          if (!t || nombre(b.t) !== null) { return; }
          var s = t === a ? 1 : (a.indexOf(t) === 0 && t.length >= 3) ? 0.8 : ressemblance(m.libelle, b.t);
          if (s > score) { score = s; meilleur = b; }
        });
      });
      if (meilleur && score >= 0.6) { colonnes[m.id] = centre(meilleur).x; }
    });
    // 2. lignes : nom de chaque élève
    var pris = {};
    var sortie = eleves.map(function (e) {
      var meilleure = null, score = 0;
      lignes.forEach(function (l, i) {
        if (pris[i]) { return; }
        var s = ressemblance(e.nom, l.t);
        if (s > score) { score = s; meilleure = i; }
      });
      var r = { iid: e.iid, nom: e.nom, trouve: false, notes: {} };
      if (meilleure === null || score < 0.5) { return r; }
      pris[meilleure] = true;
      var ln = lignes[meilleure], y = centre(ln).y, fin = (ln.x || 0) + (ln.w || 0);
      r.trouve = true;
      // 3. nombres de la même ligne, à droite du nom
      var nums = [];
      lignes.forEach(function (l) {
        (l.mots && l.mots.length ? l.mots : [l]).forEach(function (b) {
          var c = centre(b), v = nombre(b.t);
          if (v !== null && Math.abs(c.y - y) <= hauteur * 0.7 && c.x > fin - 2) { nums.push({ v: v, x: c.x }); }
        });
      });
      nums.sort(function (a, b) { return a.x - b.x; });
      var libres = nums.slice();
      var connues = matieres.filter(function (m) { return colonnes[m.id] !== undefined; });
      if (connues.length >= Math.ceil(matieres.length / 2)) {
        var pas = mediane(connues.map(function (m, i) {
          return i ? Math.abs(colonnes[m.id] - colonnes[connues[i - 1].id]) : 0;
        }).filter(Boolean)) || hauteur * 4;
        matieres.forEach(function (m) {
          if (colonnes[m.id] === undefined) { return; }
          var k = -1, d = pas * 0.6;
          libres.forEach(function (n, i) { var e2 = Math.abs(n.x - colonnes[m.id]); if (e2 <= d) { d = e2; k = i; } });
          if (k >= 0) { r.notes[m.id] = { v: libres[k].v }; libres.splice(k, 1); }
        });
      } else {
        matieres.forEach(function (m, i) { if (nums[i]) { r.notes[m.id] = { v: nums[i].v }; } });
      }
      matieres.forEach(function (m) {
        var n = r.notes[m.id];
        if (n && !(n.v >= 0 && n.v <= m.max)) { n.douteux = true; }
      });
      return r;
    });
    return {
      lignes: sortie, colonnes: Object.keys(colonnes).length,
      absents: sortie.filter(function (r) { return !r.trouve; }).map(function (r) { return r.nom; })
    };
  }

  // ------------------------------------------------------------------ extrait de naissance
  var MOIS = ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE",
    "NOVEMBRE", "DECEMBRE"];
  var UNITES = { UN: 1, UNE: 1, PREMIER: 1, DEUX: 2, TROIS: 3, QUATRE: 4, CINQ: 5, SIX: 6, SEPT: 7, HUIT: 8, NEUF: 9,
    DIX: 10, ONZE: 11, DOUZE: 12, TREIZE: 13, QUATORZE: 14, QUINZE: 15, SEIZE: 16, VINGT: 20, TRENTE: 30,
    QUARANTE: 40, CINQUANTE: 50, SOIXANTE: 60, CENT: 100, MIL: 1000, MILLE: 1000 };
  function p2(n) { return (n < 10 ? "0" : "") + n; }

  /** « DEUX MIL QUINZE » → 2015, « VINGT ET UN » → 21. */
  function nombreEnLettres(liste) {
    var total = 0, courant = 0, vu = false;
    liste.forEach(function (m) {
      if (m === "ET") { return; }
      var v = UNITES[m];
      if (v === undefined) { return; }
      vu = true;
      if (v === 1000) { total += (courant || 1) * 1000; courant = 0; }
      else if (v === 100) { courant = (courant || 1) * 100; }
      else if (v === 20 && courant % 100 === 4) { courant = courant - 4 + 80; }   // quatre-vingt
      else { courant += v; }
    });
    return vu ? total + courant : null;
  }

  /** Première date du texte (chiffres ou lettres), en ISO. */
  function date(texte) {
    var t = norm(texte), m = /\b(\d{1,2}) (\d{1,2}) ((?:19|20)\d{2})\b/.exec(t);
    if (m) { return m[3] + "-" + p2(+m[2]) + "-" + p2(+m[1]); }
    var ms = t.split(" ");
    for (var i = 0; i < ms.length; i++) {
      var k = MOIS.indexOf(ms[i]);
      if (k < 0) { continue; }
      var avant = ms.slice(Math.max(0, i - 4), i), jour = null;
      if (/^\d{1,2}$/.test(avant[avant.length - 1] || "")) { jour = +avant[avant.length - 1]; }
      else {
        for (var a = avant.length - 1; a >= 0 && (UNITES[avant[a]] !== undefined || avant[a] === "ET"); a--) { /* mots du jour */ }
        jour = nombreEnLettres(avant.slice(a + 1));
      }
      var apres = ms.slice(i + 1, i + 7), an = null;
      if (/^(19|20)\d{2}$/.test(apres[0] || "")) { an = +apres[0]; }
      else {
        var fin = 0;
        while (fin < apres.length && (UNITES[apres[fin]] !== undefined || apres[fin] === "ET")) { fin++; }
        an = nombreEnLettres(apres.slice(0, fin));
      }
      if (jour >= 1 && jour <= 31 && an >= 1990 && an <= 2100) { return an + "-" + p2(k + 1) + "-" + p2(jour); }
    }
    return null;
  }

  function apres(lignes, re) {
    for (var i = 0; i < lignes.length; i++) {
      var m = re.exec(lignes[i]);
      if (m) {
        var reste = lignes[i].slice(m.index + m[0].length).replace(/^[\s:.\-–]+/, "").trim();
        return reste || (lignes[i + 1] || "").trim();
      }
    }
    return "";
  }
  function propre(s) {
    return String(s || "").replace(/[^A-Za-zÀ-ÿ' \-]/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Extrait de naissance → champs de la fiche de l'élève (chaque champ vide s'il n'est pas lu sûrement). */
  function structurerExtrait(ocr) {
    var lignes = ((ocr && ocr.lignes) || []).slice().sort(function (a, b) { return (a.y || 0) - (b.y || 0); })
      .map(function (l) { return l.t || ""; });
    var tout = lignes.join("\n");
    var d = {};
    var nom = propre(apres(lignes, /\bNOMS?\b(?! ET)/i)).toUpperCase();
    var prenoms = propre(apres(lignes, /\bPR[EÉ]NOMS?\b/i));
    if (!nom) {          // « est né(e) KOUASSI Yao Jean » : mots en capitales = nom, la suite = prénoms
      var m = /\bn[ée]e?\s*(?:\(e\))?\s+(?!le\b)([^\n]+)/i.exec(tout);
      if (m) {
        var t = propre(m[1]).split(" "), k = 0;
        while (k < t.length && t[k].length > 1 && t[k] === t[k].toUpperCase()) { k++; }
        nom = t.slice(0, k || t.length).join(" ").toUpperCase();
        prenoms = prenoms || t.slice(k || t.length).join(" ");
      }
    }
    if (nom) { d.nom = (nom + (prenoms && nom.indexOf(prenoms.toUpperCase()) < 0 ? " " + prenoms : "")).toUpperCase(); }
    var ne = /\bn[ée]\s*\(?e?\)?\s+le\b([^\n]*(?:\n[^\n]*)?)/i.exec(tout);
    d.date_naissance = date(ne ? ne[1] : "") || date(apres(lignes, /date de naissance/i)) ||
      date(lignes.filter(function (l) { return /^\s*le\b/i.test(l); }).join(" ")) ||
      date(lignes.filter(function (l) { return !/\bN\s*[°o]\s*\d/i.test(l); }).join("\n")) || null;
    var lieu = apres(lignes, /lieu de naissance/i);
    if (!lieu) { var a = /\bn[ée]\s*\(?e?\)?[^\n]*?\s(?:à|a)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ' \-]{2,})/.exec(tout); lieu = a ? a[1] : ""; }
    d.localite = propre(lieu).toUpperCase().replace(/\b(LE|EN|DE)$/, "").trim() || null;
    var sexe = /\bSEXE\b[\s:.]*([MF])/i.exec(tout);
    d.sexe = sexe ? sexe[1].toUpperCase() : /\bfille de\b|\bn[ée]e\b|\bFEMININ\b/i.test(tout) ? "F" :
      /\bfils de\b|\bMASCULIN\b/i.test(tout) ? "M" : null;
    var pere = /\b(?:fils|fille)\s+de\s+([^\n]+?)(?:\s+et\s+de\b|\n|$)/i.exec(tout);
    d.pere_nom = propre(pere ? pere[1] : apres(lignes, /\bP[EÈ]RE\b/i)).toUpperCase() || null;
    var mere = /\bet\s+de\s+([^\n]+)/i.exec(tout);
    d.mere_nom = propre(mere ? mere[1] : apres(lignes, /\bM[EÈ]RE\b/i)).toUpperCase() || null;
    var num = /\bN\s*[°o]\s*(\d{1,6})\b/i.exec(tout);
    if (num) { d.observations = "Extrait de naissance n° " + num[1]; }
    Object.keys(d).forEach(function (k) { if (!d[k]) { delete d[k]; } });
    return d;
  }

  var API = { structurerNotes: structurerNotes, structurerExtrait: structurerExtrait, ressemblance: ressemblance,
    nombre: nombre, date: date, nombreEnLettres: nombreEnLettres };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; } else { racine.AkwaScan = API; }
})(this);
