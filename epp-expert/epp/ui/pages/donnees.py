"""Rapports & administration › Import, export & sauvegarde (modèle v8) : les deux pages réunies sous un onglet."""
from __future__ import annotations

from PySide6.QtWidgets import QTabWidget

from epp.ui.pages.base import Page
from epp.ui.pages.import_export import PageImportExport
from epp.ui.pages.sauvegarde import PageSauvegarde


class PageDonnees(Page):
    titre = "Import, export & sauvegarde"
    sous_titre = "Vos données restent sur cet ordinateur. Sauvegardez-les régulièrement sur une clé USB."
    permission = None
    besoin_annee = False

    def __init__(self, ctx):
        super().__init__(ctx)
        self.parties = []
        self.onglets = QTabWidget()
        self.onglets.setDocumentMode(True)
        for cls, titre in ((PageSauvegarde, "Sauvegarde"), (PageImportExport, "Import et export")):
            if cls.permission and not ctx.peut(cls.permission):
                continue
            p = cls(ctx)
            p.l_titre.hide()
            p.layout().setContentsMargins(0, 8, 0, 0)
            self.parties.append(p)
            self.onglets.addTab(p, titre)
        self.corps.addWidget(self.onglets, 1)
        self._fenetre = None

    def partie(self, cle: str) -> Page | None:
        """« sauvegarde » ou « import_export » (absente sans le droit nécessaire)."""
        cls = PageSauvegarde if cle == "sauvegarde" else PageImportExport
        return next((p for p in self.parties if isinstance(p, cls)), None)

    def rafraichir(self):
        for p in self.parties:
            p.invalider()

    @property
    def fenetre(self):
        return self._fenetre

    @fenetre.setter
    def fenetre(self, f):
        self._fenetre = f
        for p in self.parties:
            p.fenetre = f
