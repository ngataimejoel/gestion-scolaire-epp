"""Animations de survol et de sélection : quand le curseur passe sur un bouton, une carte cliquable ou une
entrée du menu, un halo apparaît en douceur ; l'entrée choisie du menu est marquée par un fond qui glisse
jusqu'à elle. Désactivées par la variable d'environnement EPP_SANS_ANIMATION (tests, ordinateurs lents)."""
from __future__ import annotations

import os

from PySide6.QtCore import QEasingCurve, QEvent, QObject, QPropertyAnimation, QRect, QVariantAnimation
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QFrame, QGraphicsDropShadowEffect, QPushButton, QWidget

from epp.ui import theme

DUREE = 160


def actives() -> bool:
    return not os.environ.get("EPP_SANS_ANIMATION")


class Survol(QObject):
    """Filtre d'événements de l'application : halo animé au survol des boutons et des cartes cliquables."""
    NOMS = {"kpi", "actionHero", "actionHeroBlanc", "ligneListe"}

    def _cible(self, w) -> bool:
        if not isinstance(w, QWidget) or not w.isEnabled():
            return False
        if isinstance(w, QPushButton):
            return not w.isFlat() and w.objectName() not in ("navGroupe", "navSous") \
                and w.property("role") != "lien"
        return isinstance(w, QFrame) and w.objectName() in self.NOMS

    def eventFilter(self, obj, e):
        t = e.type()
        if t in (QEvent.Enter, QEvent.Leave) and self._cible(obj):
            self._animer(obj, t == QEvent.Enter)
        return False

    def _animer(self, w: QWidget, entree: bool) -> None:
        eff = w.graphicsEffect()
        if eff is None:
            if not entree:
                return
            eff = QGraphicsDropShadowEffect(w)
            eff.setOffset(0, 2)
            eff.setBlurRadius(0)
            eff.setColor(QColor(theme.PRIMAIRE))
            w.setGraphicsEffect(eff)
        elif not isinstance(eff, QGraphicsDropShadowEffect):
            return                           # effet propre au widget : on n'y touche pas
        anim = getattr(w, "_anim_survol", None)
        if anim is None:
            anim = QVariantAnimation(w)
            anim.setDuration(DUREE)
            anim.setEasingCurve(QEasingCurve.OutCubic)

            def pas(v, eff=eff):
                eff.setBlurRadius(v)
                c = QColor(theme.PRIMAIRE)
                c.setAlphaF(min(0.35, v / 50))
                eff.setColor(c)
                eff.setOffset(0, v / 8)
            anim.valueChanged.connect(pas)
            w._anim_survol = anim
        anim.stop()
        anim.setStartValue(float(eff.blurRadius()))
        anim.setEndValue(18.0 if entree else 0.0)
        anim.start()


def installer(app) -> Survol | None:
    if not actives():
        return None
    f = Survol(app)
    app.installEventFilter(f)
    return f


class Indicateur(QFrame):
    """Fond de l'entrée choisie du menu, qui glisse d'une entrée à l'autre."""

    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setObjectName("indicateurMenu")
        self.setStyleSheet(f"QFrame#indicateurMenu {{ background: {theme.PRIMAIRE_PALE}; border-radius: 10px; }}")
        self.anim = QPropertyAnimation(self, b"geometry", self)
        self.anim.setDuration(220)
        self.anim.setEasingCurve(QEasingCurve.OutCubic)
        self.hide()

    def aller(self, cible: QWidget | None) -> None:
        if cible is None or not cible.isVisible():
            self.hide()
            return
        r = QRect(cible.mapTo(self.parentWidget(), cible.rect().topLeft()), cible.size())
        if not self.isVisible() or not actives():
            self.anim.stop()
            self.setGeometry(r)
            self.show()
        else:
            self.anim.stop()
            self.anim.setStartValue(self.geometry())
            self.anim.setEndValue(r)
            self.anim.start()
        self.lower()
