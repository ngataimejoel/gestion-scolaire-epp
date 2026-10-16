"""Écrans d'accès : connexion, premier lancement, activation de la licence, mot de passe."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QButtonGroup, QDialog, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                               QMessageBox, QRadioButton, QStackedWidget, QVBoxLayout, QWidget)

from epp import APP_NAME, __version__
from epp.core import licence, recuperation, security
from epp.ui import logo as logo_app
from epp.ui import theme
from epp.ui.video import BandeauVideo
from epp.ui.widgets import afficher_erreur, bouton, label, ligne

ESSAIS_AVANT_PAUSE = 5


def _champ_mdp(placeholder: str = "") -> QLineEdit:
    e = QLineEdit()
    e.setEchoMode(QLineEdit.Password)
    e.setPlaceholderText(placeholder)
    return e


def libelle_annee_courante(aujourdhui: date | None = None) -> str:
    d = aujourdhui or date.today()
    a = d.year if d.month >= 8 else d.year - 1
    return f"{a}-{a + 1}"


class _EcranScinde(QDialog):
    """Fenêtre en deux parties : bandeau animé à gauche, formulaire à droite (maquette)."""

    def __init__(self, titre_fenetre: str, ecole: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{APP_NAME} – {titre_fenetre}")
        self.setObjectName("page")
        self.resize(940, 580)
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)
        self.bandeau = BandeauVideo("connexion", ecole or APP_NAME,
                                    "Gestion des élèves, des notes, des absences et des rapports officiels, "
                                    "sans connexion Internet.")
        self.bandeau.setMinimumWidth(380)
        h.addWidget(self.bandeau, 5)
        droite = QWidget()
        droite.setObjectName("panneauDroit")     # sélecteur : le fond ne doit pas s'appliquer aux boutons
        droite.setStyleSheet(f"QWidget#panneauDroit {{ background: {theme.CARTE}; }}")
        self.corps = QVBoxLayout(droite)
        self.corps.setContentsMargins(40, 36, 40, 28)
        self.corps.setSpacing(10)
        h.addWidget(droite, 4)
        img = QLabel()
        img.setPixmap(logo_app.pixmap("logo_complet", 96))
        self.corps.addWidget(img, 0, Qt.AlignLeft)
        t = label(APP_NAME, gras=True, taille=14)
        t.setStyleSheet(f"color: {theme.PRIMAIRE_FONCE};")
        self.corps.addWidget(t)
        self.corps.addWidget(label(f"Version {__version__}", discret=True))


# =================================================================== connexion
class DialogueConnexion(_EcranScinde):
    def __init__(self, db, etat_licence: licence.Etat | None = None, parent=None):
        ecole = db.get_param("ecole_nom") or ""
        super().__init__("Connexion", ecole, parent)
        self.db = db
        self.session: security.Session | None = None
        self.mot_de_passe = ""
        self.echecs = 0
        self.corps.addSpacing(18)
        self.corps.addWidget(label("Connexion", gras=True, taille=13))
        self.corps.addWidget(label("Saisissez votre identifiant et votre mot de passe.", discret=True))
        f = QFormLayout()
        f.setVerticalSpacing(10)
        self.login = QLineEdit()
        self.login.setPlaceholderText("Identifiant")
        self.mdp = _champ_mdp("Mot de passe")
        f.addRow("Identifiant", self.login)
        f.addRow("Mot de passe", self.mdp)
        self.corps.addLayout(f)
        self.erreur = label("", wrap=True)
        self.erreur.setStyleSheet(f"color: {theme.DANGER};")
        self.corps.addWidget(self.erreur)
        self.b_ok = bouton("Se connecter", self._valider, "primaire")
        self.b_ok.setDefault(True)
        self.corps.addWidget(self.b_ok)
        oubli = bouton("Mot de passe oublié ?", self._oubli)
        oubli.setFlat(True)
        oubli.setStyleSheet(f"color: {theme.PRIMAIRE}; border: none; text-align: left; padding: 0;")
        self.corps.addWidget(oubli)
        self.corps.addStretch(1)
        if etat_licence is not None:
            l = label(etat_licence.message, discret=True, wrap=True)
            self.corps.addWidget(l)
        self.login.returnPressed.connect(self.mdp.setFocus)
        self.mdp.returnPressed.connect(self._valider)
        dernier = db.scalar("SELECT login FROM utilisateur WHERE derniere_connexion IS NOT NULL "
                            "ORDER BY derniere_connexion DESC LIMIT 1")
        if dernier:
            self.login.setText(dernier)
            QTimer.singleShot(0, self.mdp.setFocus)

    def _oubli(self):
        d = DialogueRecuperation(self.db, self.login.text().strip(), self)
        if d.exec():
            self.login.setText(d.login.text().strip())
            self.mdp.clear()
            self.mdp.setFocus()

    def _valider(self):
        if not self.b_ok.isEnabled():
            return
        login, mdp = self.login.text().strip(), self.mdp.text()
        if not login or not mdp:
            self.erreur.setText("Saisissez l'identifiant et le mot de passe.")
            return
        s = security.authenticate(self.db, login, mdp)
        if s is None:
            self.echecs += 1
            self.mdp.clear()
            if self.echecs >= ESSAIS_AVANT_PAUSE:
                self.erreur.setText("Trop d'essais incorrects : patientez 30 secondes.")
                self.b_ok.setEnabled(False)
                QTimer.singleShot(30_000, lambda: (self.b_ok.setEnabled(True), self.erreur.setText("")))
                self.echecs = 0
            else:
                self.erreur.setText("Identifiant ou mot de passe incorrect (ou compte désactivé).")
            return
        self.session, self.mot_de_passe = s, mdp
        self.accept()


# =================================================================== mot de passe oublié
def afficher_code_secours(parent, login: str, code: str) -> None:
    """Code de secours à noter ou imprimer : il ne sera plus jamais affiché."""
    from PySide6.QtGui import QTextDocument
    from PySide6.QtPrintSupport import QPrintDialog, QPrinter
    texte = (f"Code de secours du compte « {login} » : {code}\n\nIl permet de choisir un nouveau mot de passe en cas "
             "d'oubli, même sans Internet (« Mot de passe oublié ? » à la connexion). Notez-le ou imprimez-le et "
             "rangez-le en lieu sûr : il ne sera plus affiché. Il ne sert qu'une fois ; un nouveau code vous sera "
             "alors donné.")
    m = QMessageBox(QMessageBox.Information, "Code de secours", texte, parent=parent)
    m.setTextInteractionFlags(Qt.TextSelectableByMouse)
    b_imp = m.addButton("Imprimer", QMessageBox.ActionRole)
    m.addButton("C'est noté", QMessageBox.AcceptRole)
    while True:
        m.exec()
        if m.clickedButton() is not b_imp:
            return
        pr = QPrinter()
        if QPrintDialog(pr, parent).exec():
            doc = QTextDocument()
            doc.setPlainText(f"AKWA SCHOOL\n\n{texte}")
            doc.print_(pr)


class DialogueRecuperation(QDialog):
    """Mot de passe oublié : code de secours (hors ligne)."""

    def __init__(self, db, login: str = "", parent=None):
        super().__init__(parent)
        self.db = db
        self.setWindowTitle("Mot de passe oublié")
        v = QVBoxLayout(self)
        v.addWidget(label("Saisissez le code de secours remis à la création de votre compte. Sans ce code, demandez "
                          "à un administrateur un mot de passe provisoire (Paramètres › Utilisateurs).", wrap=True))
        f = QFormLayout()
        self.login = QLineEdit(login)
        self.code = QLineEdit()
        self.code.setPlaceholderText("XXXX-XXXX-XXXX")
        self.nouveau = _champ_mdp(f"au moins {security.MIN_PASSWORD} caractères")
        self.confirm = _champ_mdp()
        f.addRow("Identifiant", self.login)
        f.addRow("Code de secours", self.code)
        f.addRow("Nouveau mot de passe", self.nouveau)
        f.addRow("Confirmation", self.confirm)
        v.addLayout(f)
        self.msg = label("", wrap=True)
        v.addWidget(self.msg)
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Valider", self._ok, "primaire")))

    def _ok(self):
        if self.nouveau.text() != self.confirm.text():
            self.msg.setText("La confirmation ne correspond pas au nouveau mot de passe.")
            return
        try:
            secours = recuperation.reinitialiser(self.db, self.login.text(), self.code.text(), self.nouveau.text())
        except (recuperation.RecuperationErreur, ValueError) as e:
            self.msg.setText(str(e))
            return
        afficher_code_secours(self, self.login.text().strip(), secours)
        QMessageBox.information(self, "Mot de passe oublié", "Votre mot de passe a été changé : connectez-vous.")
        self.accept()


# =================================================================== mot de passe
class DialogueMotDePasse(QDialog):
    """Changement de mot de passe ; « impose » après un mot de passe provisoire."""

    def __init__(self, db, session, ancien_connu: str | None = None, parent=None):
        super().__init__(parent)
        self.db, self.session, self.ancien_connu = db, session, ancien_connu
        self.setWindowTitle("Changer le mot de passe")
        v = QVBoxLayout(self)
        if ancien_connu:
            v.addWidget(label("Votre mot de passe est provisoire : choisissez votre mot de passe personnel.",
                              wrap=True))
        f = QFormLayout()
        self.ancien = _champ_mdp()
        self.nouveau = _champ_mdp(f"au moins {security.MIN_PASSWORD} caractères")
        self.confirm = _champ_mdp()
        if not ancien_connu:
            f.addRow("Mot de passe actuel", self.ancien)
        f.addRow("Nouveau mot de passe", self.nouveau)
        f.addRow("Confirmation", self.confirm)
        self.sans_secours = not db.scalar("SELECT secours_hash FROM utilisateur WHERE id=?", (session.user_id,))
        v.addLayout(f)
        v.addLayout(ligne(bouton("Nouveau code de secours…", self._secours), None, bouton("Annuler", self.reject),
                          bouton("Enregistrer", self._ok, "primaire")))

    def _secours(self):
        afficher_code_secours(self, self.session.login,
                              recuperation.nouveau_code_secours(self.db, self.session.user_id))
        self.sans_secours = False

    def _ok(self):
        if self.nouveau.text() != self.confirm.text():
            QMessageBox.warning(self, "Mot de passe", "La confirmation ne correspond pas au nouveau mot de passe.")
            return
        try:
            security.changer_mon_mot_de_passe(self.db, self.session, self.ancien_connu or self.ancien.text(),
                                              self.nouveau.text())
        except ValueError as e:
            afficher_erreur(self, e)
            return
        QMessageBox.information(self, "Mot de passe", "Votre mot de passe a été modifié.")
        if self.sans_secours:
            self._secours()
        self.accept()


# =================================================================== activation
class DialogueActivation(_EcranScinde):
    """Écran d'activation. Quand la licence n'est pas valable, c'est le seul écran accessible :
    aucune donnée n'est consultable tant qu'un code valide n'a pas été activé (les données sont conservées)."""

    def __init__(self, db=None, bloquant: bool = True, parent=None):
        ecole = db.get_param("ecole_nom") if db else ""
        super().__init__("Activation", ecole or "", parent)
        self.db = db
        self.etat = licence.etat()
        self.corps.addSpacing(14)
        self.corps.addWidget(label("Activation de la licence", gras=True, taille=13))
        self.statut = label(self.etat.message, wrap=True)
        couleur = theme.SUCCES if self.etat.utilisable else theme.DANGER
        self.statut.setStyleSheet(f"color: {couleur}; font-weight: 600;")
        self.corps.addWidget(self.statut)
        self.corps.addWidget(label(
            "Saisissez le code d'activation reçu (licence d'un an ou à vie). L'activation se fait une seule "
            "fois, avec une connexion Internet ; l'application fonctionne ensuite hors ligne.", discret=True,
            wrap=True))
        f = QFormLayout()
        self.code = QLineEdit()
        self.code.setPlaceholderText("XXXX-XXXX-XXXX-XXXX")
        self.ecole = QLineEdit(ecole or "")
        f.addRow("Code d'activation", self.code)
        f.addRow("Établissement", self.ecole)
        self.corps.addLayout(f)
        self.machine = label(f"Identifiant de cet ordinateur : {licence.empreinte_machine()[:16]}", discret=True)
        self.machine.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.corps.addWidget(self.machine)
        self.erreur = label("", wrap=True)
        self.erreur.setStyleSheet(f"color: {theme.DANGER};")
        self.corps.addWidget(self.erreur)
        self.corps.addStretch(1)
        self.b_activer = bouton("Activer", self._activer, "primaire")
        quitter = bouton("Quitter" if bloquant else "Fermer", self.reject)
        self.corps.addLayout(ligne(quitter, None, self.b_activer))
        self.code.returnPressed.connect(self._activer)

    def _activer(self):
        code = self.code.text().strip()
        if not code:
            self.erreur.setText("Saisissez le code d'activation.")
            return
        self.erreur.setText("")
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            self.etat = licence.activer(code, self.ecole.text().strip())
        except licence.LicenceErreur as e:
            self.erreur.setText(str(e))
            return
        finally:
            QGuiApplication.restoreOverrideCursor()
        if self.db is not None:
            security.log(self.db, "systeme", "ACTIVATION", "licence", f"{self.etat.type} {self.etat.code}")
        QMessageBox.information(self, "Activation réussie", self.etat.message)
        self.accept()


# =================================================================== premier lancement
class DialoguePremierLancement(_EcranScinde):
    """Premier lancement : établissement, compte administrateur, puis données de départ."""

    def __init__(self, db, parent=None):
        super().__init__("Premier lancement", db.get_param("ecole_nom") or "", parent)
        self.db = db
        self.session: security.Session | None = None
        self.resume = ""
        self.pages = QStackedWidget()
        self.corps.addWidget(label("Bienvenue ! Configurons l'application.", gras=True, taille=12))
        self.etape = label("", discret=True)
        self.corps.addWidget(self.etape)
        self.corps.addWidget(self.pages, 1)

        # étape 1 : établissement
        p1 = QWidget()
        f1 = QFormLayout(p1)
        self.ecole = QLineEdit(db.get_param("ecole_nom") or "")
        self.code_ecole = QLineEdit(db.get_param("ecole_code") or "")
        self.iepp = QLineEdit(db.get_param("iepp") or "")
        self.dren = QLineEdit(db.get_param("dren") or "")
        self.localite = QLineEdit(db.get_param("localite") or "")
        self.directeur = QLineEdit(db.get_param("directeur") or "")
        for t, w in (("École", self.ecole), ("Code de l'école", self.code_ecole), ("IEPP", self.iepp),
                     ("DRENAET", self.dren), ("Localité", self.localite), ("Directeur / Directrice", self.directeur)):
            f1.addRow(t, w)
        self.pages.addWidget(p1)

        # étape 2 : administrateur
        p2 = QWidget()
        f2 = QFormLayout(p2)
        f2.addRow(label("Ce compte a tous les droits (utilisateurs, sauvegardes, paramètres). Le mot de passe est "
                        "enregistré sous forme chiffrée irréversible : notez-le en lieu sûr.", discret=True, wrap=True))
        self.nom = QLineEdit(self.directeur.text())
        self.login = QLineEdit("admin")
        self.mdp = _champ_mdp(f"au moins {security.MIN_PASSWORD} caractères")
        self.mdp2 = _champ_mdp()
        f2.addRow("Nom complet", self.nom)
        f2.addRow("Identifiant", self.login)
        f2.addRow("Mot de passe", self.mdp)
        f2.addRow("Confirmation", self.mdp2)
        self.pages.addWidget(p2)

        # étape 3 : données de départ
        p3 = QWidget()
        v3 = QVBoxLayout(p3)
        self.choix = QButtonGroup(self)
        self.r_import = QRadioButton("Importer le classeur Excel GESTION SCOLAIRE EPP (.xlsm / .xlsx)")
        self.r_vide = QRadioButton("Commencer une nouvelle année scolaire vide")
        self.r_demo = QRadioButton("Créer une école de démonstration (pour découvrir l'application)")
        for i, r in enumerate((self.r_import, self.r_vide, self.r_demo)):
            self.choix.addButton(r, i)
            v3.addWidget(r)
        self.r_vide.setChecked(True)
        self.fichier = QLineEdit()
        self.fichier.setPlaceholderText("Classeur à importer (une copie est lue, l'original n'est pas modifié)")
        v3.addLayout(ligne(self.fichier, bouton("Parcourir…", self._parcourir)))
        self.libelle = QLineEdit(libelle_annee_courante())
        v3.addLayout(ligne(label("Année scolaire :"), self.libelle, None))
        v3.addStretch(1)
        self.pages.addWidget(p3)

        self.b_prec = bouton("Précédent", lambda: self._aller(-1))
        self.b_suiv = bouton("Suivant", lambda: self._aller(1), "primaire")
        self.corps.addLayout(ligne(bouton("Quitter", self.reject), None, self.b_prec, self.b_suiv))
        self._maj()

    def _parcourir(self):
        f, _ = QFileDialog.getOpenFileName(self, "Classeur à importer", str(Path.home()),
                                           "Classeurs Excel (*.xlsm *.xlsx)")
        if f:
            self.fichier.setText(f)
            self.r_import.setChecked(True)

    def _maj(self):
        i = self.pages.currentIndex()
        self.etape.setText(["Étape 1 sur 3 : l'établissement", "Étape 2 sur 3 : le compte administrateur",
                            "Étape 3 sur 3 : les données de départ"][i])
        self.b_prec.setEnabled(i > 0)
        self.b_suiv.setText("Terminer" if i == 2 else "Suivant")

    def _aller(self, pas: int):
        i = self.pages.currentIndex()
        if pas > 0 and i == 0 and not self.ecole.text().strip():
            QMessageBox.warning(self, "Établissement", "Le nom de l'école est obligatoire.")
            return
        if pas > 0 and i == 1:
            err = security.check_password_policy(self.mdp.text())
            if not self.login.text().strip():
                err = "L'identifiant est obligatoire."
            elif not err and self.mdp.text() != self.mdp2.text():
                err = "La confirmation ne correspond pas au mot de passe."
            if err:
                QMessageBox.warning(self, "Compte administrateur", err)
                return
            if not self.nom.text().strip():
                self.nom.setText(self.directeur.text() or "Administrateur")
        if pas > 0 and i == 2:
            self._terminer()
            return
        self.pages.setCurrentIndex(i + pas)
        self._maj()

    def _terminer(self):
        from epp.core import seed
        from epp.demo import creer_ecole_demo
        from epp.domain import repo
        from epp.io import import_excel
        sysd = security.system_session()
        mode = self.choix.checkedId()
        if mode == 0 and not Path(self.fichier.text()).is_file():
            QMessageBox.warning(self, "Import", "Choisissez le classeur à importer.")
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            with self.db.transaction():
                uid = security.create_user(self.db, self.login.text(), self.nom.text(), self.mdp.text(), "ADMIN")
                secours = recuperation.nouveau_code_secours(self.db, uid)
                repo.save_etablissement(self.db, sysd, {
                    "ecole_nom": self.ecole.text().strip(), "ecole_code": self.code_ecole.text().strip(),
                    "iepp": self.iepp.text().strip(), "dren": self.dren.text().strip(),
                    "localite": self.localite.text().strip(), "directeur": self.directeur.text().strip()})
                session = security.load_session(self.db, uid)
                if mode == 0:
                    rep = import_excel.import_workbook(self.db, session, self.fichier.text())
                    self.resume = rep.resume()
                elif mode == 2:
                    a = creer_ecole_demo(self.db, session, self.libelle.text().strip())
                    self.resume = f"École de démonstration créée pour l'année {a.libelle}."
                else:
                    seed.create_year(self.db, self.libelle.text().strip())
                    self.resume = f"Année scolaire {self.libelle.text().strip()} créée."
        except Exception as e:      # noqa: BLE001 - tout est annulé, l'utilisateur corrige et recommence
            QGuiApplication.restoreOverrideCursor()
            afficher_erreur(self, e, "Configuration impossible")
            return
        QGuiApplication.restoreOverrideCursor()
        security.log(self.db, session.login, "PREMIER_LANCEMENT", "application", self.resume.splitlines()[0])
        self.session = session
        afficher_code_secours(self, session.login, secours)
        self.accept()
