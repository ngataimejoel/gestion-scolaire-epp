"""Saisie des notes : une classe, une évaluation ; présence, notes par matière, total et moyenne recalculés."""
from __future__ import annotations

from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt
from PySide6.QtGui import QBrush, QColor, QFont
from PySide6.QtWidgets import QAbstractItemView, QComboBox, QHeaderView, QTableView

from epp.domain import repo
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, afficher_erreur, bouton, confirmer, label, ligne

FIXES = [("numero", "N°"), ("matricule_ecole", "Matricule"), ("nom", "Nom et prénoms"), ("present", "Présent")]


def _fmt(v) -> str:
    if v is None:
        return ""
    return (f"{v:.2f}" if isinstance(v, float) and not float(v).is_integer() else f"{v:g}").replace(".", ",")


def _coupe(t: str, n: int = 12) -> str:
    """Libellé de matière sur deux lignes au plus pour garder des colonnes étroites."""
    mots, lignes = t.split(), [""]
    for m in mots:
        if lignes[-1] and len(lignes[-1]) + 1 + len(m) > n and len(lignes) < 2:
            lignes.append(m)
        else:
            lignes[-1] = f"{lignes[-1]} {m}".strip()
    return "\n".join(lignes)


class ModeleNotes(QAbstractTableModel):
    def __init__(self, page: "PageNotes"):
        super().__init__(page)
        self.page = page
        self.mats: list[dict] = []
        self.lignes: list[dict] = []
        self.grille = None
        self.eval_num = 1
        self.editable = False

    def charger(self, grille, eval_num, classe, editable):
        self.beginResetModel()
        self.grille, self.eval_num, self.editable = grille, eval_num, editable
        self.mats, self.lignes = repo.notes_grille(self.page.db, self.page.annee, grille.id, eval_num, classe)
        self.endResetModel()

    def _recharger(self):
        mats, lignes = repo.notes_grille(self.page.db, self.page.annee, self.grille.id, self.eval_num,
                                         self.page.classe.currentData())
        self.mats, self.lignes = mats, lignes
        self.dataChanged.emit(self.index(0, 0), self.index(self.rowCount() - 1, self.columnCount() - 1))

    def rowCount(self, p=QModelIndex()):
        return 0 if p.isValid() else len(self.lignes)

    def columnCount(self, p=QModelIndex()):
        if p.isValid():
            return 0
        return len(FIXES) + (len(self.mats) + 2 if self.grille else 0)

    def _col(self, c):
        if c < len(FIXES):
            return ("fixe", FIXES[c][0])
        c -= len(FIXES)
        if c < len(self.mats):
            return ("note", self.mats[c])
        return ("calc", ["total", "moyenne"][c - len(self.mats)])

    def headerData(self, s, o, role=Qt.DisplayRole):
        if o != Qt.Horizontal or role not in (Qt.DisplayRole, Qt.ToolTipRole):
            return None
        k, x = self._col(s)
        if k == "fixe":
            return FIXES[s][1]
        if k == "note":
            mx = repo.max_note(self.grille, x)
            if role == Qt.ToolTipRole:
                return f"{x['libelle']} : note sur {mx:g}" + (f", coefficient {x['valeur']:g}"
                                                             if self.grille.mode == "COEF" else "")
            return f"{_coupe(x['libelle'])}\n/{mx:g}"
        return "Total" if x == "total" else f"Moyenne\n/{self.grille.echelle:g}"

    def flags(self, idx):
        f = Qt.ItemIsEnabled | Qt.ItemIsSelectable
        if not self.editable:
            return f
        k, x = self._col(idx.column())
        if k == "fixe" and x == "present":
            return f | Qt.ItemIsUserCheckable
        if k == "note" and self.lignes[idx.row()]["present"]:
            return f | Qt.ItemIsEditable
        return f

    def data(self, idx, role=Qt.DisplayRole):
        r = self.lignes[idx.row()]
        k, x = self._col(idx.column())
        if k == "fixe" and x == "present":
            if role == Qt.CheckStateRole:
                return Qt.Checked if r["present"] else Qt.Unchecked
            if role == Qt.DisplayRole:
                return "" if r["present"] else "absent"
            return None
        if role in (Qt.DisplayRole, Qt.EditRole):
            if k == "fixe":
                return r.get(x)
            if k == "note":
                return _fmt(r["notes"].get(x["id"]))
            return _fmt(r.get(x))
        if role == Qt.TextAlignmentRole:
            return int(Qt.AlignLeft | Qt.AlignVCenter) if k == "fixe" and x == "nom" else int(Qt.AlignCenter)
        if role == Qt.BackgroundRole:
            if not r["present"]:
                return QBrush(QColor("#F3F1EC"))
            if k == "calc":
                return QBrush(QColor("#EEF3F0"))
            if k == "note" and r["notes"].get(x["id"]) is None and self.editable:
                return QBrush(QColor("#FFFBF3"))
        if role == Qt.ForegroundRole and k == "calc" and x == "moyenne" and r.get("moyenne") is not None:
            cl = self.page.annee.classe(r["classe"])
            seuil = cl.seuil * self.grille.echelle / cl.bareme if cl and cl.bareme else self.grille.echelle / 2
            return QBrush(QColor(theme.SUCCES if r["moyenne"] >= seuil else theme.DANGER))
        if role == Qt.FontRole and k == "calc":
            f = QFont()
            f.setBold(True)
            return f
        return None

    def setData(self, idx, valeur, role=Qt.EditRole):
        r = self.lignes[idx.row()]
        k, x = self._col(idx.column())
        p = self.page
        try:
            if k == "fixe" and x == "present" and role == Qt.CheckStateRole:
                present = Qt.CheckState(valeur) == Qt.Checked
                if not present and r["notes"] and not confirmer(
                        p, "Absent à l'évaluation", f"{r['nom']} est noté absent : ses notes de cette évaluation "
                                                     "seront effacées et sa moyenne vaudra 0. Continuer ?",
                        "Noter absent", danger=True):
                    return False
                repo.set_presence(p.db, p.s, r["inscription_id"], self.eval_num, present, self.grille.id)
            elif k == "note" and role == Qt.EditRole:
                texte = str(valeur).strip()
                repo.set_note(p.db, p.s, p.annee, r["inscription_id"], x["id"], texte or None)
            else:
                return False
        except Exception as e:      # noqa: BLE001
            afficher_erreur(p, e, "Note refusée")
            return False
        self._recharger()
        p.ctx.modifie("notes")
        return True


class VueNotes(QTableView):
    """Après validation d'une note, la cellule suivante (élève suivant) est sélectionnée."""

    def closeEditor(self, editor, hint):
        super().closeEditor(editor, QAbstractItemView.NoHint)
        if hint in (QAbstractItemView.EditNextItem, QAbstractItemView.SubmitModelCache):
            i = self.currentIndex()
            suivant = self.model().index(i.row() + 1, i.column())
            if suivant.isValid():
                self.setCurrentIndex(suivant)


class PageNotes(Page):
    titre = "Notes"
    sous_titre = "Saisie des notes par classe et par évaluation"
    permission = "notes.lire"
    ecoute = ("eleves", "classes", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Feuille de notes", lambda: self._imprimer("FEUILLE_NOTES", "Feuille de notes")))
        self.actions.addWidget(bouton("Bulletins de la classe", lambda: self._imprimer("BULLETIN_EVAL", "Bulletins"),
                                      "primaire"))
        self.classe = QComboBox()
        self.eval = QComboBox()
        self.classe.activated.connect(lambda _: self._remplir_evals())
        self.eval.activated.connect(lambda _: self._charger())
        self.info = label("", discret=True)
        self.corps.addLayout(ligne(label("Classe"), self.classe, label("Évaluation"), self.eval, self.info, None))
        c = Carte()
        self.vue = VueNotes()
        self.modele = ModeleNotes(self)
        self.vue.setModel(self.modele)
        self.vue.setAlternatingRowColors(False)
        self.vue.verticalHeader().setVisible(False)
        self.vue.verticalHeader().setDefaultSectionSize(28)
        self.vue.setEditTriggers(QAbstractItemView.AnyKeyPressed | QAbstractItemView.DoubleClicked |
                                 QAbstractItemView.EditKeyPressed | QAbstractItemView.SelectedClicked)
        self.vue.setSelectionMode(QAbstractItemView.SingleSelection)
        self.vue.horizontalHeader().setMinimumHeight(60)
        c.lay.addWidget(self.vue, 1)
        c.lay.addWidget(label("Tapez la note puis Entrée pour passer à l'élève suivant. Décochez « Présent » pour un "
                              "élève absent à l'évaluation (sa moyenne vaut alors 0). Virgule ou point acceptés.",
                              discret=True, wrap=True))
        self.corps.addWidget(c, 1)

    def rafraichir(self):
        cl = self.classe.currentData()
        self.classe.clear()
        for c in self.annee.classes:
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
        if n:
            self.eval.setCurrentIndex(max(0, self.eval.findData(n)))
        self._charger()

    def _charger(self):
        c = self.annee.classe(self.classe.currentData() or "")
        if not c or c.grille_id not in self.annee.grilles or self.eval.currentData() is None:
            self.modele.beginResetModel()
            self.modele.lignes, self.modele.mats = [], []
            self.modele.endResetModel()
            self.info.setText("Aucune classe" if not c else "Aucune grille de notes pour cette classe")
            return
        g = self.annee.grilles[c.grille_id]
        editable = self.modifiable() and self.peut("notes.modifier")
        self.modele.charger(g, self.eval.currentData(), c.code, editable)
        h = self.vue.horizontalHeader()
        h.setSectionResizeMode(QHeaderView.Interactive)
        self.vue.setColumnWidth(0, 40)
        self.vue.setColumnWidth(1, 105)
        self.vue.setColumnWidth(2, 220)
        self.vue.setColumnWidth(3, 64)
        fm = self.vue.horizontalHeader().fontMetrics()
        for i in range(len(FIXES), self.modele.columnCount()):
            texte = str(self.modele.headerData(i, Qt.Horizontal) or "")
            self.vue.setColumnWidth(i, max(64, max(fm.horizontalAdvance(x) for x in texte.split("\n")) + 22))
        mode = "coefficients" if g.mode == "COEF" else "barèmes"
        n = len(self.modele.lignes)
        self.info.setText(f"{n} élève(s) · grille {g.libelle} ({mode}) · moyenne sur {g.echelle:g}"
                          + ("" if editable else " · lecture seule"))

    def _imprimer(self, code, nom):
        from epp.ui.dialogs.export import exporter_rapport
        c = self.classe.currentData()
        if c:
            exporter_rapport(self, code, {"classe": c, "compo": self.eval.currentData()},
                             f"{nom} {c} {self.eval.currentText()}")
