"""Statistiques : indicateurs par classe et par sexe (année, composition ou mois)."""
from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QLabel, QSplitter

from epp.domain import stats
from epp.ui.pages.absences import mois_de_l_annee
from epp.ui.pages.base import Page
from epp.ui.widgets import Barres, Carte, Col, Tableau, bouton, label, ligne

ANNEE = ["inscrits", "presents", "abandons", "transferes", "redoublants", "non_redoublants", "sur_age",
         "ivoiriens", "etrangers", "orphelins", "avec_extrait", "sans_extrait", "admis", "redoublent",
         "taux_admission", "effectif_probable"]
COMPO = ["compo_inscrits", "compo_presents", "compo_absents", "compo_admis", "compo_taux"]
MOIS = ["inscrits", "mois_jours_absence", "mois_retards", "mois_frequentation"]


class PageStatistiques(Page):
    titre = "Statistiques"
    sous_titre = "Indicateurs par classe et par sexe"
    permission = "eleves.lire"
    ecoute = ("eleves", "notes", "absences", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Imprimer la synthèse", self._imprimer))
        self.periode = QComboBox()
        self.sexe = QComboBox()
        for k, t in (("T", "Garçons et filles"), ("M", "Garçons"), ("F", "Filles")):
            self.sexe.addItem(t, k)
        self.extrait = QComboBox()
        for k, t in stats.EXTRAITS.items():
            self.extrait.addItem(t, k)
        self.periode.activated.connect(lambda _: self._calculer())
        self.sexe.activated.connect(lambda _: self._calculer())
        self.extrait.activated.connect(lambda _: self._calculer())
        self.l_sexe, self.l_extrait = label("Élèves"), label("Extrait")
        self.corps.addLayout(ligne(label("Période"), self.periode, self.l_sexe, self.sexe, self.l_extrait,
                                   self.extrait, None))
        split = QSplitter()
        c1 = Carte()
        self.table = Tableau([Col("libelle", "Indicateur")])
        c1.lay.addWidget(self.table, 1)
        split.addWidget(c1)
        c2 = Carte("Par classe")
        self.titre_graph = c2.findChild(QLabel, "titreCarte")
        self.graph = Barres()
        c2.lay.addWidget(self.graph, 1)
        split.addWidget(c2)
        split.setSizes([820, 400])
        self.corps.addWidget(split, 1)

    def rafraichir(self):
        p = self.periode.currentData()
        self.periode.clear()
        self.periode.addItem("Année scolaire", ("annee", None))
        self.periode.addItem("Âges par niveau et par sexe", ("ages", None))
        for n in self.annee.eval_nums():
            self.periode.addItem(self.annee.libelle_evaluation("STD", n), ("compo", n))
        for m, t in mois_de_l_annee(self.annee):
            self.periode.addItem(f"Mois de {t.lower()}", ("mois", m))
        if p:
            i = next((k for k in range(self.periode.count()) if self.periode.itemData(k) == p), 0)
            self.periode.setCurrentIndex(i)
        self._calculer()

    def _calculer(self):
        kind, val = self.periode.currentData() or ("annee", None)
        ages = kind == "ages"
        for w in (self.l_sexe, self.sexe):
            w.setVisible(not ages)
        for w in (self.l_extrait, self.extrait):
            w.setVisible(ages)
        self.titre_graph.setText("Par âge (toute l'école)" if ages else "Par classe")
        if ages:
            return self._calculer_ages()
        sx = self.sexe.currentData()
        st = stats.compute(self.db, self.annee, compo=val if kind == "compo" else None,
                           mois=val if kind == "mois" else None)
        metriques = {"annee": ANNEE, "compo": COMPO, "mois": MOIS}[kind]
        cols = [Col("libelle", "Indicateur", largeur=240)]
        typ = lambda k: {"p": "pourcent", "d": "nombre"}.get(stats.METRIQUES[k][1], "nombre")   # noqa: E731
        for c in st.classes:
            cols.append(Col(c, c, "texte", 70))
        cols += [Col("TOTAL_M", "Total G", "texte", 70), Col("TOTAL_F", "Total F", "texte", 70),
                 Col("TOTAL_T", "Total", "texte", 70)]
        from epp.ui.widgets import _texte
        lignes = []
        for k in metriques:
            t = typ(k)
            r = {"libelle": stats.METRIQUES[k][0].strip()}
            for c in st.classes:
                r[c] = _texte(st.val(c, sx, k), t)
            for s_ in ("M", "F", "T"):
                r[f"TOTAL_{s_}"] = _texte(st.val("TOTAL", s_, k), t)
            lignes.append(r)
        self.table.modele.colonnes = cols
        self.table.modele.set_lignes(lignes)
        for i, c in enumerate(cols):
            self.table.setColumnWidth(i, c.largeur or 80)
        cle = {"annee": "taux_admission", "compo": "compo_taux", "mois": "mois_frequentation"}[kind]
        self.graph.set_donnees(st.classes, [(stats.METRIQUES[cle][0], [st.val(c, sx, cle) or 0 for c in st.classes])],
                               pourcent=True)

    def _calculer_ages(self):
        r = stats.repartition_ages(self.db, self.annee, self.extrait.currentData() or "tous")
        groupes = r["classes"] + ["TOTAL"]
        cols = [Col("age", "Âge", largeur=110)]
        for g in groupes:
            for x, t in (("M", "G"), ("F", "F"), ("T", "T")):
                cols.append(Col(f"{g}_{x}", f"{g} {t}" if g != "TOTAL" else f"Total {t}", "texte", 58))
        lignes = []
        for ag in r["ages"] + ["TOTAL"]:
            d = {"age": ag if isinstance(ag, str) else f"{ag} ans"}
            for g in groupes:
                for x in ("M", "F", "T"):
                    d[f"{g}_{x}"] = str(r["n"].get((ag, g, x), 0))
            lignes.append(d)
        self.table.modele.colonnes = cols
        self.table.modele.set_lignes(lignes)
        for i, c in enumerate(cols):
            self.table.setColumnWidth(i, c.largeur or 80)
        libs = [a if isinstance(a, str) else f"{a} ans" for a in r["ages"]]
        self.graph.set_donnees(libs, [("Garçons", [r["n"].get((a, "TOTAL", "M"), 0) for a in r["ages"]]),
                                      ("Filles", [r["n"].get((a, "TOTAL", "F"), 0) for a in r["ages"]])])

    def _imprimer(self):
        from epp.ui.dialogs.export import exporter_rapport
        kind, val = self.periode.currentData() or ("annee", None)
        if kind == "ages":
            exporter_rapport(self, "AGES", {}, "Élèves par âge, niveau et sexe")
        elif kind == "compo":
            exporter_rapport(self, "COMPOSITION", {"compo": val}, f"Rapport de composition {val}")
        elif kind == "mois":
            exporter_rapport(self, "MENSUEL", {"mois": val}, f"Rapport mensuel {val}")
        else:
            exporter_rapport(self, "SYNTHESE", {}, "Synthèse de fin d'année")
