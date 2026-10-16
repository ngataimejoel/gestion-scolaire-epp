"""Import / Export : modèles Excel (vierges ou remplis), import contrôlé avec aperçu, exports PDF / Word,
et import du classeur d'origine GESTION SCOLAIRE EPP."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QCheckBox, QComboBox, QDialog, QFileDialog, QGridLayout, QVBoxLayout

from epp.core import paths
from epp.io import import_eleves19, import_excel, modeles_excel
from epp.reports import service
from epp.ui.dialogs.export import enregistrer, formats_autorises
from epp.ui.pages.base import Page
from epp.ui.widgets import (Carte, Col, Tableau, afficher_erreur, bouton, confirmer, info, label, ligne,
                            mot_de_passe_admin, ouvrir_fichier, protege)

ACTIONS = {"creer": "Création", "modifier": "Mise à jour", "inscrire": "Inscription", "ignorer": "Ignorée"}


class DialogueAnalyse(QDialog):
    """Ce que l'import va faire, ligne par ligne, avant d'enregistrer quoi que ce soit."""

    def __init__(self, page: Page, an: modeles_excel.Analyse, fichier: Path):
        super().__init__(page)
        self.page, self.an, self.fichier = page, an, fichier
        self.setWindowTitle(f"Import – {Path(fichier).name}")
        self.resize(980, 620)
        v = QVBoxLayout(self)
        c = an.compte()
        v.addWidget(label(f"{modeles_excel.TYPES[an.kind][1]} · année {an.annee}", gras=True, taille=11))
        v.addWidget(label(f"{c.get('creer', 0)} création(s), {c.get('modifier', 0)} mise(s) à jour, "
                          f"{c.get('inscrire', 0)} inscription(s), {c.get('ignorer', 0)} ligne(s) inchangée(s), "
                          f"{c['erreurs']} ligne(s) refusée(s).", wrap=True))
        for e in an.erreurs_fichier:
            l = label("⚠ " + e, wrap=True)
            l.setStyleSheet("color: #B23A30;")
            v.addWidget(l)
        lignes = []
        for l in an.lignes:
            d = l.donnees
            lignes.append({"feuille": l.feuille, "numero": l.numero,
                           "action": "Refusée" if l.erreurs else ACTIONS.get(l.action, l.action),
                           "qui": d.get("nom") or d.get("matricule_ecole") or d.get("matricule") or d.get("code") or "",
                           "detail": "; ".join(l.erreurs + l.avertissements),
                           "_couleur": "#B23A30" if l.erreurs else ("#B7791F" if l.avertissements else None)})
        self.filtre = QComboBox()
        for k, t in (("", "Toutes les lignes"), ("Refusée", "Lignes refusées"), ("avert", "Avec avertissement")):
            self.filtre.addItem(t, k)
        self.filtre.activated.connect(lambda _: self._filtrer())
        v.addLayout(ligne(self.filtre, None))
        self.toutes = lignes
        self.table = Tableau([Col("feuille", "Feuille", largeur=110), Col("numero", "Ligne", "nombre", 54),
                              Col("action", "Action", largeur=100), Col("qui", "Élément", largeur=230),
                              Col("detail", "Erreurs et avertissements")])
        v.addWidget(self.table, 1)
        self._filtrer()
        v.addWidget(label("Seules les lignes valides sont enregistrées, en une seule fois, après une sauvegarde "
                          "automatique. Les lignes refusées peuvent être corrigées dans le fichier puis réimportées.",
                          discret=True, wrap=True))
        self.b_ok = bouton("Importer les lignes valides", self._importer, "primaire")
        self.b_ok.setEnabled(an.importable)
        v.addLayout(ligne(bouton("Enregistrer le rapport…", self._rapport), None, bouton("Annuler", self.reject),
                          self.b_ok))

    def _filtrer(self):
        f = self.filtre.currentData()
        self.table.set_lignes([l for l in self.toutes if not f or (f == "Refusée" and l["action"] == "Refusée")
                               or (f == "avert" and l["detail"] and l["action"] != "Refusée")])

    @protege
    def _rapport(self):
        ch, _ = QFileDialog.getSaveFileName(self, "Rapport d'import", str(paths.exports_dir() /
                                            f"Rapport import {Path(self.fichier).stem}.xlsx"), "Classeur Excel (*.xlsx)")
        if ch:
            ouvrir_fichier(modeles_excel.ecrire_rapport(self.an, ch))

    @protege
    def _importer(self):
        p = self.page
        if self.an.corrections and not mot_de_passe_admin(
                self, p.db, p.s, f"Cet import corrige {self.an.corrections} note(s) déjà saisie(s). Saisissez le mot "
                                 "de passe d'un administrateur pour continuer.", "import de notes avec corrections"):
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            b = modeles_excel.appliquer(p.db, p.s, p.annee, self.an)
        finally:
            QGuiApplication.restoreOverrideCursor()
        info(self, "Import terminé", f"{b['enregistrees']} ligne(s) enregistrée(s), {b['ignorees']} inchangée(s), "
                                     f"{b['refusees']} refusée(s)."
             + (f"\nSauvegarde faite avant l'import : {b['sauvegarde'].name}" if b["sauvegarde"] else ""))
        self.accept()


ETATS19 = {"ok": "Import", "reinscription": "Réinscription", "doublon": "Doublon ignoré", "erreur": "Refusée"}


class DialogueEleves19(QDialog):
    """Aperçu de l'import du fichier national des élèves (ELEVES 19) avant tout enregistrement."""

    def __init__(self, page: Page, bilan: dict, fichier: Path):
        super().__init__(page)
        self.page, self.bilan, self.fichier = page, bilan, fichier
        self.setWindowTitle(f"Fichier national – {Path(fichier).name}")
        self.resize(980, 620)
        v = QVBoxLayout(self)
        v.addWidget(label(f"{bilan['lignes']} élève(s) dans le fichier · année {page.annee.libelle}", gras=True,
                          taille=11))
        v.addWidget(label(f"{bilan['a_importer']} à inscrire, {bilan['a_reinscrire']} à réinscrire, "
                          f"{bilan['doublons']} doublon(s) ignoré(s), {bilan['erreurs']} ligne(s) refusée(s).",
                          wrap=True))
        for e in bilan.get("avertissements") or []:
            l = label("⚠ " + e, wrap=True)
            l.setStyleSheet("color: #9F5C06;")
            v.addWidget(l)
        self.table = Tableau([Col("ligne", "Ligne", "nombre", 54), Col("etat_lib", "Action", largeur=130),
                              Col("matricule", "Matricule", largeur=110), Col("nom", "Nom et prénoms", largeur=230),
                              Col("classe", "Classe", largeur=80), Col("motif", "Motif")])
        self.table.set_lignes([dict(d, etat_lib=ETATS19.get(d["etat"], d["etat"]),
                                    _couleur={"erreur": "#BF3A33", "doublon": "#9F5C06"}.get(d["etat"]))
                               for d in bilan["details"]])
        v.addWidget(self.table, 1)
        v.addWidget(label("Seules les lignes valides sont enregistrées, en une seule fois, après une sauvegarde "
                          "automatique. Aucune classe n'est créée : un niveau sans classe est refusé.",
                          discret=True, wrap=True))
        self.b_ok = bouton("Importer les élèves", self._importer, "primaire")
        self.b_ok.setEnabled(bool(bilan["a_importer"] or bilan["a_reinscrire"]))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), self.b_ok))

    @protege
    def _importer(self):
        p = self.page
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            b = import_eleves19.importer(p.db, p.s, p.annee, self.fichier)
        finally:
            QGuiApplication.restoreOverrideCursor()
        info(self, "Import terminé", import_eleves19.resume(b))
        self.accept()


class PageImportExport(Page):
    titre = "Import / Export"
    sous_titre = "Modèles Excel, exports PDF et Word, classeur d'origine"
    permission = None
    ecoute = ("classes",)

    def __init__(self, ctx):
        super().__init__(ctx)
        grille = QGridLayout()
        grille.setSpacing(12)
        c1 = Carte("Modèles Excel")
        c1.lay.addWidget(label("Choisissez le type de données. Le modèle contient les colonnes attendues, des listes "
                               "déroulantes et une feuille d'aide ; il peut être rempli hors de l'application puis "
                               "importé ici.", discret=True, wrap=True))
        self.type = QComboBox()
        for k, (t, d) in modeles_excel.TYPES.items():
            self.type.addItem(t, k)
            self.type.setItemData(self.type.count() - 1, d, Qt.ToolTipRole)
        self.eval = QComboBox()
        self.l_eval = label("Évaluation")
        self.type.currentIndexChanged.connect(self._type)
        c1.lay.addLayout(ligne(label("Données"), self.type, self.l_eval, self.eval, None))
        self.b_vierge = bouton("Modèle vierge…", self._vierge)
        self.b_rempli = bouton("Exporter les données (Excel)…", self._rempli)
        self.b_import = bouton("Importer un fichier rempli…", self._importer, "primaire")
        c1.lay.addLayout(ligne(self.b_vierge, self.b_rempli, None, self.b_import))
        grille.addWidget(c1, 0, 0)

        c2 = Carte("Exporter une liste (PDF, Word, Excel)")
        c2.lay.addWidget(label("Liste mise en page avec l'en-tête officiel et les logos, ou classeur Excel "
                               "réimportable.", discret=True, wrap=True))
        self.b_liste = bouton("Exporter la liste choisie…", self._liste)
        c2.lay.addWidget(self.b_liste)
        c2.lay.addStretch(1)
        grille.addWidget(c2, 0, 1)

        c4 = Carte("Fichier national des élèves (ELEVES 19)")
        c4.lay.addWidget(label("Fichier à 22 colonnes de la plateforme nationale (.xls, .xlsx ou .csv). L'aperçu "
                               "montre les inscriptions, réinscriptions, doublons et erreurs avant tout "
                               "enregistrement.", discret=True, wrap=True))
        self.b_n_modele = bouton("Modèle vierge…", self._n_modele)
        self.b_n_export = bouton("Exporter au format national…", self._n_export)
        self.b_n_import = bouton("Importer le fichier national…", self._n_import, "primaire")
        c4.lay.addLayout(ligne(self.b_n_modele, self.b_n_export, None, self.b_n_import))
        grille.addWidget(c4, 1, 0, 1, 2)

        c3 = Carte("Classeur GESTION SCOLAIRE EPP d'origine")
        c3.lay.addWidget(label("Reprend une année complète depuis le classeur Excel (.xlsm) : paramètres, classes, "
                               "élèves, notes, personnel et absences. Le classeur est seulement lu : il n'est jamais "
                               "modifié.", discret=True, wrap=True))
        self.remplacer = QCheckBox("Remplacer l'année si elle existe déjà dans l'application")
        c3.lay.addWidget(self.remplacer)
        self.b_classeur = bouton("Importer le classeur…", self._classeur)
        c3.lay.addLayout(ligne(self.b_classeur, None))
        grille.addWidget(c3, 2, 0, 1, 2)
        self.corps.addLayout(grille)
        self.corps.addStretch(1)

    def rafraichir(self):
        n = self.eval.currentData()
        self.eval.clear()
        for k in self.annee.eval_nums():
            self.eval.addItem(self.annee.libelle_evaluation("STD", k), k)
        if n:
            self.eval.setCurrentIndex(max(0, self.eval.findData(n)))
        self._type()

    def _type(self):
        notes = self.type.currentData() == "notes"
        self.eval.setVisible(notes)
        self.l_eval.setVisible(notes)
        imp = self.peut("import.excel") and self.modifiable()
        self.b_import.setEnabled(imp)
        self.b_classeur.setEnabled(self.peut("import.excel"))
        self.b_rempli.setEnabled(self.peut("export.excel"))
        self.b_liste.setEnabled(self.peut("rapports.generer") or self.peut("export.excel"))
        self.b_n_import.setEnabled(imp)
        self.b_n_export.setEnabled(self.peut("export.excel"))

    def _num(self):
        return self.eval.currentData() if self.type.currentData() == "notes" else None

    def _nom(self, quoi: str) -> str:
        return f"{quoi} {modeles_excel.TYPES[self.type.currentData()][0]} {self.annee.libelle}"

    def _vierge(self):
        k = self.type.currentData()
        enregistrer(self, self._nom("Modèle"),
                    lambda ch, f: modeles_excel.creer_modele(self.db, self.annee, k, ch, num=self._num()), ["xlsx"])

    def _rempli(self):
        k = self.type.currentData()
        enregistrer(self, self._nom("Export"),
                    lambda ch, f: modeles_excel.exporter(self.db, self.s, self.annee, k, ch, self._num()), ["xlsx"])

    def _liste(self):
        k = self.type.currentData()
        fmts = [f for f in formats_autorises(self.ctx) if f != "pdf" or self.peut("rapports.generer")]
        if not fmts:
            return
        enregistrer(self, self._nom("Liste"),
                    lambda ch, f: service.exporter_liste(self.db, self.s, self.annee, k, ch, f, self._num()), fmts)

    @protege
    def _importer(self):
        ch, _ = QFileDialog.getOpenFileName(self, "Fichier à importer", str(paths.exports_dir()),
                                            "Classeurs Excel (*.xlsx *.xlsm)")
        if not ch:
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            an = modeles_excel.analyser(self.db, self.annee, ch)
        finally:
            QGuiApplication.restoreOverrideCursor()
        if DialogueAnalyse(self, an, Path(ch)).exec():
            self.ctx.modifie("*")

    def _n_modele(self):
        enregistrer(self, "Modèle ELEVES 19", lambda ch, f: import_eleves19.modele(ch, self.db), ["xlsx"])

    def _n_export(self):
        enregistrer(self, f"ELEVES {self.annee.libelle}",
                    lambda ch, f: import_eleves19.exporter(self.db, self.s, self.annee, ch), ["xlsx", "csv"])

    @protege
    def _n_import(self):
        ch, _ = QFileDialog.getOpenFileName(self, "Fichier national des élèves", str(Path.home()),
                                            "Fichiers élèves (*.xls *.xlsx *.csv);;Tous les fichiers (*)")
        if not ch:
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            bilan = import_eleves19.analyser(self.db, self.annee, ch)
        finally:
            QGuiApplication.restoreOverrideCursor()
        if DialogueEleves19(self, bilan, Path(ch)).exec():
            self.ctx.modifie("*")

    @protege
    def _classeur(self):
        ch, _ = QFileDialog.getOpenFileName(self, "Classeur GESTION SCOLAIRE EPP", str(Path.home()),
                                            "Classeurs Excel (*.xlsm *.xlsx)")
        if not ch:
            return
        if self.remplacer.isChecked() and not confirmer(
                self, "Remplacer l'année", "Si l'année du classeur existe déjà, toutes ses données (élèves, notes, "
                                           "absences) seront remplacées par celles du classeur. Une sauvegarde est "
                                           "faite avant. Continuer ?", "Remplacer", True):
            return
        from epp.core import backup
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            sauv = backup.sauvegarde_auto(self.db, "avant import du classeur", login=self.s.login)
            rep = import_excel.import_workbook(self.db, self.s, ch, remplacer=self.remplacer.isChecked())
        except Exception as e:     # noqa: BLE001
            QGuiApplication.restoreOverrideCursor()
            afficher_erreur(self, e, "Import impossible")
            return
        QGuiApplication.restoreOverrideCursor()
        info(self, "Classeur importé", rep.resume() + f"\n\nSauvegarde faite avant l'import : {sauv.name}")
        self.ctx.modifie("annees")
        from epp.domain import repo
        self.ctx.recharger_annee(repo.active_annee_id(self.db))
        self.ctx.modifie("*")

