"""Bandeau animé (vidéo en boucle si un fichier est présent, sinon animation dessinée) et lecteur de tutoriels.

Les vidéos sont cherchées dans le dossier de données (« videos », pour que l'école puisse mettre les siennes)
puis dans les ressources de l'application. Sans fichier vidéo, ou si la lecture est impossible, une animation
légère aux couleurs de l'application est affichée : l'écran n'est jamais vide.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PySide6.QtCore import QRectF, Qt, QTimer, QUrl
from PySide6.QtGui import QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QLabel, QStackedLayout, QVBoxLayout, QWidget

from epp.core import paths
from epp.ui import theme

EXTENSIONS = (".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv")


def dossiers_videos() -> list[Path]:
    return [paths.data_dir() / "videos", paths.resource_path("resources", "videos")]


def trouver_video(nom: str) -> Path | None:
    if os.environ.get("EPP_SANS_VIDEO"):
        return None
    for d in dossiers_videos():
        for ext in EXTENSIONS:
            p = d / f"{nom}{ext}"
            if p.is_file():
                return p
    return None


def tutoriels() -> list[Path]:
    vus, out = set(), []
    for d in dossiers_videos():
        t = d / "tutoriels"
        if t.is_dir():
            for p in sorted(t.iterdir()):
                if p.suffix.lower() in EXTENSIONS and p.name not in vus:
                    vus.add(p.name)
                    out.append(p)
    return out


class Animation(QWidget):
    """Vagues lentes sur un dégradé vert, avec un titre : remplace la vidéo quand il n'y en a pas."""

    def __init__(self, titre: str = "", sous_titre: str = "", parent=None):
        super().__init__(parent)
        self.titre, self.sous_titre = titre, sous_titre
        self.t = 0.0
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._pas)
        self.setMinimumHeight(90)

    def set_textes(self, titre: str, sous_titre: str) -> None:
        self.titre, self.sous_titre = titre, sous_titre
        self.update()

    def _pas(self):
        self.t += 0.04
        self.update()

    def showEvent(self, e):
        if not os.environ.get("EPP_SANS_ANIMATION"):
            self.timer.start(60)
        super().showEvent(e)

    def hideEvent(self, e):
        self.timer.stop()
        super().hideEvent(e)

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        g = QLinearGradient(0, 0, w, h)
        g.setColorAt(0, QColor(theme.PRIMAIRE_FONCE))
        g.setColorAt(1, QColor(theme.PRIMAIRE))
        p.fillRect(self.rect(), g)
        for k, (alpha, amp, freq, vitesse, base) in enumerate(
                [(38, 14, 1.6, 1.0, 0.62), (28, 18, 1.1, -0.7, 0.72), (22, 10, 2.3, 1.4, 0.84)]):
            path = QPainterPath()
            path.moveTo(0, h)
            for x in range(0, w + 8, 8):
                y = h * base + amp * math.sin(freq * x / max(w, 1) * 2 * math.pi + self.t * vitesse + k)
                path.lineTo(x, y)
            path.lineTo(w, h)
            path.closeSubpath()
            c = QColor(255, 255, 255, alpha) if k != 1 else QColor(232, 137, 47, alpha + 20)
            p.fillPath(path, c)
        p.setPen(QPen(QColor(255, 255, 255, 30), 2))
        r = min(w, h) * 0.9
        p.drawEllipse(QRectF(w - r * 0.7, -r * 0.35, r, r))
        if self.titre:
            f = QFont(theme.POLICE)
            f.setPointSizeF(max(13.0, min(22.0, h / 9)))
            f.setBold(True)
            p.setFont(f)
            p.setPen(QColor("white"))
            p.drawText(QRectF(24, h * 0.18, w - 48, h * 0.3), Qt.AlignLeft | Qt.AlignVCenter, self.titre)
        if self.sous_titre:
            f = QFont(theme.POLICE)
            f.setPointSizeF(max(9.5, min(12.5, h / 16)))
            p.setFont(f)
            p.setPen(QColor(255, 255, 255, 215))
            p.drawText(QRectF(24, h * 0.45, w - 48, h * 0.25), Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap,
                       self.sous_titre)


class BandeauVideo(QWidget):
    """Vidéo en boucle, sans son, avec repli sur l'animation."""

    def __init__(self, nom_video: str, titre: str = "", sous_titre: str = "", parent=None):
        super().__init__(parent)
        self.pile = QStackedLayout(self)
        self.pile.setContentsMargins(0, 0, 0, 0)
        self.animation = Animation(titre, sous_titre)
        self.pile.addWidget(self.animation)
        self.lecteur = None
        f = trouver_video(nom_video)
        if f:
            self._video(f)

    def _video(self, fichier: Path) -> None:
        try:
            from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
            from PySide6.QtMultimediaWidgets import QVideoWidget
        except ImportError:
            return
        vw = QVideoWidget()
        vw.setAspectRatioMode(Qt.KeepAspectRatioByExpanding)
        self.lecteur = QMediaPlayer(self)
        self.son = QAudioOutput(self)
        self.son.setVolume(0)
        self.lecteur.setAudioOutput(self.son)
        self.lecteur.setVideoOutput(vw)
        self.lecteur.setLoops(QMediaPlayer.Infinite)
        self.lecteur.setSource(QUrl.fromLocalFile(str(fichier)))
        self.lecteur.errorOccurred.connect(lambda *_: self.pile.setCurrentWidget(self.animation))
        self.pile.addWidget(vw)
        self.pile.setCurrentWidget(vw)

    def set_textes(self, titre: str, sous_titre: str) -> None:
        self.animation.set_textes(titre, sous_titre)

    def showEvent(self, e):
        if self.lecteur:
            self.lecteur.play()
        super().showEvent(e)

    def hideEvent(self, e):
        if self.lecteur:
            self.lecteur.pause()
        super().hideEvent(e)


class LecteurTutoriel(QWidget):
    """Lecteur simple (lecture / pause / position) pour les vidéos de tutoriel."""

    def __init__(self, parent=None):
        super().__init__(parent)
        from PySide6.QtWidgets import QHBoxLayout, QPushButton, QSlider
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.vide = QLabel("Choisissez un tutoriel dans la liste.")
        self.vide.setAlignment(Qt.AlignCenter)
        self.vide.setMinimumHeight(260)
        self.vide.setStyleSheet(f"background: {theme.PRIMAIRE_FONCE}; color: white; border-radius: 8px;")
        lay.addWidget(self.vide, 1)
        self.lecteur = None
        try:
            from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
            from PySide6.QtMultimediaWidgets import QVideoWidget
        except ImportError:
            return
        self.ecran = QVideoWidget()
        self.ecran.hide()
        lay.addWidget(self.ecran, 1)
        self.lecteur = QMediaPlayer(self)
        self.son = QAudioOutput(self)
        self.lecteur.setAudioOutput(self.son)
        self.lecteur.setVideoOutput(self.ecran)
        barre = QHBoxLayout()
        self.b_lire = QPushButton("Lecture")
        self.b_lire.clicked.connect(self._basculer)
        self.pos = QSlider(Qt.Horizontal)
        self.pos.sliderMoved.connect(self.lecteur.setPosition)
        self.lecteur.durationChanged.connect(lambda d: self.pos.setRange(0, d))
        self.lecteur.positionChanged.connect(self.pos.setValue)
        self.lecteur.playbackStateChanged.connect(
            lambda st: self.b_lire.setText("Pause" if st == QMediaPlayer.PlayingState else "Lecture"))
        barre.addWidget(self.b_lire)
        barre.addWidget(self.pos, 1)
        lay.addLayout(barre)

    def ouvrir(self, fichier: Path) -> None:
        if not self.lecteur:
            self.vide.setText("La lecture vidéo n'est pas disponible sur cet ordinateur.")
            return
        self.vide.hide()
        self.ecran.show()
        self.lecteur.setSource(QUrl.fromLocalFile(str(fichier)))
        self.lecteur.play()

    def _basculer(self):
        from PySide6.QtMultimedia import QMediaPlayer
        if self.lecteur.playbackState() == QMediaPlayer.PlayingState:
            self.lecteur.pause()
        else:
            self.lecteur.play()

    def arreter(self):
        if self.lecteur:
            self.lecteur.stop()
