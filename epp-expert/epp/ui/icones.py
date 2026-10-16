"""Icônes au trait de l'interface (mêmes tracés que le prototype AKWA SCHOOL), dessinées sans fichier."""
from __future__ import annotations

from PySide6.QtCore import QByteArray, QRectF, Qt
from PySide6.QtGui import QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

# tracés SVG 24 × 24 (trait de 1,8)
TRACES = {
    "home": "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
    "users": "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    "grid": "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    "edit": "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
    "award": "M5 8a7 7 0 1 0 14 0a7 7 0 1 0-14 0M8.2 13.9L7 23l5-3 5 3-1.2-9.1",
    "cal": "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
    "chart": "M18 20V10M12 20V4M6 20v-6",
    "set": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    "plus": "M12 5v14M5 12h14",
    "search": "M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.35-4.35",
    "trash": "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
    "print": "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
    "moon": "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    "help": "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
    "down": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    "up": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
    "x": "M18 6L6 18M6 6l12 12",
    "file": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8",
    "chev": "M9 18l6-6-6-6",
    "check": "M20 6L9 17l-5-5",
    "lock": "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    "key": "M15 7a4 4 0 1 1-3.4 6.1L4 20.7V17h3v-3h3l1.9-1.9A4 4 0 0 1 15 7zM16 8h.01",
    "cam": "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "clip": "M9 2h6v4H9zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 13l2 2 4-4",
    "flag": "M4 22V4M4 4h13l-2 4 2 4H4",
    "book": "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
}


def _svg(nom: str, couleur: str, epaisseur: float = 1.8) -> bytes:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{couleur}" '
            f'stroke-width="{epaisseur}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{TRACES.get(nom, TRACES["chev"])}"/></svg>').encode()


def pixmap(nom: str, couleur: str = "#5A6961", taille: int = 18) -> QPixmap:
    """Image de l'icône à la taille voulue (écrans à forte densité compris)."""
    ratio = 2
    pm = QPixmap(taille * ratio, taille * ratio)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    QSvgRenderer(QByteArray(_svg(nom, couleur))).render(p, QRectF(0, 0, taille * ratio, taille * ratio))
    p.end()
    pm.setDevicePixelRatio(ratio)
    return pm


def icone(nom: str, couleur: str = "#5A6961", actif: str | None = None, taille: int = 18) -> QIcon:
    """Icône ; « actif » : couleur quand le bouton est coché ou survolé."""
    ic = QIcon(pixmap(nom, couleur, taille))
    if actif:
        ic.addPixmap(pixmap(nom, actif, taille), QIcon.Normal, QIcon.On)
        ic.addPixmap(pixmap(nom, actif, taille), QIcon.Active, QIcon.Off)
    return ic
