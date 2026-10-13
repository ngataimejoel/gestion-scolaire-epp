"""Tableau de bord : bandeau, indicateurs clés, effectifs par classe, alertes et graphique."""
from __future__ import annotations

from PySide6.QtWidgets import QGridLayout, QHBoxLayout, QLabel, QVBoxLayout

from epp.domain import stats
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.video import BandeauVideo
from epp.ui.widgets import Barres, Carte, Col, Kpi, Tableau, bouton, label


def _pct(v) -> str:
    return "–" if v is None else f"{v * 100:.1f} %".replace(".", ",")


ALERTES = [
    ("sans_extrait", "élève(s) sans extrait de naissance", "eleves"),
    ("homonymes", "élève(s) homonymes à vérifier", "eleves"),
    ("mga_manquantes", "élève(s) présents sans moyenne annuelle", "notes"),
    ("classes_sans_enseignant", "classe(s) sans enseignant affecté", "personnel"),
    ("sur_age", "élève(s) en sur-âge", "eleves"),
]


class PageTableauBord(Page):
    titre = "Tableau de bord"
    sous_titre = "Vue d'ensemble de l'année scolaire"
    permission = "eleves.lire"
    ecoute = ("eleves", "notes", "personnel", "classes", "parametres", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Nouvel élève", self._nouvel_eleve, "primaire"))
        self.actions.addWidget(bouton("Rapports", lambda: self.fenetre.aller("rapports")))
        self.bandeau = BandeauVideo("banniere", "", "")
        self.bandeau.setFixedHeight(112)
        self.corps.addWidget(self.bandeau)
        grille = QGridLayout()
        grille.setSpacing(12)
        self.kpis = {}
        for i, (cle, titre) in enumerate([
                ("effectif", "Effectif total"), ("filles", "Filles"), ("presents", "Présents"),
                ("abandon", "Taux d'abandon"), ("admission", "Taux d'admission"),
                ("extrait", "Sans extrait"), ("enseignants", "Enseignants"), ("ratio", "Élèves par enseignant")]):
            k = Kpi(titre)
            self.kpis[cle] = k
            grille.addWidget(k, i // 4, i % 4)
        self.corps.addLayout(grille)
        bas = QHBoxLayout()
        bas.setSpacing(12)
        c1 = Carte("Effectifs par classe")
        self.table = Tableau([Col("classe", "Classe", largeur=80), Col("garcons", "Garçons", "nombre"),
                              Col("filles", "Filles", "nombre"), Col("total", "Total", "nombre"),
                              Col("admis", "Admis", "nombre"), Col("taux_admission", "Taux d'admission", "pourcent"),
                              Col("abandons", "Abandons", "nombre")])
        self.table.etirer()
        c1.lay.addWidget(self.table)
        bas.addWidget(c1, 5)
        droite = QVBoxLayout()
        droite.setSpacing(12)
        self.c_alertes = Carte("Points d'attention")
        self.l_alertes = QVBoxLayout()
        self.c_alertes.lay.addLayout(self.l_alertes)
        droite.addWidget(self.c_alertes)
        c3 = Carte("Garçons et filles par classe")
        self.graph = Barres()
        c3.lay.addWidget(self.graph)
        droite.addWidget(c3, 1)
        bas.addLayout(droite, 4)
        self.corps.addLayout(bas, 1)

    def _nouvel_eleve(self):
        p = self.fenetre.page("eleves")
        if p:
            p.nouveau()

    def rafraichir(self):
        e = self.db.get_param("ecole_nom") or ""
        a = self.annee
        self.bandeau.set_textes(e, f"Année scolaire {a.libelle} · {self.db.get_param('iepp') or ''} · "
                                   f"{self.db.get_param('dren') or ''}")
        tb = stats.tableau_de_bord(self.db, a)
        eff = tb["effectif"] or 0
        self.kpis["effectif"].set(str(eff), f"{len(a.classes)} classes")
        nf = sum(r["filles"] for r in tb["par_classe"])
        self.kpis["filles"].set(str(nf), _pct(tb["filles_pct"]))
        self.kpis["presents"].set(str(tb["presents"]), "en fin d'année")
        self.kpis["abandon"].set(_pct(tb["taux_abandon"]))
        self.kpis["admission"].set(_pct(tb["taux_admission"]), "des présents")
        self.kpis["extrait"].set(str(tb["sans_extrait"]), "à régulariser" if tb["sans_extrait"] else "")
        self.kpis["enseignants"].set(str(tb["enseignants"]))
        self.kpis["ratio"].set("–" if not tb["enseignants"] else f"{eff / tb['enseignants']:.0f}")
        self.table.set_lignes(tb["par_classe"])
        self.graph.set_donnees([r["classe"] for r in tb["par_classe"]],
                               [("Garçons", [r["garcons"] for r in tb["par_classe"]]),
                                ("Filles", [r["filles"] for r in tb["par_classe"]])])
        while self.l_alertes.count():
            w = self.l_alertes.takeAt(0).widget()
            if w:
                w.deleteLater()
        n = 0
        for cle, texte, page in ALERTES:
            v = tb["alertes"].get(cle) or 0
            if v:
                n += 1
                b = bouton(f"⚠  {v} {texte}", lambda _=False, p=page: self.fenetre.aller(p))
                b.setFlat(True)
                b.setStyleSheet(f"text-align: left; border: none; color: {theme.ALERTE}; padding: 2px 0;")
                self.l_alertes.addWidget(b)
        if not n:
            ok = QLabel("Aucun point d'attention : les données sont complètes.")
            ok.setStyleSheet(f"color: {theme.SUCCES};")
            self.l_alertes.addWidget(ok)
        if not eff:
            self.l_alertes.addWidget(label("Aucun élève inscrit : commencez par « Nouvel élève » ou importez "
                                           "un fichier (Import / Export).", discret=True, wrap=True))
