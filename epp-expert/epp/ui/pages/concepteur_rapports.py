"""Générateur de rapports : créer un rapport vide ou copier un rapport officiel, puis le composer par blocs
(titre, tableaux, textes, signatures) dans le concepteur. Les rapports créés apparaissent dans « Rapports
officiels » avec les autres, pour l'aperçu, l'impression et l'export."""
from __future__ import annotations

from PySide6.QtWidgets import QInputDialog

from epp.reports import store
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, Col, Tableau, bouton, confirmer, label, ligne, protege, valider_suppression


class PageConcepteurRapports(Page):
    titre = "Générateur de rapports"
    sous_titre = "Rapports faits de blocs : partez d'un rapport vide ou d'une copie d'un rapport officiel"
    permission = "rapports.generer"
    ecoute = ("modeles",)
    besoin_annee = False

    def __init__(self, ctx):
        super().__init__(ctx)
        self.b_vide = bouton("Nouveau rapport vide…", self.nouveau_vide, "primaire")
        self.actions.addWidget(self.b_vide)
        c = Carte("Rapports disponibles")
        c.lay.addWidget(label("Un rapport officiel n'est jamais modifié ici : « Copier et modifier » en crée une "
                              "copie que vous composez librement. Vos rapports se retrouvent ensuite dans l'onglet "
                              "« Rapports officiels », rubrique « Mes modèles », pour l'aperçu et l'impression.",
                              discret=True, wrap=True))
        self.table = Tableau([Col("nom", "Rapport", largeur=360), Col("categorie", "Rubrique", largeur=160),
                              Col("origine", "Origine", largeur=110), Col("version_courante", "Version", "nombre", 70),
                              Col("description", "Description")])
        self.table.double_clic.connect(lambda r: self.modifier())
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._etat())
        c.lay.addWidget(self.table, 1)
        self.b_copier = bouton("Copier et modifier…", self.copier)
        self.b_modifier = bouton("Composer ce rapport…", self.modifier)
        self.b_apercu = bouton("Aperçu et impression", self.apercu)
        self.b_supprimer = bouton("Supprimer…", self._supprimer, "danger")
        c.lay.addLayout(ligne(self.b_copier, self.b_modifier, self.b_apercu, None, self.b_supprimer))
        self.corps.addWidget(c, 1)

    def rafraichir(self):
        lignes = []
        for m in store.lister(self.db):
            m["origine"] = "Officiel" if m.get("integre") else "Mon rapport"
            lignes.append(m)
        self.table.set_lignes(lignes)
        self._etat()

    def _etat(self):
        r = self.table.ligne_courante()
        gerer = self.peut("modeles.gerer")
        self.b_vide.setEnabled(gerer)
        self.b_copier.setEnabled(bool(r) and gerer)
        self.b_modifier.setEnabled(bool(r) and gerer and not r.get("integre"))
        self.b_supprimer.setEnabled(bool(r) and gerer and not r.get("integre"))
        self.b_apercu.setEnabled(bool(r))

    def _composer(self, mid: int) -> None:
        from epp.ui.designer.editeur import EditeurModele
        EditeurModele(self, mid).exec()
        self.ctx.modifie("modeles")
        self.table.selectionner(lambda x: x["id"] == mid)

    @protege
    def nouveau_vide(self):
        nom, ok = QInputDialog.getText(self, "Nouveau rapport", "Nom du rapport :")
        if ok and nom.strip():
            mid = store.creer(self.db, self.s, nom.strip())
            self.ctx.modifie("modeles")
            self._composer(mid)

    @protege
    def copier(self):
        r = self.table.ligne_courante()
        if not r:
            return
        nom, ok = QInputDialog.getText(self, "Copier le rapport", "Nom de la copie :", text=f"{r['nom']} (copie)")
        if ok and nom.strip():
            mid = store.dupliquer(self.db, self.s, r["id"], nom.strip())
            self.ctx.modifie("modeles")
            self._composer(mid)

    def modifier(self):
        r = self.table.ligne_courante()
        if r and self.b_modifier.isEnabled():
            self._composer(r["id"])
        elif r:
            self.copier()

    def apercu(self):
        r = self.table.ligne_courante()
        if r and getattr(self, "fenetre", None):
            p = self.fenetre.page("rapports")
            if p:
                p.selectionner_modele(r["id"])

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if r and not r.get("integre") and confirmer(self, "Supprimer le rapport",
                                                    f"Supprimer définitivement « {r['nom']} » et son historique ?",
                                                    "Supprimer", True) \
                and valider_suppression(self, self.db, self.s, f"modèle de rapport {r['nom']}"):
            store.supprimer(self.db, self.s, r["id"])
            self.ctx.modifie("modeles")
