"""Aperçu, impression et export (PDF, Excel, Word) des documents produits par le moteur de rapports."""
from __future__ import annotations

import tempfile
from pathlib import Path

from PySide6.QtCore import QPointF, QSize, Qt
from PySide6.QtGui import QGuiApplication, QPainter
from PySide6.QtWidgets import QDialog, QMessageBox, QVBoxLayout, QWidget

from epp.ui.widgets import afficher_erreur, bouton, chemin_sortie, label, ligne, ouvrir_fichier

_TMP = Path(tempfile.gettempdir()) / "epp_apercus"


def formats_autorises(ctx_ou_session) -> list[str]:
    s = getattr(ctx_ou_session, "session", ctx_ou_session)
    out = ["pdf"]
    if s.can("export.excel"):
        out.append("xlsx")
    if s.can("export.word"):
        out.append("docx")
    return out


def fichier_apercu(nom: str) -> Path:
    _TMP.mkdir(parents=True, exist_ok=True)
    for f in _TMP.glob("*.pdf"):          # aperçus précédents
        try:
            f.unlink()
        except OSError:
            pass
    from epp.reports.service import nom_fichier
    return _TMP / f"{nom_fichier(nom)}.pdf"


def _proposer_ouverture(parent, chemin: Path) -> None:
    box = QMessageBox(QMessageBox.Information, "Document enregistré", f"Le document a été enregistré :\n{chemin}",
                      parent=parent)
    b_ouvrir = box.addButton("Ouvrir", QMessageBox.AcceptRole)
    box.addButton("Fermer", QMessageBox.RejectRole)
    box.exec()
    if box.clickedButton() is b_ouvrir:
        ouvrir_fichier(chemin)


def enregistrer(parent, nom: str, produire, formats: list[str]) -> Path | None:
    """produire(chemin, format) écrit le fichier et renvoie son chemin réel."""
    chemin, fmt = chemin_sortie(parent, "Enregistrer le document", nom, formats)
    if not chemin:
        return None
    QGuiApplication.setOverrideCursor(Qt.WaitCursor)
    try:
        out = produire(chemin, fmt)
    except Exception as e:      # noqa: BLE001
        QGuiApplication.restoreOverrideCursor()
        afficher_erreur(parent, e, "Export impossible")
        return None
    QGuiApplication.restoreOverrideCursor()
    _proposer_ouverture(parent, out)
    return out


def exporter_rapport(page, code: str, params: dict, nom: str) -> Path | None:
    """Enregistre un modèle de rapport dans le format choisi parmi ceux autorisés."""
    from epp.reports import service
    ctx = page.ctx
    return enregistrer(page, nom, lambda ch, f: service.generer(ctx.db, ctx.session, ctx.annee, code, params, ch, f),
                       formats_autorises(ctx))


def orientation_page(taille):
    """Orientation d'impression d'une page du document : paysage si elle est plus large que haute."""
    from PySide6.QtGui import QPageLayout
    return QPageLayout.Landscape if taille.width() > taille.height() else QPageLayout.Portrait


def imprimer_pdf(parent, chemin: Path) -> None:
    """Impression d'un PDF via la boîte d'impression du système (pages rendues à la résolution de l'imprimante)."""
    from PySide6.QtPdf import QPdfDocument
    from PySide6.QtPrintSupport import QPrintDialog, QPrinter
    doc = QPdfDocument(parent)
    doc.load(str(chemin))
    if doc.pageCount() == 0:
        QMessageBox.warning(parent, "Impression", "Le document est vide.")
        return
    imp = QPrinter(QPrinter.HighResolution)
    imp.setDocName(chemin.stem)
    imp.setFromTo(1, doc.pageCount())
    imp.setPageOrientation(orientation_page(doc.pagePointSize(0)))
    dlg = QPrintDialog(imp, parent)
    dlg.setOption(QPrintDialog.PrintPageRange, True)
    if dlg.exec() != QDialog.Accepted:
        return
    debut, fin = (imp.fromPage() or 1), (imp.toPage() or doc.pageCount())
    QGuiApplication.setOverrideCursor(Qt.WaitCursor)
    try:
        ok = imprimer_pages(imp, doc, debut, fin)
    finally:
        QGuiApplication.restoreOverrideCursor()
    if not ok:
        QMessageBox.warning(parent, "Impression", "L'imprimante n'est pas disponible.")


def imprimer_pages(imp, doc, debut: int, fin: int) -> bool:
    """Envoie les pages debut..fin (numérotées à partir de 1) à l'imprimante, chacune dans l'orientation
    de la page du document (paysage ou portrait), centrée et agrandie à la zone imprimable."""
    imp.setPageOrientation(orientation_page(doc.pagePointSize(debut - 1)))
    p = QPainter()
    if not p.begin(imp):
        return False
    try:
        for i in range(debut - 1, fin):
            if i > debut - 1:
                imp.setPageOrientation(orientation_page(doc.pagePointSize(i)))
                imp.newPage()
            zone = imp.pageLayout().paintRectPixels(imp.resolution())
            taille_pt = doc.pagePointSize(i)
            k = min(zone.width() / taille_pt.width(), zone.height() / taille_pt.height())
            img = doc.render(i, QSize(int(taille_pt.width() * k), int(taille_pt.height() * k)))
            p.drawImage(QPointF((zone.width() - img.width()) / 2, 0), img)
    finally:
        p.end()
    return True


class Apercu(QWidget):
    """Visionneuse PDF intégrée (défilement continu, largeur de la page)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        self.chemin: Path | None = None
        try:
            from PySide6.QtPdf import QPdfDocument
            from PySide6.QtPdfWidgets import QPdfView
            self.doc = QPdfDocument(self)
            self.vue = QPdfView(self)
            self.vue.setDocument(self.doc)
            self.vue.setPageMode(QPdfView.PageMode.MultiPage)
            self.vue.setZoomMode(QPdfView.ZoomMode.FitToWidth)
            self.vue.setStyleSheet("background: #8A918D;")
            v.addWidget(self.vue)
        except ImportError:
            self.doc = None
            self.vue = label("L'aperçu n'est pas disponible : enregistrez le document pour l'ouvrir.", wrap=True)
            v.addWidget(self.vue)

    def charger(self, chemin: Path | None) -> None:
        self.chemin = chemin
        if self.doc is None:
            return
        self.doc.close()
        if chemin:
            self.doc.load(str(chemin))

    def pages(self) -> int:
        return self.doc.pageCount() if self.doc else 0


class DialogueApercu(QDialog):
    """Aperçu d'un document déjà produit en PDF, avec impression et enregistrement."""

    def __init__(self, parent, titre: str, chemin_pdf: Path, enregistrer_sous=None, formats=("pdf",)):
        super().__init__(parent)
        self.setWindowTitle(f"Aperçu – {titre}")
        self.resize(900, 760)
        self.chemin, self.titre, self.enregistrer_sous, self.formats = chemin_pdf, titre, enregistrer_sous, formats
        v = QVBoxLayout(self)
        self.apercu = Apercu()
        self.apercu.charger(chemin_pdf)
        v.addWidget(self.apercu, 1)
        v.addLayout(ligne(label(f"{self.apercu.pages()} page(s)", discret=True), None,
                          bouton("Imprimer…", lambda: imprimer_pdf(self, self.chemin)),
                          bouton("Enregistrer…", self._enregistrer, "primaire"), bouton("Fermer", self.accept)))

    def _enregistrer(self):
        if self.enregistrer_sous:
            enregistrer(self, self.titre, self.enregistrer_sous, list(self.formats))
        else:
            import shutil
            enregistrer(self, self.titre, lambda ch, f: Path(shutil.copyfile(self.chemin, ch)), ["pdf"])
