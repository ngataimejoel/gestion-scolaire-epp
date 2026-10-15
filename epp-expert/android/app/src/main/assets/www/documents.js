/* AKWA SCHOOL — documents imprimables et exports CSV du téléphone.
 *
 * Chaque document est une page HTML autonome (A4, sans script) que l'application confie à Android :
 * l'utilisateur choisit une imprimante ou « Enregistrer au format PDF ». Les données viennent du contexte
 * fourni par app.js (contexteDocs) : mêmes calculs que l'écran, rien n'est recalculé ici.
 * Règles de mise en page : en-tête officiel, noms en gras alignés à gauche, police de 9,5 pt au moins,
 * lisible en noir et blanc, grand cadre pour la signature et le cachet du directeur.
 */
(function () {
  "use strict";

  var MOIS = { "01": "janvier", "02": "février", "03": "mars", "04": "avril", "05": "mai", "06": "juin", "07": "juillet",
    "08": "août", "09": "septembre", "10": "octobre", "11": "novembre", "12": "décembre" };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function dateFr(iso) {
    if (!iso) { return ""; }
    var s = String(iso).slice(0, 10).split("-");
    return s.length === 3 ? s[2] + "/" + s[1] + "/" + s[0] : String(iso);
  }
  function aujourdhui() { var d = new Date(); return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function nb(v) {
    if (v === null || v === undefined || v === "") { return ""; }
    return (Math.round(Number(v) * 100) / 100).toString().replace(".", ",");
  }
  function niveau(code) { var m = /^(CP|CE|CM)\s*[12]/.exec(String(code || "").toUpperCase()); return m ? m[0].replace(/\s/g, "") : String(code || ""); }
  function statutCourt(e) {
    return e.statut && e.statut !== "PRESENT" ? (e.statut === "ABANDON" ? "Abandon" : e.statut === "TRANSFERE" ? "Transféré" : e.statut) : "";
  }
  function trierParNom(l) { return l.slice().sort(function (a, b) { return String(a.nom || "").localeCompare(String(b.nom || ""), "fr"); }); }
  function classesDe(ctx, code) { return code ? [ctx.classes().filter(function (c) { return c.code === code; })[0]].filter(Boolean) : ctx.classes(); }
  function anneeLib(ctx) { return (ctx.inst().annee || {}).libelle || ""; }

  // ------------------------------------------------------------------- mise en page commune
  var CSS = "@page{size:A4;margin:12mm 11mm 12mm 11mm}" +
    "*{box-sizing:border-box}body{margin:0;font-family:'DejaVu Sans',Roboto,Arial,sans-serif;font-size:10pt;color:#000;background:#fff}" +
    ".page{page-break-after:always}.page:last-child{page-break-after:auto}" +
    ".tete{display:flex;justify-content:space-between;gap:8mm;font-size:9.5pt;line-height:1.3}" +
    ".tete .g{flex:1.3}.tete .d{flex:1;text-align:center}.tete b{font-weight:700}.tete .trait{display:block;margin:1px auto;width:30mm;border-top:1px solid #000}" +
    "h1{font-size:14pt;text-align:center;margin:5mm 0 1mm;text-transform:uppercase;letter-spacing:.3px}" +
    ".sous{text-align:center;font-size:10.5pt;margin:0 0 4mm}" +
    "table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border:1px solid #000;padding:2px 4px;vertical-align:middle}" +
    "th{background:#e6e6e6;font-weight:700;text-align:center;overflow-wrap:anywhere;hyphens:auto;-webkit-hyphens:auto}table.fixe{table-layout:fixed}td{text-align:center}td.nom{text-align:left;font-weight:700}" +
    "td.g{text-align:left}tr{page-break-inside:avoid}thead{display:table-header-group}" +
    ".pied{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;margin-top:6mm;page-break-inside:avoid;font-size:10pt}" +
    ".pied .fait{flex:1;padding-top:2mm}.sig{width:85mm;min-height:40mm;border:1px solid #000;padding:2mm 3mm;text-align:center}" +
    ".sig b{display:block}.sig .n{margin-top:26mm;font-weight:700}.petit{width:55mm}.petit .n{margin-top:18mm}" +
    ".bilan{margin-top:3mm;font-size:10pt}.info{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;margin:0 0 3mm;font-size:10pt}" +
    ".info b{font-weight:700}.cadre{border:1.5px solid #000;padding:2mm 3mm;margin-top:3mm}.gros{font-size:12pt;font-weight:700}" +
    ".vide{text-align:center;padding:10mm;font-style:italic}";

  function entete(ctx) {
    var e = ctx.inst().ecole || {}, d = window.AKWA_DEFAUTS && window.AKWA_DEFAUTS.ecole || {};
    var ligne = function (v) { return v ? "<b>" + esc(v) + "</b><br>" : ""; };
    return '<div class="tete"><div class="g">' + ligne(e.ministere || d.ministere) + ligne(e.dren || d.dren) + ligne(e.iepp || d.iepp) +
      ligne(e.ecole_nom) + (e.localite ? esc(e.localite) : "") + '</div><div class="d"><b>' + esc(e.pays || d.pays || "") + "</b><br>" +
      esc(e.devise_pays || d.devise_pays || "") + '<span class="trait"></span>Année scolaire <b>' + esc(anneeLib(ctx)) + "</b></div></div>";
  }
  function piedSignature(ctx, avecMaitre, maitre) {
    var e = ctx.inst().ecole || {};
    return '<div class="pied">' + (avecMaitre ? '<div class="sig petit"><b>L\'enseignant(e)</b><div class="n">' + esc(maitre || "") + "</div></div>" : "") +
      '<div class="fait">Fait à ' + esc(e.localite || "………………") + ", le " + aujourdhui() + "</div>" +
      '<div class="sig"><b>Le Directeur</b>(signature et cachet)<div class="n">' + esc(e.directeur || "") + "</div></div></div>";
  }
  function maitreDe(ctx, code) {
    var p = (ctx.inst().personnel || []).filter(function (x) { return x.classe_tenue === code; })[0];
    return p ? p.nom : "";
  }
  function page(ctx, titre, sous, corps, pied) {
    return '<section class="page">' + entete(ctx) + "<h1>" + esc(titre) + "</h1>" + (sous ? '<p class="sous">' + sous + "</p>" : "") + corps + (pied || "") + "</section>";
  }
  function html(titre, pages, paysage) {
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>' + esc(titre) + "</title><style>" + CSS +
      (paysage ? "@page{size:A4 landscape}" : "") + "</style></head><body>" +
      (pages.length ? pages.join("") : '<p class="vide">Aucune donnée à imprimer.</p>') + "</body></html>";
  }
  function compte(liste) {
    var g = liste.filter(function (e) { return e.sexe === "M"; }).length;
    return liste.length + " élève(s) : " + g + " garçon(s), " + (liste.length - g) + " fille(s)";
  }

  // ------------------------------------------------------------------- documents
  function liste(ctx, o) {
    var pages = classesDe(ctx, o.classe).map(function (c) {
      var l = trierParNom(ctx.eleves(c.code));
      var corps = "<table><thead><tr><th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Sexe</th><th>Date de naissance</th><th>Âge</th>" +
        "<th>Redoublant</th><th>Observation</th></tr></thead><tbody>" + l.map(function (e, i) {
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(e.matricule_desps || e.matricule_ecole || "") + '</td><td class="nom">' + esc(e.nom) +
            "</td><td>" + esc(e.sexe) + "</td><td>" + dateFr(e.date_naissance) + "</td><td>" + esc(e.age === null || e.age === undefined ? "" : e.age) +
            "</td><td>" + (e.redoublant === "OUI" ? "Oui" : "") + "</td><td>" + esc(statutCourt(e)) + "</td></tr>";
        }).join("") + "</tbody></table><p class=\"bilan\">" + compte(l) + "</p>";
      return page(ctx, "Liste de la classe " + c.code, esc(c.libelle || ""), corps, piedSignature(ctx, true, maitreDe(ctx, c.code)));
    });
    return { titre: "Liste de classe" + (o.classe ? " " + o.classe : "s"), pages: pages };
  }

  function ficheNotes(ctx, o) {
    var c = classesDe(ctx, o.classe)[0];
    if (!c) { throw new Error("Choisissez une classe."); }
    var g = ctx.grille(c), ev = ctx.evaluations(c).filter(function (x) { return x.num === o.evaluation; })[0] || ctx.evaluations(c)[0];
    if (!g || !ev) { throw new Error("La classe " + c.code + " n'a pas de grille de notes."); }
    var ms = ctx.matieres(g, ev.num), rangs = ctx.rangsEvaluation(c.code, ev.num), l = trierParNom(ctx.eleves(c.code));
    var max = function (m) { return g.mode === "COEF" ? g.note_max : m.valeur; };
    var corps = '<table class="fixe"><colgroup><col style="width:8mm"><col style="width:' + (ms.length > 5 ? 46 : 55) + 'mm">' + ms.map(function () { return "<col>"; }).join("") +
      '<col style="width:14mm"><col style="width:18mm"><col style="width:12mm"></colgroup><thead><tr><th>N°</th><th>Nom et prénoms</th>' + ms.map(function (m) {
      return "<th>" + esc(m.libelle) + "<br>/" + nb(max(m)) + (g.mode === "COEF" && m.valeur !== 1 ? " ×" + nb(m.valeur) : "") + "</th>";
    }).join("") + "<th>Total</th><th>Moy.<br>/" + nb(g.mode === "COEF" ? g.note_max : g.echelle) + "</th><th>Rang</th></tr></thead><tbody>" +
      l.map(function (e, i) {
        var iid = e.inscription_id, abs = ctx.absentEval(iid, ev.num);
        return "<tr><td>" + (i + 1) + '</td><td class="nom">' + esc(e.nom) + "</td>" + ms.map(function (m) {
          return "<td>" + (abs ? "ABS" : nb(ctx.noteAff(iid, m.id))) + "</td>";
        }).join("") + "<td>" + (abs ? "" : nb(ctx.totalEval(iid, c, ev.num))) + "</td><td><b>" + (abs ? "ABS" : nb(ctx.moyenneEval(iid, c, ev.num))) +
          "</b></td><td>" + esc(rangs[iid] || "") + "</td></tr>";
      }).join("") + "</tbody></table><p class=\"bilan\">" + compte(l) + "</p>";
    return { titre: "Notes " + c.code + " " + ev.libelle, paysage: ms.length > 5, pages: [page(ctx, "Fiche de notes — " + ev.libelle, "Classe <b>" + esc(c.code) + "</b>", corps,
      piedSignature(ctx, true, maitreDe(ctx, c.code)))] };
  }

  function resultats(ctx, o) {
    var pages = classesDe(ctx, o.classe).map(function (c) {
      var evs = ctx.evaluations(c).slice(0, 4), rows = ctx.resultatsClasse(c.code).slice().sort(function (a, b) {
        return String(a.eleve.nom || "").localeCompare(String(b.eleve.nom || ""), "fr");
      });
      var std = (c.regle_mga || (c.calendrier === "CM2" ? "MOYENNE4" : "STANDARD")) !== "MOYENNE4";
      var corps = "<table><thead><tr><th>N°</th><th>Nom et prénoms</th>" + evs.map(function (e) { return "<th>" + esc(e.libelle) + "</th>"; }).join("") +
        (std ? "<th>Moy. compos.</th>" : "") + "<th>MGA</th><th>Rang</th><th>Décision</th><th>Observation</th></tr></thead><tbody>" +
        rows.map(function (r, i) {
          return "<tr><td>" + (i + 1) + '</td><td class="nom">' + esc(r.eleve.nom) + "</td>" + evs.map(function (e, k) { return "<td>" + nb(r.moy[k]) + "</td>"; }).join("") +
            (std ? "<td>" + nb(r.moy_compos) + "</td>" : "") + "<td><b>" + nb(r.mga) + "</b></td><td>" + esc(r.rang || "") + "</td><td>" +
            esc(r.decision || "") + "</td><td>" + esc(r.observation || "") + "</td></tr>";
        }).join("") + "</tbody></table>";
      var cl = rows.filter(function (r) { return r.mga !== null && r.eleve.statut === "PRESENT"; }), adm = cl.filter(function (r) { return r.decision === "ADMIS"; });
      corps += '<p class="bilan">Effectif : <b>' + rows.length + "</b> — classés : <b>" + cl.length + "</b> — admis : <b>" + adm.length + "</b>" +
        (cl.length ? " (" + nb(adm.length / cl.length * 100) + " %)" : "") + " — moyenne d'admission : " + nb(c.seuil) + "/" + nb(c.bareme) + "</p>";
      return page(ctx, "Résultats annuels", "Classe <b>" + esc(c.code) + "</b>", corps, piedSignature(ctx, true, maitreDe(ctx, c.code)));
    });
    return { titre: "Résultats" + (o.classe ? " " + o.classe : ""), pages: pages };
  }

  function bulletins(ctx, o) {
    var c = classesDe(ctx, o.classe)[0];
    if (!c) { throw new Error("Choisissez une classe."); }
    var g = ctx.grille(c), evs = ctx.evaluations(c).slice(0, 4);
    if (!g) { throw new Error("La classe " + c.code + " n'a pas de grille de notes."); }
    var res = {}, rangsEv = {}, eff = 0;
    ctx.resultatsClasse(c.code).forEach(function (r) { res[r.inscription_id] = r; if (r.eleve.statut === "PRESENT") { eff++; } });
    evs.forEach(function (e) { rangsEv[e.num] = ctx.rangsEvaluation(c.code, e.num); });
    var base = g.mode === "COEF" ? g.note_max : g.echelle;
    var pages = trierParNom(ctx.eleves(c.code).filter(function (e) { return e.statut === "PRESENT"; })).map(function (e) {
      var iid = e.inscription_id, r = res[iid] || {};
      var info = '<div class="info"><div>Nom et prénoms : <b class="gros">' + esc(e.nom) + "</b></div><div>Classe : <b>" + esc(c.code) + "</b> (effectif " + eff + ")</div>" +
        "<div>Matricule : <b>" + esc(e.matricule_desps || e.matricule_ecole || "") + "</b></div><div>Sexe : <b>" + esc(e.sexe) + "</b> — né(e) le <b>" +
        dateFr(e.date_naissance) + "</b></div><div>Redoublant : <b>" + (e.redoublant === "OUI" ? "Oui" : "Non") + "</b></div></div>";
      var t = "<table><thead><tr><th>Évaluation</th><th>Notes obtenues</th><th>Total</th><th>Moyenne /" + nb(base) + "</th><th>Rang</th></tr></thead><tbody>" +
        evs.map(function (ev) {
          var abs = ctx.absentEval(iid, ev.num);
          var notes = abs ? "Absent(e)" : ctx.matieres(g, ev.num).map(function (m) {
            var v = ctx.noteAff(iid, m.id);
            return esc(m.libelle) + " : <b>" + (v === null || v === undefined ? "–" : nb(v)) + "</b>/" + nb(g.mode === "COEF" ? g.note_max : m.valeur);
          }).join(" · ");
          return '<tr><td class="g"><b>' + esc(ev.libelle) + '</b></td><td class="g">' + notes + "</td><td>" + (abs ? "" : nb(ctx.totalEval(iid, c, ev.num))) +
            "</td><td><b>" + nb(ctx.moyenneEval(iid, c, ev.num)) + "</b></td><td>" + esc(rangsEv[ev.num][iid] || "") + "</td></tr>";
        }).join("") + "</tbody></table>";
      var bilan = '<div class="cadre"><span class="gros">Moyenne générale annuelle : ' + (r.mga === null || r.mga === undefined ? "–" : nb(r.mga)) + "/" + nb(c.bareme) +
        "</span>" + (r.rang ? " — rang : <b>" + r.rang + "</b>/" + eff : "") + "<br>Décision : <b>" + esc(r.decision || "en attente") + "</b>" +
        (r.observation ? " — Appréciation : <b>" + esc(r.observation) + "</b>" : "") + "</div>";
      var pied = '<div class="pied"><div class="sig petit"><b>L\'enseignant(e)</b><div class="n">' + esc(maitreDe(ctx, c.code)) + "</div></div>" +
        '<div class="sig petit"><b>Le parent</b><div class="n"></div></div>' +
        '<div class="sig"><b>Le Directeur</b>(signature et cachet)<div class="n">' + esc((ctx.inst().ecole || {}).directeur || "") + "</div></div></div>";
      return page(ctx, "Bulletin de notes", "", info + t + bilan, pied);
    });
    return { titre: "Bulletins " + c.code, pages: pages };
  }

  function absences(ctx, o) {
    var mois = o.mois || p2(new Date().getMonth() + 1), lib = anneeLib(ctx);
    var an = /^\d{4}/.test(lib) ? Number(lib.slice(0, 4)) + (Number(mois) < 8 ? 1 : 0) : new Date().getFullYear();
    var cle = an + "-" + mois;
    var pages = [];
    [["eleve", "Élèves"], ["personnel", "Personnel"]].forEach(function (k) {
      var l = ctx.absences(k[0]).filter(function (a) { return String(a.date || "").slice(0, 7) === cle; }).slice().reverse();
      if (o.classe && k[0] === "eleve") { l = l.filter(function (a) { var e = ctx.eleve(a.cible); return e && e.classe === o.classe; }); }
      var qui = function (a) {
        if (k[0] === "eleve") { var e = ctx.eleve(a.cible); return e ? [e.nom, e.classe] : ["?", ""]; }
        var p = ctx.agent(a.cible); return p ? [p.nom, p.fonction || ""] : ["?", ""];
      };
      var jours = 0, retards = 0;
      var lignes = l.map(function (a, i) {
        var q = qui(a);
        if (a.nature === "RETARD") { retards++; } else { jours += Number(a.jours || 0); }
        return "<tr><td>" + (i + 1) + "</td><td>" + dateFr(a.date) + '</td><td class="nom">' + esc(q[0]) + "</td><td>" + esc(q[1]) + "</td><td>" +
          (a.nature === "RETARD" ? "Retard " + esc(a.retard_min || "") + " min" : "Absence " + nb(a.jours) + " j") + '</td><td class="g">' + esc(a.motif || "") +
          "</td><td>" + (a.justifie === "OUI" || a.justifie === true ? "Oui" : a.justifie === "NON" || a.justifie === false ? "Non" : "") + "</td></tr>";
      }).join("");
      if (!l.length && k[0] === "personnel") { return; }
      var corps = "<table><thead><tr><th>N°</th><th>Date</th><th>Nom et prénoms</th><th>" + (k[0] === "eleve" ? "Classe" : "Fonction") +
        "</th><th>Nature</th><th>Motif</th><th>Justifié</th></tr></thead><tbody>" + (lignes || '<tr><td colspan="7" class="vide">Aucune absence ni aucun retard.</td></tr>') +
        '</tbody></table><p class="bilan">Total : <b>' + nb(jours) + "</b> jour(s) d'absence, <b>" + retards + "</b> retard(s).</p>";
      pages.push(page(ctx, "Absences et retards — " + k[1], "Mois de <b>" + MOIS[mois] + " " + an + "</b>" + (o.classe && k[0] === "eleve" ? " — classe <b>" + esc(o.classe) + "</b>" : ""),
        corps, piedSignature(ctx, false)));
    });
    return { titre: "Absences " + MOIS[mois] + " " + an, pages: pages };
  }

  var GENERATEURS = { liste: liste, notes: ficheNotes, resultats: resultats, bulletins: bulletins, absences: absences };

  // ------------------------------------------------------------------- exports CSV
  function cellule(v) {
    var s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvTexte(lignes) { return lignes.map(function (r) { return r.map(cellule).join(";"); }).join("\r\n") + "\r\n"; }
  function nomFichier(ctx, quoi) {
    var e = ((ctx.inst().ecole || {}).ecole_nom || "ECOLE").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var d = new Date();
    return quoi + "-" + e.toUpperCase().slice(0, 30) + "-" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + ".csv";
  }
  var COLONNES = ["codedren", "codeiep", "iep", "codeecole", "ecole", "matricule", "nom", "prenoms", "sexe", "jour", "mois", "annee", "nationalite",
    "localite", "codesp", "sp", "pere", "mere", "nacte", "lieuacte", "residence", "niveau"];

  function csvEleves(ctx) {
    var e = ctx.inst().ecole || {}, ordre = {};
    ctx.classes().forEach(function (c, i) { ordre[c.code] = i; });
    var tete = [e.code_dren || "", e.code_iepp || "", String(e.iepp || "").replace(/^\s*IEPP\s+/i, "").trim(), e.ecole_code || e.code_ecole || "", e.ecole_nom || ""];
    var l = ctx.eleves().filter(function (x) { return (x.statut || "PRESENT") === "PRESENT"; }).sort(function (a, b) {
      return (ordre[a.classe] === undefined ? 999 : ordre[a.classe]) - (ordre[b.classe] === undefined ? 999 : ordre[b.classe]) ||
        String(a.nom || "").localeCompare(String(b.nom || ""), "fr");
    });
    var out = [COLONNES.slice()];
    l.forEach(function (x) {
      var mots = String(x.nom || "").split(/\s+/).filter(Boolean), dn = String(x.date_naissance || "").split("-");
      var extrait = String(x.extrait || "").toUpperCase() === "OUI" && x.acte_num;
      out.push(tete.concat([x.matricule_desps || "", (mots[0] || "").toUpperCase(), mots.slice(1).join(" ").toUpperCase(),
        x.sexe === "M" ? "MASCULIN" : "FEMININ", dn.length === 3 ? String(Number(dn[2])) : "", dn.length === 3 ? String(Number(dn[1])) : "",
        dn.length === 3 ? dn[0] : "", String(x.nationalite || "IVOIRIENNE").toUpperCase(), String(x.localite || "").toUpperCase(), "",
        String(x.sous_prefecture || "").toUpperCase(), String(x.pere_nom || "").toUpperCase(), String(x.mere_nom || "").toUpperCase(),
        extrait ? String(x.acte_num) : "0", extrait ? String(x.centre_etat_civil || "").toUpperCase() : "", x.pere_residence || x.mere_residence || "",
        niveau(x.classe)]));
    });
    return out;
  }
  function csvResultats(ctx) {
    var out = [["Classe", "N°", "Matricule", "Nom et prénoms", "Sexe", "Évaluation 1", "Évaluation 2", "Évaluation 3", "Évaluation 4", "Moyenne des compositions",
      "MGA", "Rang", "Décision", "Observation"]];
    ctx.classes().forEach(function (c) {
      ctx.resultatsClasse(c.code).slice().sort(function (a, b) { return String(a.eleve.nom || "").localeCompare(String(b.eleve.nom || ""), "fr"); })
        .forEach(function (r, i) {
          out.push([c.code, i + 1, r.eleve.matricule_desps || r.eleve.matricule_ecole || "", r.eleve.nom, r.eleve.sexe].concat(r.moy.map(nb))
            .concat([nb(r.moy_compos), nb(r.mga), r.rang || "", r.decision || "", r.observation || ""]));
        });
    });
    return out;
  }
  function csvAbsences(ctx) {
    var out = [["Type", "Nom et prénoms", "Classe ou fonction", "Date", "Nature", "Jours", "Retard (min)", "Motif", "Justifié"]];
    [["eleve", "Élève"], ["personnel", "Personnel"]].forEach(function (k) {
      ctx.absences(k[0]).slice().reverse().forEach(function (a) {
        var e = k[0] === "eleve" ? ctx.eleve(a.cible) : ctx.agent(a.cible);
        out.push([k[1], e ? e.nom : "?", e ? (k[0] === "eleve" ? e.classe : e.fonction || "") : "", dateFr(a.date), a.nature === "RETARD" ? "Retard" : "Absence",
          a.nature === "RETARD" ? "" : nb(a.jours), a.nature === "RETARD" ? (a.retard_min || "") : "", a.motif || "",
          a.justifie === "OUI" || a.justifie === true ? "Oui" : a.justifie === "NON" || a.justifie === false ? "Non" : ""]);
      });
    });
    return out;
  }
  var CSV = { eleves: ["ELEVES", csvEleves], resultats: ["RESULTATS", csvResultats], absences: ["ABSENCES", csvAbsences] };

  window.AkwaDocs = {
    liste: [
      { id: "liste", titre: "Liste de classe", aide: "Élèves par ordre alphabétique, avec matricule, date de naissance et âge.", classe: true, toutes: true },
      { id: "notes", titre: "Fiche de notes d'une évaluation", aide: "Notes par matière, total, moyenne et rang de chaque élève.", classe: true, evaluation: true },
      { id: "resultats", titre: "Résultats annuels", aide: "Moyennes des évaluations, MGA, rang, décision et observation.", classe: true, toutes: true },
      { id: "bulletins", titre: "Bulletins (un par page)", aide: "Un bulletin par élève de la classe, à signer et à remettre aux parents.", classe: true },
      { id: "absences", titre: "Absences et retards du mois", aide: "Élèves (toutes classes ou une seule) et personnel.", classe: true, toutes: true, mois: true }
    ],
    document: function (id, ctx, opts) {
      var g = GENERATEURS[id];
      if (!g) { throw new Error("Document inconnu : " + id); }
      var r = g(ctx, opts || {});
      return { html: html(r.titre, r.pages, r.paysage), titre: r.titre };
    },
    csv: function (quoi, ctx) {
      var x = CSV[quoi];
      if (!x) { throw new Error("Export inconnu : " + quoi); }
      return { nom: nomFichier(ctx, x[0]), contenu: csvTexte(x[1](ctx)) };
    }
  };
})();
