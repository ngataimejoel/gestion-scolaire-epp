"""Page de l'application : titre, barre d'actions, contenu actualisé quand il est affiché."""
from __future__ import annotations

from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from epp.ui.widgets import Contexte, afficher_erreur


class Page(QWidget):
    titre = ""
    sous_titre = ""
    permission: str | None = None          # droit nécessaire pour voir la page
    ecoute: tuple[str, ...] = ()           # données dont la modification oblige à actualiser

    def __init__(self, ctx: Contexte, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setObjectName("page")
        self._a_actualiser = True
        racine = QVBoxLayout(self)
        racine.setContentsMargins(24, 18, 24, 18)
        racine.setSpacing(12)
        tete = QHBoxLayout()
        bloc = QVBoxLayout()
        bloc.setSpacing(0)
        self.l_titre = QLabel(self.titre)
        self.l_titre.setObjectName("titrePage")
        self.l_sous = QLabel(self.sous_titre)
        self.l_sous.setObjectName("sousTitre")
        bloc.addWidget(self.l_titre)
        bloc.addWidget(self.l_sous)
        tete.addLayout(bloc, 1)
        self.actions = QHBoxLayout()
        self.actions.setSpacing(8)
        tete.addLayout(self.actions)
        racine.addLayout(tete)
        self.corps = QVBoxLayout()
        self.corps.setSpacing(12)
        racine.addLayout(self.corps, 1)
        ctx.annee_changee.connect(self.invalider)
        ctx.session_changee.connect(self.invalider)
        ctx.donnees_modifiees.connect(self._modif)

    # ------------------------------------------------------------------ actualisation
    def _modif(self, quoi: str) -> None:
        if quoi in self.ecoute or quoi == "*":
            self.invalider()

    def invalider(self) -> None:
        self._a_actualiser = True
        if self.isVisible():
            self.actualiser()

    def showEvent(self, e):
        super().showEvent(e)
        if self._a_actualiser:
            self.actualiser()

    def actualiser(self) -> None:
        self._a_actualiser = False
        if self.ctx.annee is None and self.besoin_annee:
            return
        try:
            self.rafraichir()
        except Exception as e:      # noqa: BLE001
            afficher_erreur(self, e, "Affichage impossible")

    besoin_annee = True

    def rafraichir(self) -> None:
        """À redéfinir : relit les données et met l'affichage à jour."""

    # ------------------------------------------------------------------ utilitaires
    @property
    def db(self):
        return self.ctx.db

    @property
    def annee(self):
        return self.ctx.annee

    @property
    def s(self):
        return self.ctx.session

    def peut(self, perm: str) -> bool:
        return self.ctx.peut(perm)

    def modifiable(self) -> bool:
        """L'année affichée accepte des modifications (elle n'est pas clôturée)."""
        return bool(self.annee) and not self.annee.cloturee

    def set_sous_titre(self, texte: str) -> None:
        self.l_sous.setText(texte)
