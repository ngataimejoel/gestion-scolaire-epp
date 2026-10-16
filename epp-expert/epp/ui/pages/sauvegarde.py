"""Sauvegarde : sauvegardes manuelles (dossier ou clé USB), automatiques, vérification et restauration."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QCheckBox, QFileDialog, QFormLayout, QInputDialog, QLineEdit, QSpinBox

from epp.core import backup
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, Col, Tableau, bouton, info, label, ligne, ouvrir_fichier, protege, valider_suppression

MOT_CONFIRMATION = "RESTAURER"


class PageSauvegarde(Page):
    titre = "Sauvegarde"
    sous_titre = "Protégez vos données : sauvegardes automatiques, copie sur clé USB, restauration"
    permission = "sauvegarde.creer"
    besoin_annee = False

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Ouvrir le dossier", lambda: ouvrir_fichier(backup.dossier(self.db))))
        self.actions.addWidget(bouton("Copier sur une clé USB…", self._usb))
        self.actions.addWidget(bouton("Sauvegarder maintenant", self._maintenant, "primaire"))
        c = Carte("Sauvegardes disponibles")
        self.table = Tableau([Col("date", "Date", largeur=140), Col("motif", "Motif", largeur=260),
                              Col("utilisateur", "Par", largeur=90), Col("annees", "Années", largeur=160),
                              Col("taille_ko", "Taille (Ko)", "nombre", 90), Col("nom", "Fichier")])
        c.lay.addWidget(self.table, 1)
        self.b_verif = bouton("Vérifier", self._verifier)
        self.b_rest = bouton("Restaurer cette sauvegarde…", self._restaurer_selection, "danger")
        self.b_fichier = bouton("Restaurer depuis un fichier…", self._restaurer_fichier, "danger")
        c.lay.addLayout(ligne(self.b_verif, None, self.b_fichier, self.b_rest))
        self.corps.addWidget(c, 1)
        c2 = Carte("Sauvegarde automatique")
        f = QFormLayout()
        self.auto = QCheckBox("Sauvegarder automatiquement à l'ouverture et à la fermeture de l'application")
        self.freq = QSpinBox()
        self.freq.setRange(1, 24 * 30)
        self.freq.setSuffix(" heure(s) au moins entre deux sauvegardes")
        self.garder = QSpinBox()
        self.garder.setRange(1, 500)
        self.garder.setSuffix(" sauvegardes automatiques conservées")
        self.dossier = QLineEdit()
        self.dossier.setPlaceholderText("dossier par défaut (données de l'application)")
        f.addRow("", self.auto)
        f.addRow("Fréquence", self.freq)
        f.addRow("Conservation", self.garder)
        f.addRow("Dossier", ligne(self.dossier, bouton("Choisir…", self._choisir_dossier)))
        c2.lay.addLayout(f)
        self.b_reglages = bouton("Enregistrer les réglages", self._reglages, "primaire")
        c2.lay.addLayout(ligne(label("Les sauvegardes manuelles et celles faites avant une opération importante "
                                     "(passage d'année, import, restauration) ne sont jamais supprimées.",
                                     discret=True, wrap=True), self.b_reglages))
        self.corps.addWidget(c2)

    def rafraichir(self):
        lignes = []
        for b in backup.lister(self.db):
            r = {"nom": b["nom"], "fichier": b["fichier"], "taille_ko": round(b["taille"] / 1024)}
            try:
                import json
                import zipfile
                with zipfile.ZipFile(b["fichier"]) as z:
                    m = json.loads(z.read("manifeste.json").decode("utf-8"))
                r.update(date=datetime.fromisoformat(m["cree_le"]).strftime("%d/%m/%Y %H:%M"), motif=m.get("motif"),
                         utilisateur=m.get("utilisateur"), annees=", ".join(m.get("annees") or []))
            except Exception:      # noqa: BLE001 - fichier illisible : signalé dans la liste
                r.update(date="?", motif="fichier illisible", _couleur="#B23A30")
            lignes.append(r)
        self.table.set_lignes(lignes)
        e = self.db
        self.auto.setChecked((e.get_param("sauvegarde_auto") or "1") == "1")
        self.freq.setValue(int(float(e.get_param("sauvegarde_frequence_heures") or 24)))
        self.garder.setValue(int(float(e.get_param("sauvegarde_conserver") or 20)))
        self.dossier.setText(e.get_param("sauvegarde_dossier") or "")
        ok = self.peut("parametres.modifier")
        for w in (self.auto, self.freq, self.garder, self.dossier, self.b_reglages):
            w.setEnabled(ok)
        rest = self.peut("sauvegarde.restaurer")
        self.b_rest.setEnabled(rest)
        self.b_fichier.setEnabled(rest)

    @protege
    def _maintenant(self):
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            f = backup.creer_sauvegarde(self.db, self.s, "manuelle")
        finally:
            QGuiApplication.restoreOverrideCursor()
        self.rafraichir()
        info(self, "Sauvegarde", f"Sauvegarde créée et vérifiée :\n{f}")

    @protege
    def _usb(self):
        d = QFileDialog.getExistingDirectory(self, "Dossier de destination (clé USB, disque externe…)")
        if not d:
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            f = backup.creer_sauvegarde(self.db, self.s, "copie externe", Path(d))
        finally:
            QGuiApplication.restoreOverrideCursor()
        info(self, "Sauvegarde", f"Sauvegarde copiée et vérifiée :\n{f}\n\nConservez cette copie hors de l'école.")

    @protege
    def _verifier(self):
        r = self.table.ligne_courante()
        if r:
            m = backup.verifier(r["fichier"])
            info(self, "Sauvegarde intègre", f"La sauvegarde est complète et intègre.\nCréée le {m['cree_le']} par "
                                             f"{m.get('utilisateur')} ({m.get('motif')}).\nAnnées : "
                                             f"{', '.join(m.get('annees') or [])}")

    def _restaurer_selection(self):
        r = self.table.ligne_courante()
        if r:
            self._restaurer(Path(r["fichier"]))

    def _restaurer_fichier(self):
        f, _ = QFileDialog.getOpenFileName(self, "Fichier de sauvegarde", str(backup.dossier(self.db)),
                                           "Sauvegardes (*.zip)")
        if f:
            self._restaurer(Path(f))

    @protege
    def _restaurer(self, fichier: Path):
        m = backup.verifier(fichier)
        mot, ok = QInputDialog.getText(
            self, "Restaurer une sauvegarde",
            f"Sauvegarde du {m['cree_le']} ({m.get('motif')}), années : {', '.join(m.get('annees') or [])}.\n\n"
            "Toutes les données actuelles seront remplacées par celles de cette sauvegarde. Une sauvegarde de "
            "l'état actuel est faite d'abord ; vous devrez ensuite vous reconnecter.\n\n"
            f"Pour confirmer, tapez {MOT_CONFIRMATION} :")
        if not ok or mot.strip().upper() != MOT_CONFIRMATION:
            return
        if not valider_suppression(self, self.db, self.s, "remplacement de toutes les données par une sauvegarde"):
            return
        QGuiApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            nouvelle, avant = backup.restaurer(self.db, self.s, fichier)
        finally:
            QGuiApplication.restoreOverrideCursor()
        info(self, "Restauration terminée", f"Les données ont été restaurées.\nL'état précédent est conservé dans "
                                            f"{avant.name}.\n\nReconnectez-vous pour continuer.")
        self.fenetre.reconnexion(nouvelle)

    def _choisir_dossier(self):
        d = QFileDialog.getExistingDirectory(self, "Dossier des sauvegardes")
        if d:
            self.dossier.setText(d)

    @protege
    def _reglages(self):
        from epp.domain import repo
        repo.save_etablissement(self.db, self.s, {
            "sauvegarde_auto": "1" if self.auto.isChecked() else "0",
            "sauvegarde_frequence_heures": str(self.freq.value()),
            "sauvegarde_conserver": str(self.garder.value()), "sauvegarde_dossier": self.dossier.text().strip()})
        self.rafraichir()
        info(self, "Sauvegarde", "Les réglages ont été enregistrés.")
