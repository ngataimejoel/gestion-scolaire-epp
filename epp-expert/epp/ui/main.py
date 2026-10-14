"""Fenêtre principale et démarrage de l'interface.

Ordre au lancement : licence (si elle n'est pas valable, seul l'écran d'activation est accessible et
aucune donnée n'est consultable), premier lancement ou connexion, mot de passe provisoire à changer,
sauvegarde automatique, puis la fenêtre principale.
"""
from __future__ import annotations

import importlib
import logging
import sys

from PySide6.QtCore import QRect, QSize, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QKeySequence, QPalette, QShortcut
from PySide6.QtWidgets import (QApplication, QComboBox, QFrame, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
                               QMainWindow, QMenu, QMessageBox, QScrollArea, QStackedWidget, QStyledItemDelegate, QToolButton,
                               QVBoxLayout, QWidget)

from epp import APP_MARQUE, APP_NAME, __version__
from epp.core import backup, licence, security
from epp.core.db import open_database
from epp.domain import repo
from epp.ui import logo as logo_app
from epp.ui import theme
from epp.ui.dialogs.acces import (DialogueActivation, DialogueConnexion, DialogueMotDePasse,
                                  DialoguePremierLancement)
from epp.ui.widgets import Contexte, afficher_erreur, bouton, label

log = logging.getLogger(__name__)

# clé, libellé, raccourci, classe de la page, droit nécessaire pour la voir
PAGES = [
    ("tableau", "Tableau de bord", "Ctrl+1", "tableau_bord:PageTableauBord", "eleves.lire"),
    ("eleves", "Élèves", "Ctrl+2", "eleves:PageEleves", "eleves.lire"),
    ("inscriptions", "Inscriptions", "Ctrl+3", "inscriptions:PageInscriptions", "eleves.lire"),
    ("classes", "Classes et effectifs", "Ctrl+4", "classes:PageClasses", "eleves.lire"),
    ("personnel", "Personnel", "Ctrl+5", "personnel:PagePersonnel", "personnel.lire"),
    ("notes", "Notes", "Ctrl+6", "notes:PageNotes", "notes.lire"),
    ("resultats", "Résultats et fin d'année", "Ctrl+7", "resultats:PageResultats", "notes.lire"),
    ("absences", "Absences et autorisations", "Ctrl+8", "absences:PageAbsences", "absences.lire"),
    ("statistiques", "Statistiques", "Ctrl+9", "statistiques:PageStatistiques", "eleves.lire"),
    ("rapports", "Rapports", "", "rapports:PageRapports", "rapports.generer"),
    ("import_export", "Import / Export", "", "import_export:PageImportExport", None),
    ("parametres", "Paramètres", "", "parametres:PageParametres", None),
    ("sauvegarde", "Sauvegarde", "", "sauvegarde:PageSauvegarde", "sauvegarde.creer"),
    ("aide", "Aide et tutoriels", "F1", "aide:PageAide", None),
]

VERIF_LICENCE_MS = 15 * 60 * 1000


def classe_page(chemin: str):
    mod, cls = chemin.split(":")
    return getattr(importlib.import_module(f"epp.ui.pages.{mod}"), cls)


class _DelegueMenu(QStyledItemDelegate):
    """Entrée du menu avec le raccourci clavier aligné à droite."""

    def paint(self, p, opt, idx):
        super().paint(p, opt, idx)
        rac = idx.data(Qt.UserRole + 1)
        if rac:
            p.save()
            p.setPen(QColor("#8FB5A5"))
            f = QFont(opt.font)
            f.setPointSizeF(max(7.5, f.pointSizeF() - 1.5))
            p.setFont(f)
            r = QRect(opt.rect.adjusted(0, 0, -20, 0))
            p.drawText(r, Qt.AlignRight | Qt.AlignVCenter, rac)
            p.restore()

    def sizeHint(self, opt, idx):
        s = super().sizeHint(opt, idx)
        return QSize(s.width(), max(s.height(), 34))


class FenetrePrincipale(QMainWindow):
    def __init__(self, ctx: Contexte):
        super().__init__()
        self.ctx = ctx
        self.action_fin: str | None = None          # « deconnexion », « reconnexion » ou None (quitter)
        self.setWindowTitle(APP_NAME)
        self.resize(1360, 820)
        self.setMinimumSize(1080, 660)
        self.pages: dict[str, QWidget] = {}
        self.zones: dict[str, QScrollArea] = {}
        central = QWidget()
        self.setCentralWidget(central)
        h = QHBoxLayout(central)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)
        h.addWidget(self._barre_laterale())
        droite = QVBoxLayout()
        droite.setSpacing(0)
        droite.addWidget(self._barre_haute())
        self.bandeau_essai = self._bandeau("bandeauEssai")
        self.bandeau_archive = self._bandeau("bandeauArchive")
        droite.addWidget(self.bandeau_essai)
        droite.addWidget(self.bandeau_archive)
        self.pile = QStackedWidget()
        droite.addWidget(self.pile, 1)
        h.addLayout(droite, 1)
        for cle, _, rac, _, _ in PAGES:
            if rac:
                QShortcut(QKeySequence(rac), self, activated=lambda c=cle: self.aller(c))
        ctx.annee_changee.connect(self._maj_entete)
        ctx.donnees_modifiees.connect(lambda q: q == "annees" and self._remplir_annees())
        self._remplir_annees()
        self._maj_licence()
        self._maj_entete()
        self._maj_menu()
        self.aller("tableau")
        self.timer_licence = QTimer(self)
        self.timer_licence.timeout.connect(self.verifier_licence)
        self.timer_licence.start(VERIF_LICENCE_MS)

    # ------------------------------------------------------------------ construction
    def _barre_laterale(self) -> QWidget:
        w = QFrame()
        w.setObjectName("sidebar")
        w.setFixedWidth(250)
        v = QVBoxLayout(w)
        v.setContentsMargins(0, 18, 0, 14)
        v.setSpacing(4)
        tete = QHBoxLayout()
        tete.setContentsMargins(18, 0, 14, 8)
        self.logo = QLabel()
        self.logo.setFixedSize(40, 40)
        self.logo.setPixmap(logo_app.pixmap("tuile", 40))      # logo de l'application
        tete.addWidget(self.logo)
        b = QVBoxLayout()
        b.setSpacing(0)
        m = QLabel(APP_MARQUE)
        m.setObjectName("marque")
        self.l_ecole = QLabel("")
        self.l_ecole.setObjectName("marqueSous")
        self.l_ecole.setWordWrap(True)
        b.addWidget(m)
        b.addWidget(self.l_ecole)
        tete.addLayout(b, 1)
        v.addLayout(tete)
        self.menu = QListWidget()
        self.menu.setObjectName("menu")
        self.menu.setItemDelegate(_DelegueMenu(self.menu))
        self.menu.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.menu.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        for cle, lib, rac, _, _ in PAGES:
            it = QListWidgetItem(lib)
            it.setData(Qt.UserRole, cle)
            it.setData(Qt.UserRole + 1, rac)
            if rac:
                it.setToolTip(f"{lib} ({rac})")
            self.menu.addItem(it)
        self.menu.currentItemChanged.connect(
            lambda it, _: it is not None and self.aller(it.data(Qt.UserRole)))
        v.addWidget(self.menu, 1)
        self.l_utilisateur = QLabel("")
        self.l_utilisateur.setObjectName("sidebarPied")
        self.l_utilisateur.setContentsMargins(18, 6, 12, 0)
        self.l_utilisateur.setWordWrap(True)
        v.addWidget(self.l_utilisateur)
        pied = QLabel(f"Version {__version__} · hors ligne")
        pied.setObjectName("sidebarPied")
        pied.setContentsMargins(18, 0, 12, 0)
        v.addWidget(pied)
        return w

    def _barre_haute(self) -> QWidget:
        w = QFrame()
        w.setObjectName("barre")
        w.setFixedHeight(54)
        h = QHBoxLayout(w)
        h.setContentsMargins(20, 6, 16, 6)
        h.addWidget(label("Année scolaire", discret=True))
        self.annees = QComboBox()
        self.annees.setMinimumWidth(190)
        self.annees.activated.connect(self._choisir_annee)
        h.addWidget(self.annees)
        h.addStretch(1)
        self.badge = QLabel("")
        self.badge.setObjectName("badgeLicence")
        h.addWidget(self.badge)
        self.b_compte = QToolButton()
        self.b_compte.setPopupMode(QToolButton.InstantPopup)
        self.b_compte.setStyleSheet("QToolButton { border: 1px solid #C9C7BD; border-radius: 6px; padding: 5px 10px; "
                                    "background: white; } QToolButton::menu-indicator { image: none; }")
        menu = QMenu(self.b_compte)
        menu.addAction("Changer mon mot de passe", self._mot_de_passe)
        menu.addAction("Licence et activation", self._licence)
        menu.addSeparator()
        menu.addAction("Se déconnecter", self._deconnexion)
        menu.addAction("Quitter", self.close)
        self.b_compte.setMenu(menu)
        h.addWidget(self.b_compte)
        return w

    def _bandeau(self, nom: str) -> QFrame:
        f = QFrame()
        f.setObjectName(nom)
        h = QHBoxLayout(f)
        h.setContentsMargins(20, 6, 16, 6)
        f.texte = QLabel("")
        f.texte.setWordWrap(True)
        h.addWidget(f.texte, 1)
        if nom == "bandeauEssai":
            h.addWidget(bouton("Activer maintenant", self._licence, "accent"))
        f.hide()
        return f

    # ------------------------------------------------------------------ navigation
    def _maj_menu(self) -> None:
        for i, (_, _, _, _, perm) in enumerate(PAGES):
            self.menu.item(i).setHidden(bool(perm) and not self.ctx.peut(perm))

    def aller(self, cle: str) -> None:
        i = next(k for k, p in enumerate(PAGES) if p[0] == cle)
        if self.menu.item(i).isHidden():
            return
        if cle not in self.pages:
            QApplication.setOverrideCursor(Qt.WaitCursor)
            try:
                page = classe_page(PAGES[i][3])(self.ctx)
            except Exception as e:     # noqa: BLE001
                QApplication.restoreOverrideCursor()
                afficher_erreur(self, e, "Ouverture de la page impossible")
                return
            QApplication.restoreOverrideCursor()
            page.fenetre = self
            self.pages[cle] = page
            zone = QScrollArea()        # petits écrans (1366 × 768) : la page défile au lieu d'être coupée
            zone.setWidgetResizable(True)
            zone.setFrameShape(QFrame.NoFrame)
            zone.setWidget(page)
            self.zones[cle] = zone
            self.pile.addWidget(zone)
        self.pile.setCurrentWidget(self.zones[cle])
        if self.menu.currentRow() != i:
            self.menu.blockSignals(True)
            self.menu.setCurrentRow(i)
            self.menu.blockSignals(False)

    def page(self, cle: str):
        self.aller(cle)
        return self.pages.get(cle)

    # ------------------------------------------------------------------ en-tête
    def _remplir_annees(self) -> None:
        self.annees.blockSignals(True)
        self.annees.clear()
        for a in repo.list_annees(self.ctx.db):
            t = a["libelle"] + (" (en cours)" if a["active"] else "") + (" – clôturée" if a["cloturee"] else "")
            self.annees.addItem(t, a["id"])
        if self.ctx.annee:
            self.annees.setCurrentIndex(max(0, self.annees.findData(self.ctx.annee.id)))
        self.annees.blockSignals(False)

    def _choisir_annee(self, i: int) -> None:
        aid = self.annees.itemData(i)
        if aid and (not self.ctx.annee or aid != self.ctx.annee.id):
            self.ctx.recharger_annee(aid)

    def _maj_entete(self) -> None:
        db, s = self.ctx.db, self.ctx.session
        self.l_ecole.setText(db.get_param("ecole_nom") or "")
        self.l_utilisateur.setText(f"{s.nom}\n{s.role_libelle}")
        self.b_compte.setText(f"{s.nom}  ▾")
        a = self.ctx.annee
        self._remplir_annees()
        if a and a.cloturee:
            self.bandeau_archive.texte.setText(
                f"Année {a.libelle} clôturée : consultation et impression uniquement (archive en lecture seule).")
            self.bandeau_archive.show()
        else:
            self.bandeau_archive.hide()

    def _maj_licence(self) -> None:
        e = self.ctx.licence or licence.etat()
        if e.statut == "essai":
            self.badge.setText(f"Essai : {e.jours_restants} j")
            self.badge.setStyleSheet(f"background: #FDF0DF; color: {theme.ALERTE};")
            self.bandeau_essai.texte.setText(
                f"Version d'essai : {e.jours_restants} jour(s) restant(s). À la fin de l'essai, l'application et "
                "les données ne sont plus accessibles tant qu'un code d'activation n'est pas saisi.")
            self.bandeau_essai.show()
        else:
            self.badge.setText("Licence à vie" if e.type == "vie" else
                               f"Licence jusqu'au {e.expire_le:%d/%m/%Y}" if e.expire_le else "Licence active")
            self.badge.setStyleSheet(f"background: #E3F1E9; color: {theme.SUCCES};")
            self.bandeau_essai.hide()

    # ------------------------------------------------------------------ actions du compte
    def _mot_de_passe(self):
        DialogueMotDePasse(self.ctx.db, self.ctx.session, parent=self).exec()

    def _licence(self):
        d = DialogueActivation(self.ctx.db, bloquant=False, parent=self)
        if d.exec():
            self.ctx.licence = licence.etat()
            self._maj_licence()

    def _deconnexion(self):
        security.log(self.ctx.db, self.ctx.session.login, "DECONNEXION", "utilisateur", self.ctx.session.login)
        self.action_fin = "deconnexion"
        self.close()

    def reconnexion(self, db) -> None:
        """Après une restauration : la base a changé, il faut se reconnecter."""
        self.ctx.db = db
        self.action_fin = "reconnexion"
        self.close()

    def verifier_licence(self) -> None:
        e = licence.etat()
        self.ctx.licence = e
        if not licence.verrouillee(e):
            self._maj_licence()
            return
        # licence échue pendant l'utilisation : plus aucune donnée visible
        self.hide()
        d = DialogueActivation(self.ctx.db, bloquant=True)
        if d.exec() and not licence.verrouillee(licence.etat()):
            self.ctx.licence = licence.etat()
            self._maj_licence()
            self.show()
        else:
            self.action_fin = None
            self.close()

    def closeEvent(self, e):
        try:
            backup.sauvegarde_periodique(self.ctx.db)
        except Exception:      # noqa: BLE001 - ne bloque pas la fermeture
            log.exception("Sauvegarde automatique à la fermeture impossible")
        self.timer_licence.stop()
        super().closeEvent(e)
        QApplication.instance().quit()


# =================================================================== démarrage
def appliquer_theme(app: QApplication) -> None:
    app.setStyle("Fusion")
    pal = app.palette()
    pal.setColor(QPalette.Window, QColor(theme.FOND))
    pal.setColor(QPalette.Base, QColor("white"))
    pal.setColor(QPalette.Text, QColor(theme.TEXTE))
    pal.setColor(QPalette.WindowText, QColor(theme.TEXTE))
    pal.setColor(QPalette.Highlight, QColor("#D8EBE1"))
    pal.setColor(QPalette.HighlightedText, QColor(theme.TEXTE))
    pal.setColor(QPalette.Button, QColor("white"))
    pal.setColor(QPalette.ButtonText, QColor(theme.TEXTE))
    app.setPalette(pal)
    app.setStyleSheet(theme.QSS)


def verifier_acces_licence(db) -> licence.Etat | None:
    """Tant que la licence n'est pas valable, seul l'écran d'activation s'affiche. None = l'utilisateur quitte."""
    while True:
        e = licence.etat()
        if not licence.verrouillee(e):
            return e
        if not DialogueActivation(db, bloquant=True).exec():
            return None


def ouvrir_session(db) -> security.Session | None:
    if not security.has_users(db):
        d = DialoguePremierLancement(db)
        if not d.exec():
            return None
        if d.resume:
            QMessageBox.information(None, "Configuration terminée", d.resume)
        return d.session
    d = DialogueConnexion(db, licence.etat())
    if not d.exec():
        return None
    s = d.session
    if security.doit_changer(db, s.user_id):
        if not DialogueMotDePasse(db, s, ancien_connu=d.mot_de_passe).exec():
            return None
    return s


def run(argv: list[str]) -> int:
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication.instance() or QApplication(argv)
    app.setApplicationName(APP_NAME)
    app.setWindowIcon(logo_app.icone())
    app.setApplicationVersion(__version__)
    app.setOrganizationName("GestionScolaireEPP")
    app.setQuitOnLastWindowClosed(False)          # la fenêtre principale décide (verrouillage, déconnexion)
    appliquer_theme(app)
    try:
        db = open_database()
    except Exception as e:     # noqa: BLE001
        log.exception("Ouverture de la base impossible")
        QMessageBox.critical(None, APP_NAME, f"La base de données ne peut pas être ouverte :\n{e}\n\n"
                                             "Restaurez une sauvegarde ou contactez l'assistance.")
        return 1
    code = 0
    try:
        while True:
            etat = verifier_acces_licence(db)
            if etat is None:
                break
            s = ouvrir_session(db)
            if s is None:
                break
            try:
                backup.sauvegarde_periodique(db)
            except Exception:      # noqa: BLE001
                log.exception("Sauvegarde automatique impossible")
            ctx = Contexte(db, licence.restreindre(s, etat), None, etat)
            aid = repo.active_annee_id(db)
            ctx.annee = repo.load_annee(db, aid) if aid else None
            win = FenetrePrincipale(ctx)
            win.show()
            app.exec()
            db = ctx.db
            if win.action_fin not in ("deconnexion", "reconnexion"):
                break
    finally:
        try:
            db.close()
        except Exception:      # noqa: BLE001
            pass
    return code


if __name__ == "__main__":
    sys.exit(run(sys.argv))
