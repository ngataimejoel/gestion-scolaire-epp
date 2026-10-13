"""Rapports : choix du modèle, paramètres, aperçu, impression et export PDF / Excel / Word, gestion des modèles."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QComboBox, QFileDialog, QFormLayout, QInputDialog, QMenu, QSplitter, QToolButton,
                               QTreeWidget, QTreeWidgetItem)

from epp.core import paths
from epp.domain import repo
from epp.reports import service, store
from epp.reports.builtin import LOTS
from epp.ui.dialogs.export import Apercu, enregistrer, fichier_apercu, formats_autorises, imprimer_pdf
from epp.ui.pages.absences import mois_de_l_annee
from epp.ui.pages.base import Page
from epp.ui.widgets import (Carte, ChampDate, afficher_erreur, bouton, confirmer, info, label, ouvrir_fichier,
                            protege)

LOT = "lot:"


class PageRapports(Page):
    titre = "Rapports"
    sous_titre = "États officiels, bulletins et rapports personnalisés"
    permission = "rapports.generer"
    ecoute = ("modeles",)

    def __init__(self, ctx):
        super().__init__(ctx)
        self.apercu_pdf: Path | None = None
        split = QSplitter()
        gauche = Carte("Modèles")
        self.arbre = QTreeWidget()
        self.arbre.setHeaderHidden(True)
        self.arbre.currentItemChanged.connect(lambda *_: self._choisir())
        self.arbre.itemDoubleClicked.connect(lambda *_: self._apercu())
        gauche.lay.addWidget(self.arbre, 1)
        self.b_gerer = QToolButton()
        self.b_gerer.setText("Gérer le modèle ▾")
        self.b_gerer.setPopupMode(QToolButton.InstantPopup)
        m = QMenu(self.b_gerer)
        self.a_modifier = m.addAction("Modifier la mise en page…", self._modifier)
        m.addAction("Dupliquer…", self._dupliquer)
        self.a_renommer = m.addAction("Renommer…", self._renommer)
        self.a_actif = m.addAction("Masquer / afficher", self._basculer_actif)
        self.a_versions = m.addAction("Revenir à une version précédente…", self._versions)
        self.a_original = m.addAction("Rétablir le modèle d'origine", self._original)
        m.addSeparator()
        m.addAction("Exporter le modèle (.epptpl)…", self._exporter_modele)
        m.addAction("Importer un modèle…", self._importer_modele)
        m.addSeparator()
        self.a_supprimer = m.addAction("Supprimer le modèle…", self._supprimer)
        self.b_gerer.setMenu(m)
        gauche.lay.addWidget(self.b_gerer)
        split.addWidget(gauche)

        milieu = Carte("Paramètres")
        self.desc = label("", discret=True, wrap=True)
        milieu.lay.addWidget(self.desc)
        self.form = QFormLayout()
        self.w_classe = QComboBox()
        self.w_eleve = QComboBox()
        self.w_mois = QComboBox()
        self.w_compo = QComboBox()
        self.w_debut = ChampDate()
        self.w_fin = ChampDate()
        self.w_classe.currentIndexChanged.connect(lambda _: self._remplir_eleves())
        self.champs = {"classe": ("Classe", self.w_classe), "eleve": ("Élève", self.w_eleve),
                       "mois": ("Mois", self.w_mois), "compo": ("Évaluation", self.w_compo),
                       "date_debut": ("Du", self.w_debut), "date_fin": ("Au", self.w_fin)}
        for k, (t, w) in self.champs.items():
            self.form.addRow(t, w)
        milieu.lay.addLayout(self.form)
        self.aucun = label("Ce rapport n'a pas de paramètre.", discret=True)
        milieu.lay.addWidget(self.aucun)
        milieu.lay.addStretch(1)
        self.b_apercu = bouton("Aperçu", self._apercu, "primaire")
        self.b_imprimer = bouton("Imprimer…", self._imprimer)
        self.b_enreg = bouton("Enregistrer (PDF, Excel, Word)…", self._enregistrer)
        self.b_classes = bouton("Un fichier par classe…", self._par_classe)
        for b in (self.b_apercu, self.b_imprimer, self.b_enreg, self.b_classes):
            milieu.lay.addWidget(b)
        split.addWidget(milieu)

        droite = Carte("Aperçu")
        self.apercu = Apercu()
        droite.lay.addWidget(self.apercu, 1)
        self.l_pages = label("Choisissez un modèle puis « Aperçu ».", discret=True)
        droite.lay.addWidget(self.l_pages)
        split.addWidget(droite)
        split.setSizes([290, 300, 640])
        self.corps.addWidget(split, 1)

    # ------------------------------------------------------------------ liste
    def rafraichir(self):
        cur = self._ref()
        self.arbre.clear()
        cats: dict[str, QTreeWidgetItem] = {}
        lots = QTreeWidgetItem(["Dossiers complets"])
        self.arbre.addTopLevelItem(lots)
        for k, (titre, codes) in LOTS.items():
            it = QTreeWidgetItem([titre])
            it.setData(0, Qt.UserRole, LOT + k)
            it.setToolTip(0, "Regroupe : " + ", ".join(codes))
            lots.addChild(it)
        for m in store.lister(self.db):
            cat = m["categorie"] or "Autre"
            if cat not in cats:
                cats[cat] = QTreeWidgetItem([cat])
                self.arbre.addTopLevelItem(cats[cat])
            it = QTreeWidgetItem([m["nom"] + ("" if m["actif"] else "  (masqué)")])
            it.setData(0, Qt.UserRole, m["id"])
            it.setToolTip(0, m.get("description") or m["nom"])
            cats[cat].addChild(it)
        self.arbre.expandAll()
        self._remplir_listes()
        if cur is not None:
            for it in self._items():
                if it.data(0, Qt.UserRole) == cur:
                    self.arbre.setCurrentItem(it)
                    break
        self._choisir()

    def _items(self):
        for i in range(self.arbre.topLevelItemCount()):
            t = self.arbre.topLevelItem(i)
            for j in range(t.childCount()):
                yield t.child(j)

    def _ref(self):
        it = self.arbre.currentItem()
        return it.data(0, Qt.UserRole) if it else None

    def _remplir_listes(self):
        a = self.annee
        for w, items in ((self.w_classe, [("", "Toutes les classes")] + [(c, c) for c in a.codes]),
                         (self.w_mois, [(m, t) for m, t in mois_de_l_annee(a)]),
                         (self.w_compo, [(n, a.libelle_evaluation("STD", n)) for n in a.eval_nums()])):
            v = w.currentData()
            w.blockSignals(True)
            w.clear()
            for k, t in items:
                w.addItem(t, k)
            if v is not None:
                w.setCurrentIndex(max(0, w.findData(v)))
            w.blockSignals(False)
        self._remplir_eleves()

    def _remplir_eleves(self):
        self.w_eleve.clear()
        self.w_eleve.addItem("Tous les élèves", "")
        cl = self.w_classe.currentData()
        if cl:
            for r in repo.inscriptions(self.db, self.annee, cl):
                self.w_eleve.addItem(f"{r['nom']} ({r['matricule_ecole']})", r["inscription_id"])

    def _parametres_modele(self) -> list[str]:
        ref = self._ref()
        if ref is None:
            return []
        if isinstance(ref, str) and ref.startswith(LOT):
            return []
        return store.definition(self.db, ref).get("parametres", [])

    def _choisir(self):
        ref = self._ref()
        params = self._parametres_modele()
        for k, (_, w) in self.champs.items():
            vis = k in params
            w.setVisible(vis)
            self.form.labelForField(w).setVisible(vis)
        self.aucun.setVisible(ref is not None and not params)
        est_modele = isinstance(ref, int)
        est_lot = isinstance(ref, str)
        for b in (self.b_apercu, self.b_imprimer, self.b_enreg):
            b.setEnabled(ref is not None)
        self.b_classes.setEnabled(est_modele and "classe" in params)
        if est_modele:
            m = store.get(self.db, ref)
            self.desc.setText(m.get("description") or "")
            partage = bool(m["integre"]) or m.get("cree_par") != self.s.login
            peut = self.peut("modeles.partages") if partage else self.peut("modeles.gerer")
            for a in (self.a_modifier, self.a_renommer, self.a_actif, self.a_versions):
                a.setEnabled(peut)
            self.a_original.setEnabled(bool(m["integre"]) and self.peut("modeles.partages"))
            self.a_supprimer.setEnabled(not m["integre"] and peut)
        elif est_lot:
            titre, codes = LOTS[ref[len(LOT):]]
            noms = {m["code"]: m["nom"] for m in store.lister(self.db)}
            self.desc.setText("Dans un seul document : " + ", ".join(noms.get(c, c) for c in codes) + ".")
            for a in (self.a_modifier, self.a_renommer, self.a_actif, self.a_versions, self.a_original,
                      self.a_supprimer):
                a.setEnabled(False)
        else:
            self.desc.setText("Choisissez un modèle dans la liste.")

    def _valeurs(self) -> dict:
        p = {}
        for k in self._parametres_modele():
            w = self.champs[k][1]
            v = w.iso() if isinstance(w, ChampDate) else w.currentData()
            if v not in (None, ""):
                p[k] = v
        return p

    def _nom(self) -> str:
        it = self.arbre.currentItem()
        nom = it.text(0).replace("  (masqué)", "") if it else "Rapport"
        p = self._valeurs()
        if p.get("classe"):
            nom += f" {p['classe']}"
        return f"{nom} {self.annee.libelle}"

    def _produire(self, chemin: Path, fmt: str) -> Path:
        ref = self._ref()
        if isinstance(ref, str) and ref.startswith(LOT):
            titre, codes = LOTS[ref[len(LOT):]]
            return service.generer_lot(self.db, self.s, self.annee, codes, self._valeurs(), chemin, fmt)
        return service.generer(self.db, self.s, self.annee, ref, self._valeurs(), chemin, fmt)

    # ------------------------------------------------------------------ génération
    def _apercu(self):
        if self._ref() is None:
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            self.apercu.charger(None)
            self.apercu_pdf = self._produire(fichier_apercu(self._nom()), "pdf")
            self.apercu.charger(self.apercu_pdf)
            self.l_pages.setText(f"{self.apercu.pages()} page(s) · {self._nom()}")
        except Exception as e:       # noqa: BLE001
            QGuiApplication.restoreOverrideCursor()
            afficher_erreur(self, e, "Génération impossible")
            return
        QGuiApplication.restoreOverrideCursor()

    def _imprimer(self):
        if self.apercu_pdf is None or self.apercu.chemin is None:
            self._apercu()
        if self.apercu_pdf:
            imprimer_pdf(self, self.apercu_pdf)

    def _enregistrer(self):
        if self._ref() is not None:
            enregistrer(self, self._nom(), self._produire, formats_autorises(self.ctx))

    @protege
    def _par_classe(self):
        fmts = formats_autorises(self.ctx)
        fmt = "pdf"
        if len(fmts) > 1:
            noms = {"pdf": "PDF", "xlsx": "Excel", "docx": "Word"}
            choix, ok = QInputDialog.getItem(self, "Format", "Format des fichiers :", [noms[f] for f in fmts], 0, False)
            if not ok:
                return
            fmt = fmts[[noms[f] for f in fmts].index(choix)]
        d = QFileDialog.getExistingDirectory(self, "Dossier de destination", str(paths.exports_dir()))
        if not d:
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            out = service.un_fichier_par_classe(self.db, self.s, self.annee, self._ref(), self._valeurs(), d, fmt)
        finally:
            QGuiApplication.restoreOverrideCursor()
        info(self, "Fichiers enregistrés", f"{len(out)} fichier(s) enregistré(s) dans :\n{d}")
        ouvrir_fichier(d)

    # ------------------------------------------------------------------ gestion des modèles
    def _apres(self):
        self.ctx.modifie("modeles")

    def _modifier(self):
        ref = self._ref()
        if not isinstance(ref, int):
            return
        from epp.ui.designer.editeur import EditeurModele
        if EditeurModele(self, ref).exec():
            self._apres()

    @protege
    def _dupliquer(self):
        ref = self._ref()
        if not isinstance(ref, int):
            return
        nom, ok = QInputDialog.getText(self, "Dupliquer", "Nom de la copie :",
                                       text=store.get(self.db, ref)["nom"] + " (copie)")
        if ok and nom.strip():
            store.dupliquer(self.db, self.s, ref, nom.strip())
            self._apres()

    @protege
    def _renommer(self):
        ref = self._ref()
        m = store.get(self.db, ref)
        nom, ok = QInputDialog.getText(self, "Renommer", "Nouveau nom :", text=m["nom"])
        if ok and nom.strip():
            store.renommer(self.db, self.s, ref, nom.strip())
            self._apres()

    @protege
    def _basculer_actif(self):
        ref = self._ref()
        store.set_actif(self.db, self.s, ref, not store.get(self.db, ref)["actif"])
        self._apres()

    @protege
    def _versions(self):
        ref = self._ref()
        vs = store.versions(self.db, ref)
        if len(vs) < 2:
            info(self, "Versions", "Ce modèle n'a pas de version précédente.")
            return
        items = [f"Version {v['version']} – {v.get('cree_le') or ''} {v.get('commentaire') or ''}".strip()
                 for v in vs]
        choix, ok = QInputDialog.getItem(self, "Versions", "Revenir à :", items, 0, False)
        if ok:
            v = vs[items.index(choix)]["version"]
            store.restaurer_version(self.db, self.s, ref, v)
            self._apres()

    @protege
    def _original(self):
        if confirmer(self, "Rétablir", "Rétablir la présentation d'origine de ce modèle ? Vos modifications restent "
                                       "disponibles dans l'historique des versions."):
            store.retablir_original(self.db, self.s, self._ref())
            self._apres()

    @protege
    def _exporter_modele(self):
        ref = self._ref()
        if not isinstance(ref, int):
            return
        m = store.get(self.db, ref)
        ch, _ = QFileDialog.getSaveFileName(self, "Exporter le modèle",
                                            str(paths.exports_dir() / f"{service.nom_fichier(m['nom'])}{store.EXTENSION}"),
                                            f"Modèle de rapport (*{store.EXTENSION})")
        if ch:
            store.exporter(self.db, ref, ch)
            info(self, "Modèle exporté", f"Le modèle a été enregistré :\n{ch}")

    @protege
    def _importer_modele(self):
        ch, _ = QFileDialog.getOpenFileName(self, "Importer un modèle", str(paths.exports_dir()),
                                            f"Modèle de rapport (*{store.EXTENSION})")
        if ch:
            mid = store.importer(self.db, self.s, ch)
            self._apres()
            info(self, "Modèle importé", f"Le modèle « {store.get(self.db, mid)['nom']} » a été ajouté.")

    @protege
    def _supprimer(self):
        ref = self._ref()
        m = store.get(self.db, ref)
        if confirmer(self, "Supprimer le modèle", f"Supprimer définitivement le modèle « {m['nom']} » et son "
                                                  "historique ?", "Supprimer", True):
            store.supprimer(self.db, self.s, ref)
            self._apres()

