"""Aide et tutoriels : guide d'utilisation, vidéos de démonstration, informations sur l'installation."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QListWidget, QListWidgetItem, QSplitter, QTabWidget, QTextBrowser

from epp import APP_NAME, __version__
from epp.core import licence, paths
from epp.core.db import SCHEMA_VERSION
from epp.ui.pages.base import Page
from epp.ui.video import LecteurTutoriel, dossiers_videos, tutoriels
from epp.ui.widgets import Carte, bouton, label, ouvrir_fichier

GUIDE = """
<h2>Bien démarrer</h2>
<ol>
<li><b>Paramètres › Établissement</b> : vérifiez le nom de l'école, l'IEPP, la DRENAET, le directeur, puis ajoutez
les logos ; ils sont imprimés dans l'en-tête officiel de tous les états.</li>
<li><b>Paramètres › Calendrier</b> : complétez les jours fériés (fêtes musulmanes) et les congés scolaires de
l'année : ces jours ne comptent pas comme jours de classe.</li>
<li><b>Élèves</b> : saisissez les élèves (bouton « Nouvel élève ») ou importez un modèle Excel rempli
(<b>Import / Export</b>). Le classeur GESTION SCOLAIRE EPP d'origine peut aussi être repris tel quel.</li>
<li><b>Personnel</b> : saisissez les agents et la classe tenue par chaque enseignant.</li>
<li><b>Notes</b> : choisissez la classe et l'évaluation, tapez les notes ; Entrée passe à l'élève suivant.</li>
<li><b>Rapports</b> : choisissez un état, réglez les paramètres, faites un aperçu, puis imprimez ou enregistrez
en PDF, Excel ou Word.</li>
</ol>
<h2>Raccourcis clavier</h2>
<p>Ctrl+1 Tableau de bord · Ctrl+2 Élèves · Ctrl+3 Inscriptions · Ctrl+4 Classes · Ctrl+5 Personnel ·
Ctrl+6 Notes · Ctrl+7 Résultats · Ctrl+8 Absences · Ctrl+9 Statistiques · F1 Aide</p>
<h2>Absences et autorisations</h2>
<p>Dans <b>Absences et autorisations › Autorisations d'absence</b>, « Nouvelle demande » : tapez le matricule (ou
un nom, une classe) puis « Remplir la fiche ». La demande accordée par le directeur crée automatiquement les
absences justifiées correspondantes. La fiche s'imprime par son numéro, le matricule ou une recherche.</p>
<h2>Fin d'année</h2>
<p>Dans <b>Résultats et fin d'année</b>, vérifiez les décisions proposées (admis, redoublants), corrigez-les si
besoin, validez chaque classe, puis « Passer à l'année suivante » : une sauvegarde est faite, les élèves sont
réinscrits dans leur nouvelle classe et l'année terminée est archivée en lecture seule.</p>
<h2>Sauvegardes</h2>
<p>L'application sauvegarde automatiquement vos données. Copiez régulièrement une sauvegarde sur une clé USB
(<b>Sauvegarde › Copier sur une clé USB</b>) et gardez-la hors de l'école. La restauration remplace toutes les
données actuelles, après une sauvegarde de sécurité de l'état présent.</p>
<h2>Utilisateurs et sécurité</h2>
<p>Chaque personne a son compte et son rôle (administrateur, directeur, secrétariat, enseignant). Les mots de
passe sont enregistrés sous forme chiffrée irréversible. Un mot de passe oublié est remplacé par un mot de passe
provisoire donné par un administrateur (<b>Paramètres › Utilisateurs</b>).</p>
<h2>Licence</h2>
<p>La version d'essai dure 7 jours. Ensuite, ou à l'expiration d'une licence d'un an, l'application et les
données ne sont plus accessibles tant qu'un code d'activation n'a pas été saisi ; les données sont conservées et
réapparaissent dès l'activation.</p>
"""


class PageAide(Page):
    titre = "Aide et tutoriels"
    sous_titre = "Guide d'utilisation et vidéos de démonstration"
    besoin_annee = False

    def __init__(self, ctx):
        super().__init__(ctx)
        onglets = QTabWidget()
        guide = QTextBrowser()
        guide.setHtml(GUIDE)
        guide.setOpenExternalLinks(False)
        onglets.addTab(guide, "Guide")
        tuto = QSplitter()
        self.liste = QListWidget()
        self.liste.itemClicked.connect(self._lire)
        tuto.addWidget(self.liste)
        self.lecteur = LecteurTutoriel()
        tuto.addWidget(self.lecteur)
        tuto.setSizes([280, 800])
        onglets.addTab(tuto, "Tutoriels vidéo")
        apropos = Carte()
        self.infos = label("", wrap=True)
        self.infos.setTextInteractionFlags(Qt.TextSelectableByMouse)
        apropos.lay.addWidget(self.infos)
        apropos.lay.addWidget(bouton("Ouvrir le dossier des données", lambda: ouvrir_fichier(paths.data_dir())))
        apropos.lay.addWidget(bouton("Ouvrir le journal des erreurs", lambda: ouvrir_fichier(paths.logs_dir())))
        apropos.lay.addStretch(1)
        onglets.addTab(apropos, "À propos")
        self.corps.addWidget(onglets, 1)

    def rafraichir(self):
        self.liste.clear()
        vids = tutoriels()
        for f in vids:
            it = QListWidgetItem(f.stem.replace("_", " ").strip())
            it.setData(256, str(f))
            self.liste.addItem(it)
        if not vids:
            it = QListWidgetItem("Aucune vidéo installée")
            it.setToolTip("Placez des vidéos (.mp4) dans : " + str(dossiers_videos()[0] / "tutoriels"))
            self.liste.addItem(it)
        e = self.ctx.licence or licence.etat()
        self.infos.setText(
            f"<b>{APP_NAME}</b> version {__version__} (base de données version {SCHEMA_VERSION})<br><br>"
            f"Licence : {e.message}<br><br>"
            f"Données : {paths.data_dir()}<br>Base : {self.db.path}<br>Journal : {paths.logs_dir()}<br><br>"
            "Fonctionne entièrement hors ligne. Une connexion Internet n'est nécessaire que pour activer un code.")

    def _lire(self, it):
        f = it.data(256)
        if f:
            from pathlib import Path
            self.lecteur.ouvrir(Path(f))

    def hideEvent(self, e):
        self.lecteur.arreter()
        super().hideEvent(e)
