"""Serveur de synchronisation des téléphones attaché à la fenêtre principale : démarré à l'ouverture (si l'école
l'a choisi) ou depuis la page Téléphones, arrêté à la fermeture. Les saisies reçues des téléphones actualisent
les pages concernées."""
from __future__ import annotations

import logging

from PySide6.QtCore import QObject, Signal
from PySide6.QtGui import QColor, QImage, QPainter, QPixmap

from epp.core import licence
from epp.synchro.serveur import ServeurSynchro, adresses_locales

log = logging.getLogger(__name__)

PARAM_AUTO = "synchro_auto"
LIEN_APK = "https://github.com/ngataimejoel/gestion-scolaire-epp/releases/latest/download/AkwaSchool.apk"


class GestionSynchro(QObject):
    recu = Signal(object, str, int)        # pages modifiées, nom du téléphone, nombre de saisies appliquées
    etat_change = Signal()

    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.srv: ServeurSynchro | None = None
        self.dernier_message = ""
        self.recu.connect(self._recu)

    @property
    def en_marche(self) -> bool:
        return bool(self.srv and self.srv.en_marche)

    def demarrer(self) -> None:
        if self.en_marche:
            return
        self.srv = ServeurSynchro(self.ctx.db.path, etat_licence=licence.etat,
                                  quand_modifie=lambda q, nom, n: self.recu.emit(q, nom, n))
        try:
            self.srv.demarrer()
        except OSError:
            self.srv = None
            raise
        self.etat_change.emit()

    def arreter(self) -> None:
        if self.srv is not None:
            try:
                self.srv.arreter()
            finally:
                self.srv = None
                self.etat_change.emit()

    def adresses(self) -> list[str]:
        port = self.srv.port if self.srv else 8765
        return [f"{ip}:{port}" if port != 8765 else ip for ip in adresses_locales()]

    def _recu(self, quoi, nom: str, n: int) -> None:
        self.dernier_message = f"{n} saisie(s) reçue(s) du téléphone « {nom} »"
        for q in sorted(quoi):
            self.ctx.modifie(q)
        self.etat_change.emit()


def image_qr(texte: str, taille: int = 168) -> QPixmap:
    """Code QR (module de reportlab déjà livré avec l'application) dessiné en pixels pour l'écran."""
    from reportlab.graphics.barcode import qrencoder as q
    code = None
    for version in range(1, 21):
        try:
            code = q.QRCode(version, q.QRErrorCorrectLevel.M)
            code.addData(texte)
            code.make()
            break
        except Exception:      # noqa: BLE001 - texte trop long pour cette version : version suivante
            code = None
    n = code.getModuleCount() if code else 21
    marge = 4
    img = QImage(n + 2 * marge, n + 2 * marge, QImage.Format_RGB32)
    img.fill(QColor("white"))
    if code:
        for r in range(n):
            for c in range(n):
                if code.isDark(r, c):
                    img.setPixelColor(c + marge, r + marge, QColor("black"))
    pm = QPixmap(taille, taille)
    pm.fill(QColor("white"))
    p = QPainter(pm)
    p.drawImage(pm.rect(), img)
    p.end()
    return pm
