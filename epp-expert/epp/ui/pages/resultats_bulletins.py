"""Résultats & bulletins (modèle v8) : classement, mentions et bulletins d'une évaluation ou de l'année (MGA)."""
from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QGridLayout

from epp.domain import bulletins
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, Col, Kpi, Tableau, bouton, label, ligne

ANNUEL = "A"


def _fmt(v) -> str:
    return "—" if v is None else f"{v:.2f}".replace(".", ",")


class PageResultatsBulletins(Page):
    titre = "Résultats & bulletins"
    sous_titre = "Classement, mentions et bulletins de composition ou annuels (MGA)."
    permission = "notes.lire"
    ecoute = ("notes", "eleves", "classes", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Imprimer le classement", self._classement))
        self.actions.addWidget(bouton("Tous les bulletins", self._bulletins, "primaire"))
        self.classe, self.eval = QComboBox(), QComboBox()
        self.classe.activated.connect(lambda _: self._remplir_evals())
        self.eval.activated.connect(lambda _: self._charger())
        self.corps.addLayout(ligne(label("Classe"), self.classe, label("Évaluation"), self.eval, None))
        g = QGridLayout()
        self.k_moy, self.k_reu = Kpi("Moyenne de classe"), Kpi("Taux de réussite")
        self.k_pre, self.k_man = Kpi("Premier"), Kpi("Notes manquantes")
        for i, k in enumerate((self.k_moy, self.k_reu, self.k_pre, self.k_man)):
            g.addWidget(k, 0, i)
        self.corps.addLayout(g)
        c = Carte()
        self.table = Tableau([Col("rang_txt", "Rang", largeur=56), Col("nom", "Élève", largeur=240),
                              Col("total_txt", "Total", largeur=70), Col("moy_txt", "Moyenne", largeur=80),
                              Col("appreciation", "Mention", largeur=150), Col("resultat", "Appréciation")])
        c.lay.addWidget(self.table, 1)
        self.corps.addWidget(c, 1)

    def rafraichir(self):
        cl = self.classe.currentData()
        self.classe.clear()
        for c in self.classes_visibles():
            self.classe.addItem(c.code, c.code)
        if cl:
            self.classe.setCurrentIndex(max(0, self.classe.findData(cl)))
        self._remplir_evals()

    def _remplir_evals(self):
        c = self.annee.classe(self.classe.currentData() or "")
        n = self.eval.currentData()
        self.eval.clear()
        if c:
            for num in sorted(self.annee.evaluations.get(c.calendrier, {})) or self.annee.eval_nums():
                self.eval.addItem(self.annee.libelle_evaluation(c.calendrier, num), num)
            self.eval.addItem("Annuel (MGA)", ANNUEL)
        if n is not None:
            self.eval.setCurrentIndex(max(0, self.eval.findData(n)))
        self._charger()

    def _charger(self):
        c, n = self.classe.currentData(), self.eval.currentData()
        if not c or n is None:
            self.table.set_lignes([])
            return
        cl = self.annee.classe(c)
        if n == ANNUEL:
            bs = bulletins.bulletins_annuels(self.db, self.annee, c)
            for b in bs:
                b["moyenne"], b["total_txt"] = b.get("mga"), ""
                b["resultat"] = b.get("decision") or ("Notes manquantes" if b["mga"] is None else "")
                b["appreciation"] = "" if b["mga"] is None else bulletins.appreciation(b["mga"], cl.bareme)
            self.k_man.t.setText("MGA incomplètes")
            manquants = sum(1 for b in bs if b.get("statut") == "PRESENT" and b["mga"] is None)
        else:
            bs = bulletins.bulletins_evaluation(self.db, self.annee, n, c)
            for b in bs:
                b["total_txt"] = _fmt(b["total"]) if b["present"] else "—"
                if not b["present"]:
                    b["resultat"] = "Absent"
                elif b["moyenne"] is None:
                    b["resultat"] = "Notes manquantes"
            self.k_man.t.setText("Notes manquantes")
            manquants = sum(1 for b in bs if b.get("statut") == "PRESENT" and b["present"] and b["moyenne"] is None)
        bs = [b for b in bs if b.get("statut") == "PRESENT"]
        bs.sort(key=lambda b: (b.get("rang") is None, b.get("rang") or 0, b.get("nom") or ""))
        for b in bs:
            r = b.get("rang")
            b["rang_txt"] = "" if r is None else ("1er" if r == 1 else f"{r}e")
            b["moy_txt"] = "Absent" if n != ANNUEL and not b["present"] else _fmt(b["moyenne"])
        classes = [b for b in bs if b.get("moyenne") is not None and (n == ANNUEL or b["present"])]
        ech = cl.bareme
        moy = sum(b["moyenne"] for b in classes) / len(classes) if classes else None
        ok = sum(1 for b in classes if b["moyenne"] >= cl.seuil)
        self.k_moy.set(f"{_fmt(moy)} / {ech:g}" if moy is not None else "—", f"{len(classes)} élève(s) classé(s)")
        self.k_reu.set(f"{round(100 * ok / len(classes))} %" if classes else "—", f"seuil {cl.seuil:g}/{ech:g}")
        p = classes[0] if classes and classes[0].get("rang") == 1 else None
        self.k_pre.set(p["nom"] if p else "—", f"{_fmt(p['moyenne'])} / {ech:g}" if p else "")
        self.k_man.set(str(manquants))
        self.table.set_lignes(bs)

    def _classement(self):
        from epp.ui.dialogs.export import exporter_rapport
        c, n = self.classe.currentData(), self.eval.currentData()
        if c:
            exporter_rapport(self, "RESULTATS", {"classe": c, "compo": None if n == ANNUEL else n},
                             f"Classement {c} {self.eval.currentText()}")

    def _bulletins(self):
        from epp.ui.dialogs.export import exporter_rapport
        c, n = self.classe.currentData(), self.eval.currentData()
        if not c:
            return
        if n == ANNUEL:
            exporter_rapport(self, "BULLETIN_ANNUEL", {"classe": c}, f"Bulletins annuels {c}")
        else:
            exporter_rapport(self, "BULLETIN_COMPO", {"classe": c, "compo": n}, f"Bulletins {c} {self.eval.currentText()}")
