"""Logo de l'application (fabriqué par outils/logo.py dans resources/logo)."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon, QPixmap

from epp.core import paths


def chemin(nom: str = "tuile"):
    return paths.resource_path("resources", "logo", f"{nom}.png")


def pixmap(nom: str = "tuile", hauteur: int = 40) -> QPixmap:
    """« tuile » (symbole sur fond crème, lisible sur le menu vert), « symbole » ou « logo_complet »."""
    pm = QPixmap(str(chemin(nom)))
    if pm.isNull():
        return pm
    ratio = 2.0                    # image nette sur les écrans à haute densité
    pm = pm.scaledToHeight(int(hauteur * ratio), Qt.SmoothTransformation)
    pm.setDevicePixelRatio(ratio)
    return pm


def icone() -> QIcon:
    return QIcon(str(chemin("tuile")))
