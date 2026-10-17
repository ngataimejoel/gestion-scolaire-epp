"""Fenêtres d'accès de l'application AKWA SCHOOL v8 : premier lancement, connexion, mot de passe oublié."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QComboBox, QDialog, QDialogButtonBox, QFormLayout, QLabel, QLineEdit, QMessageBox,
                               QPushButton, QVBoxLayout)

from epp import __version__
from epp.ui import logo as logo_app
from epp.ui.dialogs.acces import afficher_code_secours
from epp.v8.stockage import ADMIN, Erreur, Stockage

TITRE = "AKWA SCHOOL v8"


def _mdp() -> QLineEdit:
    e = QLineEdit()
    e.setEchoMode(QLineEdit.Password)
    return e


class _Base(QDialog):
    def __init__(self, titre: str, intro: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{TITRE} – {titre}")
        self.setMinimumWidth(420)
        lay = QVBoxLayout(self)
        logo = QLabel()
        logo.setPixmap(logo_app.pixmap("tuile", 64))
        logo.setAlignment(Qt.AlignCenter)
        lay.addWidget(logo)
        t = QLabel(f"<b>AKWA SCHOOL</b> – Gestion scolaire EPP · v{__version__}<br>{intro}")
        t.setWordWrap(True)
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        self.form = QFormLayout()
        lay.addLayout(self.form)
        self.boutons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        self.boutons.accepted.connect(self._valider)
        self.boutons.rejected.connect(self.reject)
        lay.addWidget(self.boutons)

    def _valider(self):
        try:
            self.valider()
        except Erreur as e:
            QMessageBox.warning(self, TITRE, str(e))
            return
        self.accept()

    def valider(self):
        raise NotImplementedError


CLASSES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]
# demandés à la création, pour l'école comme pour l'espace enseignant seul
CHAMPS = [("director", "Directeur (nom et prénoms)"), ("dirTel", "Contact du directeur"),
          ("secteur", "Secteur pédagogique"), ("iepp", "Inspection (IEPP)"),
          ("inspNom", "Inspecteur (nom et prénoms)"), ("inspTel", "Contact de l'inspecteur"),
          ("cpNom", "Conseiller pédagogique (nom et prénoms)"), ("cpTel", "Contact du conseiller pédagogique")]


class PremierLancement(_Base):
    """Espace de l'école (mot de passe du directeur) ou espace enseignant seul, puis le code de secours."""

    def __init__(self, st: Stockage):
        super().__init__("Premier lancement", "Choisissez qui utilise cet ordinateur, puis le mot de passe. "
                                              "Identifiant : <b>admin</b>.")
        self.st = st
        self.qui = QComboBox()
        self.qui.addItem("Le directeur (espace de l'école)", "dir")
        self.qui.addItem("Un enseignant seul (sans l'école)", "solo")
        self.nom, self.classe, self.ecole = QLineEdit(), QComboBox(), QLineEdit()
        self.classe.addItems(CLASSES)
        self.ecole.setPlaceholderText("facultatif")
        self.p1, self.p2 = _mdp(), _mdp()
        self.form.addRow("Utilisateur", self.qui)
        self.form.addRow("Vos nom et prénoms", self.nom)
        self.form.addRow("Votre classe", self.classe)
        self.form.addRow("École", self.ecole)
        self.champs = {k: QLineEdit() for k, _ in CHAMPS}
        for k, lib in CHAMPS:
            self.form.addRow(lib, self.champs[k])
        self.form.addRow("Mot de passe", self.p1)
        self.form.addRow("Confirmation", self.p2)
        self.qui.currentIndexChanged.connect(self._montrer)
        self._montrer()

    def _montrer(self):
        solo = self.qui.currentData() == "solo"
        for w in (self.nom, self.classe, self.ecole):
            self.form.setRowVisible(w, solo)

    def valider(self):
        for k, lib in CHAMPS:
            if not self.champs[k].text().strip():
                raise Erreur(f"{lib} : à renseigner.")
        if self.p1.text() != self.p2.text():
            raise Erreur("Les deux mots de passe ne sont pas identiques.")
        if self.qui.currentData() == "solo":
            if len(self.nom.text().strip()) < 3:
                raise Erreur("Saisissez vos nom et prénoms.")
            code = self.st.creer_espace_enseignant(self.p1.text(), self.nom.text(), self.classe.currentText(),
                                                   self.ecole.text())
        else:
            code = self.st.creer_admin(self.p1.text())
        self.st.completer_ecole({k: e.text() for k, e in self.champs.items()})
        self.session = self.st.authentifier(ADMIN, self.p1.text())
        afficher_code_secours(self, ADMIN, code)


class NouveauMotDePasse(_Base):
    """Mot de passe provisoire remplacé à la première connexion (enseignant)."""

    def __init__(self, st: Stockage, login: str):
        super().__init__("Nouveau mot de passe", "Votre mot de passe est provisoire : choisissez le vôtre.")
        self.st, self.login = st, login
        self.p1, self.p2 = _mdp(), _mdp()
        self.form.addRow("Nouveau mot de passe", self.p1)
        self.form.addRow("Confirmation", self.p2)

    def valider(self):
        if self.p1.text() != self.p2.text():
            raise Erreur("Les deux mots de passe ne sont pas identiques.")
        self.st.definir(self.login, self.p1.text())
        afficher_code_secours(self, self.login, self.st.nouveau_code_secours(self.login))


class Recuperation(_Base):
    def __init__(self, st: Stockage, login: str, parent=None):
        super().__init__("Mot de passe oublié", "Saisissez le code de secours remis à la création du compte, puis "
                                                "votre nouveau mot de passe.", parent)
        self.st = st
        self.login, self.code, self.p1 = QLineEdit(login), QLineEdit(), _mdp()
        self.code.setPlaceholderText("XXXX-XXXX-XXXX")
        self.form.addRow("Identifiant", self.login)
        self.form.addRow("Code de secours", self.code)
        self.form.addRow("Nouveau mot de passe", self.p1)

    def valider(self):
        login = self.login.text().strip()
        afficher_code_secours(self, login, self.st.recuperer(login, self.code.text(), self.p1.text()))


class Connexion(_Base):
    def __init__(self, st: Stockage):
        super().__init__("Connexion", "Connectez-vous pour ouvrir l'application.")
        self.st = st
        self.login, self.mdp = QLineEdit(ADMIN), _mdp()
        self.form.addRow("Identifiant", self.login)
        self.form.addRow("Mot de passe", self.mdp)
        oubli = QPushButton("Mot de passe oublié ?")
        oubli.setFlat(True)
        oubli.clicked.connect(lambda: Recuperation(self.st, self.login.text(), self).exec())
        self.form.addRow("", oubli)
        self.mdp.setFocus()

    def valider(self):
        self.session = self.st.authentifier(self.login.text(), self.mdp.text())
        if self.session["provisoire"] and not NouveauMotDePasse(self.st, self.session["login"]).exec():
            raise Erreur("Choisissez un nouveau mot de passe pour continuer.")


def ouvrir_session(st: Stockage) -> dict | None:
    d = Connexion(st) if st.a_un_admin() else PremierLancement(st)
    return d.session if d.exec() else None
