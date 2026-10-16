"""Fenêtre de l'application AKWA SCHOOL v8 : l'interface v8 (HTML) reliée aux données par un pont QWebChannel."""
from __future__ import annotations

import json
import time
from pathlib import Path

from PySide6.QtCore import QEventLoop, QObject, Qt, QTimer, QUrl, Slot
from PySide6.QtGui import QGuiApplication, QPageLayout, QPageSize
from PySide6.QtPrintSupport import QPrinter, QPrintPreviewDialog
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QFileDialog, QMainWindow, QMessageBox

from epp.core import licence, paths
from epp.ui import logo as logo_app
from epp.v8.stockage import ADMIN, Erreur, Stockage, dossier, licence_pour_page  # noqa: F401
from epp.v8.page import page_html

DELAI_ADMIN = 120     # secondes pendant lesquelles un mot de passe administrateur vérifié autorise une opération sensible


class Pont(QObject):
    """Ce que la page peut demander à l'application."""

    def __init__(self, fenetre: "Fenetre"):
        super().__init__(fenetre)
        self.f = fenetre
        self.st: Stockage = fenetre.st
        self._admin_ok = 0.0

    def _dir(self) -> bool:
        return self.f.session["role"] == "dir"

    @Slot(str, result=str)
    def enregistrer(self, texte: str) -> str:
        try:
            self.st.ecrire(texte)
        except Erreur as e:
            return str(e)
        except Exception as e:      # noqa: BLE001 — disque plein, base verrouillée…
            return f"Enregistrement impossible : {e}"
        return ""

    @Slot(str, result=bool)
    def verifierAdmin(self, mdp: str) -> bool:
        ok = self.st.verifier_admin(mdp)
        if ok:
            self._admin_ok = time.monotonic()
        return ok

    @Slot(str, str, result=str)
    def changerAdmin(self, ancien: str, nouveau: str) -> str:
        try:
            self.st.changer(ADMIN, ancien, nouveau)
        except Erreur as e:
            return str(e)
        return ""

    @Slot(result=str)
    def nouveauSecours(self) -> str:
        if time.monotonic() - self._admin_ok > DELAI_ADMIN:
            return json.dumps({"erreur": "Mot de passe administrateur requis."})
        return json.dumps({"code": self.st.nouveau_code_secours(ADMIN)})

    @Slot(str, str, result=str)
    def recupererAdmin(self, code: str, nouveau: str) -> str:
        try:
            return json.dumps({"code": self.st.recuperer(ADMIN, code, nouveau)})
        except Erreur as e:
            return json.dumps({"erreur": str(e)})

    @Slot(str, str, result=str)
    def creerCompte(self, tid: str, login: str) -> str:
        if not self._dir():
            return json.dumps({"erreur": "Réservé au directeur."})
        try:
            return json.dumps({"mdp": self.st.creer_compte_enseignant(tid, login)})
        except Erreur as e:
            return json.dumps({"erreur": str(e)})

    @Slot(str, result=str)
    def reinitCompte(self, tid: str) -> str:
        if not self._dir():
            return json.dumps({"erreur": "Réservé au directeur."})
        try:
            return json.dumps({"mdp": self.st.reinitialiser_enseignant(tid)})
        except Erreur as e:
            return json.dumps({"erreur": str(e)})

    @Slot(str, str, str, result=str)
    def telecharger(self, nom: str, texte: str, _type: str) -> str:
        chemin, _ = QFileDialog.getSaveFileName(self.f, "Enregistrer le fichier", str(paths.exports_dir() / nom))
        if not chemin:
            return ""
        try:
            Path(chemin).write_text(texte, encoding="utf-8")
        except OSError as e:
            QMessageBox.warning(self.f, "AKWA SCHOOL", f"Le fichier n'a pas pu être enregistré :\n{e}")
            return ""
        return chemin

    @Slot(bool)
    def imprimer(self, paysage: bool) -> None:
        QTimer.singleShot(0, lambda: self.f.imprimer(paysage))

    @Slot(str, result=str)
    def activer(self, code: str) -> str:
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            e = licence.activer(code, (self.st.lire() or {}).get("school", {}).get("name", ""))
        except licence.LicenceErreur as e:
            return json.dumps({"erreur": str(e)})
        finally:
            QGuiApplication.restoreOverrideCursor()
        return json.dumps({"licence": licence_pour_page(e), "message": e.message})

    @Slot()
    def deconnexion(self) -> None:
        self.f.action_fin = "deconnexion"
        QTimer.singleShot(0, self.f.close)


class Fenetre(QMainWindow):
    def __init__(self, st: Stockage, session: dict, etat_licence: licence.Etat):
        super().__init__()
        self.st, self.session = st, session
        self.action_fin = ""
        self._fini = False
        self.setWindowTitle("AKWA SCHOOL – Gestion scolaire EPP")
        self.setWindowIcon(logo_app.icone())
        self.vue = QWebEngineView(self)
        s = self.vue.settings()
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.JavascriptCanAccessClipboard, True)
        self.canal = QWebChannel(self)
        self.pont = Pont(self)
        self.canal.registerObject("pont", self.pont)
        self.vue.page().setWebChannel(self.canal)
        self.vue.page().printRequested.connect(lambda: self.imprimer(False))
        self.setCentralWidget(self.vue)
        page = dossier() / "interface.html"          # setHtml est limité à 2 Mo : la page passe par un fichier
        page.write_text(page_html(st.lire(), session, licence_pour_page(etat_licence)), encoding="utf-8")
        self.vue.load(QUrl.fromLocalFile(str(page)))
        self.resize(1366, 820)

    def imprimer(self, paysage: bool) -> None:
        imp = QPrinter(QPrinter.HighResolution)
        imp.setPageSize(QPageSize(QPageSize.A4))
        imp.setPageOrientation(QPageLayout.Landscape if paysage else QPageLayout.Portrait)
        d = QPrintPreviewDialog(imp, self)
        d.setWindowTitle("Aperçu avant impression")
        d.paintRequested.connect(self._peindre)
        d.resize(1100, 800)
        d.exec()

    def _peindre(self, imp: QPrinter) -> None:
        boucle = QEventLoop()
        self.vue.printFinished.connect(boucle.quit)
        self.vue.print(imp)
        boucle.exec()
        self.vue.printFinished.disconnect(boucle.quit)

    def closeEvent(self, e):
        """Les dernières saisies sont enregistrées avant de fermer."""
        if self._fini:
            e.accept()
            return
        e.ignore()

        def fin(texte):
            if isinstance(texte, str) and texte:
                try:
                    self.st.ecrire(texte)
                except Exception:      # noqa: BLE001 — la fermeture ne doit pas être bloquée
                    pass
            self._fini = True
            self.close()
        self.vue.page().runJavaScript("window.APP&&APP.etatJSON()", 0, fin)
