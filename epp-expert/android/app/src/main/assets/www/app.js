/* AKWA SCHOOL – application Android (interface reprise du prototype v7).
 *
 * Données : copie de l'année en cours reçue de l'ordinateur de l'école (instantane.json) et saisies faites sur
 * le téléphone en attente d'envoi (operations.json). Rien ne part sur Internet : la synchronisation passe par
 * le Wi-Fi de l'école, chiffrée par le pont Java (AkwaNative).
 *
 * Règles (appliquées aussi par l'ordinateur, qui a le dernier mot) :
 *  - droits du compte associé au téléphone (notes.modifier, absences.modifier…) ;
 *  - corriger ou effacer une note déjà saisie, noter absent un élève qui a des notes, supprimer une absence
 *    enregistrée : mot de passe d'un administrateur, demandé au moment d'envoyer, jamais conservé ;
 *  - licence de l'ordinateur échue (ou date limite dépassée sans synchronisation) : données masquées ;
 *  - année clôturée : lecture seule. Les fiches des élèves et du personnel se modifient sur l'ordinateur.
 */
(function () {
  "use strict";

  var N = window.AkwaNative;
  var VERROU_APRES_MS = 2 * 60 * 1000;
  var S = {
    infos: {}, inst: null, ops: [], etat: { derniere: null, rejets: [] },
    vue: "accueil", deverrouille: false, occupe: false, pause: 0,
    eleves: { classe: "", q: "" }, notes: { classe: "", ev: 0, mat: 0 },
    abs: { mode: "appel", kind: "eleve", classe: "", date: aujourdhui() }, plus: "menu"
  };

  // =================================================================== utilitaires
  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function dateFr(iso) {
    if (!iso) { return ""; }
    var s = String(iso).slice(0, 10).split("-");
    return s.length === 3 ? s[2] + "/" + s[1] + "/" + s[0] : String(iso);
  }
  function heureFr(iso) {
    if (!iso) { return "jamais"; }
    var d = new Date(iso);
    return d.toLocaleDateString("fr-FR") + " à " + p2(d.getHours()) + " h " + p2(d.getMinutes());
  }
  function nb(v, dec) {
    if (v === null || v === undefined || v === "") { return "–"; }
    var x = Number(v);
    return (dec === 0 ? String(Math.round(x)) : (Math.round(x * 100) / 100).toString()).replace(".", ",");
  }
  function xround(x, n) {
    var p = Math.pow(10, n);
    return Math.round(Number((x * p).toPrecision(15))) / p;      // ARRONDI d'Excel (valeurs positives)
  }
  function uid() {
    var a = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return "t" + Date.now().toString(36) + Array.prototype.map.call(a, function (b) { return p2(b.toString(16)).slice(-2); }).join("");
  }
  function initiales(nom) {
    var m = String(nom || "?").split(/\s+/);
    return (m[0] ? m[0][0] : "?") + (m[1] ? m[1][0] : "");
  }
  function lireJson(nom, defaut) {
    try { var t = N.lire(nom); return t ? JSON.parse(t) : defaut; } catch (e) { return defaut; }
  }
  function sauver() {
    N.ecrire("operations.json", JSON.stringify(S.ops));
    N.ecrire("etat.json", JSON.stringify(S.etat));
  }
  var ICONES = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.8 3.1 2.5 3.5 5.2"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    plus: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    tel: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>'
  };
  function ic(nom) { return '<svg class="i" viewBox="0 0 24 24">' + (ICONES[nom] || "") + "</svg>"; }

  function toast(texte, mauvais) {
    var t = document.getElementById("toast");
    t.innerHTML = '<div class="toast' + (mauvais ? " bad" : "") + '">' + esc(texte) + "</div>";
    clearTimeout(toast.minuteur);
    toast.minuteur = setTimeout(function () { t.innerHTML = ""; }, mauvais ? 6000 : 3200);
  }

  // =================================================================== pont Java (asynchrone)
  var attentes = {}, compteur = 0;
  window.akwaRetour = function (id) {
    var f = attentes[id];
    delete attentes[id];
    var r = null;
    try { r = JSON.parse(N.resultat(id)); } catch (e) { r = { ok: false, statut: 0, message: "Réponse illisible." }; }
    if (f) { f(r); }
  };
  function attendre(lancer) {
    return new Promise(function (ok) {
      var id = "r" + (++compteur);
      attentes[id] = ok;
      lancer(id);
    });
  }

  // =================================================================== fenêtres
  var fermerFenetre = null;
  function fenetre(html, onFermer) {
    var f = document.getElementById("fenetre");
    f.innerHTML = '<div class="voile" data-a="voile"><div class="feuille"><div class="poignee"></div>' + html + "</div></div>";
    fermerFenetre = function () { f.innerHTML = ""; fermerFenetre = null; if (onFermer) { onFermer(); } };
    var champ = f.querySelector("input.c, input.code");
    if (champ) { setTimeout(function () { champ.focus(); }, 120); }
  }
  function fermer() { if (fermerFenetre) { fermerFenetre(); } }

  /** Demande le mot de passe d'un administrateur : renvoie une promesse (mot de passe ou null). */
  function demanderAdmin(titre, texte) {
    return new Promise(function (ok) {
      var fini = false;
      fenetre('<h3>' + esc(titre) + '</h3><p class="mut small">' + esc(texte) + "</p>" +
        '<label class="f">Mot de passe d\'un administrateur</label><input class="c" id="mdpAdmin" type="password" autocomplete="off">' +
        '<div class="rang" style="margin-top:14px"><button class="btn" data-a="admin-non">Plus tard</button><span class="esp"></span>' +
        '<button class="btn pri" data-a="admin-oui">Valider et envoyer</button></div>', function () { if (!fini) { fini = true; ok(null); } });
      actionsFenetre["admin-oui"] = function () {
        var v = document.getElementById("mdpAdmin").value;
        if (!v) { return; }
        fini = true; fermer(); ok(v);
      };
      actionsFenetre["admin-non"] = function () { fini = true; fermer(); ok(null); };
    });
  }
  function confirmer(titre, texte, bouton, danger) {
    return new Promise(function (ok) {
      var fini = false;
      fenetre("<h3>" + esc(titre) + '</h3><p class="mut">' + esc(texte) + '</p><div class="rang" style="margin-top:14px">' +
        '<button class="btn" data-a="conf-non">Annuler</button><span class="esp"></span><button class="btn ' +
        (danger ? "dng" : "pri") + '" data-a="conf-oui">' + esc(bouton) + "</button></div>",
        function () { if (!fini) { fini = true; ok(false); } });
      actionsFenetre["conf-oui"] = function () { fini = true; fermer(); ok(true); };
      actionsFenetre["conf-non"] = function () { fini = true; fermer(); ok(false); };
    });
  }
  var actionsFenetre = {};

  // =================================================================== données
  function inst() { return S.inst || {}; }
  function perm(p) { var u = inst().utilisateur; return !!(u && u.permissions && u.permissions.indexOf(p) >= 0); }
  function licenceOk() {
    var l = inst().licence;
    if (!l) { return false; }
    if (!l.utilisable) { return false; }
    return !(l.valide_jusqua && Date.now() > Date.parse(l.valide_jusqua));
  }
  function modifiable() { var a = inst().annee; return !!a && !a.cloturee; }
  function classes() { return inst().classes || []; }
  function classe(code) { return classes().filter(function (c) { return c.code === code; })[0] || null; }
  function grille(c) {
    if (!c) { return null; }
    return (inst().grilles || []).filter(function (g) { return g.id === c.grille_id; })[0] || null;
  }
  function evaluations(c) { return c ? ((inst().evaluations || {})[c.calendrier] || []) : []; }
  function matieres(g, num) { return g ? (g.matieres[String(num)] || []) : []; }
  function maxNote(g, m) { return g.mode === "COEF" ? g.note_max : m.valeur; }
  function eleves(code) {
    return (inst().eleves || []).filter(function (e) { return !code || e.classe === code; });
  }
  function eleve(iid) { return (inst().eleves || []).filter(function (e) { return e.inscription_id === iid; })[0] || null; }
  function agent(pid) { return (inst().personnel || []).filter(function (p) { return p.id === pid; })[0] || null; }
  function resultat(iid) { return (inst().resultats || []).filter(function (r) { return r.inscription_id === iid; })[0] || null; }

  function noteBase(iid, mid) {
    var n = (inst().notes || {})[String(iid)];
    var v = n ? n[String(mid)] : undefined;
    return v === undefined ? null : v;
  }
  function opNote(iid, mid) {
    for (var i = S.ops.length - 1; i >= 0; i--) {
      var o = S.ops[i];
      if (o.op === "note" && o.inscription_id === iid && o.matiere_id === mid) { return o; }
    }
    return null;
  }
  function noteAff(iid, mid) { var o = opNote(iid, mid); return o ? o.valeur : noteBase(iid, mid); }
  function absentBase(iid, num) { var a = (inst().absents_evaluation || {})[String(iid)]; return !!(a && a.indexOf(num) >= 0); }
  function opPresence(iid, num) {
    for (var i = S.ops.length - 1; i >= 0; i--) {
      var o = S.ops[i];
      if (o.op === "presence" && o.inscription_id === iid && o.eval_num === num) { return o; }
    }
    return null;
  }
  function absentEval(iid, num) { var o = opPresence(iid, num); return o ? !o.present : absentBase(iid, num); }
  function moyenneEval(iid, c, num) {
    var g = grille(c);
    if (!g) { return null; }
    if (absentEval(iid, num)) { return 0; }
    var den = 0, tot = 0, pond = 0, n = 0;
    matieres(g, num).forEach(function (m) {
      var v = noteAff(iid, m.id);
      if (v === null || v === undefined) { return; }
      n++; den += m.valeur; tot += v; pond += v * m.valeur;
    });
    if (!n || !den) { return null; }
    return g.mode === "COEF" ? xround(pond / den, 2) : xround(tot / den * g.echelle, 2);
  }

  function absencesAffichees(kind) {
    var cle = kind === "eleve" ? "absences_eleves" : "absences_personnel";
    var suppr = {};
    S.ops.forEach(function (o) { if (o.op === "suppr_absence" && o.kind === kind) { suppr[o.id] = true; } });
    var out = (inst()[cle] || []).filter(function (a) { return !suppr[a.id]; }).map(function (a) {
      var x = {}; for (var k in a) { x[k] = a[k]; }
      x.cible = kind === "eleve" ? a.inscription_id : a.personnel_id;
      return x;
    });
    S.ops.forEach(function (o) {
      if (o.op === "absence" && o.kind === kind) {
        out.push({ attente: o.uid, cible: o.cible, date: o.date, nature: o.nature, jours: o.jours,
                   retard_min: o.retard_min, motif: o.motif, justifie: o.justifie });
      }
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return out;
  }

  // =================================================================== opérations en attente
  function ajouterOp(op) {
    op.uid = uid();
    op.cree_le = new Date().toISOString();
    S.ops.push(op);
    sauver();
    majBadge();
  }
  function retirerOp(u) {
    S.ops = S.ops.filter(function (o) { return o.uid !== u; });
    sauver();
    majBadge();
  }
  function libelleOp(o) {
    var e = o.inscription_id ? eleve(o.inscription_id) : null;
    if (o.op === "note") {
      return "Note " + (o.libelle || "") + " de " + (e ? e.nom : "?") + " : " + (o.valeur === null ? "effacée" : nb(o.valeur));
    }
    if (o.op === "presence") { return (e ? e.nom : "?") + " : " + (o.present ? "présent" : "absent") + " à l'évaluation " + o.eval_num; }
    if (o.op === "absence") {
      var qui = o.kind === "eleve" ? eleve(o.cible) : agent(o.cible);
      return (o.nature === "RETARD" ? "Retard" : "Absence") + " de " + (qui ? qui.nom : "?") + " le " + dateFr(o.date);
    }
    if (o.op === "suppr_absence") { return "Suppression de l'absence du " + dateFr(o.date); }
    return o.op;
  }

  // =================================================================== synchronisation
  function synchroniser(opts) {
    opts = opts || {};
    if (S.occupe) { return Promise.resolve(false); }
    var aEnvoyer = S.ops.slice();
    var protege = aEnvoyer.some(function (o) { return o.protege; });
    var avant = opts.admin ? Promise.resolve(opts.admin) : (protege && !opts.silencieux
      ? demanderAdmin("Saisies à valider", "Certaines saisies corrigent ou effacent des données déjà enregistrées " +
        "(note déjà saisie, absence enregistrée). Elles demandent le mot de passe d'un administrateur. « Plus tard » " +
        "envoie les autres saisies et garde celles-ci en attente.")
      : Promise.resolve(null));
    return avant.then(function (admin) {
      S.occupe = true;
      majBadge();
      var req = { ops: aEnvoyer.map(function (o) {
        var x = {}; for (var k in o) { if (k !== "libelle" && k !== "cree_le" && k !== "protege" && k !== "message") { x[k] = o[k]; } }
        return x;
      }), client: { version: S.infos.version, modele: S.infos.modele } };
      if (admin) { req.admin = admin; }
      return attendre(function (id) { N.synchroniser(id, JSON.stringify(req)); }).then(function (r) {
        S.occupe = false;
        return traiterReponse(r, aEnvoyer, opts);
      });
    });
  }

  function traiterReponse(r, envoyees, opts) {
    if (!r || !r.ok) {
      var corps = (r && r.corps) || {};
      if (r && r.statut === 401) {
        S.etat.revoque = true;
        sauver();
        rendre();
        toast(r.message, true);
        return false;
      }
      majBadge();
      if (!opts.silencieux) { toast((r && r.message) || "Synchronisation impossible.", true); }
      if (corps.code === "CLE") { S.etat.revoque = true; sauver(); rendre(); }
      return false;
    }
    var rep = r.reponse || {};
    if (rep.instantane) {
      S.inst = rep.instantane;
      N.ecrire("instantane.json", JSON.stringify(S.inst));
    }
    S.etat.derniere = new Date().toISOString();
    S.etat.revoque = false;
    var n = 0, a = 0, ref = 0;
    (rep.resultats || []).forEach(function (res) {
      var o = envoyees.filter(function (x) { return x.uid === res.uid; })[0];
      if (!o) { return; }
      if (res.ok) { n++; retirerSansSauver(o.uid); return; }
      if (res.code === "ADMIN_REQUIS") {
        a++; o.protege = true; o.message = res.message;
        return;
      }
      ref++;
      retirerSansSauver(o.uid);
      S.etat.rejets.unshift({ libelle: libelleOp(o), message: res.message, le: new Date().toISOString() });
    });
    S.etat.rejets = S.etat.rejets.slice(0, 30);
    sauver();
    rendre();
    if (rep.code === "LICENCE") { toast(rep.erreur, true); return false; }
    if (rep.erreur) { toast(rep.erreur, true); return false; }
    var msg = "Synchronisé" + (n ? " : " + n + " saisie(s) envoyée(s)" : "") + ".";
    if (a) { msg += " " + a + " en attente du mot de passe administrateur."; }
    if (ref) { msg += " " + ref + " refusée(s) : voir Plus › Synchronisation."; }
    if (!opts.silencieux || n || ref) { toast(msg, ref > 0 || a > 0); }
    return true;
  }
  function retirerSansSauver(u) { S.ops = S.ops.filter(function (o) { return o.uid !== u; }); }

  function majBadge() {
    var b = document.getElementById("btnSync");
    if (!b) { return; }
    b.className = "sync" + (S.occupe ? " tourne" : "");
    var badge = b.querySelector(".badge");
    badge.textContent = String(S.ops.length);
    badge.classList.toggle("hidden", !S.ops.length);
  }

  // =================================================================== rendu général
  var app = document.getElementById("app");
  function rendre() {
    if (!N) {
      app.innerHTML = '<div class="ecran"><h1>AKWA SCHOOL</h1><p>Cette page s\'ouvre dans l\'application Android AKWA SCHOOL.</p></div>';
      return;
    }
    if (!S.infos.associe) { return rendreBienvenue(); }
    if (S.infos.pin && !S.deverrouille) { return rendreVerrou(); }
    if (!S.infos.pin) { return rendrePin(); }
    if (!S.inst) { return rendrePremiereSynchro(); }
    var l = inst().licence || {};
    var ecole = (inst().ecole || {}).ecole_nom || "École";
    var annee = inst().annee ? "Année " + inst().annee.libelle : "Aucune année scolaire";
    var html = '<header class="top"><img src="logo.png" alt=""><div class="t"><b>' + esc(ecole) + "</b><small>" + esc(annee) +
      " · " + esc((inst().utilisateur || {}).nom || "") + '</small></div><button id="btnSync" class="sync" data-a="sync">' +
      ic("sync") + 'Synchro<span class="badge hidden">0</span></button></header><main class="vue" id="vue">';
    if (S.etat.revoque) {
      html += '<div class="bandeau bad">Ce téléphone n\'est plus reconnu par l\'ordinateur de l\'école (retiré ou réinstallé). ' +
        'Les saisies en attente sont conservées : associez-le de nouveau pour les envoyer.<div style="margin-top:8px">' +
        '<button class="btn sm" data-a="reassocier">Associer de nouveau</button></div></div>';
    }
    if (!licenceOk()) {
      html += '<div class="card"><h3>' + ic("lock") + " Données verrouillées</h3><p>" + esc(l.message ||
        "La licence de l'application Windows n'est plus valable.") + '</p><p class="mut small">Activez la licence sur ' +
        "l'ordinateur de l'école puis synchronisez ce téléphone : les données réapparaîtront. Les saisies en attente " +
        "sont conservées.</p><button class=\"btn pri bloc\" data-a=\"sync\">" + ic("sync") + " Synchroniser</button></div>";
    } else {
      html += ({ accueil: vueAccueil, eleves: vueEleves, notes: vueNotes, absences: vueAbsences, plus: vuePlus }[S.vue] || vueAccueil)();
    }
    html += "</main>" + nav();
    app.innerHTML = html;
    majBadge();
  }
  function nav() {
    var items = [["accueil", "home", "Accueil"], ["eleves", "users", "Élèves"], ["notes", "award", "Notes"],
      ["absences", "cal", "Absences"], ["plus", "plus", "Plus"]];
    return '<nav class="bnav">' + items.map(function (x) {
      return '<button data-a="vue" data-v="' + x[0] + '" class="' + (S.vue === x[0] ? "on" : "") + '">' + ic(x[1]) + x[2] + "</button>";
    }).join("") + "</nav>";
  }
  function aller(v) { S.vue = v; rendre(); window.scrollTo(0, 0); }

  // =================================================================== accueil
  function vueAccueil() {
    var els = eleves().filter(function (e) { return e.statut === "PRESENT"; });
    var g = els.filter(function (e) { return e.sexe === "M"; }).length;
    var aujourd = absencesAffichees("eleve").filter(function (a) { return a.date === aujourdhui(); }).length;
    var res = (inst().resultats || []).filter(function (r) { return r.mga !== null && r.mga !== undefined; });
    var u = inst().utilisateur || {};
    var h = '<div class="card hero"><h2>Bonjour ' + esc(u.nom || "") + "</h2><p>" + esc(u.role || "") + " · " +
      esc((inst().ecole || {}).iepp || "") + "</p></div>";
    if (inst().annee && inst().annee.cloturee) {
      h += '<div class="bandeau">Année ' + esc(inst().annee.libelle) + " clôturée : consultation seulement.</div>";
    }
    h += '<div class="kpis">' +
      kpi("Élèves", inst().eleves ? els.length : "–", inst().eleves ? g + " garçons · " + (els.length - g) + " filles" : "non autorisé") +
      kpi("Classes", classes().length, "année " + esc(inst().annee ? inst().annee.libelle : "")) +
      kpi("Absents aujourd'hui", inst().absences_eleves ? aujourd : "–", dateFr(aujourdhui())) +
      kpi("Moyennes annuelles", res.length ? res.length : "–", res.length ? "élèves avec une MGA" : "pas encore calculées") + "</div>";
    var l = inst().licence || {};
    h += '<div class="card"><h3>Synchronisation</h3><dl class="kv"><dt>Dernière</dt><dd>' + esc(heureFr(S.etat.derniere)) +
      "</dd><dt>En attente</dt><dd>" + S.ops.length + " saisie(s)</dd><dt>Ordinateur</dt><dd>" + esc(S.infos.adresse || "") +
      "</dd>" + (l.valide_jusqua ? "<dt>Données valables</dt><dd>jusqu'au " + esc(dateFr(l.valide_jusqua)) + "</dd>" : "") +
      '</dl><div style="margin-top:12px"><button class="btn pri bloc" data-a="sync">' + ic("sync") + " Synchroniser maintenant</button></div></div>";
    if (inst().eleves && classes().length) {
      h += '<div class="card"><h3>Effectifs par classe</h3><table class="t"><tr><th>Classe</th><th>Garçons</th><th>Filles</th><th>Total</th></tr>';
      classes().forEach(function (c) {
        var e = els.filter(function (x) { return x.classe === c.code; });
        var gg = e.filter(function (x) { return x.sexe === "M"; }).length;
        h += '<tr><td><b>' + esc(c.code) + "</b></td><td class=\"num\">" + gg + '</td><td class="num">' + (e.length - gg) +
          '</td><td class="num"><b>' + e.length + "</b></td></tr>";
      });
      h += "</table></div>";
    }
    return h;
  }
  function kpi(t, v, s) { return '<div class="kpi"><small>' + esc(t) + "</small><b class=\"num\">" + esc(v) + "</b><span>" + s + "</span></div>"; }

  // =================================================================== élèves
  function chipsClasses(courant, action, toutes) {
    var h = '<div class="chips">';
    if (toutes) { h += '<button class="chip' + (!courant ? " on" : "") + '" data-a="' + action + '" data-c="">Toutes</button>'; }
    classes().forEach(function (c) {
      h += '<button class="chip' + (courant === c.code ? " on" : "") + '" data-a="' + action + '" data-c="' + esc(c.code) + '">' + esc(c.code) + "</button>";
    });
    return h + "</div>";
  }
  function vueEleves() {
    if (!inst().eleves) { return '<div class="card vide">Votre compte ne permet pas de consulter les élèves.</div>'; }
    var h = '<div class="ph"><h2>Élèves</h2><p>' + eleves().length + " inscrit(s) en " + esc(inst().annee ? inst().annee.libelle : "") + "</p></div>" +
      '<input class="c" id="rech" type="search" placeholder="Nom, matricule, parent…" value="' + esc(S.eleves.q) + '" style="margin-bottom:10px">' +
      chipsClasses(S.eleves.classe, "filtre-classe", true) + '<div class="liste" id="listeEleves">' + lignesEleves() + "</div>";
    if (perm("personnel.lire") && inst().personnel) {
      h += '<button class="btn bloc" data-a="vue" data-v="plus" data-p="personnel">' + ic("users") + " Voir le personnel</button>";
    }
    return h;
  }
  function lignesEleves() {
    var q = S.eleves.q.trim().toLowerCase();
    var l = eleves(S.eleves.classe).filter(function (e) {
      if (!q) { return true; }
      return [e.nom, e.matricule_ecole, e.matricule_desps, e.pere_nom, e.mere_nom].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    if (!l.length) { return '<div class="vide">Aucun élève.</div>'; }
    return l.slice(0, 400).map(function (e) {
      var st = e.statut !== "PRESENT" ? ' <span class="pill bad">' + esc(e.statut) + "</span>" : "";
      return '<button class="ligne" data-a="fiche" data-i="' + e.inscription_id + '"><span class="av' + (e.sexe === "F" ? " f" : "") + '">' +
        esc(initiales(e.nom)) + '</span><span class="t"><b>' + esc(e.nom) + "</b><small>" + esc(e.classe) + " · " +
        esc(e.matricule_ecole || "") + (e.age !== null && e.age !== undefined ? " · " + e.age + " ans" : "") + st + "</small></span></button>";
    }).join("");
  }
  function telLien(nom, tel) {
    if (!nom && !tel) { return "–"; }
    return esc(nom || "") + (tel ? ' <a class="pill ok" href="tel:' + esc(String(tel).replace(/[^0-9+]/g, "")) + '">' + ic("tel").replace('class="i"', 'class="i" style="width:13px;height:13px;vertical-align:-2px"') + " " + esc(tel) + "</a>" : "");
  }
  function ficheEleve(iid) {
    var e = eleve(iid);
    if (!e) { return; }
    var r = resultat(iid);
    var abs = absencesAffichees("eleve").filter(function (a) { return a.cible === iid; });
    var jours = abs.reduce(function (s, a) { return s + (a.nature === "ABSENCE" ? Number(a.jours || 0) : 0); }, 0);
    var h = '<div class="rang"><span class="av' + (e.sexe === "F" ? " f" : "") + '" style="width:48px;height:48px;font-size:16px">' + esc(initiales(e.nom)) +
      '</span><div><h3 style="margin:0">' + esc(e.nom) + '</h3><span class="mut small">' + esc(e.classe) + " · " + esc(e.matricule_ecole || "") + "</span></div></div>" +
      '<div class="card" style="margin-top:12px"><dl class="kv"><dt>Matricule DESPS</dt><dd>' + esc(e.matricule_desps || "–") +
      "</dd><dt>Sexe</dt><dd>" + (e.sexe === "F" ? "Fille" : "Garçon") + "</dd><dt>Né(e) le</dt><dd>" + esc(dateFr(e.date_naissance)) +
      (e.age !== null && e.age !== undefined ? " (" + e.age + " ans)" : "") + "</dd><dt>Nationalité</dt><dd>" + esc(e.nationalite || "–") +
      "</dd><dt>Statut</dt><dd>" + esc(e.statut) + (e.redoublant === "OUI" ? " · redoublant" : "") + "</dd>" +
      (e.groupe_sanguin ? "<dt>Groupe sanguin</dt><dd>" + esc(e.groupe_sanguin) + "</dd>" : "") +
      (e.allergies ? "<dt>Allergies</dt><dd>" + esc(e.allergies) + "</dd>" : "") + "</dl></div>" +
      '<div class="card"><h3>Parents</h3><dl class="kv"><dt>Père</dt><dd>' + telLien(e.pere_nom, e.pere_tel) + "</dd><dt>Mère</dt><dd>" +
      telLien(e.mere_nom, e.mere_tel) + "</dd>" + (e.tuteur_nom || e.tuteur_tel ? "<dt>Tuteur</dt><dd>" + telLien(e.tuteur_nom, e.tuteur_tel) + "</dd>" : "") + "</dl></div>";
    if (inst().notes) {
      var c = classe(e.classe);
      h += '<div class="card"><h3>Résultats</h3><table class="t"><tr>' + evaluations(c).map(function (ev) {
        return "<th>" + esc(ev.libelle) + "</th>";
      }).join("") + "</tr><tr>" + evaluations(c).map(function (ev) {
        return '<td class="num"><b>' + nb(moyenneEval(iid, c, ev.num)) + "</b></td>";
      }).join("") + "</tr></table>" + (r ? '<dl class="kv" style="margin-top:10px"><dt>MGA</dt><dd>' + nb(r.mga) + (c ? " / " + nb(c.bareme, 0) : "") +
        "</dd><dt>Rang</dt><dd>" + (r.rang ? r.rang + (r.rang === 1 ? "er" : "e") : "–") + "</dd><dt>Décision</dt><dd>" + esc(r.decision || "–") +
        (r.observation ? " · " + esc(r.observation) : "") + "</dd></dl>" : "") +
        '<p class="mut small" style="margin:8px 0 0">Moyennes calculées comme sur l\'ordinateur ; MGA et rang à la dernière synchronisation.</p></div>';
    }
    if (inst().absences_eleves) {
      h += '<div class="card"><h3>Absences et retards</h3><p class="mut small" style="margin:0 0 6px">' + nb(jours) + " jour(s) d'absence, " +
        abs.filter(function (a) { return a.nature === "RETARD"; }).length + " retard(s)</p>" +
        (abs.length ? abs.slice(0, 20).map(function (a) {
          return '<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)">' + esc(dateFr(a.date)) + " · " +
            (a.nature === "RETARD" ? "Retard " + esc(a.retard_min || "") + " min" : "Absence " + nb(a.jours) + " j") +
            (a.motif ? " · " + esc(a.motif) : "") + (a.attente ? ' <span class="pill org">en attente</span>' : "") + "</div>";
        }).join("") : '<p class="mut small">Aucune.</p>') + "</div>";
    }
    h += '<button class="btn bloc" data-a="fermer">Fermer</button>';
    fenetre(h);
  }

  // =================================================================== notes
  function vueNotes() {
    if (!perm("notes.lire")) { return '<div class="card vide">Votre compte ne permet pas de consulter les notes.</div>'; }
    var cs = classes().filter(function (c) { return grille(c); });
    if (!cs.length) { return '<div class="card vide">Aucune classe avec une grille de notes.</div>'; }
    if (!classe(S.notes.classe) || !grille(classe(S.notes.classe))) { S.notes.classe = cs[0].code; }
    var c = classe(S.notes.classe), g = grille(c), evs = evaluations(c);
    if (!evs.some(function (e) { return e.num === S.notes.ev; })) { S.notes.ev = evs.length ? evs[0].num : 1; }
    var mats = matieres(g, S.notes.ev);
    if (!mats.some(function (m) { return m.id === S.notes.mat; })) { S.notes.mat = mats.length ? mats[0].id : 0; }
    var m = mats.filter(function (x) { return x.id === S.notes.mat; })[0];
    var saisie = perm("notes.modifier") && modifiable();
    var h = '<div class="ph"><h2>Saisie des notes</h2><p>' + (saisie ? "Les notes saisies sont envoyées à la prochaine synchronisation." :
      "Consultation seulement.") + "</p></div>" + chipsClasses(S.notes.classe, "notes-classe", false) +
      '<div class="rang" style="margin-bottom:10px"><select class="c" data-ch="notes-ev" style="flex:1">' + evs.map(function (e) {
        return '<option value="' + e.num + '"' + (e.num === S.notes.ev ? " selected" : "") + ">" + esc(e.libelle) + "</option>";
      }).join("") + '</select><select class="c" data-ch="notes-mat" style="flex:1">' + mats.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === S.notes.mat ? " selected" : "") + ">" + esc(x.libelle) + "</option>";
      }).join("") + "</select></div>";
    if (!m) { return h + '<div class="card vide">Aucune matière pour cette évaluation.</div>'; }
    var mx = maxNote(g, m);
    h += '<p class="mut small" style="margin:0 0 8px">' + esc(m.libelle) + " : note sur " + nb(mx) + (g.mode === "COEF" ? " (coefficient " + nb(m.valeur) + ")" : "") +
      " · Moy. = moyenne de l'évaluation sur " + nb(g.mode === "COEF" ? g.note_max : g.echelle, 0) + ". Une note déjà enregistrée ne se corrige qu'avec le mot de passe d'un administrateur.</p>";
    h += '<div class="liste">' + eleves(c.code).map(function (e) {
      var iid = e.inscription_id, ab = absentEval(iid, S.notes.ev), v = noteAff(iid, m.id), o = opNote(iid, m.id);
      var off = !saisie || ab || e.statut !== "PRESENT";
      return '<div class="note"><span class="t"><b>' + esc(e.nom) + "</b><small>Moy. " + nb(moyenneEval(iid, c, S.notes.ev)) +
        (o ? ' · <span class="attente-txt">en attente</span>' : "") + (e.statut !== "PRESENT" ? " · " + esc(e.statut) : "") + "</small></span>" +
        (saisie && e.statut === "PRESENT" ? '<button class="abs' + (ab ? " on" : "") + '" data-a="presence" data-i="' + iid + '">' + (ab ? "Absent" : "Abs.") + "</button>" : "") +
        '<input inputmode="decimal" data-ch="note" data-i="' + iid + '" data-m="' + m.id + '" data-max="' + mx + '" value="' +
        (v === null || v === undefined ? "" : nb(v)) + '"' + (off ? " disabled" : "") + (o ? ' class="attente"' : "") + "></div>";
    }).join("") + "</div>";
    return h;
  }

  function lireNombre(t) {
    t = String(t || "").trim().replace(",", ".");
    if (t === "") { return null; }
    var x = Number(t);
    return isFinite(x) ? x : NaN;
  }

  function saisirNote(input) {
    var iid = Number(input.getAttribute("data-i")), mid = Number(input.getAttribute("data-m")), mx = Number(input.getAttribute("data-max"));
    var v = lireNombre(input.value);
    var c = classe(S.notes.classe), g = grille(c);
    var m = matieres(g, S.notes.ev).filter(function (x) { return x.id === mid; })[0];
    var e = eleve(iid);
    if (v !== null && (isNaN(v) || v < 0 || v > mx)) {
      input.classList.add("err");
      toast("La note de " + m.libelle + " doit être comprise entre 0 et " + nb(mx) + ".", true);
      return;
    }
    input.classList.remove("err");
    var base = noteBase(iid, mid), o = opNote(iid, mid);
    var actuelle = o ? o.valeur : base;
    if (v === actuelle) { return; }
    if (o) { retirerSansSauver(o.uid); }
    if (base === null || v === base) {
      if (v !== base) {
        ajouterOp({ op: "note", inscription_id: iid, matiere_id: mid, valeur: v, avant: null, libelle: m.libelle });
      } else { sauver(); majBadge(); }
      rendre();
      return;
    }
    // correction (ou effacement) d'une note déjà enregistrée sur l'ordinateur : mot de passe administrateur
    ajouterOp({ op: "note", inscription_id: iid, matiere_id: mid, valeur: v, avant: base, libelle: m.libelle, protege: true });
    rendre();
    demanderAdmin("Corriger une note enregistrée", "La note de " + m.libelle + " de " + e.nom + " est déjà enregistrée (" + nb(base) +
      "). La remplacer par " + (v === null ? "rien (effacer)" : nb(v)) + " demande le mot de passe d'un administrateur. " +
      "Le téléphone doit être sur le Wi-Fi de l'école pour l'envoyer maintenant ; sinon la correction reste en attente.").then(function (mdp) {
      if (mdp) { synchroniser({ admin: mdp }); } else { toast("Correction en attente du mot de passe d'un administrateur.", true); }
    });
  }

  function basculerPresence(iid) {
    var num = S.notes.ev, c = classe(S.notes.classe), e = eleve(iid);
    var ab = absentEval(iid, num), base = absentBase(iid, num), o = opPresence(iid, num);
    var nouveau = !ab;                     // true = noter absent
    if (o) { retirerSansSauver(o.uid); }
    if (nouveau === base) { sauver(); majBadge(); rendre(); return; }
    var aDesNotes = matieres(grille(c), num).some(function (m) { return noteBase(iid, m.id) !== null; });
    if (nouveau) {          // notes en attente de cette évaluation : sans objet
      matieres(grille(c), num).forEach(function (m) { var x = opNote(iid, m.id); if (x) { retirerSansSauver(x.uid); } });
    }
    var op = { op: "presence", inscription_id: iid, eval_num: num, present: !nouveau };
    if (nouveau && aDesNotes) {
      confirmer("Absent à l'évaluation", e.nom + " sera noté absent : ses notes de cette évaluation seront effacées et sa moyenne " +
        "vaudra 0. Il faudra le mot de passe d'un administrateur.", "Noter absent", true).then(function (oui) {
        if (!oui) { sauver(); rendre(); return; }
        op.protege = true;
        ajouterOp(op);
        rendre();
        demanderAdmin("Effacer des notes enregistrées", "Mot de passe d'un administrateur pour noter " + e.nom + " absent.")
          .then(function (mdp) { if (mdp) { synchroniser({ admin: mdp }); } });
      });
      return;
    }
    ajouterOp(op);
    rendre();
  }

  // =================================================================== absences
  function vueAbsences() {
    if (!perm("absences.lire")) { return '<div class="card vide">Votre compte ne permet pas de consulter les absences.</div>'; }
    var saisie = perm("absences.modifier") && modifiable();
    var h = '<div class="ph"><h2>Absences</h2><p>' + (saisie ? "Appel du jour, retards et absences, envoyés à la prochaine synchronisation." :
      "Consultation seulement.") + "</p></div>" + '<div class="seg">' +
      (saisie ? segBtn("appel", "Appel du jour") + segBtn("saisir", "Saisir") : "") + segBtn("historique", "Historique") + "</div>";
    if (!saisie && S.abs.mode !== "historique") { S.abs.mode = "historique"; }
    if (S.abs.mode === "appel") { return h + vueAppel(); }
    if (S.abs.mode === "saisir") { return h + vueSaisirAbsence(); }
    return h + vueHistorique(saisie);
  }
  function segBtn(m, t) { return '<button data-a="abs-mode" data-m="' + m + '" class="' + (S.abs.mode === m ? "on" : "") + '">' + t + "</button>"; }

  function vueAppel() {
    if (!classe(S.abs.classe)) { S.abs.classe = classes().length ? classes()[0].code : ""; }
    var d = S.abs.date;
    var abs = absencesAffichees("eleve").filter(function (a) { return a.date === d; });
    var h = '<label class="f">Date</label><input class="c" type="date" data-ch="abs-date" value="' + esc(d) + '" style="margin-bottom:10px">' +
      chipsClasses(S.abs.classe, "abs-classe", false) + '<div class="liste">';
    var l = eleves(S.abs.classe).filter(function (e) { return e.statut === "PRESENT"; });
    if (!l.length) { return h + '<div class="vide">Aucun élève présent dans cette classe.</div></div>'; }
    h += l.map(function (e) {
      var a = abs.filter(function (x) { return x.cible === e.inscription_id; })[0];
      var etat = a ? (a.nature === "RETARD" ? "r" : "a") : "";
      return '<div class="note"><span class="t"><b>' + esc(e.nom) + "</b><small>" + (a ? (a.nature === "RETARD" ? "Retard " + esc(a.retard_min) + " min" :
        "Absent " + nb(a.jours) + " j") + (a.attente ? ' · <span class="attente-txt">en attente</span>' : " · enregistré") : "Présent") + "</small></span>" +
        '<span class="appel"><button class="a' + (etat === "a" ? " on" : "") + '" data-a="appel" data-n="ABSENCE" data-i="' + e.inscription_id + '">Absent</button>' +
        '<button class="r' + (etat === "r" ? " on" : "") + '" data-a="appel" data-n="RETARD" data-i="' + e.inscription_id + '">Retard</button></span></div>';
    }).join("");
    return h + '</div><p class="mut small">Touchez « Absent » ou « Retard » ; touchez de nouveau pour annuler une saisie en attente. Un motif se précise dans « Saisir ».</p>';
  }

  function appel(iid, nature) {
    var d = S.abs.date;
    var a = absencesAffichees("eleve").filter(function (x) { return x.date === d && x.cible === iid; })[0];
    if (a && a.attente) {
      retirerOp(a.attente);
      if (a.nature === nature) { rendre(); return; }
    } else if (a) {
      supprimerAbsence("eleve", a);
      return;
    }
    if (nature === "RETARD") {
      fenetre('<h3>Retard de ' + esc(eleve(iid).nom) + '</h3><label class="f">Durée du retard (minutes)</label>' +
        '<input class="c" id="minutes" inputmode="numeric" value="15"><div class="rang" style="margin-top:14px"><span class="esp"></span>' +
        '<button class="btn pri" data-a="retard-ok">Enregistrer</button></div>');
      actionsFenetre["retard-ok"] = function () {
        var mn = parseInt(document.getElementById("minutes").value, 10);
        if (!(mn > 0 && mn <= 600)) { toast("Retard : entre 1 et 600 minutes.", true); return; }
        fermer();
        ajouterOp({ op: "absence", kind: "eleve", cible: iid, date: d, nature: "RETARD", retard_min: mn, motif: null, justifie: null });
        rendre();
      };
      return;
    }
    ajouterOp({ op: "absence", kind: "eleve", cible: iid, date: d, nature: "ABSENCE", jours: 1, motif: null, justifie: null });
    rendre();
  }

  function vueSaisirAbsence() {
    var k = S.abs.kind;
    var h = '<div class="seg">' + '<button data-a="abs-kind" data-k="eleve" class="' + (k === "eleve" ? "on" : "") + '">Élève</button>' +
      '<button data-a="abs-kind" data-k="personnel" class="' + (k === "personnel" ? "on" : "") + '">Personnel</button></div><div class="card">';
    if (k === "eleve") {
      if (!classe(S.abs.classe)) { S.abs.classe = classes().length ? classes()[0].code : ""; }
      h += chipsClasses(S.abs.classe, "abs-classe", false) + '<label class="f">Élève</label><select class="c" id="fCible">' +
        eleves(S.abs.classe).filter(function (e) { return e.statut === "PRESENT"; }).map(function (e) {
          return '<option value="' + e.inscription_id + '">' + esc(e.nom) + "</option>";
        }).join("") + "</select>";
    } else {
      h += '<label class="f">Agent</label><select class="c" id="fCible">' + (inst().personnel || []).map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.nom) + " (" + esc(p.fonction || "") + ")</option>";
      }).join("") + "</select>";
    }
    h += '<label class="f">Date</label><input class="c" id="fDate" type="date" value="' + esc(S.abs.date) + '">' +
      '<label class="f">Nature</label><select class="c" id="fNature" data-ch="abs-nature"><option value="ABSENCE">Absence</option><option value="RETARD">Retard</option></select>' +
      '<div id="zJours"><label class="f">Jours d\'absence (0,5 = demi-journée)</label><input class="c" id="fJours" inputmode="decimal" value="1"></div>' +
      '<div id="zRetard" class="hidden"><label class="f">Retard (minutes)</label><input class="c" id="fRetard" inputmode="numeric" value="15"></div>' +
      '<label class="f">Motif</label><select class="c" id="fMotif"><option value="">—</option>' + (inst().motifs_absence || []).map(function (m) {
        return '<option>' + esc(m) + "</option>";
      }).join("") + '</select><label class="f">Justifiée</label><select class="c" id="fJust"><option value="">—</option><option>OUI</option><option>NON</option></select>' +
      '<label class="f">Observations</label><input class="c" id="fObs" maxlength="200">' +
      '<div style="margin-top:14px"><button class="btn pri bloc" data-a="abs-enregistrer">Enregistrer</button></div></div>';
    return h;
  }

  function enregistrerAbsence() {
    var g = function (id) { return document.getElementById(id).value; };
    var a = inst().annee || {};
    var cible = Number(g("fCible")), d = g("fDate"), nature = g("fNature");
    if (!cible) { toast("Choisissez " + (S.abs.kind === "eleve" ? "l'élève." : "l'agent."), true); return; }
    if (!d || (a.date_debut && d < a.date_debut) || (a.date_fin && d > a.date_fin)) {
      toast("La date doit être comprise dans l'année scolaire " + (a.libelle || "") + ".", true); return;
    }
    var deja = absencesAffichees(S.abs.kind).filter(function (x) { return x.cible === cible && x.date === d; })[0];
    if (deja) {
      toast("Une saisie existe déjà le " + dateFr(d) + " pour cette personne (" + (deja.nature === "RETARD" ? "retard" : "absence") +
        "). Pour la remplacer, supprimez-la d'abord dans l'historique.", true);
      return;
    }
    var op = { op: "absence", kind: S.abs.kind, cible: cible, date: d, nature: nature, motif: g("fMotif") || null,
               justifie: g("fJust") || null, observations: g("fObs").trim() || null };
    if (nature === "ABSENCE") {
      var j = lireNombre(g("fJours"));
      if (!(j > 0 && j <= 31)) { toast("Jours d'absence : entre 0,5 et 31.", true); return; }
      op.jours = j;
    } else {
      var mn = parseInt(g("fRetard"), 10);
      if (!(mn > 0 && mn <= 600)) { toast("Retard : entre 1 et 600 minutes.", true); return; }
      op.retard_min = mn;
    }
    ajouterOp(op);
    S.abs.date = d;
    toast("Enregistrée sur le téléphone : elle sera envoyée à la prochaine synchronisation.");
    rendre();
  }

  function vueHistorique(saisie) {
    var k = S.abs.kind;
    var h = '<div class="seg"><button data-a="abs-kind" data-k="eleve" class="' + (k === "eleve" ? "on" : "") + '">Élèves</button>' +
      '<button data-a="abs-kind" data-k="personnel" class="' + (k === "personnel" ? "on" : "") + '">Personnel</button></div>';
    var l = absencesAffichees(k).slice(0, 150);
    if (!l.length) { return h + '<div class="card vide">Aucune absence enregistrée.</div>'; }
    return h + '<div class="liste">' + l.map(function (a, i) {
      var qui = k === "eleve" ? eleve(a.cible) : agent(a.cible);
      return '<div class="note"><span class="t"><b>' + esc(qui ? qui.nom : "?") + "</b><small>" + esc(dateFr(a.date)) + " · " +
        (a.nature === "RETARD" ? "Retard " + esc(a.retard_min) + " min" : "Absence " + nb(a.jours) + " j") + (a.motif ? " · " + esc(a.motif) : "") +
        (qui && qui.classe ? " · " + esc(qui.classe) : "") + (a.attente ? ' · <span class="attente-txt">en attente</span>' : "") + "</small></span>" +
        (saisie && !a.autorisation_id ? '<button class="btn sm dng" data-a="abs-suppr" data-x="' + i + '">' + (a.attente ? "Annuler" : "Supprimer") + "</button>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function supprimerAbsence(kind, a) {
    if (a.attente) { retirerOp(a.attente); rendre(); return; }
    var qui = kind === "eleve" ? eleve(a.cible) : agent(a.cible);
    confirmer("Supprimer une absence", "L'absence du " + dateFr(a.date) + " de " + (qui ? qui.nom : "?") + " est enregistrée sur " +
      "l'ordinateur. Sa suppression demande le mot de passe d'un administrateur.", "Supprimer", true).then(function (oui) {
      if (!oui) { return; }
      ajouterOp({ op: "suppr_absence", kind: kind, id: a.id, date: a.date, protege: true });
      rendre();
      demanderAdmin("Supprimer une absence", "Mot de passe d'un administrateur pour supprimer l'absence du " + dateFr(a.date) + ".")
        .then(function (mdp) { if (mdp) { synchroniser({ admin: mdp }); } });
    });
  }

  // =================================================================== plus
  function vuePlus() {
    if (S.plus === "personnel") { return vuePersonnel(); }
    var h = '<div class="ph"><h2>Plus</h2></div>';
    if (inst().personnel && perm("personnel.lire")) {
      h += '<div class="liste"><button class="ligne" data-a="plus" data-p="personnel">' + ic("users") +
        '<span class="t"><b>Personnel</b><small>' + inst().personnel.length + " agent(s)</small></span>›</button></div>";
    }
    h += '<div class="card"><h3>Synchronisation</h3><dl class="kv"><dt>Ordinateur</dt><dd>' + esc(S.infos.adresse || "") +
      "</dd><dt>Dernière</dt><dd>" + esc(heureFr(S.etat.derniere)) + "</dd><dt>Compte</dt><dd>" + esc((inst().utilisateur || {}).nom || "") +
      " (" + esc((inst().utilisateur || {}).role || "") + ")</dd></dl>" +
      '<p class="mut small">Le téléphone et l\'ordinateur doivent être sur le même Wi-Fi, la synchronisation démarrée sur l\'ordinateur ' +
      "(Rapports & administration › Téléphones).</p>" +
      '<button class="btn pri bloc" data-a="sync">' + ic("sync") + " Synchroniser maintenant</button></div>";
    h += '<div class="card"><h3>Saisies en attente (' + S.ops.length + ")</h3>" + (S.ops.length ? S.ops.map(function (o) {
      return '<div class="note" style="padding:8px 0"><span class="t"><b style="white-space:normal">' + esc(libelleOp(o)) + "</b>" +
        (o.protege ? '<small class="warn">' + esc(o.message || "Mot de passe administrateur nécessaire") + "</small>" : "") +
        '</span><button class="btn sm" data-a="op-annuler" data-u="' + esc(o.uid) + '">Annuler</button></div>';
    }).join("") : '<p class="mut small">Aucune : tout est sur l\'ordinateur.</p>') + "</div>";
    if (S.etat.rejets.length) {
      h += '<div class="card"><h3>Saisies refusées par l\'ordinateur</h3>' + S.etat.rejets.map(function (r) {
        return '<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>' + esc(r.libelle) + '</b><br><span class="bad">' +
          esc(r.message) + "</span></div>";
      }).join("") + '<div style="margin-top:10px"><button class="btn sm" data-a="rejets-effacer">Effacer la liste</button></div></div>';
    }
    h += '<div class="card"><h3>Sécurité</h3><div class="rang"><button class="btn" data-a="verrouiller">' + ic("lock") +
      ' Verrouiller</button><button class="btn" data-a="pin-changer">Changer le code PIN</button></div></div>' +
      '<div class="card"><h3>Ce téléphone</h3><p class="mut small">' + esc(S.infos.modele || "") + " · Android " + esc(S.infos.android || "") +
      " · AKWA SCHOOL " + esc(S.infos.version || "") + '</p><button class="btn dng" data-a="dissocier">Dissocier ce téléphone</button></div>';
    return h;
  }
  function vuePersonnel() {
    var l = inst().personnel || [];
    return '<div class="rang ph"><button class="btn sm" data-a="plus" data-p="menu">‹ Retour</button><h2>Personnel</h2></div><div class="liste">' +
      (l.length ? l.map(function (p) {
        return '<div class="ligne"><span class="av' + (p.sexe === "F" ? " f" : "") + '">' + esc(initiales(p.nom)) + '</span><span class="t"><b>' +
          esc(p.nom) + "</b><small>" + esc(p.fonction || "") + (p.classe_tenue && p.classe_tenue !== "-" ? " · " + esc(p.classe_tenue) : "") +
          " · " + esc(p.matricule || "") + "</small></span>" + (p.telephone ? '<a class="btn sm" href="tel:' +
          esc(String(p.telephone).replace(/[^0-9+]/g, "")) + '">' + ic("tel") + "</a>" : "") + "</div>";
      }).join("") : '<div class="vide">Aucun agent.</div>') + "</div>";
  }

  // =================================================================== bienvenue, association, PIN
  function rendreBienvenue() {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h1>AKWA SCHOOL</h1><p>Gestion scolaire EPP, sur votre téléphone, ' +
      "synchronisée avec l'ordinateur de l'école par le Wi-Fi — sans Internet.</p>" +
      '<div class="card"><ol class="etapes"><li>Sur l\'ordinateur : AKWA SCHOOL › Rapports &amp; administration › Téléphones › « Démarrer la synchronisation ».</li>' +
      "<li>Choisissez le compte du téléphone et cliquez « Afficher un code d'association ».</li><li>Connectez ce téléphone au même Wi-Fi, puis touchez ci-dessous.</li></ol>" +
      '<button class="btn pri bloc" data-a="associer-ecran" style="margin-top:10px">' + ic("wifi") + " Associer ce téléphone</button></div></div>";
  }
  function rendreAssociation() {
    app.innerHTML = '<div class="ecran" style="justify-content:flex-start"><img class="logo" src="logo.png" alt="" style="width:64px;height:64px">' +
      '<h2 style="margin-bottom:12px">Associer ce téléphone</h2><div class="card"><h3>1. Ordinateur de l\'école</h3>' +
      '<button class="btn bloc" data-a="chercher">' + ic("wifi") + ' Rechercher sur le Wi-Fi</button><div id="trouves"></div>' +
      '<label class="f">Adresse de l\'ordinateur</label><input class="c" id="adr" placeholder="ex. 192.168.1.20" inputmode="url" value="' + esc(S.infos.adresse || "") + '">' +
      '<h3 style="margin-top:16px">2. Code affiché sur l\'ordinateur</h3><input class="c code" id="code" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters">' +
      '<h3 style="margin-top:16px">3. Nom de ce téléphone</h3><input class="c" id="nomTel" maxlength="60" value="' + esc(S.infos.modele || "Téléphone") + '">' +
      '<div style="margin-top:16px"><button class="btn pri bloc" id="btnAssocier" data-a="associer">Associer</button></div>' +
      '<p class="mut small" id="msgAssoc"></p></div><button class="btn" data-a="bienvenue">Retour</button></div>';
    chercher();
  }
  function chercher() {
    var z = document.getElementById("trouves");
    if (!z) { return; }
    z.innerHTML = '<p class="mut small">Recherche de l\'ordinateur…</p>';
    attendre(function (id) { N.chercher(id); }).then(function (l) {
      var zz = document.getElementById("trouves");
      if (!zz) { return; }
      l = l || [];
      zz.innerHTML = l.length ? '<div class="liste" style="margin-top:8px">' + l.map(function (s) {
        return '<button class="ligne" data-a="choisir" data-adr="' + esc(s.adresse) + '">' + ic("wifi") + '<span class="t"><b>' + esc(s.ecole || "AKWA SCHOOL") +
          "</b><small>" + esc(s.adresse) + "</small></span></button>";
      }).join("") + "</div>" : '<p class="mut small">Aucun ordinateur trouvé. Vérifiez le Wi-Fi et que la synchronisation est démarrée ' +
        "sur l'ordinateur, ou saisissez son adresse (affichée sur la page Téléphones).</p>";
      if (l.length === 1 && !document.getElementById("adr").value) { document.getElementById("adr").value = l[0].adresse; }
    });
  }
  function associer() {
    var adr = document.getElementById("adr").value.trim(), code = document.getElementById("code").value.replace(/[^0-9a-zA-Z]/g, "");
    var nom = document.getElementById("nomTel").value.trim() || "Téléphone";
    var msg = document.getElementById("msgAssoc"), b = document.getElementById("btnAssocier");
    if (!adr) { msg.textContent = "Indiquez l'adresse de l'ordinateur (ou touchez « Rechercher »)."; return; }
    if (code.length !== 8) { msg.textContent = "Le code compte 8 caractères (ex. K7P2-9QXM)."; return; }
    b.disabled = true;
    msg.textContent = "Association en cours… (quelques secondes)";
    attendre(function (id) { N.associer(id, adr, code, nom); }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { msg.textContent = (r && r.message) || "Association impossible."; return; }
      S.infos = JSON.parse(N.infos());
      S.etat.revoque = false;
      sauver();
      S.deverrouille = true;
      toast("Téléphone associé à " + ((r.contenu || {}).ecole || "l'ordinateur de l'école") + ".");
      if (S.infos.pin) { rendre(); synchroniser({}); } else { rendrePin(); }
    });
  }
  function rendrePin(changement) {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h2>' + (changement ? "Nouveau code PIN" : "Protégez ce téléphone") +
      '</h2><p>Choisissez un code PIN de 4 à 8 chiffres. Il sera demandé à l\'ouverture de l\'application : les données des élèves restent ' +
      'protégées si le téléphone est perdu.</p><div class="card"><label class="f">Code PIN</label><input class="c code" id="pin1" type="password" inputmode="numeric" maxlength="8">' +
      '<label class="f">Confirmez le code PIN</label><input class="c code" id="pin2" type="password" inputmode="numeric" maxlength="8">' +
      '<div style="margin-top:14px"><button class="btn pri bloc" data-a="pin-ok">Enregistrer le code PIN</button></div><p class="mut small" id="msgPin"></p></div></div>';
  }
  function enregistrerPin() {
    var a = document.getElementById("pin1").value, b = document.getElementById("pin2").value, m = document.getElementById("msgPin");
    if (!/^\d{4,8}$/.test(a)) { m.textContent = "Le code PIN compte 4 à 8 chiffres."; return; }
    if (a !== b) { m.textContent = "Les deux codes ne sont pas identiques."; return; }
    if (!N.definirPin(a)) { m.textContent = "Enregistrement impossible."; return; }
    S.infos = JSON.parse(N.infos());
    S.deverrouille = true;
    toast("Code PIN enregistré.");
    rendre();
    if (!S.inst) { synchroniser({}); }
  }
  function rendreVerrou() {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h1>AKWA SCHOOL</h1><p>Saisissez votre code PIN.</p>' +
      '<div class="card"><input class="c code" id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">' +
      '<div style="margin-top:12px"><button class="btn pri bloc" data-a="deverrouiller">Déverrouiller</button></div><p class="mut small" id="msgPin"></p>' +
      '<button class="btn sm" data-a="pin-oublie" style="margin-top:6px">Code PIN oublié ?</button></div></div>';
    setTimeout(function () { var p = document.getElementById("pin"); if (p) { p.focus(); } }, 150);
  }
  function deverrouiller() {
    var p = document.getElementById("pin"), m = document.getElementById("msgPin");
    var att = N.attentePin();
    if (att > 0) { m.textContent = "Trop d'essais : patientez " + att + " s."; return; }
    if (N.verifierPin(p.value)) {
      S.deverrouille = true;
      rendre();
      if (S.ops.length || !S.etat.derniere || Date.now() - Date.parse(S.etat.derniere) > 10 * 60 * 1000) { synchroniser({ silencieux: true }); }
    } else {
      p.value = "";
      att = N.attentePin();
      m.textContent = att > 0 ? "Code incorrect. Trop d'essais : patientez " + att + " s." : "Code incorrect.";
    }
  }
  function rendrePremiereSynchro() {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h2>Première synchronisation</h2>' +
      "<p>Le téléphone récupère les données de l'école auprès de l'ordinateur (" + esc(S.infos.adresse || "") + ").</p>" +
      '<button class="btn pri" data-a="sync">' + ic("sync") + " Synchroniser</button></div>";
  }

  // =================================================================== événements
  var actions = {
    vue: function (b) { var p = b.getAttribute("data-p"); if (p) { S.plus = p; } else if (b.getAttribute("data-v") === "plus") { S.plus = "menu"; } aller(b.getAttribute("data-v")); },
    sync: function () { synchroniser({}); },
    fiche: function (b) { ficheEleve(Number(b.getAttribute("data-i"))); },
    fermer: fermer,
    voile: function (b, e) { if (e.target === b) { fermer(); } },
    "filtre-classe": function (b) { S.eleves.classe = b.getAttribute("data-c"); rendre(); },
    "notes-classe": function (b) { S.notes.classe = b.getAttribute("data-c"); rendre(); },
    "abs-classe": function (b) { S.abs.classe = b.getAttribute("data-c"); rendre(); },
    "abs-mode": function (b) { S.abs.mode = b.getAttribute("data-m"); rendre(); },
    "abs-kind": function (b) { S.abs.kind = b.getAttribute("data-k"); rendre(); },
    "abs-enregistrer": enregistrerAbsence,
    "abs-suppr": function (b) { var a = absencesAffichees(S.abs.kind).slice(0, 150)[Number(b.getAttribute("data-x"))]; if (a) { supprimerAbsence(S.abs.kind, a); } },
    appel: function (b) { appel(Number(b.getAttribute("data-i")), b.getAttribute("data-n")); },
    presence: function (b) { basculerPresence(Number(b.getAttribute("data-i"))); },
    plus: function (b) { S.plus = b.getAttribute("data-p"); rendre(); },
    "op-annuler": function (b) { retirerOp(b.getAttribute("data-u")); rendre(); },
    "rejets-effacer": function () { S.etat.rejets = []; sauver(); rendre(); },
    verrouiller: function () { S.deverrouille = false; rendre(); },
    "pin-changer": function () { rendrePin(true); },
    "pin-ok": enregistrerPin,
    deverrouiller: deverrouiller,
    "pin-oublie": function () {
      confirmer("Code PIN oublié", "Pour des raisons de sécurité, le code PIN ne peut pas être récupéré. Dissociez le téléphone : les données " +
        "de l'école et les saisies non envoyées sont effacées de ce téléphone, puis associez-le de nouveau avec un code affiché sur l'ordinateur.",
        "Dissocier ce téléphone", true).then(function (oui) { if (oui) { dissocier(); } });
    },
    dissocier: function () {
      confirmer("Dissocier ce téléphone", "Les données de l'école seront effacées de ce téléphone" + (S.ops.length ? ", ainsi que " + S.ops.length +
        " saisie(s) non envoyée(s)" : "") + ". Pensez à retirer aussi le téléphone sur l'ordinateur (page Téléphones).", "Dissocier", true)
        .then(function (oui) { if (oui) { dissocier(); } });
    },
    reassocier: function () { rendreAssociation(); },
    bienvenue: function () { rendre(); },
    "associer-ecran": rendreAssociation,
    chercher: chercher,
    choisir: function (b) { document.getElementById("adr").value = b.getAttribute("data-adr"); document.getElementById("code").focus(); },
    associer: associer
  };
  function dissocier() {
    N.dissocier();
    S.inst = null; S.ops = []; S.etat = { derniere: null, rejets: [] }; S.deverrouille = false;
    S.infos = JSON.parse(N.infos());
    rendre();
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-a]") : null;
    if (!b) { return; }
    var a = b.getAttribute("data-a");
    var f = actionsFenetre[a] || actions[a];
    if (f) {
      if (a !== "voile") { e.preventDefault(); }
      f(b, e);
    }
  });
  document.addEventListener("change", function (e) {
    var t = e.target, a = t.getAttribute && t.getAttribute("data-ch");
    if (a === "note") { saisirNote(t); }
    else if (a === "notes-ev") { S.notes.ev = Number(t.value); rendre(); }
    else if (a === "notes-mat") { S.notes.mat = Number(t.value); rendre(); }
    else if (a === "abs-date") { S.abs.date = t.value || aujourdhui(); rendre(); }
    else if (a === "abs-nature") {
      document.getElementById("zJours").classList.toggle("hidden", t.value !== "ABSENCE");
      document.getElementById("zRetard").classList.toggle("hidden", t.value !== "RETARD");
    }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "rech") {
      S.eleves.q = e.target.value;
      var l = document.getElementById("listeEleves");
      if (l) { l.innerHTML = lignesEleves(); }
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") { return; }
    var id = e.target.id;
    if (id === "pin") { deverrouiller(); }
    else if (id === "pin2") { enregistrerPin(); }
    else if (id === "mdpAdmin" && actionsFenetre["admin-oui"]) { actionsFenetre["admin-oui"](); }
    else if (e.target.getAttribute && e.target.getAttribute("data-ch") === "note") {
      e.preventDefault();
      var champs = Array.prototype.slice.call(document.querySelectorAll('input[data-ch="note"]:not([disabled])'));
      var i = champs.indexOf(e.target);
      e.target.blur();
      if (champs[i + 1]) { champs[i + 1].focus(); }
    }
  });

  // retour Android, mise en arrière-plan
  window.akwaArriere = function () {
    if (fermerFenetre) { fermer(); return true; }
    if (S.vue === "plus" && S.plus !== "menu") { S.plus = "menu"; rendre(); return true; }
    if (S.deverrouille && S.vue !== "accueil" && S.infos.associe) { aller("accueil"); return true; }
    return false;
  };
  window.akwaPause = function () { S.pause = Date.now(); };
  window.akwaReprise = function () {
    if (S.pause && S.deverrouille && S.infos.pin && Date.now() - S.pause > VERROU_APRES_MS) {
      S.deverrouille = false;
      fermer();
      rendre();
    }
    S.pause = 0;
  };

  // =================================================================== démarrage
  if (N) {
    S.infos = JSON.parse(N.infos());
    S.inst = lireJson("instantane.json", null);
    S.ops = lireJson("operations.json", []);
    S.etat = lireJson("etat.json", { derniere: null, rejets: [] });
    if (!S.etat.rejets) { S.etat.rejets = []; }
  }
  rendre();
})();
