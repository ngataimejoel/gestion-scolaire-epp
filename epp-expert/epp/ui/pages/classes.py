"""Classes et effectifs : structure de l'année (seuils, barèmes, grilles), matières et effectifs par sexe."""
from __future__ import annotations

from PySide6.QtWidgets import (QComboBox, QDialog, QDoubleSpinBox, QHeaderView, QSplitter,
                               QTableWidget, QTableWidgetItem, QVBoxLayout)

from epp.domain import repo, stats
from epp.ui.pages.base import Page
from epp.ui.widgets import (Carte, Col, Formulaire, Tableau, bouton, confirmer, info, label, ligne, protege,
                            valider_suppression)

REGLES = [("STANDARD", "Standard : (compositions + 2 × passage) ÷ 3"), ("MOYENNE4", "Moyenne des 4 évaluations")]


class DialogueClasse(QDialog):
    def __init__(self, page: Page, classe: repo.Classe | None):
        super().__init__(page)
        self.page, self.classe = page, classe
        a = page.annee
        self.setWindowTitle("Modifier la classe" if classe else "Nouvelle classe")
        v = QVBoxLayout(self)
        grilles = [(g.id, f"{g.libelle} ({'coefficients' if g.mode == 'COEF' else 'barèmes'}, sur {g.echelle:g})")
                   for g in a.grilles.values()]
        cals = sorted(a.evaluations) or ["STD"]
        self.f = Formulaire([
            ("code", "Code *", "texte"), ("libelle", "Libellé", "texte"), ("ordre", "Ordre d'affichage", "entier"),
            ("niveau_suivant", "Classe suivante", "liste", [("", "– (fin de cycle)")] + [(c, c) for c in a.codes]),
            ("bareme", "Moyenne sur", "nombre", (1, 100)), ("seuil", "Moyenne d'admission", "nombre", (0, 100)),
            ("grille_id", "Grille de notes", "liste", grilles),
            ("calendrier", "Calendrier des évaluations", "liste", [(c, c) for c in cals]),
            ("regle_mga", "Moyenne générale annuelle", "liste", REGLES)])
        v.addWidget(self.f)
        if classe:
            self.f.remplir(vars(classe))
        else:
            self.f.remplir({"ordre": len(a.classes) + 1, "bareme": 10, "seuil": 5, "calendrier": "STD",
                            "regle_mga": "STANDARD"})
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Enregistrer", self._ok, "primaire")))

    def marquer_erreur(self, champ):
        self.f.marquer_erreur(champ)

    @protege
    def _ok(self):
        d = self.f.valeurs()
        repo.save_classe(self.page.db, self.page.s, self.classe.id if self.classe else None, self.page.annee.id, d)
        self.accept()


class DialogueMatieres(QDialog):
    """Matières d'une grille pour une évaluation (libellé et coefficient ou barème)."""

    def __init__(self, page: Page, grille: repo.Grille):
        super().__init__(page)
        self.page, self.grille = page, grille
        self.setWindowTitle(f"Matières – {grille.libelle}")
        self.resize(560, 460)
        v = QVBoxLayout(self)
        self.eval = QComboBox()
        for n in page.annee.eval_nums():
            self.eval.addItem(page.annee.libelle_evaluation("STD", n), n)
        self.eval.currentIndexChanged.connect(self._charger)
        v.addLayout(ligne(label("Évaluation"), self.eval, None))
        v.addWidget(label("Coefficient (grille à coefficients) ou note maximale de la matière (grille à barèmes). "
                          "Les notes des matières conservées ne sont pas touchées.", discret=True, wrap=True))
        self.t = QTableWidget(0, 2)
        self.t.setHorizontalHeaderLabels(["Matière", "Coefficient / barème"])
        self.t.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        v.addWidget(self.t, 1)
        v.addLayout(ligne(bouton("Ajouter une matière", self._ajouter), bouton("Retirer", self._retirer), None,
                          bouton("Fermer", self.reject), bouton("Enregistrer", self._ok, "primaire")))
        self._charger()

    def _ligne(self, m: dict):
        r = self.t.rowCount()
        self.t.insertRow(r)
        it = QTableWidgetItem(m.get("libelle", ""))
        it.setData(256, m.get("id"))
        self.t.setItem(r, 0, it)
        sp = QDoubleSpinBox()
        sp.setRange(0, 1000)
        sp.setDecimals(2)
        sp.setValue(float(m.get("valeur") or 1))
        self.t.setCellWidget(r, 1, sp)

    def _charger(self):
        self.t.setRowCount(0)
        for m in self.grille.matieres.get(self.eval.currentData(), []):
            self._ligne(m)

    def _ajouter(self):
        self._ligne({"libelle": "NOUVELLE MATIERE", "valeur": 1})

    def _retirer(self):
        r = self.t.currentRow()
        if r < 0:
            return
        it = self.t.item(r, 0)
        if it is not None and it.data(256) and not valider_suppression(
                self, self.page.db, self.page.s, f"matière {it.text()} (et ses notes) – {self.grille.libelle}"):
            return                       # matière déjà enregistrée : ses notes seront effacées
        self.t.removeRow(r)

    @protege
    def _ok(self):
        mats = []
        for r in range(self.t.rowCount()):
            it = self.t.item(r, 0)
            mats.append({"id": it.data(256), "libelle": it.text(), "valeur": self.t.cellWidget(r, 1).value()})
        repo.save_matieres(self.page.db, self.page.s, self.grille.id, self.eval.currentData(), mats)
        self.page.ctx.recharger_annee()
        self.grille = self.page.annee.grilles[self.grille.id]
        info(self, "Matières", "Les matières ont été enregistrées.")


class PageClasses(Page):
    titre = "Classes et effectifs"
    sous_titre = "Structure de l'année, grilles de notes et effectifs"
    permission = "eleves.lire"
    ecoute = ("eleves", "classes", "personnel", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.b_ajout = bouton("Nouvelle classe", self._nouvelle, "primaire")
        self.actions.addWidget(bouton("Imprimer les effectifs", self._imprimer))
        self.actions.addWidget(self.b_ajout)
        split = QSplitter()
        c1 = Carte("Classes")
        self.table = Tableau([Col("code", "Classe", largeur=60), Col("libelle", "Libellé", largeur=90),
                              Col("grille", "Grille", largeur=110), Col("bareme", "Sur", "nombre", 46),
                              Col("seuil", "Admission", "nombre", 74), Col("niveau_suivant", "Suivante", largeur=70),
                              Col("enseignant", "Enseignant", largeur=180), Col("garcons", "G", "nombre", 40),
                              Col("filles", "F", "nombre", 40), Col("total", "Total", "nombre", 50)])
        self.table.double_clic.connect(lambda _: self._modifier())
        c1.lay.addWidget(self.table, 1)
        self.b_mod = bouton("Modifier", self._modifier)
        self.b_mat = bouton("Matières de la grille…", self._matieres)
        self.b_sup = bouton("Supprimer", self._supprimer, "danger")
        c1.lay.addLayout(ligne(self.b_mod, self.b_mat, None, self.b_sup))
        split.addWidget(c1)
        c2 = Carte("Effectifs par âge et par sexe")
        self.ages = Tableau([Col("libelle", "Indicateur", largeur=200), Col("M", "Garçons", "nombre"),
                             Col("F", "Filles", "nombre"), Col("T", "Total", "nombre")])
        self.ages.etirer()
        c2.lay.addWidget(self.ages, 1)
        split.addWidget(c2)
        split.setSizes([800, 380])
        self.corps.addWidget(split, 1)
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._etat())

    def rafraichir(self):
        a = self.annee
        st = stats.compute(self.db, a)
        ens = {}
        for p in repo.personnel(self.db, a):
            if p.get("classe_code"):
                ens.setdefault(p["classe_code"], []).append(p["nom"])
        lignes = []
        for c in a.classes:
            g = a.grilles.get(c.grille_id)
            lignes.append({**vars(c), "grille": g.libelle if g else "–", "enseignant": ", ".join(ens.get(c.code, [])),
                           "garcons": st.val(c.code, "M", "inscrits"), "filles": st.val(c.code, "F", "inscrits"),
                           "total": st.val(c.code, "T", "inscrits"), "_classe": c})
        self.table.set_lignes(lignes)
        indic = ["inscrits", "presents", "abandons", "transferes", "redoublants", "sur_age", "orphelins",
                 "sans_extrait", "ivoiriens", "etrangers"]
        self.ages.set_lignes([{"libelle": stats.METRIQUES[k][0].strip(),
                               **{sx: st.val("TOTAL", sx, k) for sx in ("M", "F", "T")}} for k in indic])
        self._etat()

    def _etat(self):
        r = self.table.ligne_courante()
        ok = self.modifiable() and self.peut("parametres.modifier")
        self.b_ajout.setEnabled(ok)
        self.b_mod.setEnabled(ok and bool(r))
        self.b_mat.setEnabled(ok and bool(r) and r["_classe"].grille_id in self.annee.grilles)
        self.b_sup.setEnabled(ok and bool(r) and not r["total"])

    def _apres(self):
        self.ctx.recharger_annee()
        self.ctx.modifie("classes")

    def _nouvelle(self):
        if DialogueClasse(self, None).exec():
            self._apres()

    def _modifier(self):
        r = self.table.ligne_courante()
        if r and self.b_mod.isEnabled() and DialogueClasse(self, r["_classe"]).exec():
            self._apres()

    def _matieres(self):
        r = self.table.ligne_courante()
        if r:
            DialogueMatieres(self, self.annee.grilles[r["_classe"].grille_id]).exec()
            self._apres()

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if r and confirmer(self, "Supprimer la classe", f"Supprimer la classe {r['code']} ?", "Supprimer", True) \
                and valider_suppression(self, self.db, self.s, f"classe {r['code']}"):
            repo.delete_classe(self.db, self.s, r["id"])
            self._apres()

    def _imprimer(self):
        from epp.ui.dialogs.export import exporter_rapport
        exporter_rapport(self, "EFFECTIFS", {}, "Tableau des effectifs")
