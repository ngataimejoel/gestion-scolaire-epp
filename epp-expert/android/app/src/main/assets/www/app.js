/* AKWA SCHOOL – application Android (interface reprise du prototype v7).
 *
 * Deux façons de travailler, au choix :
 *  - téléphone utilisé seul (« autonome ») : l'école, les classes, les élèves, les notes et les absences sont sur
 *    le téléphone (base.json), sans ordinateur ni Internet. Licence propre au téléphone (7 jours d'essai, puis
 *    code d'activation, comme l'application Windows) ; mot de passe administrateur du téléphone pour les
 *    opérations protégées ; impression, exports et sauvegarde chiffrée sur place ;
 *  - téléphone associé à l'ordinateur de l'école : copie de l'année en cours reçue de l'ordinateur
 *    (instantane.json) et saisies en attente d'envoi (operations.json).
 * La synchronisation n'est jamais automatique : elle se fait quand l'utilisateur la demande, après un résumé de
 * ce qui sera échangé. Un téléphone utilisé seul peut ensuite être associé : ses données sont alors envoyées à
 * l'ordinateur (mot de passe d'un administrateur de l'ordinateur), qui ne remplace jamais ce qu'il a déjà.
 *
 * Règles (les mêmes que sur l'ordinateur, qui a le dernier mot quand le téléphone lui est associé) :
 *  - corriger ou effacer une note déjà saisie, noter absent un élève qui a des notes, supprimer une donnée,
 *    modifier la fiche d'un élève enregistré : mot de passe d'un administrateur ;
 *  - licence échue (téléphone ou ordinateur) : données masquées, jamais effacées ;
 *  - année clôturée : lecture seule.
 */
(function () {
  "use strict";

  var N = window.AkwaNative;
  var D = window.AKWA_DEFAUTS || {};
  var DOCS = window.AkwaDocs;
  var VERROU_APRES_MS = 2 * 60 * 1000;
  var TOUTES_PERMISSIONS = ["eleves.lire", "eleves.modifier", "eleves.supprimer", "notes.lire", "notes.modifier",
    "personnel.lire", "personnel.modifier", "personnel.supprimer", "absences.lire", "absences.modifier",
    "rapports.generer", "parametres.modifier", "import.excel", "export.excel", "sauvegarde.creer", "sauvegarde.restaurer"];
  var S = {
    infos: {}, inst: null, base: null, ops: [], etat: { derniere: null, rejets: [] }, licence: null,
    vue: "accueil", deverrouille: false, occupe: false, pause: 0,
    eleves: { classe: "", q: "" }, notes: { mode: "saisie", classe: "", ev: 0, mat: 0 },
    abs: { mode: "appel", kind: "eleve", classe: "", date: aujourdhui() }, plus: "menu", impression: { doc: "liste" }
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
  /** Identifiant lu dans un attribut : nombre, ou « u:… » (élève inscrit sur le téléphone, pas encore envoyé). */
  function idDe(v) { return /^-?\d+$/.test(String(v)) ? Number(v) : String(v); }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function norm(v) {
    return String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  }
  function lireJson(nom, defaut) {
    try { var t = N.lire(nom); return t ? JSON.parse(t) : defaut; } catch (e) { return defaut; }
  }
  function sauver() {
    N.ecrire("operations.json", JSON.stringify(S.ops));
    N.ecrire("etat.json", JSON.stringify(S.etat));
  }
  function sauverBase() {
    var b = {};
    for (var k in S.base) { if (k !== "utilisateur" && k !== "licence" && k !== "resultats") { b[k] = S.base[k]; } }
    if (!N.ecrire("base.json", JSON.stringify(b))) { toast("Enregistrement impossible sur le téléphone (mémoire pleine ?).", true); }
  }
  /** Âge révolu à une date (DATEDIF(…;"y") d'Excel). */
  function age(dn, ref) {
    if (!dn || !ref) { return null; }
    var a = String(dn).slice(0, 10).split("-").map(Number), b = String(ref).slice(0, 10).split("-").map(Number);
    if (a.length < 3 || isNaN(a[0])) { return null; }
    var y = b[0] - a[0];
    if (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) { y--; }
    return y < 0 ? null : y;
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
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    ajout: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    school: '<path d="M3 10l9-5 9 5-9 5z"/><path d="M7 12v5c3 2 7 2 10 0v-5"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    check: '<path d="M4 12l5 5L20 6"/>'
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
  var actionsFenetre = {};
  function fenetre(html, onFermer) {
    var f = document.getElementById("fenetre");
    actionsFenetre = {};
    f.innerHTML = '<div class="voile" data-a="voile"><div class="feuille"><div class="poignee"></div>' + html + "</div></div>";
    fermerFenetre = function () { f.innerHTML = ""; fermerFenetre = null; actionsFenetre = {}; if (onFermer) { onFermer(); } };
    var champ = f.querySelector("input.c:not([type=date]), input.code");
    if (champ) { setTimeout(function () { champ.focus(); }, 120); }
  }
  function fermer() { if (fermerFenetre) { fermerFenetre(); } }

  /** Mot de passe d'un administrateur de l'ordinateur (téléphone associé) : promesse (mot de passe ou null). */
  function demanderAdminOrdinateur(titre, texte, bouton) {
    return new Promise(function (ok) {
      var fini = false;
      fenetre('<h3>' + esc(titre) + '</h3><p class="mut small">' + esc(texte) + "</p>" +
        '<label class="f">Mot de passe d\'un administrateur de l\'ordinateur</label><input class="c" id="mdpAdmin" type="password" autocomplete="off">' +
        '<div class="rang" style="margin-top:14px"><button class="btn" data-a="admin-non">Annuler</button><span class="esp"></span>' +
        '<button class="btn pri" data-a="admin-oui">' + esc(bouton || "Valider") + "</button></div>", function () { if (!fini) { fini = true; ok(null); } });
      actionsFenetre["admin-oui"] = function () {
        var v = document.getElementById("mdpAdmin").value;
        if (!v) { return; }
        fini = true; fermer(); ok(v);
      };
      actionsFenetre["admin-non"] = function () { fini = true; fermer(); ok(null); };
    });
  }
  /** Mot de passe administrateur du téléphone utilisé seul, vérifié sur place : promesse (vrai si accordé). */
  function demanderAdminLocal(titre, texte) {
    return new Promise(function (ok) {
      var fini = false;
      fenetre('<h3>' + ic("key") + " " + esc(titre) + '</h3><p class="mut small">' + esc(texte) + "</p>" +
        '<label class="f">Mot de passe administrateur</label><input class="c" id="mdpAdmin" type="password" autocomplete="off">' +
        '<p class="small bad" id="msgAdmin"></p><div class="rang" style="margin-top:6px"><button class="btn" data-a="admin-non">Annuler</button>' +
        '<button class="btn sm" data-a="admin-oubli">Mot de passe oublié ?</button>' +
        '<span class="esp"></span><button class="btn pri" data-a="admin-oui">Valider</button></div>', function () { if (!fini) { fini = true; ok(false); } });
      actionsFenetre["admin-oubli"] = function () { fini = true; recupererAdminLocal().then(ok); };
      actionsFenetre["admin-oui"] = function () {
        var v = document.getElementById("mdpAdmin").value, m = document.getElementById("msgAdmin");
        if (!v) { return; }
        var att = N.attenteAdmin();
        if (att > 0) { m.textContent = "Trop d'essais : patientez " + att + " s."; return; }
        if (N.verifierAdmin(v)) { fini = true; fermer(); ok(true); return; }
        document.getElementById("mdpAdmin").value = "";
        att = N.attenteAdmin();
        m.textContent = att > 0 ? "Mot de passe incorrect. Trop d'essais : patientez " + att + " s." : "Mot de passe incorrect.";
      };
      actionsFenetre["admin-non"] = function () { fini = true; fermer(); ok(false); };
    });
  }
  /** Code de secours du mot de passe administrateur : affiché une seule fois, à noter. */
  function montrerSecours(code) {
    if (!code) { return; }
    fenetre('<h3>' + ic("key") + ' Code de secours</h3><p class="small">Il permet de choisir un nouveau mot de passe administrateur en cas ' +
      "d'oubli, même sans Internet. Notez-le et rangez-le en lieu sûr : il ne sera plus affiché. Il ne sert qu'une fois.</p>" +
      '<p style="font-size:22px;font-weight:700;letter-spacing:2px;text-align:center;margin:12px 0">' + esc(code) + "</p>" +
      '<div class="rang"><span class="esp"></span><button class="btn pri" data-a="secours-ok">C\'est noté</button></div>');
    actionsFenetre["secours-ok"] = fermer;
  }
  /** Mot de passe administrateur oublié (téléphone seul) : code de secours. Promesse (vrai si changé). */
  function recupererAdminLocal() {
    return new Promise(function (ok) {
      var fini = false;
      fenetre('<h3>' + ic("key") + ' Mot de passe oublié</h3><p class="mut small">Saisissez le code de secours remis à la création de l\'école ' +
        "(ou depuis Plus › Sécurité).</p>" +
        '<label class="f">Code de secours</label><input class="c" id="recCode" autocomplete="off" autocapitalize="characters">' +
        '<label class="f">Nouveau mot de passe (6 caractères au moins)</label><input class="c" id="recMdp1" type="password">' +
        '<label class="f">Confirmez</label><input class="c" id="recMdp2" type="password"><p class="small" id="msgRec"></p>' +
        '<div class="rang"><button class="btn" data-a="recup-non">Annuler</button><span class="esp"></span>' +
        '<button class="btn pri" data-a="recup-oui">Valider</button></div>', function () { if (!fini) { fini = true; ok(false); } });
      var m = function (t, mal) { var e = document.getElementById("msgRec"); e.textContent = t; e.className = "small " + (mal ? "bad" : "ok"); };
      actionsFenetre["recup-oui"] = function () {
        var a = document.getElementById("recMdp1").value;
        if (a.length < 6) { m("6 caractères au moins.", true); return; }
        if (a !== document.getElementById("recMdp2").value) { m("Les deux mots de passe ne sont pas identiques.", true); return; }
        var r = JSON.parse(N.recupererAdmin(document.getElementById("recCode").value, a));
        if (!r.ok) { m(r.message, true); return; }
        fini = true;
        toast("Mot de passe administrateur changé.");
        montrerSecours(r.secours);
        ok(true);
      };
      actionsFenetre["recup-non"] = function () { fini = true; fermer(); ok(false); };
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

  // =================================================================== mode de travail
  /** null (rien encore), « autonome » (téléphone seul), « transition » (associé, données du téléphone pas encore
   * envoyées), « associe » (copie de l'ordinateur). */
  function mode() {
    if (S.base) { return S.infos.associe ? "transition" : "autonome"; }
    return S.infos.associe ? "associe" : null;
  }
  function local() { return !!S.base; }
  function rafraichirLicence() {
    try { S.licence = JSON.parse(N.licence()); } catch (e) { S.licence = { utilisable: false, statut: "?", message: "Licence illisible." }; }
    if (S.base) {
      S.base.licence = { statut: S.licence.statut, utilisable: S.licence.utilisable, message: S.licence.message,
                         valide_jusqua: S.licence.statut === "essai" ? S.licence.expire_le : null };
    }
  }
  function preparerBase() {
    if (!S.base) { return; }
    var e = S.base.ecole || {};
    S.base.utilisateur = { login: "telephone", nom: e.directeur || "Administrateur", role: "Administrateur (téléphone)",
                           permissions: TOUTES_PERMISSIONS };
    S.base.notes = S.base.notes || {};
    S.base.absents_evaluation = S.base.absents_evaluation || {};
    ["eleves", "personnel", "absences_eleves", "absences_personnel", "classes", "grilles"].forEach(function (k) { S.base[k] = S.base[k] || []; });
    S.base.compteur = S.base.compteur || 1000;
    rafraichirLicence();
  }
  function nouvelId() { S.base.compteur = (S.base.compteur || 1000) + 1; return S.base.compteur; }

  // =================================================================== données
  function inst() { return (S.base || S.inst) || {}; }
  function perm(p) { var u = inst().utilisateur; return !!(u && u.permissions && u.permissions.indexOf(p) >= 0); }
  function licenceOk() {
    var l = inst().licence;
    if (!l || !l.utilisable) { return false; }
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
  function regleMga(c) { return c.regle_mga || (c.calendrier === "CM2" ? "MOYENNE4" : "STANDARD"); }

  /** Élèves affichés : ceux de la copie, avec les inscriptions et corrections en attente (téléphone associé). */
  function tousEleves() {
    var l = inst().eleves || [];
    if (local() || !S.ops.length) { return l; }
    var modifs = {};
    var out = [];
    S.ops.forEach(function (o) { if (o.op === "eleve" && o.inscription_id) { modifs[String(o.inscription_id)] = o; } });
    l.forEach(function (e) {
      var o = modifs[String(e.inscription_id)];
      if (!o) { out.push(e); return; }
      var x = copie(e);
      for (var k in o.donnees) { x[k] = o.donnees[k]; }
      x.attente = o.uid;
      out.push(x);
    });
    S.ops.forEach(function (o) {
      if (o.op === "eleve" && !o.inscription_id) {
        var x = copie(o.donnees);
        x.inscription_id = "u:" + o.uid;
        x.statut = x.statut || "PRESENT";
        x.matricule_ecole = "en attente";
        x.age = age(x.date_naissance, refAge());
        x.attente = o.uid;
        out.push(x);
      }
    });
    return out;
  }
  function eleves(code) { return tousEleves().filter(function (e) { return !code || e.classe === code; }); }
  function eleve(iid) { return tousEleves().filter(function (e) { return String(e.inscription_id) === String(iid); })[0] || null; }
  function agent(pid) { return (inst().personnel || []).filter(function (p) { return p.id === pid; })[0] || null; }
  function refAge() { var a = inst().annee || {}; return a.date_ref_age || (a.libelle ? a.libelle.slice(0, 4) + "-12-31" : null); }

  function noteBase(iid, mid) {
    var n = (inst().notes || {})[String(iid)];
    var v = n ? n[String(mid)] : undefined;
    return v === undefined ? null : v;
  }
  function opNote(iid, mid) {
    for (var i = S.ops.length - 1; i >= 0; i--) {
      var o = S.ops[i];
      if (o.op === "note" && String(o.inscription_id) === String(iid) && o.matiere_id === mid) { return o; }
    }
    return null;
  }
  function noteAff(iid, mid) { var o = local() ? null : opNote(iid, mid); return o ? o.valeur : noteBase(iid, mid); }
  function absentBase(iid, num) { var a = (inst().absents_evaluation || {})[String(iid)]; return !!(a && a.indexOf(num) >= 0); }
  function opPresence(iid, num) {
    for (var i = S.ops.length - 1; i >= 0; i--) {
      var o = S.ops[i];
      if (o.op === "presence" && String(o.inscription_id) === String(iid) && o.eval_num === num) { return o; }
    }
    return null;
  }
  function absentEval(iid, num) { var o = local() ? null : opPresence(iid, num); return o ? !o.present : absentBase(iid, num); }

  // ------------------------------------------------------------------- calculs (epp/domain/calculs.py)
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
  function totalEval(iid, c, num) {
    var g = grille(c);
    if (!g || absentEval(iid, num)) { return g ? 0 : null; }
    var t = 0, n = 0;
    matieres(g, num).forEach(function (m) {
      var v = noteAff(iid, m.id);
      if (v === null || v === undefined) { return; }
      n++; t += g.mode === "COEF" ? v * m.valeur : v;
    });
    return n ? xround(t, 2) : null;
  }
  function decision(statut, mga, seuil) {
    if (statut === "ABANDON" || statut === "TRANSFERE") { return statut; }
    if (mga === null) { return null; }
    return mga >= seuil ? "ADMIS" : "REDOUBLE";
  }
  function observation(dec, mga, bareme) {
    if (dec === "ADMIS" && mga !== null) {
      var s = mga / bareme * 10;
      return s >= 8 ? "Très bien" : s >= 7 ? "Bien" : s >= 6 ? "Assez bien" : "Passable";
    }
    return dec === "REDOUBLE" ? "Insuffisant" : null;
  }
  function rangs(valeurs, eligibles) {
    var pool = eligibles.map(function (k) { return valeurs[k]; }).filter(function (v) { return v !== null && v !== undefined; });
    var out = {};
    eligibles.forEach(function (k) {
      var v = valeurs[k];
      if (v !== null && v !== undefined) { out[k] = pool.filter(function (x) { return x > v; }).length + 1; }
    });
    return out;
  }
  /** Résultats annuels d'une classe (epp/domain/resultats.compute) : une ligne par élève. */
  function resultatsClasse(code) {
    var c = classe(code);
    if (!c) { return []; }
    var rows = eleves(code).map(function (e) {
      var iid = e.inscription_id;
      var m = [1, 2, 3, 4].map(function (n) { return moyenneEval(iid, c, n); });
      var r = { eleve: e, inscription_id: iid, moy: m, moy_compos: null, mga: null };
      if (regleMga(c) === "MOYENNE4") {
        var v4 = m.filter(function (x) { return x !== null; });
        r.mga = v4.length < 4 ? null : xround(v4.reduce(function (a, b) { return a + b; }, 0) / 4, 2);
      } else {
        var v3 = m.slice(0, 3).filter(function (x) { return x !== null; });
        r.moy_compos = v3.length ? xround(v3.reduce(function (a, b) { return a + b; }, 0) / v3.length, 2) : null;
        r.mga = r.moy_compos === null || m[3] === null ? null : xround((r.moy_compos + 2 * m[3]) / 3, 2);
      }
      r.decision = decision(e.statut, r.mga, c.seuil);
      r.observation = observation(r.decision, r.mga, c.bareme);
      return r;
    });
    var vals = {}, elig = [];
    rows.forEach(function (r) { vals[r.inscription_id] = r.mga; if (r.eleve.statut === "PRESENT") { elig.push(r.inscription_id); } });
    var rk = rangs(vals, elig);
    rows.forEach(function (r) { r.rang = rk[r.inscription_id] || null; });
    return rows;
  }
  function rangsEvaluation(code, num) {
    var c = classe(code), vals = {}, elig = [];
    eleves(code).forEach(function (e) {
      vals[e.inscription_id] = moyenneEval(e.inscription_id, c, num);
      if (e.statut === "PRESENT") { elig.push(e.inscription_id); }
    });
    return rangs(vals, elig);
  }
  function resultat(iid) {
    var e = eleve(iid);
    if (!e) { return null; }
    return resultatsClasse(e.classe).filter(function (r) { return String(r.inscription_id) === String(iid); })[0] || null;
  }

  function absencesAffichees(kind) {
    var cle = kind === "eleve" ? "absences_eleves" : "absences_personnel";
    var suppr = {};
    if (!local()) { S.ops.forEach(function (o) { if (o.op === "suppr_absence" && o.kind === kind) { suppr[o.id] = true; } }); }
    var out = (inst()[cle] || []).filter(function (a) { return !suppr[a.id]; }).map(function (a) {
      var x = {}; for (var k in a) { x[k] = a[k]; }
      x.cible = kind === "eleve" ? a.inscription_id : a.personnel_id;
      return x;
    });
    if (!local()) {
      S.ops.forEach(function (o) {
        if (o.op === "absence" && o.kind === kind) {
          out.push({ attente: o.uid, cible: o.cible, date: o.date, nature: o.nature, jours: o.jours,
                     retard_min: o.retard_min, motif: o.motif, justifie: o.justifie });
        }
      });
    }
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return out;
  }

  // =================================================================== saisies : directes (téléphone seul) ou en attente
  /**
   * Enregistre une saisie. Téléphone utilisé seul : appliquée tout de suite à la base du téléphone, après le mot de
   * passe administrateur du téléphone si elle est protégée. Téléphone associé : mise en attente jusqu'à la
   * prochaine synchronisation ; une saisie protégée y demandera le mot de passe d'un administrateur de l'ordinateur.
   * Renvoie une promesse : vrai si la saisie est enregistrée.
   */
  function executer(op, protection) {
    if (local()) {
      var accord = protection ? demanderAdminLocal(protection.titre, protection.texte) : Promise.resolve(true);
      return accord.then(function (ok) {
        if (ok) {
          try { appliquerLocal(op); sauverBase(); } catch (e) { toast(e.message || String(e), true); ok = false; }
        }
        rendre();
        return ok;
      });
    }
    if (protection) {
      op.protege = true;
      op.message = "Mot de passe d'un administrateur de l'ordinateur demandé à la synchronisation.";
    }
    ajouterOp(op);
    rendre();
    if (protection) { toast("Enregistrée sur le téléphone. Le mot de passe d'un administrateur de l'ordinateur sera demandé à la synchronisation."); }
    return Promise.resolve(true);
  }
  function ajouterOp(op) {
    op.uid = op.uid || uid();
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
  function retirerSansSauver(u) { S.ops = S.ops.filter(function (o) { return o.uid !== u; }); }

  function matriculeEcole(code) {
    var lib = (inst().annee || {}).libelle || "";
    var suffixe = "-" + lib.slice(2, 4), best = 0;
    (S.base.eleves || []).forEach(function (e) {
      var m = String(e.matricule_ecole || ""), p = m.split("-");
      if (m.indexOf(code + "-") === 0 && m.slice(-suffixe.length) === suffixe && p.length >= 3 && /^\d+$/.test(p[p.length - 2])) {
        best = Math.max(best, Number(p[p.length - 2]));
      }
    });
    var n = String(best + 1);
    while (n.length < 3) { n = "0" + n; }
    return code + "-" + n + suffixe;
  }
  function renumeroter() {
    S.base.eleves.forEach(function (e, i) { e.numero = i + 1; e.age = age(e.date_naissance, refAge()); });
    S.base.personnel.forEach(function (p, i) { p.numero = i + 1; });
  }

  /** Applique une saisie à la base du téléphone utilisé seul (mêmes contrôles que l'ordinateur). */
  function appliquerLocal(o) {
    var b = S.base, k = String(o.inscription_id);
    if (o.op === "note") {
      b.notes[k] = b.notes[k] || {};
      if (o.valeur === null) { delete b.notes[k][String(o.matiere_id)]; } else { b.notes[k][String(o.matiere_id)] = o.valeur; }
    } else if (o.op === "presence") {
      var l = b.absents_evaluation[k] || [];
      l = l.filter(function (n) { return n !== o.eval_num; });
      if (!o.present) {
        l.push(o.eval_num);
        var e = eleve(o.inscription_id), g = grille(classe(e && e.classe));
        matieres(g, o.eval_num).forEach(function (m) { if (b.notes[k]) { delete b.notes[k][String(m.id)]; } });
      }
      if (l.length) { b.absents_evaluation[k] = l; } else { delete b.absents_evaluation[k]; }
    } else if (o.op === "absence") {
      var a = { id: nouvelId(), date: o.date, nature: o.nature, jours: o.nature === "ABSENCE" ? o.jours : null,
                retard_min: o.nature === "RETARD" ? o.retard_min : null, motif: o.motif || null, justifie: o.justifie || null,
                observations: o.observations || null, autorisation_id: null };
      if (o.kind === "eleve") { a.inscription_id = o.cible; b.absences_eleves.push(a); } else { a.personnel_id = o.cible; b.absences_personnel.push(a); }
    } else if (o.op === "suppr_absence") {
      var cle = o.kind === "eleve" ? "absences_eleves" : "absences_personnel";
      b[cle] = b[cle].filter(function (x) { return x.id !== o.id; });
    } else if (o.op === "eleve") {
      var d = o.donnees;
      if (!o.inscription_id) {
        var iid = nouvelId();
        var x = { inscription_id: iid, eleve_id: iid, matricule_ecole: d.matricule_ecole || matriculeEcole(d.classe),
                  statut: "PRESENT", redoublant: "NON", type: "INSCRIPTION" };
        for (var f in d) { if (f !== "matricule_ecole") { x[f] = d[f]; } }
        b.eleves.push(x);
      } else {
        var e2 = b.eleves.filter(function (x) { return String(x.inscription_id) === k; })[0];
        if (!e2) { throw new Error("Élève introuvable."); }
        if (d.classe && d.classe !== e2.classe) {
          var g1 = grille(classe(e2.classe)), g2 = grille(classe(d.classe));
          if (g1 !== g2) { delete b.notes[k]; delete b.absents_evaluation[k]; }      // autre grille de notes
          e2.matricule_ecole = matriculeEcole(d.classe);
        }
        for (var f2 in d) { e2[f2] = d[f2]; }
      }
      renumeroter();
    } else if (o.op === "suppr_eleve") {
      b.eleves = b.eleves.filter(function (x) { return String(x.inscription_id) !== k; });
      delete b.notes[k]; delete b.absents_evaluation[k];
      b.absences_eleves = b.absences_eleves.filter(function (x) { return String(x.inscription_id) !== k; });
      renumeroter();
    } else if (o.op === "personnel") {
      if (b.personnel.some(function (p) { return p.matricule === o.donnees.matricule && p.id !== o.id; })) {
        throw new Error("Ce matricule est déjà utilisé.");
      }
      if (!o.id) { var p = copie(o.donnees); p.id = nouvelId(); b.personnel.push(p); }
      else { var q = agent(o.id); for (var f3 in o.donnees) { q[f3] = o.donnees[f3]; } }
      renumeroter();
    } else if (o.op === "suppr_personnel") {
      b.personnel = b.personnel.filter(function (p) { return p.id !== o.id; });
      b.absences_personnel = b.absences_personnel.filter(function (x) { return x.personnel_id !== o.id; });
      renumeroter();
    } else if (o.op === "classe") {
      if (o.id) {
        var c = b.classes.filter(function (x) { return x.id === o.id; })[0];
        for (var f4 in o.donnees) { c[f4] = o.donnees[f4]; }
      } else {
        if (classe(o.donnees.code)) { throw new Error("La classe " + o.donnees.code + " existe déjà."); }
        var nc = copie(o.donnees); nc.id = nouvelId(); b.classes.push(nc);
        b.classes.sort(function (u, v) { return (u.ordre || 0) - (v.ordre || 0) || (u.code < v.code ? -1 : 1); });
      }
    } else if (o.op === "suppr_classe") {
      b.classes = b.classes.filter(function (x) { return x.id !== o.id; });
    } else if (o.op === "ecole") {
      for (var f5 in o.donnees) { b.ecole[f5] = o.donnees[f5]; }
      preparerBase();
    } else {
      throw new Error("Saisie inconnue : " + o.op);
    }
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
    if (o.op === "eleve") { return (o.inscription_id ? "Fiche modifiée : " : "Élève inscrit : ") + ((o.donnees || {}).nom || (e ? e.nom : "?")); }
    if (o.op === "appel") { return "Appel de " + o.classe + " le " + dateFr(o.date) + " : " + o.absents.length + " absent(s)"; }
    if (o.op === "message_lu") { return "Message lu"; }
    if (o.op === "autorisation") { return "Demande d'autorisation d'absence du " + dateFr(o.date_debut) + " au " + dateFr(o.date_fin); }
    return o.op;
  }
  function compterOps(ops) {
    var c = { note: 0, presence: 0, absence: 0, suppr_absence: 0, eleve: 0 };
    ops.forEach(function (o) { c[o.op] = (c[o.op] || 0) + 1; });
    var t = [];
    if (c.eleve) { t.push(c.eleve + " fiche(s) d'élève"); }
    if (c.note) { t.push(c.note + " note(s)"); }
    if (c.presence) { t.push(c.presence + " présence(s) aux évaluations"); }
    if (c.absence) { t.push(c.absence + " absence(s) ou retard(s)"); }
    if (c.suppr_absence) { t.push(c.suppr_absence + " suppression(s) d'absence"); }
    if (c.appel) { t.push(c.appel + " appel(s) du jour"); }
    if (c.autorisation) { t.push(c.autorisation + " demande(s) d'autorisation d'absence"); }
    return t;
  }

  // =================================================================== synchronisation (à la demande)
  /** Résumé de ce qui sera échangé, puis synchronisation si l'utilisateur confirme. */
  function ouvrirSynchro() {
    if (S.occupe) { return; }
    if (!S.infos.associe) { S.vue = "plus"; S.plus = "synchro"; rendre(); return; }
    var fusion = mode() === "transition";
    var protege = S.ops.some(function (o) { return o.protege; });
    var h = "<h3>" + ic("sync") + " Synchroniser avec l'ordinateur</h3>";
    if (fusion) {
      var b = S.base, nn = 0;
      for (var k in b.notes) { nn += Object.keys(b.notes[k]).length; }
      h += '<p class="small">Première synchronisation : les données de ce téléphone sont envoyées à l\'ordinateur de l\'école, ' +
        "qui les ajoute à son année " + esc((b.annee || {}).libelle || "") + " sans jamais remplacer ce qu'il contient déjà " +
        "(les différences vous seront montrées).</p><div class=\"card\"><b>Envoyé</b><ul class=\"small\" style=\"margin:6px 0 0;padding-left:18px\">" +
        "<li>" + b.classes.length + " classe(s), " + b.eleves.length + " élève(s)</li><li>" + nn + " note(s)</li><li>" +
        (b.absences_eleves.length + b.absences_personnel.length) + " absence(s) ou retard(s)</li><li>" + b.personnel.length +
        " agent(s)</li></ul><b style=\"display:block;margin-top:8px\">Reçu</b><p class=\"small\" style=\"margin:4px 0 0\">Les données de l'école à jour. " +
        "Ensuite, le téléphone travaille avec l'ordinateur ; une copie de ses données actuelles est gardée.</p></div>" +
        '<label class="f">Par le Wi-Fi : mot de passe d\'un administrateur de l\'ordinateur</label><input class="c" id="mdpSync" type="password" autocomplete="off">';
    } else {
      var t = compterOps(S.ops);
      h += '<div class="card"><b>Envoyé</b><p class="small" style="margin:4px 0 0">' + (t.length ? esc(t.join(", ")) : "Aucune saisie en attente.") +
        '</p><b style="display:block;margin-top:8px">Reçu</b><p class="small" style="margin:4px 0 0">Les données de l\'école à jour (élèves, notes, ' +
        "absences, personnel) et l'état de la licence de l'ordinateur.</p></div>";
      if (protege) {
        h += '<p class="small warn">Certaines saisies corrigent ou effacent des données déjà enregistrées : elles demandent le mot de passe ' +
          "d'un administrateur de l'ordinateur. Laissez vide pour les garder en attente.</p>" +
          '<label class="f">Mot de passe d\'un administrateur de l\'ordinateur</label><input class="c" id="mdpSync" type="password" autocomplete="off">';
      }
    }
    h += '<p class="mut small">Par le Wi-Fi : le téléphone et l\'ordinateur sur le même réseau, la synchronisation démarrée sur l\'ordinateur ' +
      "(Rapports &amp; administration › Téléphones).</p>" +
      '<div class="rang" style="margin-top:10px"><button class="btn" data-a="fermer">Plus tard</button><span class="esp"></span>' +
      '<button class="btn pri" data-a="sync-go">' + ic("wifi") + " Synchroniser par le Wi-Fi</button></div>" +
      '<div style="margin-top:12px">' + blocFichier(fusion, protege).replace('<div class="card">', '<div class="card" style="margin:0">') + "</div>";
    fenetre(h);
    actionsFenetre["sync-go"] = function () {
      var champ = document.getElementById("mdpSync"), mdp = champ ? champ.value : "";
      if (fusion && !mdp) { toast("Par le Wi-Fi, le mot de passe d'un administrateur de l'ordinateur est nécessaire.", true); return; }
      fermer();
      synchroniser(mdp || null);
    };
  }

  /** Requête envoyée à l'ordinateur (Wi-Fi ou fichier) : saisies en attente, ou données du téléphone utilisé seul. */
  function requeteSynchro(fusion, admin) {
    var aEnvoyer = fusion ? [] : S.ops.slice();
    var req = { ops: aEnvoyer.map(function (o) {
      var x = {}; for (var k in o) { if (k !== "libelle" && k !== "cree_le" && k !== "protege" && k !== "message") { x[k] = o[k]; } }
      return x;
    }), client: { version: S.infos.version, modele: S.infos.modele } };
    if (admin) { req.admin = admin; }
    if (fusion) {
      var b = {};
      for (var k in S.base) { if (k !== "utilisateur" && k !== "licence") { b[k] = S.base[k]; } }
      req.fusion = b;
    }
    return { req: req, aEnvoyer: aEnvoyer };
  }
  function synchroniser(admin) {
    if (S.occupe) { return Promise.resolve(false); }
    var fusion = mode() === "transition";
    var q = requeteSynchro(fusion, admin), req = q.req, aEnvoyer = q.aEnvoyer;
    S.occupe = true;
    majBadge();
    toast("Synchronisation en cours…");
    return attendre(function (id) { N.synchroniser(id, JSON.stringify(req)); }).then(function (r) {
      S.occupe = false;
      return traiterReponse(r, aEnvoyer, fusion);
    });
  }

  // ------------------------------------------------------------------- synchronisation par fichier (hors Wi-Fi)
  function creerDemande(modeEnvoi) {
    var fusion = mode() === "transition";
    var q = requeteSynchro(fusion, null);
    attendre(function (id) { N.creerDemande(id, JSON.stringify(q.req), modeEnvoi); }).then(function (r) {
      if (r && r.ok) {
        S.etat.demande = { le: new Date().toISOString(), saisies: q.aEnvoyer.length, fusion: fusion };
        sauver();
        rendre();
        toast("Fichier créé. Envoyez-le à l'ordinateur de l'école ; vos saisies restent en attente jusqu'à sa réponse.");
      } else if (r && !r.annule) { toast(r.message || "Création du fichier impossible.", true); }
    });
  }
  function ouvrirReponse() {
    attendre(function (id) { N.choisirFichier(id, "reponse"); }).then(appliquerReponseFichier);
  }
  function appliquerReponseFichier(r) {
    if (!r || !r.ok) { if (r && !r.annule) { toast(r.message || "Fichier illisible.", true); } return; }
    S.etat.demande = null;
    S.etat.par_fichier = new Date().toISOString();
    traiterReponse({ ok: true, reponse: r.reponse }, S.ops.slice(), mode() === "transition");
  }
  /** Réponse de l'ordinateur ouverte avec AKWA SCHOOL depuis WhatsApp ou la messagerie. */
  function verifierFichierRecu() {
    if (!S.fichierRecu || !N.aUnFichierRecu || !S.deverrouille || !S.infos.associe) { return; }
    S.fichierRecu = false;
    if (!N.aUnFichierRecu()) { return; }
    confirmer("Réponse de l'ordinateur", "Appliquer la réponse de l'ordinateur de l'école reçue par fichier ? Les données du téléphone seront mises à jour.",
      "Appliquer").then(function (ok) {
      if (ok) { attendre(function (id) { N.ouvrirFichierRecu(id); }).then(appliquerReponseFichier); }
    });
  }
  window.akwaFichierRecu = function () { S.fichierRecu = true; verifierFichierRecu(); };
  function blocFichier(fusion, protege) {
    var d = S.etat.demande;
    return '<div class="card"><h3>' + ic("file") + " Sans Wi-Fi : par fichier</h3><p class=\"small\">Hors de l'école, le téléphone crée un fichier chiffré " +
      "que vous envoyez à l'ordinateur par WhatsApp ou e-mail. Sur l'ordinateur : Téléphones › « Importer un fichier du téléphone » ; il produit une " +
      "réponse à renvoyer au téléphone, que vous ouvrez ici (ou « Ouvrir avec AKWA SCHOOL » depuis WhatsApp).</p>" +
      (fusion || protege ? '<p class="small warn">Le mot de passe d\'un administrateur sera demandé sur l\'ordinateur, à l\'import.</p>' : "") +
      (d ? '<p class="small">Fichier créé le ' + esc(heureFr(d.le)) + " : en attente de la réponse de l'ordinateur.</p>" : "") +
      '<div class="rang"><button class="btn pri" data-a="demande-partager">' + ic("file") + ' Envoyer le fichier</button><button class="btn" ' +
      'data-a="demande-enregistrer">Enregistrer</button></div><button class="btn bloc" style="margin-top:8px" data-a="reponse-ouvrir">' +
      "Ouvrir la réponse de l'ordinateur</button></div>";
  }

  function traiterReponse(r, envoyees, fusion) {
    if (!r || !r.ok) {
      var corps = (r && r.corps) || {};
      majBadge();
      if ((r && r.statut === 401) || corps.code === "CLE") { S.etat.revoque = true; sauver(); }
      rendre();
      toast((r && r.message) || "Synchronisation impossible.", true);
      return false;
    }
    var rep = r.reponse || {};
    if (rep.code === "ADMIN_REQUIS" || rep.code === "FUSION" || rep.code === "COMPTE") {
      rendre();
      toast(rep.erreur, true);
      return false;
    }
    if (rep.instantane) {
      S.inst = rep.instantane;
      N.ecrire("instantane.json", JSON.stringify(S.inst));
    }
    S.etat.derniere = new Date().toISOString();
    S.etat.revoque = false;
    setTimeout(programmerRappels, 0);
    if (fusion && rep.fusion) {
      N.ecrire("archive_autonome.json", N.lire("base.json") || "{}");
      N.supprimer("base.json");
      S.base = null;
      S.etat.fusion = { le: S.etat.derniere, rapport: rep.fusion };
      S.vue = "plus"; S.plus = "synchro";
    }
    var n = 0, a = 0, ref = 0;
    (rep.resultats || []).forEach(function (res) {
      var o = envoyees.filter(function (x) { return x.uid === res.uid; })[0];
      if (!o) { return; }
      if (res.ok) {
        n++;
        retirerSansSauver(o.uid);
        if (o.op === "eleve" && !o.inscription_id && res.inscription_id) {        // élève inscrit : identifiant définitif
          S.ops.forEach(function (x) {
            if (x.inscription_id === "u:" + o.uid) { x.inscription_id = res.inscription_id; }
            if (x.cible === "u:" + o.uid) { x.cible = res.inscription_id; }
          });
        }
        return;
      }
      if (res.code === "ADMIN_REQUIS") { a++; o.protege = true; o.message = res.message; return; }
      ref++;
      retirerSansSauver(o.uid);
      S.etat.rejets.unshift({ libelle: libelleOp(o), message: res.message, le: new Date().toISOString() });
    });
    S.etat.rejets = S.etat.rejets.slice(0, 30);
    sauver();
    rendre();
    if (rep.code === "LICENCE") { toast(rep.erreur, true); return false; }
    if (rep.erreur) { toast(rep.erreur, true); return false; }
    var msg;
    if (fusion && rep.fusion) {
      var f = rep.fusion;
      msg = "Données envoyées : " + f.eleves_ajoutes + " élève(s) et " + f.notes_ajoutees + " note(s) ajoutés" +
        (f.differences.length ? ", " + f.differences.length + " différence(s) à vérifier" : "") + ".";
    } else {
      msg = "Synchronisé" + (n ? " : " + n + " saisie(s) envoyée(s)" : "") + ".";
    }
    if (a) { msg += " " + a + " en attente du mot de passe administrateur."; }
    if (ref) { msg += " " + ref + " refusée(s) : voir Plus › Synchronisation."; }
    toast(msg, ref > 0 || a > 0);
    return true;
  }

  function majBadge() {
    var b = document.getElementById("btnSync");
    if (!b) { return; }
    b.className = "sync" + (S.occupe ? " tourne" : "");
    var badge = b.querySelector(".badge");
    var n = mode() === "transition" ? 1 : S.ops.length;
    badge.textContent = mode() === "transition" ? "!" : String(n);
    badge.classList.toggle("hidden", !n);
  }

  // =================================================================== rendu général
  var app = document.getElementById("app");
  function rendre() {
    if (!N) {
      app.innerHTML = '<div class="ecran"><h1>AKWA SCHOOL</h1><p>Cette page s\'ouvre dans l\'application Android AKWA SCHOOL.</p></div>';
      return;
    }
    var m = mode();
    if (!m) { return rendreBienvenue(); }
    if (S.infos.pin && !S.deverrouille) { return rendreVerrou(); }
    if (!S.infos.pin) { return rendrePin(); }
    if (m === "associe" && !S.inst) { return rendrePremiereSynchro(); }
    if (local()) { rafraichirLicence(); }
    var l = inst().licence || {};
    var ecole = (inst().ecole || {}).ecole_nom || "École";
    var annee = inst().annee ? "Année " + inst().annee.libelle : "Aucune année scolaire";
    var droite = m === "autonome"
      ? '<span class="pill ok" style="flex:none">Téléphone seul</span>'
      : '<button id="btnSync" class="sync" data-a="sync">' + ic("sync") + 'Synchro<span class="badge hidden">0</span></button>';
    var html = '<header class="top"><img src="logo.png" alt=""><div class="t"><b>' + esc(ecole) + "</b><small>" + esc(annee) +
      " · " + esc((inst().utilisateur || {}).nom || "") + "</small></div>" + droite + '</header><main class="vue" id="vue">';
    if (S.etat.revoque && S.infos.associe) {
      html += '<div class="bandeau bad">Ce téléphone n\'est plus reconnu par l\'ordinateur de l\'école (retiré ou réinstallé). ' +
        'Les saisies en attente sont conservées : associez-le de nouveau pour les envoyer.<div style="margin-top:8px">' +
        '<button class="btn sm" data-a="reassocier">Associer de nouveau</button></div></div>';
    }
    if (m === "transition") {
      html += '<div class="bandeau">Téléphone associé à l\'ordinateur de l\'école. Dernière étape : envoyer les données du téléphone ' +
        "(« Synchroniser »), quand le téléphone est sur le Wi-Fi de l'école.</div>";
    }
    if (!licenceOk()) {
      html += vueLicenceBloquee(l);
    } else {
      html += ({ accueil: vueAccueil, eleves: vueEleves, notes: vueNotes, absences: vueAbsences, plus: vuePlus }[S.vue] || vueAccueil)();
    }
    html += "</main>" + nav();
    app.innerHTML = html;
    majBadge();
    if (S.fichierRecu) { setTimeout(verifierFichierRecu, 0); }
  }
  function vueLicenceBloquee(l) {
    if (local()) {
      return '<div class="card"><h3>' + ic("lock") + " Données verrouillées</h3><p>" + esc(l.message || "") + "</p>" +
        '<p class="mut small">Vos données restent sur le téléphone, intactes. Activez un code d\'activation AKWA SCHOOL (1 an ou à vie) : ' +
        "Internet n'est nécessaire qu'à ce moment-là.</p>" + formulaireActivation() +
        (mode() === "autonome" ? '<p class="mut small" style="margin-top:12px">L\'école a l\'application AKWA SCHOOL sur un ordinateur avec ' +
          'une licence valable ? Associez ce téléphone à cet ordinateur.</p><button class="btn bloc" data-a="associer-ecran">' + ic("wifi") +
          " Associer à l'ordinateur de l'école</button>" : '<button class="btn pri bloc" style="margin-top:10px" data-a="sync">' + ic("sync") +
          " Synchroniser</button>") + "</div>";
    }
    return '<div class="card"><h3>' + ic("lock") + " Données verrouillées</h3><p>" + esc(l.message ||
      "La licence de l'application Windows n'est plus valable.") + '</p><p class="mut small">Activez la licence sur ' +
      "l'ordinateur de l'école puis synchronisez ce téléphone : les données réapparaîtront. Les saisies en attente " +
      "sont conservées.</p><button class=\"btn pri bloc\" data-a=\"sync\">" + ic("sync") + " Synchroniser</button></div>";
  }
  function formulaireActivation() {
    return '<label class="f">Code d\'activation</label><input class="c code" id="codeActivation" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" style="font-size:18px">' +
      '<div style="margin-top:10px"><button class="btn pri bloc" data-a="activer">' + ic("key") + ' Activer</button></div><p class="small" id="msgActivation"></p>';
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
    var nRes = 0;
    classes().forEach(function (c) { nRes += resultatsClasse(c.code).filter(function (r) { return r.mga !== null; }).length; });
    var u = inst().utilisateur || {};
    var h = '<div class="card hero"><h2>Bonjour ' + esc(u.nom || "") + "</h2><p>" + esc(u.role || "") + " · " +
      esc((inst().ecole || {}).iepp || "") + "</p></div>";
    if (inst().annee && inst().annee.cloturee) {
      h += '<div class="bandeau">Année ' + esc(inst().annee.libelle) + " clôturée : consultation seulement.</div>";
    }
    if (!local() && messagesNonLus().length) {
      h += '<div class="bandeau">' + ic("mail") + " " + messagesNonLus().length + ' message(s) du directeur. <button class="btn sm" data-a="plus" data-p="messages">Lire</button></div>';
    }
    var rap = notesManquantes();
    if (rap.length) {
      h += '<div class="card"><h3>' + ic("cal") + " À faire</h3>" + rap.map(function (r) {
        return '<p class="small"><b>' + esc(r.classe) + " · " + esc(r.libelle) + "</b> : " + r.manquantes + " note(s) à saisir" +
          (r.fin ? " avant le " + esc(dateFr(r.fin)) : "") + "</p>";
      }).join("") + "</div>";
    }
    if (local() && S.licence && S.licence.statut === "essai") {
      h += '<div class="bandeau">' + esc(S.licence.message) + ' <button class="btn sm" data-a="plus" data-p="licence">Activer un code</button></div>';
    }
    if (local() && !classes().length) {
      h += '<div class="card"><h3>Pour commencer</h3><p class="small">Ajoutez les classes de l\'école (Plus › Classes), puis les élèves.</p>' +
        '<button class="btn pri bloc" data-a="plus" data-p="classes">' + ic("school") + " Classes de l'école</button></div>";
    } else if (local() && !(inst().eleves || []).length) {
      h += '<div class="card"><h3>Ajoutez les élèves</h3><p class="small">Un par un, ou importez la liste (fichier Excel ' +
        ".xlsx ou .xls, comme l'export ELEVES national).</p><div class=\"rang\"><button class=\"btn pri\" data-a=\"eleve-nouveau\">" + ic("ajout") + " Ajouter un élève</button>" +
        '<button class="btn" data-a="plus" data-p="import">' + ic("file") + " Importer</button></div></div>";
    }
    h += '<div class="kpis">' +
      kpi("Élèves", inst().eleves ? els.length : "–", inst().eleves ? g + " garçons · " + (els.length - g) + " filles" : "non autorisé") +
      kpi("Classes", classes().length, "année " + esc(inst().annee ? inst().annee.libelle : "")) +
      kpi("Absents aujourd'hui", inst().absences_eleves ? aujourd : "–", dateFr(aujourdhui())) +
      kpi("Moyennes annuelles", nRes || "–", nRes ? "élèves avec une MGA" : "pas encore calculées") + "</div>";
    if (S.infos.associe) {
      var l = inst().licence || {};
      h += '<div class="card"><h3>Synchronisation</h3><dl class="kv"><dt>Dernière</dt><dd>' + esc(heureFr(S.etat.derniere)) + (S.etat.par_fichier && S.etat.par_fichier === S.etat.derniere ? " (fichier)" : "") +
        "</dd><dt>En attente</dt><dd>" + (mode() === "transition" ? "données du téléphone" : S.ops.length + " saisie(s)") +
        "</dd><dt>Ordinateur</dt><dd>" + esc(S.infos.adresse || "") + "</dd>" +
        (l.valide_jusqua && !local() ? "<dt>Données valables</dt><dd>jusqu'au " + esc(dateFr(l.valide_jusqua)) + "</dd>" : "") +
        '</dl><div style="margin-top:12px"><button class="btn pri bloc" data-a="sync">' + ic("sync") + " Synchroniser maintenant</button></div></div>";
    }
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
    var ajout = perm("eleves.modifier") && modifiable() && classes().length;
    var h = '<div class="ph rang"><div class="esp"><h2>Élèves</h2><p>' + eleves().length + " inscrit(s) en " +
      esc(inst().annee ? inst().annee.libelle : "") + "</p></div>" + (ajout ? '<button class="btn pri sm" data-a="eleve-nouveau">' + ic("ajout") +
      " Ajouter</button>" : "") + "</div>" +
      '<input class="c" id="rech" type="search" placeholder="Nom, matricule, parent…" value="' + esc(S.eleves.q) + '" style="margin-bottom:10px">' +
      chipsClasses(S.eleves.classe, "filtre-classe", true) + '<div class="liste" id="listeEleves">' + lignesEleves() + "</div>";
    if (ajout && perm("import.excel")) {
      h += '<button class="btn bloc" data-a="plus-aller" data-p="import" style="margin-bottom:10px">' + ic("file") + " Importer une liste d'élèves</button>";
    }
    if (perm("personnel.lire") && inst().personnel) {
      h += '<button class="btn bloc" data-a="plus-aller" data-p="personnel">' + ic("users") + " Voir le personnel</button>";
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
      return '<button class="ligne" data-a="fiche" data-i="' + esc(e.inscription_id) + '"><span class="av' + (e.sexe === "F" ? " f" : "") + '">' +
        esc(initiales(e.nom)) + '</span><span class="t"><b>' + esc(e.nom) + "</b><small>" + esc(e.classe) + " · " +
        esc(e.matricule_ecole || "") + (e.age !== null && e.age !== undefined ? " · " + e.age + " ans" : "") + st +
        (e.attente ? ' · <span class="attente-txt">en attente</span>' : "") + "</small></span></button>";
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
    var abs = absencesAffichees("eleve").filter(function (a) { return String(a.cible) === String(iid); });
    var jours = abs.reduce(function (s, a) { return s + (a.nature === "ABSENCE" ? Number(a.jours || 0) : 0); }, 0);
    var h = '<div class="rang"><span class="av' + (e.sexe === "F" ? " f" : "") + '" style="width:48px;height:48px;font-size:16px">' + esc(initiales(e.nom)) +
      '</span><div><h3 style="margin:0">' + esc(e.nom) + '</h3><span class="mut small">' + esc(e.classe) + " · " + esc(e.matricule_ecole || "") + "</span></div></div>" +
      (e.attente ? '<div class="bandeau" style="margin-top:10px">Saisie en attente de la prochaine synchronisation.</div>' : "") +
      '<div class="card" style="margin-top:12px"><dl class="kv"><dt>Matricule DESPS</dt><dd>' + esc(e.matricule_desps || "–") +
      "</dd><dt>Sexe</dt><dd>" + (e.sexe === "F" ? "Fille" : "Garçon") + "</dd><dt>Né(e) le</dt><dd>" + esc(dateFr(e.date_naissance)) +
      (e.localite ? " à " + esc(e.localite) : "") +
      (e.age !== null && e.age !== undefined ? " (" + e.age + " ans)" : "") + "</dd><dt>Nationalité</dt><dd>" + esc(e.nationalite || "–") +
      "</dd><dt>Statut</dt><dd>" + esc(e.statut) + (e.redoublant === "OUI" ? " · redoublant" : "") + "</dd>" +
      (e.groupe_sanguin ? "<dt>Groupe sanguin</dt><dd>" + esc(e.groupe_sanguin) + "</dd>" : "") +
      (e.allergies ? "<dt>Allergies</dt><dd>" + esc(e.allergies) + "</dd>" : "") +
      (e.observations ? "<dt>Observations</dt><dd>" + esc(e.observations) + "</dd>" : "") + "</dl></div>" +
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
        (r.observation ? " · " + esc(r.observation) : "") + "</dd></dl>" : "") + "</div>";
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
    var boutons = "";
    if (perm("eleves.modifier") && modifiable() && !(e.attente && !local() && String(iid).indexOf("u:") === 0)) {
      boutons += '<button class="btn" data-a="eleve-modifier" data-i="' + esc(iid) + '">Modifier la fiche</button>';
    }
    if (local() && perm("eleves.supprimer") && modifiable()) {
      boutons += '<button class="btn dng" data-a="eleve-supprimer" data-i="' + esc(iid) + '">Supprimer</button>';
    }
    h += (boutons ? '<div class="rang" style="margin-bottom:10px">' + boutons + "</div>" : "") + '<button class="btn bloc" data-a="fermer">Fermer</button>';
    fenetre(h);
  }

  // ------------------------------------------------------------------- formulaire élève
  var CHAMPS_FICHE = [
    ["nom", "Nom et prénoms *", "text"], ["sexe", "Sexe *", "sexe"], ["date_naissance", "Date de naissance", "date"],
    ["localite", "Lieu de naissance", "text"], ["classe", "Classe *", "classe"], ["matricule_desps", "Matricule DESPS", "text"],
    ["nationalite", "Nationalité", "nationalite"], ["redoublant", "Redoublant", "ouinon"], ["statut", "Statut", "statut"],
    ["pere_nom", "Nom du père", "text"], ["pere_tel", "Téléphone du père", "tel"], ["mere_nom", "Nom de la mère", "text"],
    ["mere_tel", "Téléphone de la mère", "tel"], ["tuteur_nom", "Tuteur (si autre)", "text"], ["tuteur_tel", "Téléphone du tuteur", "tel"],
    ["groupe_sanguin", "Groupe sanguin", "text"], ["allergies", "Allergies", "text"], ["observations", "Observations", "text"]
  ];
  function champ(f, v) {
    var id = "f_" + f[0], h = '<label class="f" for="' + id + '">' + esc(f[1]) + "</label>";
    var opts = function (l, vide) {
      return '<select class="c" id="' + id + '">' + (vide ? '<option value="">—</option>' : "") + l.map(function (x) {
        var val = Array.isArray(x) ? x[0] : x, lib = Array.isArray(x) ? x[1] : x;
        return '<option value="' + esc(val) + '"' + (String(v || "") === String(val) ? " selected" : "") + ">" + esc(lib) + "</option>";
      }).join("") + "</select>";
    };
    if (f[2] === "sexe") { return h + opts([["M", "Garçon"], ["F", "Fille"]], !v); }
    if (f[2] === "classe") { return h + opts(classes().map(function (c) { return c.code; }), false); }
    if (f[2] === "ouinon") { return h + opts(["NON", "OUI"], false); }
    if (f[2] === "statut") { return h + opts([["PRESENT", "Présent"], ["ABANDON", "Abandon"], ["TRANSFERE", "Transféré"]], false); }
    if (f[2] === "nationalite") { return h + opts(D.nationalites || ["IVOIRIENNE"], true); }
    return h + '<input class="c" id="' + id + '" type="' + (f[2] === "date" ? "date" : f[2] === "tel" ? "tel" : "text") + '" value="' + esc(v || "") +
      '"' + (f[2] === "tel" ? ' inputmode="tel"' : "") + ' maxlength="120">';
  }
  function formulaireEleve(iid) {
    var e = iid !== undefined ? eleve(iid) : null;
    var v = e ? e : { classe: S.eleves.classe || (classes()[0] || {}).code, nationalite: "IVOIRIENNE", redoublant: "NON", statut: "PRESENT" };
    var h = "<h3>" + (e ? "Modifier la fiche" : "Nouvel élève") + "</h3>";
    if (e && !e.attente) {
      h += '<p class="mut small">' + (local() ? "La modification d'une fiche enregistrée demande le mot de passe administrateur." :
        "La correction sera envoyée à la prochaine synchronisation avec le mot de passe d'un administrateur de l'ordinateur.") + "</p>";
    }
    if (!e && N.scanner) {
      h += '<div class="rang" style="margin-bottom:6px"><button class="btn" data-a="scan-extrait" data-s="scanner">' + ic("file") +
        ' Scanner l\'extrait de naissance</button><button class="btn sm" data-a="scan-extrait" data-s="galerie">Photo</button></div>' +
        '<p class="mut small" id="msgScan"></p>';
    }
    CHAMPS_FICHE.forEach(function (f) { if (e || f[0] !== "statut") { h += champ(f, v[f[0]]); } });
    h += '<p class="small bad" id="msgEleve"></p><div class="rang" style="margin-top:8px"><button class="btn" data-a="fermer">Annuler</button><span class="esp"></span>' +
      '<button class="btn pri" data-a="eleve-enregistrer" data-i="' + (e ? esc(iid) : "") + '">Enregistrer</button></div>';
    fenetre(h);
  }
  function lireFiche() {
    var d = {};
    CHAMPS_FICHE.forEach(function (f) {
      var el = document.getElementById("f_" + f[0]);
      if (el) { var x = el.value.trim(); d[f[0]] = x === "" ? null : (f[0] === "nom" ? x.toUpperCase().replace(/\s+/g, " ") : x); }
    });
    if (d.matricule_desps) { d.matricule_desps = d.matricule_desps.replace(/\s/g, "").toUpperCase(); }
    return d;
  }
  /** Mêmes contrôles que repo.validate_eleve : message d'erreur ou null. */
  function erreurEleve(d, iid) {
    if (!d.nom) { return "Le nom et les prénoms sont obligatoires."; }
    if (d.sexe !== "M" && d.sexe !== "F") { return "Le sexe doit être M ou F."; }
    if (!classe(d.classe)) { return "Choisissez la classe."; }
    var m = d.matricule_desps;
    if (m && (m.length !== 9 || !(/[A-Z]/.test(m[0]) || /[A-Z]/.test(m[8])))) {
      return "Matricule DESPS invalide : 9 caractères, avec une lettre majuscule au début ou à la fin (ex. A12345678 ou 12345678B).";
    }
    if (m && eleves().some(function (x) { return x.matricule_desps === m && String(x.inscription_id) !== String(iid); })) {
      return "Ce matricule DESPS est déjà attribué à un autre élève.";
    }
    if (d.date_naissance) {
      var a = age(d.date_naissance, refAge());
      if (a === null) { return "La date de naissance est postérieure à la date de référence (31 décembre de la rentrée)."; }
      if (a > 25) { return "Date de naissance improbable pour un élève du primaire (plus de 25 ans)."; }
    }
    return null;
  }
  function enregistrerEleve(iidTexte) {
    var iid = iidTexte ? idDe(iidTexte) : null;
    var d = lireFiche(), msg = document.getElementById("msgEleve");
    var err = erreurEleve(d, iid);
    if (err) { msg.textContent = err; return; }
    if (iid === null) {
      var doublon = eleves().filter(function (x) { return norm(x.nom) === norm(d.nom) && (x.date_naissance || "") === (d.date_naissance || ""); })[0];
      if (doublon) { msg.textContent = "Cet élève est déjà inscrit (" + doublon.classe + ", " + (doublon.matricule_ecole || "") + ")."; return; }
      fermer();
      executer({ op: "eleve", donnees: d }).then(function (ok) { if (ok) { toast(d.nom + " inscrit en " + d.classe + "."); } });
      return;
    }
    var e = eleve(iid), avant = {}, chg = {};
    for (var k in d) {
      if ((e[k] || null) !== (d[k] || null)) { chg[k] = d[k]; avant[k] = e[k] === undefined ? null : e[k]; }
    }
    if (!Object.keys(chg).length) { fermer(); return; }
    fermer();
    var pendant = !local() && String(iid).indexOf("u:") === 0;
    if (pendant) {                                   // inscription pas encore envoyée : on la corrige directement
      var o = S.ops.filter(function (x) { return "u:" + x.uid === iid; })[0];
      for (var k2 in chg) { o.donnees[k2] = chg[k2]; }
      sauver(); rendre(); return;
    }
    if (chg.classe && local() && grille(classe(chg.classe)) !== grille(classe(e.classe)) && (inst().notes || {})[String(iid)]) {
      toast("Attention : la nouvelle classe a une autre grille de notes ; les notes de l'élève seront effacées.", true);
    }
    executer({ op: "eleve", inscription_id: iid, donnees: chg, avant: avant },
      { titre: "Modifier la fiche de " + e.nom, texte: "La modification d'une fiche enregistrée demande le mot de passe administrateur." })
      .then(function (ok) { if (ok && local()) { toast("Fiche enregistrée."); } });
  }
  function supprimerEleve(iid) {
    var e = eleve(iid);
    confirmer("Supprimer " + e.nom, "L'élève, ses notes et ses absences seront effacés de ce téléphone. Cette opération demande le mot de passe " +
      "administrateur.", "Supprimer", true).then(function (oui) {
      if (!oui) { return; }
      executer({ op: "suppr_eleve", inscription_id: iid }, { titre: "Supprimer " + e.nom, texte: "Mot de passe administrateur du téléphone." })
        .then(function (ok) { if (ok) { fermer(); toast("Élève supprimé."); } });
    });
  }

  // =================================================================== notes
  function vueNotes() {
    if (!perm("notes.lire")) { return '<div class="card vide">Votre compte ne permet pas de consulter les notes.</div>'; }
    var cs = classes().filter(function (c) { return grille(c); });
    if (!cs.length) { return '<div class="card vide">Aucune classe avec une grille de notes.</div>'; }
    if (!classe(S.notes.classe) || !grille(classe(S.notes.classe))) { S.notes.classe = cs[0].code; }
    var h = '<div class="seg">' + ["saisie", "Saisie des notes", "resultats", "Résultats"].reduce(function (acc, x, i, t) {
      if (i % 2) { return acc; }
      return acc + '<button data-a="notes-mode" data-m="' + x + '" class="' + (S.notes.mode === x ? "on" : "") + '">' + t[i + 1] + "</button>";
    }, "") + "</div>";
    return h + (S.notes.mode === "resultats" ? vueResultats() : vueSaisieNotes());
  }
  function vueSaisieNotes() {
    var c = classe(S.notes.classe), g = grille(c), evs = evaluations(c);
    if (!evs.some(function (e) { return e.num === S.notes.ev; })) { S.notes.ev = evs.length ? evs[0].num : 1; }
    var mats = matieres(g, S.notes.ev);
    if (!mats.some(function (m) { return m.id === S.notes.mat; })) { S.notes.mat = mats.length ? mats[0].id : 0; }
    var m = mats.filter(function (x) { return x.id === S.notes.mat; })[0];
    var ev = evs.filter(function (e) { return e.num === S.notes.ev; })[0] || {};
    var fermee = !local() && ev.fermee;
    var saisie = perm("notes.modifier") && modifiable() && !fermee;
    var h = '<p class="mut small" style="margin:0 0 8px">' + (fermee ? "Saisie de cette évaluation fermée par le directeur." :
      saisie ? (local() ? "Les notes sont enregistrées sur le téléphone." :
      "Les notes saisies sont envoyées à la prochaine synchronisation.") : "Consultation seulement.") +
      (ev.fin_saisie && !fermee ? " À saisir avant le " + esc(dateFr(ev.fin_saisie)) + "." : "") + "</p>" + chipsClasses(S.notes.classe, "notes-classe", false) +
      '<div class="rang" style="margin-bottom:10px"><select class="c" data-ch="notes-ev" style="flex:1">' + evs.map(function (e) {
        return '<option value="' + e.num + '"' + (e.num === S.notes.ev ? " selected" : "") + ">" + esc(e.libelle) + "</option>";
      }).join("") + '</select><select class="c" data-ch="notes-mat" style="flex:1">' + mats.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === S.notes.mat ? " selected" : "") + ">" + esc(x.libelle) + "</option>";
      }).join("") + "</select></div>";
    if (!m) { return h + '<div class="card vide">Aucune matière pour cette évaluation.</div>'; }
    var mx = maxNote(g, m);
    h += '<p class="mut small" style="margin:0 0 8px">' + esc(m.libelle) + " : note sur " + nb(mx) + (g.mode === "COEF" ? " (coefficient " + nb(m.valeur) + ")" : "") +
      " · Moy. = moyenne de l'évaluation sur " + nb(g.mode === "COEF" ? g.note_max : g.echelle, 0) + ". Une note déjà enregistrée ne se corrige qu'avec le mot de passe d'un administrateur.</p>";
    var l = eleves(c.code);
    if (!l.length) { return h + '<div class="card vide">Aucun élève dans cette classe.</div>'; }
    if (saisie && N.scanner) {
      h += '<div class="rang" style="margin-bottom:10px"><button class="btn" data-a="scan-notes" data-s="scanner">' + ic("file") +
        ' Scanner la feuille de notes</button><button class="btn sm" data-a="scan-notes" data-s="galerie">Photo</button></div>';
    }
    h += '<div class="liste">' + l.map(function (e) {
      var iid = e.inscription_id, ab = absentEval(iid, S.notes.ev), v = noteAff(iid, m.id), o = local() ? null : opNote(iid, m.id);
      var off = !saisie || ab || e.statut !== "PRESENT";
      return '<div class="note"><span class="t"><b>' + esc(e.nom) + "</b><small>Moy. " + nb(moyenneEval(iid, c, S.notes.ev)) +
        (o ? ' · <span class="attente-txt">en attente</span>' : "") + (e.statut !== "PRESENT" ? " · " + esc(e.statut) : "") + "</small></span>" +
        (saisie && e.statut === "PRESENT" ? '<button class="abs' + (ab ? " on" : "") + '" data-a="presence" data-i="' + esc(iid) + '">' + (ab ? "Absent" : "Abs.") + "</button>" : "") +
        '<input inputmode="decimal" data-ch="note" data-i="' + esc(iid) + '" data-m="' + m.id + '" data-max="' + mx + '" value="' +
        (v === null || v === undefined ? "" : nb(v)) + '"' + (off ? " disabled" : "") + (o ? ' class="attente"' : "") + "></div>";
    }).join("") + "</div>";
    return h;
  }
  function vueResultats() {
    var c = classe(S.notes.classe), evs = evaluations(c);
    var rows = resultatsClasse(c.code).slice().sort(function (a, b) {
      return (a.rang || 9999) - (b.rang || 9999) || (a.eleve.nom < b.eleve.nom ? -1 : 1);
    });
    var adm = rows.filter(function (r) { return r.decision === "ADMIS"; }).length;
    var avec = rows.filter(function (r) { return r.mga !== null; }).length;
    var h = chipsClasses(S.notes.classe, "notes-classe", false) +
      '<div class="kpis"><div class="kpi"><small>Avec une MGA</small><b class="num">' + avec + "</b><span>sur " + rows.length + " élève(s)</span></div>" +
      '<div class="kpi"><small>Admis</small><b class="num">' + adm + "</b><span>" + (avec ? nb(adm / avec * 100, 0) + " %" : "–") +
      " · seuil " + nb(c.seuil) + "/" + nb(c.bareme, 0) + "</span></div></div>";
    if (!rows.length) { return h + '<div class="card vide">Aucun élève dans cette classe.</div>'; }
    h += '<div class="card" style="overflow-x:auto"><table class="t"><tr><th>Rg</th><th>Élève</th>' + evs.map(function (e) {
      return '<th title="' + esc(e.libelle) + '">É' + e.num + "</th>";
    }).join("") + "<th>MGA</th><th>Décision</th></tr>" + rows.map(function (r) {
      return '<tr data-a="fiche" data-i="' + esc(r.inscription_id) + '"><td class="num">' + (r.rang || "–") + "</td><td><b>" + esc(r.eleve.nom) + "</b></td>" +
        r.moy.slice(0, evs.length).map(function (x) { return '<td class="num">' + nb(x) + "</td>"; }).join("") +
        '<td class="num"><b>' + nb(r.mga) + "</b></td><td>" + (r.decision ? '<span class="pill ' + (r.decision === "ADMIS" ? "ok" : r.decision === "REDOUBLE" ? "bad" : "") +
        '">' + esc(r.decision) + "</span>" : "–") + "</td></tr>";
    }).join("") + "</table></div><p class=\"mut small\">MGA : " + (regleMga(c) === "MOYENNE4" ? "moyenne des 4 évaluations." :
      "(moyenne des 3 compositions + 2 × composition de passage) / 3.") + " Mêmes calculs que sur l'ordinateur.</p>" +
      '<button class="btn bloc" data-a="imprimer-direct" data-d="resultats">' + ic("print") + " Imprimer les résultats</button>";
    return h;
  }

  function lireNombre(t) {
    t = String(t || "").trim().replace(",", ".");
    if (t === "") { return null; }
    var x = Number(t);
    return isFinite(x) ? x : NaN;
  }

  function saisirNote(input) {
    var iid = idDe(input.getAttribute("data-i")), mid = Number(input.getAttribute("data-m")), mx = Number(input.getAttribute("data-max"));
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
    var base = noteBase(iid, mid), o = local() ? null : opNote(iid, mid);
    var actuelle = o ? o.valeur : base;
    if (v === actuelle) { return; }
    if (o) { retirerSansSauver(o.uid); }
    if (base === null || v === base) {
      if (v !== base) {
        executer({ op: "note", inscription_id: iid, matiere_id: mid, valeur: v, avant: null, libelle: m.libelle });
      } else { sauver(); majBadge(); rendre(); }
      return;
    }
    // correction (ou effacement) d'une note déjà enregistrée : mot de passe administrateur
    executer({ op: "note", inscription_id: iid, matiere_id: mid, valeur: v, avant: base, libelle: m.libelle },
      { titre: "Corriger une note enregistrée", texte: "La note de " + m.libelle + " de " + e.nom + " est déjà enregistrée (" + nb(base) +
        "). La remplacer par " + (v === null ? "rien (effacer)" : nb(v)) + " demande le mot de passe d'un administrateur." });
  }

  function basculerPresence(iid) {
    var num = S.notes.ev, c = classe(S.notes.classe), e = eleve(iid);
    var ab = absentEval(iid, num), base = absentBase(iid, num), o = local() ? null : opPresence(iid, num);
    var nouveau = !ab;                     // true = noter absent
    if (o) { retirerSansSauver(o.uid); }
    if (!local() && nouveau === base) { sauver(); majBadge(); rendre(); return; }
    var aDesNotes = matieres(grille(c), num).some(function (m) { return noteBase(iid, m.id) !== null; });
    if (nouveau && !local()) {          // notes en attente de cette évaluation : sans objet
      matieres(grille(c), num).forEach(function (m) { var x = opNote(iid, m.id); if (x) { retirerSansSauver(x.uid); } });
    }
    var op = { op: "presence", inscription_id: iid, eval_num: num, present: !nouveau };
    if (nouveau && aDesNotes) {
      confirmer("Absent à l'évaluation", e.nom + " sera noté absent : ses notes de cette évaluation seront effacées et sa moyenne " +
        "vaudra 0. Il faudra le mot de passe d'un administrateur.", "Noter absent", true).then(function (oui) {
        if (!oui) { sauver(); rendre(); return; }
        executer(op, { titre: "Effacer des notes enregistrées", texte: "Mot de passe d'un administrateur pour noter " + e.nom + " absent." });
      });
      return;
    }
    executer(op);
  }

  // =================================================================== absences
  function vueAbsences() {
    if (!perm("absences.lire")) { return '<div class="card vide">Votre compte ne permet pas de consulter les absences.</div>'; }
    var saisie = perm("absences.modifier") && modifiable();
    var h = '<div class="ph"><h2>Absences</h2><p>' + (saisie ? (local() ? "Appel du jour, retards et absences, enregistrés sur le téléphone." :
      "Appel du jour, retards et absences, envoyés à la prochaine synchronisation.") : "Consultation seulement.") + "</p></div>" + '<div class="seg">' +
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
      var a = abs.filter(function (x) { return String(x.cible) === String(e.inscription_id); })[0];
      var etat = a ? (a.nature === "RETARD" ? "r" : "a") : "";
      return '<div class="note"><span class="t"><b>' + esc(e.nom) + "</b><small>" + (a ? (a.nature === "RETARD" ? "Retard " + esc(a.retard_min) + " min" :
        "Absent " + nb(a.jours) + " j") + (a.attente ? ' · <span class="attente-txt">en attente</span>' : " · enregistré") : "Présent") + "</small></span>" +
        '<span class="appel"><button class="a' + (etat === "a" ? " on" : "") + '" data-a="appel" data-n="ABSENCE" data-i="' + esc(e.inscription_id) + '">Absent</button>' +
        '<button class="r' + (etat === "r" ? " on" : "") + '" data-a="appel" data-n="RETARD" data-i="' + esc(e.inscription_id) + '">Retard</button></span></div>';
    }).join("");
    if (!local()) {
      var dejaAppel = S.ops.filter(function (o) { return o.op === "appel" && o.classe === S.abs.classe && o.date === d; })[0];
      h += '</div><button class="btn pri bloc" style="margin-top:10px" data-a="appel-valider">' + ic("check") +
        (dejaAppel ? " Appel validé – valider de nouveau" : " Valider l'appel de " + esc(S.abs.classe)) + "</button><div>";
    }
    return h + '</div><p class="mut small">Touchez « Absent » ou « Retard » ' + (local() ? "; une absence enregistrée se supprime avec le mot de passe administrateur." :
      "; touchez de nouveau pour annuler une saisie en attente.") + " Un motif se précise dans « Saisir ».</p>";
  }

  function dansAnnee(d) {
    var a = inst().annee || {};
    return !!d && !(a.date_debut && d < a.date_debut) && !(a.date_fin && d > a.date_fin);
  }
  function appel(iid, nature) {
    var d = S.abs.date;
    if (!dansAnnee(d)) { toast("La date doit être comprise dans l'année scolaire.", true); return; }
    var a = absencesAffichees("eleve").filter(function (x) { return x.date === d && String(x.cible) === String(iid); })[0];
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
        executer({ op: "absence", kind: "eleve", cible: iid, date: d, nature: "RETARD", retard_min: mn, motif: null, justifie: null });
      };
      return;
    }
    executer({ op: "absence", kind: "eleve", cible: iid, date: d, nature: "ABSENCE", jours: 1, motif: null, justifie: null });
  }

  function vueSaisirAbsence() {
    var k = S.abs.kind;
    var h = '<div class="seg">' + '<button data-a="abs-kind" data-k="eleve" class="' + (k === "eleve" ? "on" : "") + '">Élève</button>' +
      '<button data-a="abs-kind" data-k="personnel" class="' + (k === "personnel" ? "on" : "") + '">Personnel</button></div><div class="card">';
    if (k === "eleve") {
      if (!classe(S.abs.classe)) { S.abs.classe = classes().length ? classes()[0].code : ""; }
      h += chipsClasses(S.abs.classe, "abs-classe", false) + '<label class="f">Élève</label><select class="c" id="fCible">' +
        eleves(S.abs.classe).filter(function (e) { return e.statut === "PRESENT"; }).map(function (e) {
          return '<option value="' + esc(e.inscription_id) + '">' + esc(e.nom) + "</option>";
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
      '<label class="f">Motif</label><select class="c" id="fMotif"><option value="">—</option>' + (inst().motifs_absence || D.motifs_absence || []).map(function (m) {
        return '<option>' + esc(m) + "</option>";
      }).join("") + '</select><label class="f">Justifiée</label><select class="c" id="fJust"><option value="">—</option><option>OUI</option><option>NON</option></select>' +
      '<label class="f">Observations</label><input class="c" id="fObs" maxlength="200">' +
      '<div style="margin-top:14px"><button class="btn pri bloc" data-a="abs-enregistrer">Enregistrer</button></div></div>';
    return h;
  }

  function enregistrerAbsence() {
    var g = function (id) { return document.getElementById(id).value; };
    var a = inst().annee || {};
    var cible = idDe(g("fCible")), d = g("fDate"), nature = g("fNature");
    if (!g("fCible")) { toast("Choisissez " + (S.abs.kind === "eleve" ? "l'élève." : "l'agent."), true); return; }
    if (!dansAnnee(d)) { toast("La date doit être comprise dans l'année scolaire " + (a.libelle || "") + ".", true); return; }
    var deja = absencesAffichees(S.abs.kind).filter(function (x) { return String(x.cible) === String(cible) && x.date === d; })[0];
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
    S.abs.date = d;
    executer(op).then(function (ok) {
      if (ok) { toast(local() ? "Enregistrée." : "Enregistrée sur le téléphone : elle sera envoyée à la prochaine synchronisation."); }
    });
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
    confirmer("Supprimer une absence", "L'absence du " + dateFr(a.date) + " de " + (qui ? qui.nom : "?") + " est enregistrée" +
      (local() ? "" : " sur l'ordinateur") + ". Sa suppression demande le mot de passe d'un administrateur.", "Supprimer", true).then(function (oui) {
      if (!oui) { return; }
      executer({ op: "suppr_absence", kind: kind, id: a.id, date: a.date },
        { titre: "Supprimer une absence", texte: "Mot de passe d'un administrateur pour supprimer l'absence du " + dateFr(a.date) + "." });
    });
  }

  // =================================================================== plus
  function lignePlus(p, icone, titre, sous) {
    return '<button class="ligne" data-a="plus" data-p="' + p + '">' + ic(icone) + '<span class="t"><b>' + esc(titre) + "</b><small>" + esc(sous) +
      "</small></span>›</button>";
  }
  function vuePlus() {
    var pages = { messages: vueMessages, demande: vueDemandeAbsence, personnel: vuePersonnel, synchro: vueSynchro, ecole: vueEcole, classes: vueClasses, import: vueImport,
                  imprimer: vueImprimer, exporter: vueExporter, sauvegarde: vueSauvegarde, licence: vueLicence, securite: vueSecurite };
    if (pages[S.plus]) {
      return '<div class="rang ph"><button class="btn sm" data-a="plus" data-p="menu">‹ Retour</button></div>' + pages[S.plus]();
    }
    var h = '<div class="ph"><h2>Plus</h2></div><div class="liste">';
    if (!local() && inst().messages) {
      var nl = messagesNonLus().length;
      h += lignePlus("messages", "mail", "Messages du directeur", nl ? nl + " nouveau(x)" : inst().messages.length + " message(s)");
    }
    if (!local() && (inst().utilisateur || {}).personnel_id && perm("absences.modifier")) {
      h += lignePlus("demande", "cal", "Demander une autorisation d'absence", "Envoyée au directeur, qui accorde ou refuse");
    }
    if (inst().personnel && perm("personnel.lire")) { h += lignePlus("personnel", "users", "Personnel", inst().personnel.length + " agent(s)"); }
    if (local()) {
      h += lignePlus("ecole", "school", "École", "Nom, IEPP, directeur, année scolaire") +
        lignePlus("classes", "school", "Classes", classes().length + " classe(s), grilles de notes");
    }
    if (perm("eleves.modifier") && modifiable()) { h += lignePlus("import", "file", "Importer des élèves", "Fichier Excel (.xlsx, .xls) : export ELEVES national ou liste"); }
    h += lignePlus("imprimer", "print", "Imprimer", "Listes, fiches de notes, résultats, bulletins, absences (PDF)") +
      lignePlus("exporter", "file", "Exporter", "Classeurs Excel : élèves, listes, résultats, absences");
    if (local()) { h += lignePlus("sauvegarde", "save", "Sauvegarde", "Copie chiffrée des données, restauration"); }
    h += lignePlus("synchro", "pc", "Ordinateur de l'école", S.infos.associe ? "Synchronisation, saisies en attente" : "Facultatif : associer et synchroniser") +
      (local() ? lignePlus("licence", "key", "Licence", S.licence ? S.licence.message : "") : "") +
      lignePlus("securite", "lock", "Sécurité", "Verrouiller, code PIN" + (local() ? ", mot de passe administrateur" : "")) + "</div>";
    h += '<div class="card"><h3>Ce téléphone</h3><p class="mut small">' + esc(S.infos.modele || "") + " · Android " + esc(S.infos.android || "") +
      " · AKWA SCHOOL " + esc(S.infos.version || "") + "</p></div>";
    return h;
  }
  function vuePersonnel() {
    var l = inst().personnel || [];
    var edit = local() && perm("personnel.modifier");
    return '<div class="rang ph"><h2 class="esp">Personnel</h2>' + (edit ? '<button class="btn pri sm" data-a="agent-form">' + ic("ajout") + " Ajouter</button>" : "") +
      '</div><div class="liste">' +
      (l.length ? l.map(function (p) {
        return '<div class="ligne"><span class="av' + (p.sexe === "F" ? " f" : "") + '">' + esc(initiales(p.nom)) + '</span><span class="t"><b>' +
          esc(p.nom) + "</b><small>" + esc(p.fonction || "") + (p.classe_tenue && p.classe_tenue !== "-" ? " · " + esc(p.classe_tenue) : "") +
          " · " + esc(p.matricule || "") + "</small></span>" + (p.telephone ? '<a class="btn sm" href="tel:' +
          esc(String(p.telephone).replace(/[^0-9+]/g, "")) + '">' + ic("tel") + "</a>" : "") +
          (edit ? '<button class="btn sm" data-a="agent-form" data-x="' + p.id + '">Modifier</button>' : "") + "</div>";
      }).join("") : '<div class="vide">Aucun agent.</div>') + "</div>" +
      (local() ? "" : '<p class="mut small">La fiche du personnel se modifie sur l\'ordinateur.</p>');
  }
  function formulaireAgent(pid) {
    var p = pid ? agent(pid) : { sexe: "M", fonction: "INSTITUTEUR ORDINAIRE", classe_tenue: "-" };
    var sel = function (id, l, v) {
      return '<select class="c" id="' + id + '">' + l.map(function (x) {
        var val = Array.isArray(x) ? x[0] : x, lib = Array.isArray(x) ? x[1] : x;
        return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? " selected" : "") + ">" + esc(lib) + "</option>";
      }).join("") + "</select>";
    };
    fenetre("<h3>" + (pid ? "Modifier l'agent" : "Nouvel agent") + '</h3><label class="f">Matricule *</label><input class="c" id="a_matricule" value="' + esc(p.matricule || "") +
      '"><label class="f">Nom et prénoms *</label><input class="c" id="a_nom" value="' + esc(p.nom || "") + '"><label class="f">Sexe</label>' +
      sel("a_sexe", [["M", "Homme"], ["F", "Femme"]], p.sexe) + '<label class="f">Fonction</label>' + sel("a_fonction", D.fonctions || [], p.fonction) +
      '<label class="f">Classe tenue</label>' + sel("a_classe", ["-"].concat(classes().map(function (c) { return c.code; })), p.classe_tenue || "-") +
      '<label class="f">Grade</label><input class="c" id="a_grade" value="' + esc(p.grade || "") + '"><label class="f">Téléphone</label><input class="c" id="a_tel" type="tel" inputmode="tel" value="' +
      esc(p.telephone || "") + '"><p class="small bad" id="msgAgent"></p><div class="rang" style="margin-top:8px">' +
      (pid ? '<button class="btn dng" data-a="agent-suppr" data-x="' + pid + '">Supprimer</button>' : '<button class="btn" data-a="fermer">Annuler</button>') +
      '<span class="esp"></span><button class="btn pri" data-a="agent-ok" data-x="' + (pid || "") + '">Enregistrer</button></div>');
  }
  function enregistrerAgent(pid) {
    var g = function (id) { return document.getElementById(id).value.trim(); };
    var d = { matricule: g("a_matricule").toUpperCase(), nom: g("a_nom").toUpperCase(), sexe: g("a_sexe"), fonction: g("a_fonction"),
              classe_tenue: g("a_classe"), grade: g("a_grade") || null, telephone: g("a_tel") || null };
    var m = document.getElementById("msgAgent");
    if (!d.matricule) { m.textContent = "Le matricule est obligatoire."; return; }
    if (!d.nom) { m.textContent = "Le nom est obligatoire."; return; }
    fermer();
    executer({ op: "personnel", id: pid || null, donnees: d });
  }

  // ------------------------------------------------------------------- ordinateur de l'école
  function vueSynchro() {
    var h = '<h2 style="margin-bottom:10px">Ordinateur de l\'école</h2>';
    if (!S.infos.associe) {
      return h + '<div class="card"><p>Ce téléphone fonctionne seul. Si l\'école utilise AKWA SCHOOL sur un ordinateur, vous pouvez l\'y associer ' +
        "quand vous le souhaitez : ses données (classes, élèves, notes, absences, personnel) seront envoyées à l'ordinateur, " +
        "qui ne remplace jamais ce qu'il contient déjà. Ensuite, vous synchronisez quand vous en avez besoin.</p>" +
        '<ol class="etapes"><li>Sur l\'ordinateur : Rapports &amp; administration › Téléphones › « Démarrer la synchronisation », puis « Afficher un code ».</li>' +
        "<li>Le téléphone sur le même Wi-Fi, touchez « Associer » et saisissez le code.</li><li>Touchez « Synchroniser » : le mot de passe d'un " +
        "administrateur de l'ordinateur est demandé.</li></ol><button class=\"btn pri bloc\" data-a=\"associer-ecran\" style=\"margin-top:10px\">" + ic("wifi") +
        " Associer à l'ordinateur</button></div>";
    }
    h += '<div class="card"><dl class="kv"><dt>Ordinateur</dt><dd>' + esc(S.infos.adresse || "") + "</dd><dt>Dernière</dt><dd>" + esc(heureFr(S.etat.derniere)) +
      "</dd>" + (S.inst ? "<dt>Compte</dt><dd>" + esc((S.inst.utilisateur || {}).nom || "") + " (" + esc((S.inst.utilisateur || {}).role || "") + ")</dd>" : "") +
      '</dl><p class="mut small">La synchronisation se fait seulement quand vous la demandez, sur le Wi-Fi de l\'école. Entre deux, le téléphone ' +
      "fonctionne sans réseau et garde vos saisies.</p>" + '<button class="btn pri bloc" data-a="sync">' + ic("sync") + " Synchroniser maintenant</button></div>" +
      blocFichier(mode() === "transition", S.ops.some(function (o) { return o.protege; }));
    var f = S.etat.fusion;
    if (f) {
      var r = f.rapport;
      h += '<div class="card"><h3>Données du téléphone envoyées le ' + esc(heureFr(f.le)) + '</h3><p class="small">' + r.eleves_ajoutes + " élève(s) ajouté(s), " +
        r.eleves_reconnus + " déjà connu(s) ; " + r.notes_ajoutees + " note(s) ajoutée(s) ; " + r.absences_ajoutees + " absence(s) ; " +
        r.personnel_ajoute + " agent(s) ; " + r.classes_creees + " classe(s) créée(s).</p>";
      if (r.differences.length) {
        h += '<p class="small warn">Notes différentes sur l\'ordinateur (non remplacées, à vérifier) :</p>' + r.differences.slice(0, 60).map(function (x) {
          return '<div class="small" style="padding:3px 0;border-bottom:1px solid var(--line)"><b>' + esc(x.eleve) + "</b> · " + esc(x.quoi) +
            " : téléphone " + esc(x.telephone) + ", ordinateur " + esc(x.ordinateur) + "</div>";
        }).join("");
      }
      if (r.erreurs.length) {
        h += '<p class="small bad">Non envoyé :</p>' + r.erreurs.slice(0, 60).map(function (x) { return '<div class="small">' + esc(x) + "</div>"; }).join("");
      }
      h += '<div class="rang" style="margin-top:10px"><button class="btn sm" data-a="fusion-effacer">Effacer ce compte rendu</button></div></div>';
    }
    if (mode() === "associe") {
      h += '<div class="card"><h3>Saisies en attente (' + S.ops.length + ")</h3>" + (S.ops.length ? S.ops.map(function (o) {
        return '<div class="note" style="padding:8px 0"><span class="t"><b style="white-space:normal">' + esc(libelleOp(o)) + "</b>" +
          (o.protege ? '<small class="warn">' + esc(o.message || "Mot de passe administrateur nécessaire") + "</small>" : "") +
          '</span><button class="btn sm" data-a="op-annuler" data-u="' + esc(o.uid) + '">Annuler</button></div>';
      }).join("") : '<p class="mut small">Aucune : tout est sur l\'ordinateur.</p>') + "</div>";
    }
    if (S.etat.rejets.length) {
      h += '<div class="card"><h3>Saisies refusées par l\'ordinateur</h3>' + S.etat.rejets.map(function (r) {
        return '<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>' + esc(r.libelle) + '</b><br><span class="bad">' +
          esc(r.message) + "</span></div>";
      }).join("") + '<div style="margin-top:10px"><button class="btn sm" data-a="rejets-effacer">Effacer la liste</button></div></div>';
    }
    h += '<div class="card"><h3>Dissocier</h3><p class="mut small">Le téléphone n\'échangera plus avec cet ordinateur. Vous pourrez continuer ' +
      "seul avec une copie des données actuelles, ou tout effacer.</p><button class=\"btn dng\" data-a=\"dissocier\">Dissocier ce téléphone</button></div>";
    return h;
  }

  // ------------------------------------------------------------------- école et classes (téléphone seul)
  function vueEcole() {
    var e = inst().ecole || {}, a = inst().annee || {};
    var ch = function (k, t) { return '<label class="f">' + t + '</label><input class="c" id="e_' + k + '" value="' + esc(e[k] || "") + '">'; };
    return '<h2 style="margin-bottom:10px">École</h2><div class="card">' + ch("ecole_nom", "Nom de l'école") + ch("code_ecole", "Code de l'école") +
      ch("iepp", "IEPP") + ch("dren", "DRENAET") + ch("localite", "Localité") + ch("directeur", "Directeur / Directrice") + ch("ministere", "Ministère") +
      '<div style="margin-top:12px"><button class="btn pri bloc" data-a="ecole-ok">Enregistrer</button></div></div>' +
      '<div class="card"><h3>Année scolaire ' + esc(a.libelle || "") + '</h3><p class="mut small">Du ' + esc(dateFr(a.date_debut)) + " au " + esc(dateFr(a.date_fin)) +
      ". Âges calculés au " + esc(dateFr(refAge())) + ".</p></div>";
  }
  function vueClasses() {
    var h = '<div class="rang ph"><h2 class="esp">Classes</h2><button class="btn pri sm" data-a="classe-form">' + ic("ajout") + " Ajouter</button></div>";
    if (!classes().length) { return h + '<div class="card vide">Aucune classe.</div>'; }
    return h + '<div class="liste">' + classes().map(function (c) {
      var g = grille(c), n = eleves(c.code).length;
      return '<button class="ligne" data-a="classe-form" data-x="' + c.id + '"><span class="av">' + esc(c.code.slice(0, 3)) + '</span><span class="t"><b>' + esc(c.libelle || c.code) +
        "</b><small>" + n + " élève(s) · " + esc(g ? g.libelle : "sans grille") + " · admis à " + nb(c.seuil) + "/" + nb(c.bareme, 0) + "</small></span>›</button>";
    }).join("") + '</div><p class="mut small">Les grilles de notes (matières, coefficients, barèmes) sont celles de l\'application Windows.</p>';
  }
  function niveauDe(code) { var m = /^(CP1|CP2|CE1|CE2|CM1|CM2)/.exec(String(code || "").toUpperCase().replace(/\s/g, "")); return m ? m[1] : null; }
  function formulaireClasse(cid) {
    var c = cid ? classes().filter(function (x) { return x.id === cid; })[0] : null;
    var niveaux = (D.classes || []).map(function (x) { return x.code; });
    fenetre("<h3>" + (c ? "Classe " + esc(c.code) : "Nouvelle classe") + "</h3>" + (c ? "" :
      '<label class="f">Niveau</label><select class="c" id="c_niveau">' + niveaux.map(function (n) { return "<option>" + n + "</option>"; }).join("") +
      '</select><label class="f">Code de la classe (ex. CP1 ou CP1 A)</label><input class="c" id="c_code" maxlength="12" autocapitalize="characters">') +
      '<label class="f">Libellé</label><input class="c" id="c_libelle" value="' + esc(c ? c.libelle || "" : "") + '" maxlength="40">' +
      (c ? '<label class="f">Moyenne de passage (sur ' + nb(c.bareme, 0) + ')</label><input class="c" id="c_seuil" inputmode="decimal" value="' + nb(c.seuil) + '">' : "") +
      '<p class="small bad" id="msgClasse"></p><div class="rang" style="margin-top:8px">' +
      (c ? '<button class="btn dng" data-a="classe-suppr" data-x="' + c.id + '">Supprimer</button>' : '<button class="btn" data-a="fermer">Annuler</button>') +
      '<span class="esp"></span><button class="btn pri" data-a="classe-ok" data-x="' + (c ? c.id : "") + '">Enregistrer</button></div>');
  }
  function enregistrerClasse(cid) {
    var m = document.getElementById("msgClasse");
    var lib = document.getElementById("c_libelle").value.trim();
    if (cid) {
      var c = classes().filter(function (x) { return x.id === cid; })[0];
      var s = lireNombre(document.getElementById("c_seuil").value);
      if (!(s >= 0 && s <= c.bareme)) { m.textContent = "Le seuil doit être compris entre 0 et " + nb(c.bareme, 0) + "."; return; }
      fermer();
      executer({ op: "classe", id: cid, donnees: { libelle: lib || c.code, seuil: s } });
      return;
    }
    var niv = document.getElementById("c_niveau").value;
    var code = (document.getElementById("c_code").value.trim() || niv).toUpperCase().replace(/\s+/g, " ");
    if (niveauDe(code) !== niv) { m.textContent = "Le code doit commencer par le niveau (" + niv + ")."; return; }
    if (classe(code)) { m.textContent = "La classe " + code + " existe déjà."; return; }
    var def = (D.classes || []).filter(function (x) { return x.code === niv; })[0];
    var g = (S.base.grilles || []).filter(function (x) { return x.code === def.grille; })[0];
    fermer();
    executer({ op: "classe", donnees: { code: code, libelle: lib || code, ordre: (D.classes || []).indexOf(def) * 10 + classes().length,
      niveau_suivant: def.niveau_suivant, seuil: def.seuil, bareme: def.bareme, grille_id: g ? g.id : null, calendrier: def.calendrier,
      regle_mga: def.regle_mga } });
  }
  function supprimerClasse(cid) {
    var c = classes().filter(function (x) { return x.id === cid; })[0];
    if (eleves(c.code).length) { toast("Impossible de supprimer une classe qui compte des élèves.", true); return; }
    fermer();
    executer({ op: "suppr_classe", id: cid }, { titre: "Supprimer la classe " + c.code, texte: "Mot de passe administrateur du téléphone." });
  }

  // ------------------------------------------------------------------- import des élèves
  var IMPORT = null;
  function vueImport() {
    var h = '<h2 style="margin-bottom:6px">Importer des élèves</h2><p class="mut small">Fichier Excel (.xlsx ou .xls) : l\'export ELEVES ' +
      "national, celui de l'application Windows, ou toute liste avec au moins les colonnes nom, prénoms, sexe et niveau (ou classe). Date de naissance en jour / mois / année ou en une colonne. " +
      "Les doublons (même matricule, ou même nom et même date de naissance) sont écartés. Un fichier .csv est aussi accepté.</p>" +
      '<button class="btn pri bloc" data-a="import-choisir">' + ic("file") + " Choisir le fichier</button>";
    if (IMPORT) {
      var ok = IMPORT.lignes.filter(function (x) { return x.etat === "ok"; });
      h += '<div class="card" style="margin-top:12px"><h3>' + esc(IMPORT.nom) + '</h3><p class="small">' + ok.length + " élève(s) à importer · " +
        IMPORT.lignes.filter(function (x) { return x.etat === "doublon"; }).length + " doublon(s) · " +
        IMPORT.lignes.filter(function (x) { return x.etat === "erreur"; }).length + " erreur(s)</p>" +
        IMPORT.lignes.filter(function (x) { return x.etat !== "ok"; }).slice(0, 80).map(function (x) {
          return '<div class="small" style="padding:3px 0;border-bottom:1px solid var(--line)">Ligne ' + x.ligne + " · " + esc(x.nom || "") + ' : <span class="' +
            (x.etat === "erreur" ? "bad" : "warn") + '">' + esc(x.motif) + "</span></div>";
        }).join("") + (ok.length ? '<div style="margin-top:12px"><button class="btn pri bloc" data-a="import-ok">Importer ' + ok.length + " élève(s)</button></div>" : "") +
        (!local() && ok.length ? '<p class="mut small">Les élèves seront inscrits sur l\'ordinateur à la prochaine synchronisation.</p>' : "") + "</div>";
    }
    return h;
  }
  var COLONNES = ["codedren", "codeiep", "iep", "codeecole", "ecole", "matricule", "nom", "prenoms", "sexe", "jour", "mois", "annee", "nationalite",
    "localite", "codesp", "sp", "pere", "mere", "nacte", "lieuacte", "residence", "niveau"];
  var ALIAS = { nom: ["nom"], prenoms: ["prenoms", "prenom"], niveau: ["niveau", "classe"], sexe: ["sexe", "genre"],
    naissance: ["naissance", "datedenaissance", "datenaissance"], jour: ["jour"], mois: ["mois"], annee: ["annee"],
    matricule: ["matricule", "matriculedesps"], nacte: ["nacte", "actenum", "numeroacte", "ndelacte", "numeroextrait"],
    lieuacte: ["lieuacte", "centreetatcivil", "centre"], nationalite: ["nationalite"], localite: ["localite", "lieu", "lieudenaissance"],
    pere: ["pere"], mere: ["mere"], telephone: ["telephone", "contact", "tel"] };
  function vide0(v) { var s = String(v || "").trim(); return /^(aucun|aucune|neant|néant|0|-)$/i.test(s) ? "" : s; }
  function dateImport(j, m, a, brut) {
    var f = function (y, mo, d) {
      var dt = new Date(Date.UTC(y, mo - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? y + "-" + p2(mo) + "-" + p2(d) : null;
    };
    if (a) { var r = f(Math.floor(Number(a)), Math.floor(Number(m)), Math.floor(Number(j))); return r ? [r, false] : [null, true]; }
    if (!brut) { return [null, false]; }
    var s = String(brut).trim(), x;
    if ((x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) { return [f(+x[1], +x[2], +x[3]), !f(+x[1], +x[2], +x[3])]; }
    if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { var d2 = f(+x[3], +x[2], +x[1]); return [d2, !d2]; }
    if (/^\d{4,5}(\.\d+)?$/.test(s)) {                 // numéro de série d'Excel
      var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
      return [dt.getUTCFullYear() + "-" + p2(dt.getUTCMonth() + 1) + "-" + p2(dt.getUTCDate()), false];
    }
    return [null, true];
  }
  function classeDuNiveau(niveau) {
    var n = String(niveau || "").toUpperCase().replace(/\s/g, "");
    if (!n) { return null; }
    var exact = classes().filter(function (c) { return c.code.toUpperCase().replace(/\s/g, "") === n; });
    if (exact.length) { return exact[0].code; }
    var cand = classes().filter(function (c) { return c.code.toUpperCase().replace(/\s/g, "").indexOf(n) === 0; });
    if (!cand.length) { return null; }
    cand.sort(function (a, b) { return eleves(a.code).length - eleves(b.code).length; });
    return cand[0].code;
  }
  /** Analyse du fichier (règles de epp/io/import_eleves19.analyser) : rien n'est enregistré. */
  function analyserImport(nom, lignes) {
    if (lignes.length < 2) { throw new Error("Fichier vide ou sans ligne de données."); }
    var h = lignes[0].map(norm), col = {}, debut = 1;
    Object.keys(ALIAS).forEach(function (k) { col[k] = -1; for (var i = 0; i < h.length; i++) { if (ALIAS[k].indexOf(h[i]) >= 0) { col[k] = i; break; } } });
    var oblig = ["nom", "niveau", "sexe"];
    if (oblig.some(function (k) { return col[k] < 0; })) {
      if (lignes[0].length === COLONNES.length && norm(lignes[0][6]) !== "nom") {
        Object.keys(ALIAS).forEach(function (k) { col[k] = COLONNES.indexOf(k); });
        debut = 0;
      } else {
        throw new Error("Colonnes obligatoires manquantes : " + oblig.filter(function (k) { return col[k] < 0; }).join(", ") + ".");
      }
    }
    var v = function (r, k) { return col[k] >= 0 ? String(r[col[k]] || "").trim() : ""; };
    var vus = {}, out = [];
    for (var i = debut; i < lignes.length; i++) {
      var r = lignes[i], nomc = (v(r, "nom") + " " + v(r, "prenoms")).trim().toUpperCase().replace(/\s+/g, " ");
      var x = { ligne: i + 1, nom: nomc, etat: "ok", motif: "" };
      var sx = norm(v(r, "sexe"));
      var sexe = ["m", "masculin", "garcon", "g", "h", "homme"].indexOf(sx) >= 0 ? "M" : ["f", "feminin", "fille", "femme"].indexOf(sx) >= 0 ? "F" : "";
      var dn = dateImport(v(r, "jour"), v(r, "mois"), v(r, "annee"), v(r, "naissance"));
      var mat = vide0(v(r, "matricule")).replace(/\s/g, "").toUpperCase();
      var cl = classeDuNiveau(v(r, "niveau"));
      var nacte = vide0(v(r, "nacte"));
      x.donnees = { nom: nomc, sexe: sexe, date_naissance: dn[0], classe: cl, matricule_desps: mat || null,
        nationalite: vide0(v(r, "nationalite")).toUpperCase() || null, localite: vide0(v(r, "localite")) || null,
        pere_nom: vide0(v(r, "pere")) || null, mere_nom: vide0(v(r, "mere")) || null, pere_tel: vide0(v(r, "telephone")) || null,
        extrait: nacte ? "OUI" : "NON", acte_num: nacte || null, centre_etat_civil: vide0(v(r, "lieuacte")) || null };
      if (!nomc) { x.etat = "erreur"; x.motif = "nom manquant"; }
      else if (!sexe) { x.etat = "erreur"; x.motif = "sexe illisible (" + v(r, "sexe") + ")"; }
      else if (!cl) { x.etat = "erreur"; x.motif = "aucune classe pour le niveau « " + v(r, "niveau") + " » (créez-la d'abord)"; }
      else if (dn[1]) { x.etat = "erreur"; x.motif = "date de naissance illisible"; }
      else {
        var err = erreurEleve(x.donnees, null);
        var cleNom = norm(nomc) + "|" + (dn[0] || "");
        if (err && err.indexOf("déjà attribué") < 0) { x.etat = "erreur"; x.motif = err; }
        else if ((mat && (vus["m" + mat] || eleves().some(function (e) { return e.matricule_desps === mat; }))) || vus[cleNom] ||
                 eleves().some(function (e) { return norm(e.nom) + "|" + (e.date_naissance || "") === cleNom; })) {
          x.etat = "doublon"; x.motif = "déjà inscrit ou répété dans le fichier";
        }
        vus[cleNom] = true;
        if (mat) { vus["m" + mat] = true; }
      }
      out.push(x);
    }
    return { nom: nom, lignes: out };
  }
  function choisirImport() {
    attendre(function (id) { N.choisirFichier(id, "tableau"); }).then(function (r) {
      if (!r || !r.ok) { if (r && !r.annule) { toast(r.message || "Fichier illisible.", true); } return; }
      try { IMPORT = analyserImport(r.nom || "fichier", r.lignes || []); } catch (e) { IMPORT = null; toast(e.message, true); }
      rendre();
    });
  }
  function importer() {
    var ok = IMPORT.lignes.filter(function (x) { return x.etat === "ok"; });
    if (local()) {
      ok.forEach(function (x) { appliquerLocal({ op: "eleve", donnees: x.donnees }); });
      sauverBase();
    } else {
      ok.forEach(function (x) { ajouterOp({ op: "eleve", donnees: x.donnees }); });
    }
    toast(ok.length + " élève(s) importé(s)" + (local() ? "." : " : ils seront inscrits à la prochaine synchronisation."));
    IMPORT = null;
    S.vue = "eleves";
    rendre();
  }

  // ------------------------------------------------------------------- impression et exports
  function contexteDocs() {
    return { inst: inst, classes: classes, classe: classe, grille: grille, evaluations: evaluations, matieres: matieres,
             eleves: eleves, eleve: eleve, agent: agent, noteAff: noteAff, absentEval: absentEval, moyenneEval: moyenneEval,
             totalEval: totalEval, resultatsClasse: resultatsClasse, rangsEvaluation: rangsEvaluation, absences: absencesAffichees,
             refAge: refAge };
  }
  function vueImprimer() {
    var p = S.impression, docs = DOCS ? DOCS.liste : [];
    if (!docs.length) { return '<p class="mut">Impression indisponible.</p>'; }
    var d = docs.filter(function (x) { return x.id === p.doc; })[0] || docs[0];
    if (!classe(p.classe) && !(d.toutes && p.classe === "")) { p.classe = (classes()[0] || {}).code || ""; }
    var c = classe(p.classe) || classes()[0], evs = evaluations(c);
    var h = '<h2 style="margin-bottom:10px">Imprimer</h2><div class="card"><label class="f">Document</label><select class="c" data-ch="impr-doc">' + docs.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === d.id ? " selected" : "") + ">" + esc(x.titre) + "</option>";
    }).join("") + "</select>";
    if (d.classe) {
      h += '<label class="f">Classe</label><select class="c" data-ch="impr-classe">' + (d.toutes ? '<option value="">Toutes les classes</option>' : "") + classes().map(function (x) {
        return "<option" + (x.code === p.classe ? " selected" : "") + ">" + esc(x.code) + "</option>";
      }).join("") + "</select>";
    }
    if (d.evaluation) {
      h += '<label class="f">Évaluation</label><select class="c" id="impr-ev">' + evs.map(function (e) {
        return '<option value="' + e.num + '">' + esc(e.libelle) + "</option>";
      }).join("") + "</select>";
    }
    if (d.mois) {
      var mois = ["09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07"], noms = { "01": "Janvier", "02": "Février", "03": "Mars", "04": "Avril",
        "05": "Mai", "06": "Juin", "07": "Juillet", "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Décembre" };
      var cur = p2(new Date().getMonth() + 1);
      h += '<label class="f">Mois</label><select class="c" id="impr-mois">' + mois.map(function (m) {
        return '<option value="' + m + '"' + (m === cur ? " selected" : "") + ">" + noms[m] + "</option>";
      }).join("") + "</select>";
    }
    h += '<p class="mut small">' + esc(d.aide || "") + ' Android propose ensuite une imprimante ou « Enregistrer au format PDF » (à partager par WhatsApp).</p>' +
      '<button class="btn pri bloc" data-a="imprimer">' + ic("print") + " Imprimer</button></div>";
    return h;
  }
  function imprimer(docId, opts) {
    if (!DOCS) { return; }
    try {
      var r = DOCS.document(docId, contexteDocs(), opts);
      N.imprimer(r.html, r.titre);
    } catch (e) { toast(e.message || String(e), true); }
  }
  function vueExporter() {
    var l = DOCS ? DOCS.exports : [];
    return '<h2 style="margin-bottom:10px">Exporter</h2><div class="card"><p class="small">Classeurs Excel (.xlsx) présentés comme ceux de l\'application ' +
      "Windows. « Envoyer » les confie à WhatsApp, à la messagerie ou à Drive ; « Enregistrer » les range sur le téléphone.</p>" + l.map(function (x) {
        return '<div class="note" style="padding:10px 0"><span class="t"><b style="white-space:normal">' + ic("file") + " " + esc(x.titre) + "</b><small>" +
          esc(x.aide) + '</small></span></div><div class="rang" style="margin:-4px 0 8px"><button class="btn sm pri" data-a="exporter" data-d="' + x.id +
          '" data-m="partager">Envoyer</button><button class="btn sm" data-a="exporter" data-d="' + x.id + '" data-m="enregistrer">Enregistrer</button></div>';
      }).join("") + "</div>";
  }
  function exporter(quoi, modeEnvoi) {
    if (!DOCS) { return; }
    var f;
    try { f = DOCS.classeur(quoi, contexteDocs()); } catch (e) { toast(e.message || String(e), true); return; }
    attendre(function (id) { N.exporterClasseur(id, f.nom, JSON.stringify(f.description), modeEnvoi || "enregistrer"); }).then(function (r) {
      if (r && r.ok) { toast((modeEnvoi === "partager" ? "Fichier prêt à envoyer : " : "Fichier enregistré : ") + f.nom); }
      else if (r && !r.annule) { toast(r.message || "Enregistrement impossible.", true); }
    });
  }

  // ------------------------------------------------------------------- sauvegarde, licence, sécurité
  function vueSauvegarde() {
    return '<h2 style="margin-bottom:10px">Sauvegarde</h2><div class="card"><h3>' + ic("save") + ' Sauvegarder</h3><p class="small">Copie complète des données ' +
      "du téléphone dans un fichier .akwa, chiffré avec le mot de passe administrateur : enregistrez-la sur une carte SD, dans Drive, ou envoyez-la-vous. " +
      "Sans ce mot de passe, le fichier est illisible. Faites-en une chaque semaine : si le téléphone est perdu, c'est votre seule copie.</p>" +
      '<button class="btn pri bloc" data-a="sauvegarder">' + ic("save") + " Créer une sauvegarde</button>" +
      (S.base.derniere_sauvegarde ? '<p class="mut small">Dernière sauvegarde : ' + esc(heureFr(S.base.derniere_sauvegarde)) + "</p>" : "") + "</div>" +
      '<div class="card"><h3>Restaurer</h3><p class="small">Remplace toutes les données du téléphone par celles d\'une sauvegarde.</p>' +
      '<button class="btn dng" data-a="restaurer">Restaurer une sauvegarde</button></div>';
  }
  function sauvegarder() {
    demanderAdminLocal("Créer une sauvegarde", "Le fichier sera chiffré avec le mot de passe administrateur du téléphone.").then(function (ok) {
      if (!ok) { return; }
      var mdp = derniereSaisieAdmin;
      S.base.derniere_sauvegarde = new Date().toISOString();
      var b = {};
      for (var k in S.base) { if (k !== "utilisateur" && k !== "licence") { b[k] = S.base[k]; } }
      var contenu = JSON.stringify({ format: "akwa-telephone", version: 1, cree_le: S.base.derniere_sauvegarde, app: S.infos.version, base: b });
      var nom = "AKWA-SCHOOL-" + norm((S.base.ecole || {}).ecole_nom || "ecole").toUpperCase().slice(0, 20) + "-" + aujourdhui() + ".akwa";
      attendre(function (id) { N.creerSauvegarde(id, mdp, nom, contenu); }).then(function (r) {
        if (r && r.ok) { sauverBase(); toast("Sauvegarde enregistrée : " + nom); rendre(); }
        else if (r && !r.annule) { toast(r.message || "Sauvegarde impossible.", true); }
      });
    });
  }
  var derniereSaisieAdmin = "";
  document.addEventListener("input", function (e) { if (e.target.id === "mdpAdmin") { derniereSaisieAdmin = e.target.value; } }, true);

  function restaurer(depuisAccueil) {
    var suite = function () {
      attendre(function (id) { N.choisirFichier(id, "sauvegarde"); }).then(function (r) {
        if (!r || !r.ok) { if (r && !r.annule) { toast(r.message || "Fichier illisible.", true); } return; }
        if (!r.sauvegarde) { toast("Ce fichier n'est pas une sauvegarde AKWA SCHOOL (.akwa).", true); return; }
        fenetre('<h3>Restaurer « ' + esc(r.nom) + ' »</h3><label class="f">Mot de passe administrateur de la sauvegarde</label>' +
          '<input class="c" id="mdpRest" type="password" autocomplete="off"><p class="small bad" id="msgRest"></p><div class="rang" style="margin-top:8px">' +
          '<button class="btn" data-a="fermer">Annuler</button><span class="esp"></span><button class="btn pri" data-a="rest-ok">Restaurer</button></div>');
        actionsFenetre["rest-ok"] = function () {
          var mdp = document.getElementById("mdpRest").value, m = document.getElementById("msgRest");
          m.textContent = "Déchiffrement…";
          setTimeout(function () {
            var o = JSON.parse(N.ouvrirSauvegarde(r.poignee, mdp));
            if (!o.ok) { m.textContent = o.message; return; }
            var s;
            try { s = JSON.parse(o.contenu); } catch (e) { m.textContent = "Sauvegarde illisible."; return; }
            if (s.format !== "akwa-telephone" || !s.base || !s.base.annee) { m.textContent = "Sauvegarde d'un autre format."; return; }
            if (!S.infos.admin) { N.definirAdmin(mdp, null); }
            S.base = s.base;
            preparerBase();
            sauverBase();
            N.demarrerEssai();
            S.infos = JSON.parse(N.infos());
            fermer();
            toast("Données restaurées (sauvegarde du " + heureFr(s.cree_le) + ").");
            S.vue = "accueil";
            if (!S.infos.pin) { S.deverrouille = true; }
            rendre();
          }, 30);
        };
      });
    };
    if (depuisAccueil) { suite(); return; }
    confirmer("Restaurer une sauvegarde", "Toutes les données actuelles du téléphone seront remplacées.", "Choisir le fichier", true)
      .then(function (oui) { if (oui) { suite(); } });
  }
  function vueLicence() {
    var l = S.licence || {};
    return '<h2 style="margin-bottom:10px">Licence</h2><div class="card"><dl class="kv"><dt>État</dt><dd>' + esc(l.message || "") + "</dd>" +
      (l.type ? "<dt>Type</dt><dd>" + (l.type === "vie" ? "à vie" : "1 an") + "</dd>" : "") + '</dl><p class="mut small">Mêmes codes que l\'application Windows ' +
      "(1 an ou à vie), un code par appareil. Internet est nécessaire au moment de l'activation seulement. Un code 1 an activé avant l'échéance " +
      "s'ajoute aux jours restants.</p>" + formulaireActivation() + "</div>";
  }
  function activer() {
    var code = document.getElementById("codeActivation").value.trim(), m = document.getElementById("msgActivation");
    if (code.replace(/[^0-9a-z]/gi, "").length < 8) { m.textContent = "Saisissez le code reçu (ex. ABCD-EFGH-JKLM)."; return; }
    m.textContent = "Activation en cours…";
    attendre(function (id) { N.activer(id, code, (inst().ecole || {}).ecole_nom || ""); }).then(function (r) {
      if (!r || !r.ok) { m.textContent = (r && r.message) || "Activation impossible."; m.className = "small bad"; return; }
      rafraichirLicence();
      toast("Licence activée : " + S.licence.message);
      rendre();
    });
  }
  function vueSecurite() {
    return '<h2 style="margin-bottom:10px">Sécurité</h2><div class="card"><div class="rang"><button class="btn" data-a="verrouiller">' + ic("lock") +
      ' Verrouiller</button><button class="btn" data-a="pin-changer">Changer le code PIN</button></div></div>' +
      (local() ? '<div class="card"><h3>Mot de passe administrateur</h3><p class="mut small">Demandé pour corriger une note, supprimer une donnée, ' +
        "modifier la fiche d'un élève, créer une sauvegarde. Il déverrouille aussi le téléphone en cas d'oubli du code PIN.</p>" +
        '<label class="f">Mot de passe actuel</label><input class="c" id="adm0" type="password"><label class="f">Nouveau mot de passe (6 caractères au moins)</label>' +
        '<input class="c" id="adm1" type="password"><label class="f">Confirmez</label><input class="c" id="adm2" type="password"><p class="small" id="msgAdm"></p>' +
        '<button class="btn pri" data-a="admin-changer">Changer le mot de passe</button></div>' +
        '<div class="card"><h3>Mot de passe oublié</h3><p class="mut small">Le code de secours permet de choisir un nouveau mot de passe ' +
        "administrateur, sans Internet. Il ne sert qu'une fois.</p>" +
        '<button class="btn" data-a="secours-nouveau">Nouveau code de secours</button></div>' : "");
  }

  // =================================================================== bienvenue, création de l'école, association, PIN
  function rendreBienvenue() {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h1>AKWA SCHOOL</h1><p>Gestion scolaire EPP sur votre téléphone : ' +
      "élèves, notes, résultats, absences, impression. Sans Internet.</p>" +
      '<div class="card"><h3>' + ic("school") + ' Utiliser ce téléphone seul</h3><p class="small mut">Créez votre école sur le téléphone. ' +
      "7 jours d'essai, puis un code d'activation. Vous pourrez l'associer plus tard à l'ordinateur de l'école.</p>" +
      '<button class="btn pri bloc" data-a="creer-ecole">Créer mon école</button><button class="btn bloc" data-a="restaurer-accueil" style="margin-top:8px">' +
      "Restaurer une sauvegarde (.akwa)</button></div>" +
      '<div class="card"><h3>' + ic("pc") + ' Travailler avec l\'ordinateur de l\'école</h3><ol class="etapes"><li>Sur l\'ordinateur : AKWA SCHOOL › Rapports &amp; administration › ' +
      "Téléphones › « Démarrer la synchronisation ».</li><li>Choisissez le compte du téléphone et cliquez « Afficher un code d'association ».</li>" +
      "<li>Connectez ce téléphone au même Wi-Fi, puis touchez ci-dessous.</li></ol>" +
      '<button class="btn bloc" data-a="associer-ecran" style="margin-top:10px">' + ic("wifi") + " Associer ce téléphone</button></div></div>";
  }
  function anneeCourante() {
    var d = new Date(), y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return y + "-" + (y + 1);
  }
  function rendreCreation() {
    var e = D.ecole || {};
    var niveaux = (D.classes || []).map(function (c) { return c.code; });
    app.innerHTML = '<div class="ecran" style="justify-content:flex-start"><img class="logo" src="logo.png" alt="" style="width:64px;height:64px">' +
      '<h2 style="margin-bottom:12px">Créer mon école</h2><div class="card">' +
      '<label class="f">Nom de l\'école *</label><input class="c" id="n_ecole" placeholder="ex. EPP OUANINOU 2" autocapitalize="characters">' +
      '<label class="f">IEPP</label><input class="c" id="n_iepp" value="' + esc(e.iepp || "") + '"><label class="f">DRENAET</label><input class="c" id="n_dren" value="' + esc(e.dren || "") + '">' +
      '<label class="f">Localité</label><input class="c" id="n_localite"><label class="f">Directeur / Directrice</label><input class="c" id="n_directeur">' +
      '<label class="f">Année scolaire</label><input class="c" id="n_annee" value="' + anneeCourante() + '" maxlength="9">' +
      '<label class="f">Classes (une par niveau ; ajoutez CP1 A, CP1 B… ensuite si besoin)</label><div class="chips" style="flex-wrap:wrap">' +
      niveaux.map(function (n) { return '<label class="chip on"><input type="checkbox" class="n_niv" value="' + n + '" checked style="margin:0 4px 0 0">' + n + "</label>"; }).join("") +
      '</div><h3 style="margin-top:14px">' + ic("key") + ' Mot de passe administrateur</h3><p class="small mut">Demandé pour corriger une note, supprimer une donnée ou ' +
      "modifier une fiche d'élève, et pour chiffrer les sauvegardes. Gardez-le précieusement : il ne peut pas être récupéré.</p>" +
      '<label class="f">Mot de passe (6 caractères au moins)</label><input class="c" id="n_mdp1" type="password"><label class="f">Confirmez</label><input class="c" id="n_mdp2" type="password">' +
      '<p class="small bad" id="msgCreation"></p><button class="btn pri bloc" data-a="creer-ok">Créer l\'école</button></div><button class="btn" data-a="bienvenue">Retour</button></div>';
  }
  function creerEcole() {
    var g = function (id) { return document.getElementById(id).value.trim(); };
    var m = document.getElementById("msgCreation");
    var nom = g("n_ecole").toUpperCase(), lib = g("n_annee"), mdp = document.getElementById("n_mdp1").value;
    var a1 = Number(lib.slice(0, 4));
    if (!nom) { m.textContent = "Indiquez le nom de l'école."; return; }
    if (!/^\d{4}-\d{4}$/.test(lib) || Number(lib.slice(5)) !== a1 + 1) { m.textContent = "L'année scolaire doit être de la forme " + anneeCourante() + "."; return; }
    if (mdp.length < 6) { m.textContent = "Le mot de passe administrateur compte 6 caractères au moins."; return; }
    if (mdp !== document.getElementById("n_mdp2").value) { m.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
    if (!N.definirAdmin(mdp, null)) { m.textContent = "Un mot de passe administrateur existe déjà sur ce téléphone : utilisez-le, ou restaurez une sauvegarde."; return; }
    montrerSecours(N.nouveauCodeSecours());
    var niv = Array.prototype.slice.call(document.querySelectorAll(".n_niv:checked")).map(function (x) { return x.value; });
    var e = D.ecole || {};
    var b = { version: 1, mode: "autonome", cree_le: new Date().toISOString(), compteur: 1000,
      ecole: { ecole_nom: nom, iepp: g("n_iepp").toUpperCase(), dren: g("n_dren").toUpperCase(), localite: g("n_localite").toUpperCase(),
               directeur: g("n_directeur").toUpperCase(), pays: e.pays, ministere: e.ministere, devise_pays: e.devise_pays, code_ecole: "" },
      annee: { id: 1, libelle: lib, date_debut: a1 + "-09-01", date_fin: (a1 + 1) + "-08-31", date_ref_age: a1 + "-12-31",
               date_edition: (a1 + 1) + "-06-30", cloturee: false },
      classes: [], grilles: [], evaluations: {}, motifs_absence: D.motifs_absence || [], eleves: [], notes: {}, absents_evaluation: {},
      personnel: [], absences_eleves: [], absences_personnel: [] };
    S.base = b;
    var gid = {};
    (D.grilles || []).forEach(function (gr) {
      var x = { id: nouvelId(), code: gr.code, libelle: gr.libelle, mode: gr.mode, echelle: gr.echelle, note_max: gr.note_max, matieres: {} };
      for (var num in gr.matieres) {
        x.matieres[num] = gr.matieres[num].map(function (mm) { return { id: nouvelId(), libelle: mm.libelle, valeur: mm.valeur }; });
      }
      gid[gr.code] = x.id;
      b.grilles.push(x);
    });
    (D.classes || []).forEach(function (c, i) {
      if (niv.indexOf(c.code) < 0) { return; }
      b.classes.push({ id: nouvelId(), code: c.code, libelle: c.code, ordre: i * 10, niveau_suivant: c.niveau_suivant, seuil: c.seuil,
                       bareme: c.bareme, grille_id: gid[c.grille], calendrier: c.calendrier, regle_mga: c.regle_mga });
    });
    for (var cal in D.evaluations || {}) {
      b.evaluations[cal] = D.evaluations[cal].map(function (ev) {
        return { num: ev.num, libelle: ev.libelle, date: (a1 + ev.decalage) + "-" + p2(ev.mois) + "-" + p2(ev.jour) };
      });
    }
    N.demarrerEssai();
    preparerBase();
    sauverBase();
    S.infos = JSON.parse(N.infos());
    toast("École créée. Protégez maintenant le téléphone par un code PIN.");
    rendre();
  }
  function rendreAssociation() {
    app.innerHTML = '<div class="ecran" style="justify-content:flex-start"><img class="logo" src="logo.png" alt="" style="width:64px;height:64px">' +
      '<h2 style="margin-bottom:12px">Associer ce téléphone</h2><div class="card"><h3>1. Ordinateur de l\'école</h3>' +
      '<button class="btn bloc" data-a="chercher">' + ic("wifi") + ' Rechercher sur le Wi-Fi</button><div id="trouves"></div>' +
      '<label class="f">Adresse de l\'ordinateur</label><input class="c" id="adr" placeholder="ex. 192.168.1.20" inputmode="url" value="' + esc(S.infos.adresse || "") + '">' +
      '<h3 style="margin-top:16px">2. Code affiché sur l\'ordinateur</h3><input class="c code" id="code" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters">' +
      '<h3 style="margin-top:16px">3. Nom de ce téléphone</h3><input class="c" id="nomTel" maxlength="60" value="' + esc(S.infos.modele || "Téléphone") + '">' +
      '<div style="margin-top:16px"><button class="btn pri bloc" id="btnAssocier" data-a="associer">Associer</button></div>' +
      '<p class="mut small" id="msgAssoc"></p>' + (S.base ? '<p class="mut small">Les données de ce téléphone ne sont pas encore envoyées : elles le seront à la ' +
      "première synchronisation, que vous lancerez vous-même.</p>" : "") + '</div><button class="btn" data-a="bienvenue">Retour</button></div>';
    chercher();
  }
  function chercher() {
    var z = document.getElementById("trouves");
    if (!z) { return; }
    z.innerHTML = '<p class="mut small">Recherche de l\'ordinateur…</p>';
    attendre(function (id) { N.chercher(id); }).then(function (l) {
      var zz = document.getElementById("trouves");
      if (!zz) { return; }
      l = Array.isArray(l) ? l : [];
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
      toast("Téléphone associé à " + ((r.contenu || {}).ecole || "l'ordinateur de l'école") + ". Synchronisez quand vous le souhaitez.");
      S.vue = "accueil";
      rendre();
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
    } else {
      p.value = "";
      att = N.attentePin();
      m.textContent = att > 0 ? "Code incorrect. Trop d'essais : patientez " + att + " s." : "Code incorrect.";
    }
  }
  function rendrePremiereSynchro() {
    app.innerHTML = '<div class="ecran"><img class="logo" src="logo.png" alt=""><h2>Première synchronisation</h2>' +
      "<p>Le téléphone récupère les données de l'école auprès de l'ordinateur (" + esc(S.infos.adresse || "") + "), sur le même Wi-Fi.</p>" +
      '<button class="btn pri" data-a="sync-direct">' + ic("sync") + " Synchroniser</button>" +
      '<div style="margin-top:18px;width:100%;text-align:left">' + blocFichier(false, false) + "</div></div>";
  }

  /** Copie de l'ordinateur (et saisies en attente) devenue base du téléphone utilisé seul. */
  function versBase() {
    var b = copie(S.inst);
    delete b.utilisateur; delete b.licence; delete b.resultats; delete b.genere_le; delete b.app_version;
    b.mode = "autonome";
    b.annee = b.annee || {};
    b.annee.date_ref_age = b.annee.date_ref_age || (b.annee.libelle ? b.annee.libelle.slice(0, 4) + "-12-31" : null);
    var max = 1000;
    ["eleves", "personnel", "absences_eleves", "absences_personnel", "classes", "grilles"].forEach(function (k) {
      (b[k] || []).forEach(function (x) { max = Math.max(max, Number(x.id || x.inscription_id) || 0); });
    });
    (b.grilles || []).forEach(function (g) { for (var n in g.matieres) { g.matieres[n].forEach(function (m) { max = Math.max(max, m.id); }); } });
    b.compteur = max + 1;
    S.base = b;
    preparerBase();
    var ops = S.ops, nouveaux = {};
    ops.forEach(function (o) {
      try {
        if (o.op === "eleve" && !o.inscription_id) { appliquerLocal(o); nouveaux["u:" + o.uid] = S.base.compteur; return; }
        if (nouveaux[o.inscription_id]) { o.inscription_id = nouveaux[o.inscription_id]; }
        if (nouveaux[o.cible]) { o.cible = nouveaux[o.cible]; }
        appliquerLocal(o);
      } catch (e) { /* saisie sans objet : ignorée */ }
    });
  }
  function dissocier() {
    var copiePossible = !!S.inst && !!S.inst.annee && licenceOk();
    fenetre('<h3>Dissocier ce téléphone</h3><p class="small">Pensez à retirer aussi le téléphone sur l\'ordinateur (page Téléphones).' +
      (S.ops.length ? " " + S.ops.length + " saisie(s) n'ont pas été envoyées." : "") + "</p>" +
      (copiePossible ? '<button class="btn pri bloc" data-a="dissocier-garder">Continuer seul avec une copie des données</button><p class="mut small">' +
        "La copie devient l'école du téléphone (saisies non envoyées comprises) ; licence du téléphone (7 jours d'essai, puis code d'activation) " +
        "et mot de passe administrateur du téléphone.</p>" : "") +
      '<button class="btn dng bloc" data-a="dissocier-effacer" style="margin-top:8px">Tout effacer de ce téléphone</button>' +
      '<button class="btn bloc" data-a="fermer" style="margin-top:8px">Annuler</button>');
    actionsFenetre["dissocier-garder"] = function () {
      if (!S.infos.admin) {
        fenetre('<h3>Mot de passe administrateur du téléphone</h3><p class="small mut">Demandé ensuite pour les opérations protégées et les sauvegardes.</p>' +
          '<label class="f">Mot de passe (6 caractères au moins)</label><input class="c" id="dm1" type="password"><label class="f">Confirmez</label>' +
          '<input class="c" id="dm2" type="password"><p class="small bad" id="msgDm"></p><button class="btn pri bloc" data-a="dm-ok">Continuer</button>');
        actionsFenetre["dm-ok"] = function () {
          var a = document.getElementById("dm1").value, m = document.getElementById("msgDm");
          if (a.length < 6) { m.textContent = "6 caractères au moins."; return; }
          if (a !== document.getElementById("dm2").value) { m.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
          N.definirAdmin(a, null);
          fermer();
          garderCopie();
        };
        return;
      }
      fermer();
      garderCopie();
    };
    actionsFenetre["dissocier-effacer"] = function () {
      fermer();
      confirmer("Tout effacer", "Les données de l'école seront effacées de ce téléphone" + (S.ops.length ? ", ainsi que " + S.ops.length +
        " saisie(s) non envoyée(s)" : "") + ".", "Effacer", true).then(function (oui) { if (oui) { effacerTout(); } });
    };
  }
  function garderCopie() {
    versBase();
    N.dissocier();
    N.demarrerEssai();
    sauverBase();
    ["instantane.json", "operations.json"].forEach(function (f) { N.supprimer(f); });
    S.inst = null; S.ops = []; S.etat = { derniere: null, rejets: [] };
    sauver();
    S.infos = JSON.parse(N.infos());
    toast("Téléphone dissocié : il fonctionne seul avec une copie des données.");
    S.vue = "accueil";
    rendre();
  }
  function effacerTout() {
    N.effacerTout();
    S.inst = null; S.base = null; S.ops = []; S.etat = { derniere: null, rejets: [] }; S.deverrouille = false;
    S.infos = JSON.parse(N.infos());
    rendre();
  }

  // =================================================================== événements
  // =================================================================== enseignant (version 1.2.0)
  function messagesNonLus() {
    var lus = S.etat.lus || [];
    return (inst().messages || []).filter(function (m) { return !m.lu && lus.indexOf(m.id) < 0; });
  }
  function vueMessages() {
    var l = inst().messages || [], lus = S.etat.lus || [];
    if (!l.length) { return '<div class="card vide">Aucun message du directeur.</div>'; }
    var h = '<h2 style="margin-bottom:10px">Messages du directeur</h2>' + l.map(function (m) {
      var nouveau = !m.lu && lus.indexOf(m.id) < 0;
      return '<div class="card"><h3>' + (nouveau ? '<span class="pill ok" style="flex:none">nouveau</span> ' : "") + esc(m.titre) +
        '</h3><p class="mut small">' + esc(m.auteur) + " · " + esc(heureFr(m.cree_le)) + "</p><p>" +
        esc(m.texte).replace(/\n/g, "<br>") + "</p></div>";
    }).join("");
    // lus en les affichant : l'accusé de lecture part à la prochaine synchronisation
    var nouveaux = l.filter(function (m) { return !m.lu && lus.indexOf(m.id) < 0; });
    if (nouveaux.length) {
      S.etat.lus = lus.concat(nouveaux.map(function (m) { return m.id; }));
      nouveaux.forEach(function (m) { ajouterOp({ op: "message_lu", message_id: m.id }); });
    }
    return h;
  }
  function vueDemandeAbsence() {
    var mot = inst().motifs_absence || D.motifs_absence || ["Maladie", "Autre"];
    var h = '<h2 style="margin-bottom:10px">Autorisation d\'absence</h2><div class="card">' +
      '<label class="f">Du</label><input class="c" type="date" id="dDebut" value="' + esc(aujourdhui()) + '">' +
      '<label class="f">Au</label><input class="c" type="date" id="dFin" value="' + esc(aujourdhui()) + '">' +
      '<label class="f">Demi-journée</label><select class="c" id="dDemi"><option value="">Non (journées entières)</option>' +
      '<option value="MATIN">Matin</option><option value="APRES_MIDI">Après-midi</option></select>' +
      '<label class="f">Motif</label><select class="c" id="dMotif">' + mot.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join("") + "</select>" +
      '<label class="f">Précisions</label><input class="c" id="dPrec" maxlength="200">' +
      '<label class="f">Lieu pendant l\'absence</label><input class="c" id="dLieu" maxlength="120">' +
      '<label class="f">Contact</label><input class="c" id="dContact" inputmode="tel" maxlength="40">' +
      '<label class="f">Intérim assuré par</label><input class="c" id="dInterim" maxlength="120">' +
      '<button class="btn pri bloc" style="margin-top:12px" data-a="demande-absence">Envoyer la demande</button></div>';
    var mes = inst().mes_autorisations || [];
    var att = S.ops.filter(function (o) { return o.op === "autorisation"; });
    if (mes.length || att.length) {
      h += '<div class="card"><h3>Mes demandes</h3>' + att.map(function (o) {
        return '<p class="small">' + esc(dateFr(o.date_debut)) + " – " + esc(dateFr(o.date_fin)) + " · " + esc(o.motif) +
          ' · <span class="attente-txt">à envoyer</span></p>';
      }).join("") + mes.map(function (a) {
        var st = { EN_ATTENTE: "en attente du directeur", ACCORDEE: "accordée", REFUSEE: "refusée" }[a.statut] || a.statut;
        return '<p class="small">' + esc(dateFr(a.date_debut)) + " – " + esc(dateFr(a.date_fin)) + " · " + esc(a.motif) + " · <b>" + esc(st) +
          "</b>" + (a.avis ? " (" + esc(a.avis) + ")" : "") + "</p>";
      }).join("") + "</div>";
    }
    return h;
  }
  function envoyerDemandeAbsence() {
    var v = function (id) { var x = document.getElementById(id); return x ? x.value.trim() : ""; };
    var d1 = v("dDebut"), d2 = v("dFin") || d1;
    if (!dansAnnee(d1) || !dansAnnee(d2) || d2 < d1) { toast("Dates : comprises dans l'année scolaire, la fin après le début.", true); return; }
    if (v("dDemi") && d1 !== d2) { toast("Une demi-journée ne concerne qu'un seul jour.", true); return; }
    ajouterOp({ op: "autorisation", date_debut: d1, date_fin: d2, demi_journee: v("dDemi") || null, motif: v("dMotif"),
      precisions: v("dPrec") || null, lieu: v("dLieu") || null, contact: v("dContact") || null, interim: v("dInterim") || null });
    toast("Demande enregistrée : elle part au directeur à la prochaine synchronisation.");
    rendre();
  }
  function validerAppel() {
    var d = S.abs.date, code = S.abs.classe;
    if (!dansAnnee(d)) { toast("La date doit être comprise dans l'année scolaire.", true); return; }
    var absents = absencesAffichees("eleve").filter(function (a) {
      var e = eleve(a.cible);
      return a.date === d && a.nature === "ABSENCE" && e && e.classe === code;
    }).map(function (a) { return a.cible; });
    S.ops.filter(function (o) { return o.op === "appel" && o.classe === code && o.date === d; })
      .forEach(function (o) { retirerSansSauver(o.uid); });
    ajouterOp({ op: "appel", classe: code, date: d, absents: absents, demi_journee: false });
    toast("Appel de " + code + " validé (" + absents.length + " absent(s)) : il part au directeur à la prochaine synchronisation.");
    rendre();
  }

  /** Notes manquantes de mes classes pour les évaluations dont le directeur a fixé une date limite. */
  function notesManquantes() {
    if (local() || !perm("notes.modifier") || !inst().notes) { return []; }
    var out = [];
    classes().forEach(function (c) {
      var g = grille(c);
      evaluations(c).forEach(function (ev) {
        if (!ev.fin_saisie || ev.fermee || ev.fin_saisie < aujourdhui()) { return; }
        var mats = matieres(g, ev.num), n = 0;
        eleves(c.code).forEach(function (e) {
          if (e.statut !== "PRESENT" || absentEval(e.inscription_id, ev.num)) { return; }
          mats.forEach(function (m) { var v = noteAff(e.inscription_id, m.id); if (v === null || v === undefined) { n++; } });
        });
        if (n) { out.push({ classe: c.code, libelle: ev.libelle, num: ev.num, manquantes: n, fin: ev.fin_saisie }); }
      });
    });
    return out;
  }
  /** Rappels en notifications : 3 jours et 1 jour avant la date limite, et le jour même, à 7 h. */
  function programmerRappels() {
    if (!N || !N.programmerRappels) { return; }
    var liste = [];
    notesManquantes().forEach(function (r) {
      [3, 1, 0].forEach(function (j) {
        var t = new Date(r.fin + "T07:00:00");
        t.setDate(t.getDate() - j);
        liste.push({ quand: t.getTime(), titre: "Notes à saisir : " + r.classe,
          texte: r.manquantes + " note(s) de « " + r.libelle + " » à saisir avant le " + dateFr(r.fin) + ", puis à synchroniser." });
      });
    });
    var nl = messagesNonLus().length;
    if (nl) {
      var demain = new Date(); demain.setDate(demain.getDate() + 1); demain.setHours(7, 30, 0, 0);
      liste.push({ quand: demain.getTime(), titre: "Messages du directeur", texte: nl + " message(s) non lu(s) dans AKWA SCHOOL." });
    }
    try { N.programmerRappels(JSON.stringify(liste)); } catch (e) { /* rappels facultatifs */ }
  }

  // ------------------------------------------------------------------ scan (photo)
  function scanner(source) {
    toast("Ouverture de l'appareil photo…");
    return attendre(function (id) { N.scanner(id, source); }).then(function (r) {
      if (!r || !r.ok) { if (r && !r.annule) { toast(r.message || "Lecture impossible.", true); } return null; }
      if (!r.lignes || !r.lignes.length) { toast("Aucun texte lu sur la photo : reprenez-la bien à plat, bien éclairée.", true); return null; }
      return r;
    });
  }
  function scanNotes(source) {
    var c = classe(S.notes.classe), g = grille(c), num = S.notes.ev;
    var mats = matieres(g, num).map(function (m) { return { id: m.id, libelle: m.libelle, max: maxNote(g, m) }; });
    var els = eleves(c.code).filter(function (e) { return e.statut === "PRESENT" && !absentEval(e.inscription_id, num); });
    scanner(source).then(function (r) {
      if (!r) { return; }
      var res = AkwaScan.structurerNotes(r, els.map(function (e) { return { iid: e.inscription_id, nom: e.nom }; }), mats);
      var trouves = res.lignes.filter(function (x) { return x.trouve; });
      if (!trouves.length) { toast("Aucun nom d'élève de " + c.code + " reconnu sur la photo.", true); return; }
      var h = '<h3>Feuille scannée – ' + esc(c.code) + "</h3><p class=\"mut small\">" + trouves.length + " élève(s) reconnu(s)" +
        (res.absents.length ? ", non lus : " + esc(res.absents.join(", ")) : "") + ". Vérifiez chaque note (en rouge : douteuse), " +
        "puis enregistrez. Une note déjà enregistrée n'est pas remplacée.</p><div style=\"overflow-x:auto\"><table class=\"t\"><tr><th>Élève</th>" +
        mats.map(function (m) { return "<th>" + esc(m.libelle.slice(0, 10)) + "</th>"; }).join("") + "</tr>";
      trouves.forEach(function (x) {
        h += "<tr><td><b>" + esc(x.nom) + "</b></td>" + mats.map(function (m) {
          var n = x.notes[m.id], deja = noteAff(x.iid, m.id);
          var val = deja !== null && deja !== undefined ? nb(deja) : n ? nb(n.v) : "";
          return '<td><input class="c' + (n && n.douteux ? " err" : "") + '" style="width:58px;padding:6px" inputmode="decimal" data-scan="' +
            esc(x.iid) + "|" + m.id + "|" + m.max + '" value="' + esc(val) + '"' + (deja !== null && deja !== undefined ? " disabled" : "") + "></td>";
        }).join("") + "</tr>";
      });
      h += '</table></div><div class="rang" style="margin-top:12px"><button class="btn" data-a="fermer">Annuler</button><span class="esp"></span>' +
        '<button class="btn pri" data-a="scan-notes-ok">Enregistrer les notes</button></div>';
      fenetre(h);
      actionsFenetre["scan-notes-ok"] = function () { enregistrerScanNotes(num); };
    });
  }
  function enregistrerScanNotes(num) {
    var champs = Array.prototype.slice.call(document.querySelectorAll("input[data-scan]:not([disabled])"));
    var ops = [], mauvais = 0;
    champs.forEach(function (i) {
      var p = i.getAttribute("data-scan").split("|"), v = lireNombre(i.value), max = Number(p[2]);
      if (v === null) { return; }
      if (isNaN(v) || v < 0 || v > max) { i.classList.add("err"); mauvais++; return; }
      i.classList.remove("err");
      var c = classe(S.notes.classe), m = matieres(grille(c), num).filter(function (x) { return x.id === Number(p[1]); })[0];
      ops.push({ op: "note", inscription_id: idDe(p[0]), matiere_id: Number(p[1]), valeur: v, avant: null, libelle: m ? m.libelle : "" });
    });
    if (mauvais) { toast(mauvais + " note(s) hors barème : corrigez-les (en rouge).", true); return; }
    if (local()) {
      try { ops.forEach(function (o) { appliquerLocal(o); }); sauverBase(); } catch (e) { toast(e.message || String(e), true); return; }
    } else {
      ops.forEach(function (o) {
        var deja = opNote(o.inscription_id, o.matiere_id);
        if (deja) { retirerSansSauver(deja.uid); }
        ajouterOp(o);
      });
    }
    fermer();
    toast(ops.length + " note(s) enregistrée(s)" + (local() ? "." : " : envoyées à la prochaine synchronisation."));
    rendre();
  }
  function scanExtrait(source) {
    scanner(source).then(function (r) {
      if (!r) { return; }
      var d = AkwaScan.structurerExtrait(r), n = 0;
      Object.keys(d).forEach(function (k) {
        var el = document.getElementById("f_" + k);
        if (el && d[k]) { el.value = d[k]; el.classList.add("lu"); n++; }
      });
      var msg = document.getElementById("msgScan");
      if (msg) { msg.textContent = n ? n + " champ(s) rempli(s) d'après l'extrait : vérifiez-les avant d'enregistrer." :
        "Rien n'a pu être lu sur l'extrait : reprenez la photo bien à plat."; }
    });
  }

  var actions = {
    vue: function (b) { S.plus = "menu"; aller(b.getAttribute("data-v")); },
    "plus-aller": function (b) { S.plus = b.getAttribute("data-p"); aller("plus"); },
    sync: function () { ouvrirSynchro(); },
    "sync-direct": function () { synchroniser(null); },
    "demande-partager": function () { fermer(); creerDemande("partager"); },
    "demande-enregistrer": function () { fermer(); creerDemande("enregistrer"); },
    "reponse-ouvrir": function () { fermer(); ouvrirReponse(); },
    fiche: function (b) { ficheEleve(idDe(b.getAttribute("data-i"))); },
    fermer: fermer,
    voile: function (b, e) { if (e.target === b) { fermer(); } },
    "filtre-classe": function (b) { S.eleves.classe = b.getAttribute("data-c"); rendre(); },
    "notes-classe": function (b) { S.notes.classe = b.getAttribute("data-c"); rendre(); },
    "notes-mode": function (b) { S.notes.mode = b.getAttribute("data-m"); rendre(); },
    "abs-classe": function (b) { S.abs.classe = b.getAttribute("data-c"); rendre(); },
    "abs-mode": function (b) { S.abs.mode = b.getAttribute("data-m"); rendre(); },
    "abs-kind": function (b) { S.abs.kind = b.getAttribute("data-k"); rendre(); },
    "abs-enregistrer": enregistrerAbsence,
    "abs-suppr": function (b) { var a = absencesAffichees(S.abs.kind).slice(0, 150)[Number(b.getAttribute("data-x"))]; if (a) { supprimerAbsence(S.abs.kind, a); } },
    appel: function (b) { appel(idDe(b.getAttribute("data-i")), b.getAttribute("data-n")); },
    "appel-valider": validerAppel,
    "demande-absence": envoyerDemandeAbsence,
    "scan-notes": function (b) { scanNotes(b.getAttribute("data-s")); },
    "scan-extrait": function (b) { scanExtrait(b.getAttribute("data-s")); },
    presence: function (b) { basculerPresence(idDe(b.getAttribute("data-i"))); },
    plus: function (b) { S.plus = b.getAttribute("data-p"); if (S.vue !== "plus") { S.vue = "plus"; } rendre(); window.scrollTo(0, 0); },
    "op-annuler": function (b) { retirerOp(b.getAttribute("data-u")); rendre(); },
    "rejets-effacer": function () { S.etat.rejets = []; sauver(); rendre(); },
    "fusion-effacer": function () { delete S.etat.fusion; N.supprimer("archive_autonome.json"); sauver(); rendre(); },
    verrouiller: function () { S.deverrouille = false; rendre(); },
    "pin-changer": function () { rendrePin(true); },
    "pin-ok": enregistrerPin,
    deverrouiller: deverrouiller,
    "pin-oublie": function () {
      if (local() && S.infos.admin) {
        demanderAdminLocal("Code PIN oublié", "Le mot de passe administrateur du téléphone permet de choisir un nouveau code PIN.").then(function (ok) {
          if (ok) { S.deverrouille = true; rendrePin(true); }
        });
        return;
      }
      confirmer("Code PIN oublié", "Pour des raisons de sécurité, le code PIN ne peut pas être récupéré. Les données de l'école et les saisies non " +
        "envoyées seront effacées de ce téléphone ; associez-le ensuite de nouveau avec un code affiché sur l'ordinateur.",
        "Tout effacer", true).then(function (oui) { if (oui) { effacerTout(); } });
    },
    dissocier: dissocier,
    reassocier: function () { rendreAssociation(); },
    bienvenue: function () { rendre(); },
    "associer-ecran": rendreAssociation,
    chercher: chercher,
    choisir: function (b) { document.getElementById("adr").value = b.getAttribute("data-adr"); document.getElementById("code").focus(); },
    associer: associer,
    "creer-ecole": rendreCreation,
    "creer-ok": creerEcole,
    "restaurer-accueil": function () { restaurer(true); },
    restaurer: function () { restaurer(false); },
    sauvegarder: sauvegarder,
    activer: activer,
    "eleve-nouveau": function () { formulaireEleve(); },
    "eleve-modifier": function (b) { formulaireEleve(idDe(b.getAttribute("data-i"))); },
    "eleve-enregistrer": function (b) { enregistrerEleve(b.getAttribute("data-i")); },
    "eleve-supprimer": function (b) { supprimerEleve(idDe(b.getAttribute("data-i"))); },
    "agent-form": function (b) { formulaireAgent(b.getAttribute("data-x") ? Number(b.getAttribute("data-x")) : null); },
    "agent-ok": function (b) { enregistrerAgent(b.getAttribute("data-x") ? Number(b.getAttribute("data-x")) : null); },
    "agent-suppr": function (b) {
      var pid = Number(b.getAttribute("data-x"));
      fermer();
      executer({ op: "suppr_personnel", id: pid }, { titre: "Supprimer l'agent " + agent(pid).nom, texte: "Ses absences seront aussi effacées." });
    },
    "classe-form": function (b) { formulaireClasse(b.getAttribute("data-x") ? Number(b.getAttribute("data-x")) : null); },
    "classe-ok": function (b) { enregistrerClasse(b.getAttribute("data-x") ? Number(b.getAttribute("data-x")) : null); },
    "classe-suppr": function (b) { supprimerClasse(Number(b.getAttribute("data-x"))); },
    "ecole-ok": function () {
      var d = {};
      ["ecole_nom", "code_ecole", "iepp", "dren", "localite", "directeur", "ministere"].forEach(function (k) { d[k] = document.getElementById("e_" + k).value.trim(); });
      if (!d.ecole_nom) { toast("Le nom de l'école est obligatoire.", true); return; }
      executer({ op: "ecole", donnees: d }).then(function (ok) { if (ok) { toast("Enregistré."); } });
    },
    "import-choisir": choisirImport,
    "import-ok": importer,
    imprimer: function () {
      var p = S.impression, ev = document.getElementById("impr-ev"), mo = document.getElementById("impr-mois");
      imprimer(p.doc, { classe: p.classe, evaluation: ev ? Number(ev.value) : null, mois: mo ? mo.value : null });
    },
    "imprimer-direct": function (b) { imprimer(b.getAttribute("data-d"), { classe: S.notes.classe }); },
    exporter: function (b) { exporter(b.getAttribute("data-d"), b.getAttribute("data-m")); },
    "secours-nouveau": function () {
      demanderAdminLocal("Nouveau code de secours", "L'ancien code ne servira plus.").then(function (ok) {
        if (ok) { montrerSecours(N.nouveauCodeSecours()); }
      });
    },
    "admin-changer": function () {
      var a0 = document.getElementById("adm0").value, a1 = document.getElementById("adm1").value, m = document.getElementById("msgAdm");
      if (a1.length < 6) { m.textContent = "6 caractères au moins."; m.className = "small bad"; return; }
      if (a1 !== document.getElementById("adm2").value) { m.textContent = "Les deux mots de passe ne sont pas identiques."; m.className = "small bad"; return; }
      if (!N.definirAdmin(a1, a0)) { m.textContent = "Mot de passe actuel incorrect."; m.className = "small bad"; return; }
      toast("Mot de passe administrateur changé.");
      rendre();
    }
  };

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
    else if (a === "impr-doc") { S.impression.doc = t.value; rendre(); }
    else if (a === "impr-classe") { S.impression.classe = t.value; rendre(); }
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
    if (S.deverrouille && S.vue !== "accueil" && mode()) { aller("accueil"); return true; }
    if (!mode() && document.getElementById("n_ecole") || document.getElementById("btnAssocier")) { rendre(); return true; }
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
    S.base = lireJson("base.json", null);
    S.ops = lireJson("operations.json", []);
    S.etat = lireJson("etat.json", { derniere: null, rejets: [] });
    if (!S.etat.rejets) { S.etat.rejets = []; }
    S.fichierRecu = !!(N.aUnFichierRecu && N.aUnFichierRecu());
    preparerBase();
  }
  rendre();
  if (N && S.inst) { setTimeout(programmerRappels, 1500); }
})();
