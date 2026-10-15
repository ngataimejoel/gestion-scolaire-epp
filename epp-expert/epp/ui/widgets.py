"""Briques communes de l'interface : contexte partagé, tableaux, formulaires, cartes, messages."""
from __future__ import annotations

import functools
import logging
import traceback
from datetime import date
from pathlib import Path

from PySide6.QtCore import (QAbstractTableModel, QDate, QModelIndex, QObject, QSortFilterProxyModel, Qt, QUrl,
                            Signal)
from PySide6.QtGui import QBrush, QColor, QDesktopServices, QFont, QPainter, QPen
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QDateEdit, QDoubleSpinBox, QFileDialog, QFormLayout,
                               QFrame, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QMessageBox, QPlainTextEdit,
                               QPushButton, QSizePolicy, QSpinBox, QTableView, QVBoxLayout, QWidget)

from epp.core import paths
from epp.core.db import AnneeCloturee
from epp.core.security import AccessDenied
from epp.domain import calculs
from epp.domain.repo import ValidationError
from epp.ui import theme

log = logging.getLogger(__name__)


# =================================================================== contexte partagé
class Contexte(QObject):
    """Base ouverte, utilisateur connecté et année affichée, partagés par toutes les pages."""
    annee_changee = Signal()
    donnees_modifiees = Signal(str)          # « eleves », « personnel », « notes », « absences »…
    session_changee = Signal()

    def __init__(self, db, session=None, annee=None, licence=None):
        super().__init__()
        self.db, self.session, self.annee, self.licence = db, session, annee, licence

    def peut(self, perm: str) -> bool:
        return bool(self.session and self.session.can(perm))

    def recharger_annee(self, annee_id: int | None = None) -> None:
        from epp.domain import repo
        aid = annee_id or (self.annee.id if self.annee else None) or repo.active_annee_id(self.db)
        self.annee = repo.load_annee(self.db, aid) if aid else None
        self.annee_changee.emit()

    def modifie(self, quoi: str) -> None:
        self.donnees_modifiees.emit(quoi)


# =================================================================== messages
MESSAGES_CONNUS = (ValidationError, AccessDenied, AnneeCloturee, ValueError, PermissionError)


def afficher_erreur(parent, exc: BaseException, titre: str = "Opération impossible") -> None:
    if isinstance(exc, AnneeCloturee):
        texte = ("Cette année scolaire est clôturée : ses données sont en lecture seule.\n"
                 "Un administrateur peut la rouvrir depuis « Résultats et fin d'année ».")
    elif isinstance(exc, MESSAGES_CONNUS):
        texte = str(exc)
    else:
        log.error("Erreur inattendue : %s", "".join(traceback.format_exception(exc)))
        texte = (f"Une erreur inattendue s'est produite :\n{exc}\n\n"
                 f"Le détail a été écrit dans le journal ({paths.logs_dir() / 'application.log'}).")
        QMessageBox.critical(parent, "Erreur", texte)
        return
    QMessageBox.warning(parent, titre, texte)


def protege(fn):
    """Décorateur de slot : toute erreur est affichée proprement au lieu de fermer l'application."""
    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        try:
            return fn(self, *a, **k)
        except Exception as e:     # noqa: BLE001 - affichée à l'utilisateur
            afficher_erreur(self if isinstance(self, QWidget) else None, e)
            if hasattr(self, "marquer_erreur") and isinstance(e, ValidationError):
                self.marquer_erreur(e.champ)
            return None
    return wrapper


def confirmer(parent, titre: str, texte: str, ok: str = "Confirmer", danger: bool = False) -> bool:
    box = QMessageBox(QMessageBox.Warning if danger else QMessageBox.Question, titre, texte, parent=parent)
    b_ok = box.addButton(ok, QMessageBox.AcceptRole)
    box.addButton("Annuler", QMessageBox.RejectRole)
    box.setDefaultButton(QMessageBox.Cancel if danger else b_ok)
    box.exec()
    return box.clickedButton() is b_ok


def mot_de_passe_admin(parent, db, s, texte: str, motif: str) -> str | None:
    """Demande le mot de passe d'un administrateur ; renvoie son identifiant si le mot de passe est juste."""
    from PySide6.QtWidgets import QDialog, QDialogButtonBox, QLineEdit, QVBoxLayout
    from epp.core import security
    d = QDialog(parent)
    d.setWindowTitle("Mot de passe administrateur")
    v = QVBoxLayout(d)
    v.addWidget(label(texte, wrap=True))
    champ = QLineEdit()
    champ.setEchoMode(QLineEdit.Password)
    champ.setPlaceholderText("Mot de passe d'un administrateur")
    v.addWidget(champ)
    erreur = label("")
    erreur.setStyleSheet(f"color: {theme.DANGER};")
    v.addWidget(erreur)
    bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
    bb.button(QDialogButtonBox.Ok).setText("Valider")
    bb.button(QDialogButtonBox.Cancel).setText("Annuler")
    v.addWidget(bb)
    resultat: list[str] = []

    def valider():
        login = security.verifier_admin(db, s, champ.text(), motif)
        if login:
            resultat.append(login)
            d.accept()
        else:
            erreur.setText("Mot de passe incorrect.")
            champ.selectAll()
            champ.setFocus()

    bb.accepted.connect(valider)
    bb.rejected.connect(d.reject)
    d.setMinimumWidth(380)
    d.exec()
    return resultat[0] if resultat else None


def valider_suppression(parent, db, s, quoi: str) -> bool:
    """Toute suppression de données exige le mot de passe d'un administrateur, même pour un administrateur
    connecté ; chaque tentative (acceptée ou refusée) est inscrite au journal."""
    return bool(mot_de_passe_admin(
        parent, db, s, f"Suppression : {quoi}.\n\nToute suppression de données doit être validée par un "
                       "administrateur. Saisissez le mot de passe d'un administrateur.", f"suppression : {quoi}"))


def info(parent, titre: str, texte: str) -> None:
    QMessageBox.information(parent, titre, texte)


def ouvrir_fichier(chemin) -> None:
    QDesktopServices.openUrl(QUrl.fromLocalFile(str(chemin)))


FILTRES = {"pdf": "Document PDF (*.pdf)", "xlsx": "Classeur Excel (*.xlsx)", "docx": "Document Word (*.docx)",
           "zip": "Sauvegarde (*.zip)", "epptpl": "Modèle de rapport (*.epptpl)"}


def chemin_sortie(parent, titre: str, nom: str, formats: list[str]) -> tuple[Path | None, str | None]:
    """Boîte « Enregistrer sous » : renvoie (chemin, format choisi)."""
    filtres = [FILTRES[f] for f in formats]
    defaut = paths.exports_dir() / f"{nom}.{formats[0]}"
    chemin, filtre = QFileDialog.getSaveFileName(parent, titre, str(defaut), ";;".join(filtres))
    if not chemin:
        return None, None
    fmt = next((f for f in formats if FILTRES[f] == filtre), formats[0])
    p = Path(chemin)
    if p.suffix.lower().lstrip(".") in formats:
        fmt = p.suffix.lower().lstrip(".")
    return p.with_suffix("." + fmt), fmt


def bouton(texte: str, slot=None, role: str | None = None, tip: str | None = None) -> QPushButton:
    b = QPushButton(texte)
    if role:
        b.setProperty("role", role)
    if slot:
        b.clicked.connect(slot)
    if tip:
        b.setToolTip(tip)
    b.setCursor(Qt.PointingHandCursor)
    return b


def ligne(*widgets, stretch_avant: bool = False, stretch_apres: bool = False, marge: int = 0) -> QHBoxLayout:
    h = QHBoxLayout()
    h.setContentsMargins(marge, marge, marge, marge)
    if stretch_avant:
        h.addStretch(1)
    for w in widgets:
        if w is None:
            h.addStretch(1)
        elif isinstance(w, QWidget):
            h.addWidget(w)
        else:
            h.addLayout(w)
    if stretch_apres:
        h.addStretch(1)
    return h


def label(texte: str = "", discret: bool = False, gras: bool = False, taille: float | None = None,
          wrap: bool = False) -> QLabel:
    l = QLabel(texte)
    if discret:
        l.setProperty("discret", True)
        l.setStyleSheet(f"color: {theme.DISCRET};")
    if gras or taille:
        f = l.font()
        f.setBold(gras)
        if taille:
            f.setPointSizeF(taille)
        l.setFont(f)
    l.setWordWrap(wrap)
    return l


# =================================================================== cartes
class Carte(QFrame):
    def __init__(self, titre: str | None = None, parent=None):
        super().__init__(parent)
        self.setObjectName("carte")
        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(14, 12, 14, 12)
        self.lay.setSpacing(8)
        if titre:
            t = QLabel(titre)
            t.setObjectName("titreCarte")
            self.lay.addWidget(t)


class Kpi(Carte):
    def __init__(self, titre: str, valeur: str = "–", note: str = ""):
        super().__init__()
        self.lay.setSpacing(2)
        self.t = QLabel(titre)
        self.t.setObjectName("kpiTitre")
        self.v = QLabel(valeur)
        self.v.setObjectName("kpiValeur")
        self.n = label(note, discret=True)
        for w in (self.t, self.v, self.n):
            self.lay.addWidget(w)
        self.setMinimumWidth(150)

    def set(self, valeur: str, note: str = "") -> None:
        self.v.setText(valeur)
        self.n.setText(note)


class Barres(QWidget):
    """Histogramme simple (séries côte à côte), dessiné sans bibliothèque externe."""
    COULEURS = [theme.PRIMAIRE, theme.ACCENT, "#7FB49A", "#2B6CB0"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.categories: list[str] = []
        self.series: list[tuple[str, list[float]]] = []
        self.pourcent = False
        self.setMinimumHeight(200)

    def set_donnees(self, categories, series, pourcent=False):
        self.categories, self.series, self.pourcent = list(categories), list(series), pourcent
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        g, d, hh, bas = 34, 10, 24, 26
        if not self.categories or not self.series:
            p.setPen(QColor(theme.DISCRET))
            p.drawText(self.rect(), Qt.AlignCenter, "Aucune donnée")
            return
        vmax = max([max((v or 0) for v in vals) for _, vals in self.series] + [1e-9])
        if self.pourcent:
            vmax = max(vmax, 1.0)
        else:
            import math
            vmax = max(4, math.ceil(vmax / 4) * 4)
        zone_h = h - hh - bas
        p.setPen(QPen(QColor("#E6E4DC"), 1))
        for i in range(5):
            y = hh + zone_h * i / 4
            p.drawLine(g, int(y), w - d, int(y))
            p.setPen(QColor(theme.DISCRET))
            v = vmax * (4 - i) / 4
            p.drawText(0, int(y) - 7, g - 4, 14, Qt.AlignRight | Qt.AlignVCenter,
                       f"{v:.0%}" if self.pourcent else f"{v:.0f}")
            p.setPen(QPen(QColor("#E6E4DC"), 1))
        n, ns = len(self.categories), len(self.series)
        larg = (w - g - d) / n
        bw = max(4.0, larg * 0.7 / ns)
        for i, cat in enumerate(self.categories):
            x0 = g + larg * i + (larg - bw * ns) / 2
            for j, (_, vals) in enumerate(self.series):
                v = vals[i] or 0
                bh = zone_h * v / vmax
                p.fillRect(int(x0 + j * bw), int(hh + zone_h - bh), int(bw - 2), int(bh),
                           QColor(self.COULEURS[j % len(self.COULEURS)]))
            p.setPen(QColor(theme.TEXTE))
            p.drawText(int(g + larg * i), h - bas + 4, int(larg), 18, Qt.AlignCenter, cat)
        x = g
        for j, (nom, _) in enumerate(self.series):
            p.fillRect(x, 6, 10, 10, QColor(self.COULEURS[j % len(self.COULEURS)]))
            p.setPen(QColor(theme.DISCRET))
            p.drawText(x + 14, 0, 140, 22, Qt.AlignVCenter, nom)
            x += 24 + p.fontMetrics().horizontalAdvance(nom)


# =================================================================== tableaux
class Col:
    """Colonne d'un tableau : clé du dictionnaire, titre, type d'affichage."""

    def __init__(self, cle: str, titre: str, type_: str = "texte", largeur: int | None = None, fmt=None):
        self.cle, self.titre, self.type, self.largeur, self.fmt = cle, titre, type_, largeur, fmt


def _texte(v, type_: str) -> str:
    if v is None or v == "":
        return ""
    if type_ == "date":
        d = calculs.to_date(v)
        return d.strftime("%d/%m/%Y") if d else str(v)
    if type_ == "decimal":
        try:
            return f"{float(v):.2f}".replace(".", ",")
        except (TypeError, ValueError):
            return str(v)
    if type_ == "nombre":
        try:
            f = float(v)
            return (f"{f:g}").replace(".", ",")
        except (TypeError, ValueError):
            return str(v)
    if type_ == "pourcent":
        try:
            return f"{float(v) * 100:.1f} %".replace(".", ",")
        except (TypeError, ValueError):
            return str(v)
    if type_ == "monnaie":
        try:
            return f"{float(v):,.0f} FCFA".replace(",", " ")
        except (TypeError, ValueError):
            return str(v)
    return str(v)


TRI = Qt.UserRole + 1


class ModeleTable(QAbstractTableModel):
    def __init__(self, colonnes: list[Col], parent=None):
        super().__init__(parent)
        self.colonnes = colonnes
        self.lignes: list[dict] = []

    def set_lignes(self, lignes: list[dict]) -> None:
        self.beginResetModel()
        self.lignes = list(lignes)
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.lignes)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.colonnes)

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if orientation == Qt.Horizontal and role == Qt.DisplayRole:
            return self.colonnes[section].titre
        return None

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        r = self.lignes[index.row()]
        c = self.colonnes[index.column()]
        v = r.get(c.cle)
        if role == Qt.DisplayRole:
            if c.fmt:
                return c.fmt(r)
            return _texte(v, c.type) if c.type != "pastille" else (_PASTILLE_TEXTE.get(v, v) or "")
        if role == Qt.UserRole:
            return r
        if role == TRI:
            if c.type in ("nombre", "decimal", "pourcent", "monnaie"):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return float("-inf")
            return "" if v is None else str(c.fmt(r) if c.fmt else v)
        if role == Qt.TextAlignmentRole:
            if c.type in ("nombre", "decimal", "pourcent", "monnaie"):
                return int(Qt.AlignRight | Qt.AlignVCenter)
            if c.type in ("pastille", "date"):
                return int(Qt.AlignCenter)
            return int(Qt.AlignLeft | Qt.AlignVCenter)
        if c.type == "pastille" and v in theme.PASTILLES:
            fond, texte = theme.PASTILLES[v]
            if role == Qt.BackgroundRole:
                return QBrush(QColor(fond))
            if role == Qt.ForegroundRole:
                return QBrush(QColor(texte))
            if role == Qt.FontRole:
                f = QFont()
                f.setBold(True)
                return f
        if role == Qt.ForegroundRole and r.get("_couleur"):
            return QBrush(QColor(r["_couleur"]))
        return None


_PASTILLE_TEXTE = {"PRESENT": "Présent", "ABANDON": "Abandon", "TRANSFERE": "Transféré", "ADMIS": "Admis",
                   "REDOUBLE": "Redouble", "EXCLU": "Exclu", "EN_ATTENTE": "En attente", "ACCORDEE": "Accordée",
                   "REFUSEE": "Refusée"}


class Tableau(QTableView):
    """Tableau trié, sélection par ligne ; ligne_courante() renvoie le dictionnaire de la ligne."""
    double_clic = Signal(dict)

    def __init__(self, colonnes: list[Col], parent=None):
        super().__init__(parent)
        self.modele = ModeleTable(colonnes, self)
        self.proxy = QSortFilterProxyModel(self)
        self.proxy.setSourceModel(self.modele)
        self.proxy.setSortRole(TRI)
        self.proxy.setSortCaseSensitivity(Qt.CaseInsensitive)
        self.setModel(self.proxy)
        self.setSortingEnabled(True)
        self.sortByColumn(-1, Qt.AscendingOrder)
        self.setAlternatingRowColors(True)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.verticalHeader().setVisible(False)
        self.verticalHeader().setDefaultSectionSize(28)
        self.setShowGrid(False)
        self.setWordWrap(False)
        h = self.horizontalHeader()
        h.setHighlightSections(False)
        h.setStretchLastSection(True)
        for i, c in enumerate(colonnes):
            if c.largeur:
                self.setColumnWidth(i, c.largeur)
        self.doubleClicked.connect(lambda idx: self.double_clic.emit(self.proxy.data(idx, Qt.UserRole)))

    def etirer(self) -> None:
        """Toutes les colonnes se partagent la largeur (petits tableaux de synthèse)."""
        self.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)

    def set_lignes(self, lignes: list[dict]) -> None:
        cle = self.ligne_courante()
        self.modele.set_lignes(lignes)
        if cle is not None:
            self.selectionner(lambda r: r is cle or r == cle)

    def lignes(self) -> list[dict]:
        return [self.proxy.data(self.proxy.index(i, 0), Qt.UserRole) for i in range(self.proxy.rowCount())]

    def ligne_courante(self) -> dict | None:
        idx = self.currentIndex()
        if not idx.isValid() or not self.selectionModel().isRowSelected(idx.row(), QModelIndex()):
            return None
        return self.proxy.data(idx, Qt.UserRole)

    def selectionner(self, predicat) -> bool:
        for i in range(self.proxy.rowCount()):
            if predicat(self.proxy.data(self.proxy.index(i, 0), Qt.UserRole)):
                self.selectRow(i)
                return True
        return False


# =================================================================== formulaires
class ChampDate(QDateEdit):
    """Date facultative : une date vide s'affiche « – »."""
    VIDE = QDate(1900, 1, 1)

    def __init__(self, parent=None, obligatoire: bool = False):
        super().__init__(parent)
        self.setDisplayFormat("dd/MM/yyyy")
        self.setCalendarPopup(True)
        self.obligatoire = obligatoire
        if not obligatoire:
            self.setMinimumDate(self.VIDE)
            self.setSpecialValueText("–")
            self.setDate(self.VIDE)
        else:
            self.setDate(QDate.currentDate())

    def iso(self) -> str | None:
        d = self.date()
        if not self.obligatoire and d == self.VIDE:
            return None
        return d.toString("yyyy-MM-dd")

    def set_iso(self, v) -> None:
        d = calculs.to_date(v) if v else None
        if d is None:
            self.setDate(self.VIDE if not self.obligatoire else QDate.currentDate())
        else:
            self.setDate(QDate(d.year, d.month, d.day))

    def set_date(self, d: date) -> None:
        self.setDate(QDate(d.year, d.month, d.day))


class Formulaire(QWidget):
    """Formulaire construit à partir d'une liste de champs : (clé, libellé, type, options).

    Types : texte, liste (choix fermé), liste_libre (choix modifiable), date, date_obl, nombre,
    entier, multiligne, oui_non, sexe."""

    def __init__(self, champs: list[tuple], parent=None, colonnes: int = 1):
        super().__init__(parent)
        self.widgets: dict[str, QWidget] = {}
        self.types: dict[str, str] = {}
        grille = QHBoxLayout(self)
        grille.setContentsMargins(0, 0, 0, 0)
        forms = []
        for _ in range(colonnes):
            f = QFormLayout()
            f.setLabelAlignment(Qt.AlignRight | Qt.AlignVCenter)
            f.setHorizontalSpacing(10)
            f.setVerticalSpacing(7)
            grille.addLayout(f, 1)
            forms.append(f)
        par_col = -(-len(champs) // colonnes)
        for i, ch in enumerate(champs):
            cle, lib, typ = ch[0], ch[1], ch[2] if len(ch) > 2 else "texte"
            opts = ch[3] if len(ch) > 3 else None
            w = self._widget(typ, opts)
            self.widgets[cle], self.types[cle] = w, typ
            forms[i // par_col].addRow(lib, w)

    @staticmethod
    def _widget(typ, opts):
        if typ in ("liste", "liste_libre", "oui_non", "sexe"):
            w = QComboBox()
            valeurs = {"oui_non": ["", "OUI", "NON"], "sexe": ["M", "F"]}.get(typ, opts or [])
            for v in valeurs:
                if isinstance(v, tuple):
                    w.addItem(v[1], v[0])
                else:
                    w.addItem(v, v)
            w.setEditable(typ == "liste_libre")
            return w
        if typ in ("date", "date_obl"):
            return ChampDate(obligatoire=typ == "date_obl")
        if typ == "nombre":
            w = QDoubleSpinBox()
            w.setDecimals(2)
            w.setRange(*(opts or (0, 1_000_000)))
            return w
        if typ == "entier":
            w = QSpinBox()
            w.setRange(*(opts or (0, 1_000_000)))
            return w
        if typ == "multiligne":
            w = QPlainTextEdit()
            w.setFixedHeight(64)
            return w
        w = QLineEdit()
        if opts:
            w.setPlaceholderText(opts)
        return w

    def valeurs(self) -> dict:
        out = {}
        for k, w in self.widgets.items():
            if isinstance(w, QComboBox):
                out[k] = w.currentText().strip() if w.isEditable() else w.currentData()
                out[k] = out[k] if out[k] not in ("",) else None
            elif isinstance(w, ChampDate):
                out[k] = w.iso()
            elif isinstance(w, (QSpinBox, QDoubleSpinBox)):
                out[k] = w.value()
            elif isinstance(w, QPlainTextEdit):
                out[k] = w.toPlainText().strip() or None
            else:
                out[k] = w.text().strip() or None
        return out

    def remplir(self, data: dict) -> None:
        for k, w in self.widgets.items():
            v = data.get(k)
            if isinstance(w, QComboBox):
                i = w.findData(v) if v is not None else w.findData("")
                if i < 0 and v is not None:
                    i = w.findText(str(v))
                if i >= 0:
                    w.setCurrentIndex(i)
                elif w.isEditable():
                    w.setEditText("" if v is None else str(v))
                elif v not in (None, ""):
                    w.addItem(str(v), v)
                    w.setCurrentIndex(w.count() - 1)
            elif isinstance(w, ChampDate):
                w.set_iso(v)
            elif isinstance(w, (QSpinBox, QDoubleSpinBox)):
                w.setValue(float(v or 0) if isinstance(w, QDoubleSpinBox) else int(v or 0))
            elif isinstance(w, QPlainTextEdit):
                w.setPlainText("" if v is None else str(v))
            else:
                w.setText("" if v is None else str(v))
        self.marquer_erreur(None)

    def marquer_erreur(self, champ: str | None) -> None:
        for k, w in self.widgets.items():
            w.setProperty("erreur", k == champ)
            w.style().unpolish(w)
            w.style().polish(w)
        if champ in self.widgets:
            self.widgets[champ].setFocus()

    def activer(self, actif: bool) -> None:
        for w in self.widgets.values():
            w.setEnabled(actif)


def separateur() -> QFrame:
    f = QFrame()
    f.setFrameShape(QFrame.HLine)
    f.setStyleSheet(f"color: {theme.BORDURE};")
    return f


def extensible(w: QWidget) -> QWidget:
    w.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
    return w
