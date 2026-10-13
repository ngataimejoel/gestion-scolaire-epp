"""Fabrique les vidéos de démonstration (Aide › Tutoriels vidéo) à partir de l'application elle-même.

L'outil ouvre l'application sans écran sur l'école de démonstration fictive, rejoue chaque tutoriel
(pages, fenêtres remplies, aperçus), capture chaque étape avec une légende, puis assemble les images
en vidéos MP4 (H.264, lisibles par Windows) avec ffmpeg. Aucune donnée réelle n'est utilisée.

    python outils/tutoriels.py                      -> epp/resources/videos/tutoriels/*.mp4
    python outils/tutoriels.py --sortie DOSSIER --images   (garde aussi les images PNG)
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["EPP_SANS_ANIMATION"] = "1"
os.environ["EPP_SANS_VIDEO"] = "1"

from PySide6.QtCore import QCoreApplication, QEvent, QRect, Qt         # noqa: E402
from PySide6.QtGui import QColor, QFont, QImage, QPainter                # noqa: E402
from PySide6.QtWidgets import QApplication, QInputDialog, QMessageBox    # noqa: E402

LARGEUR, HAUTEUR, BANDE = 1280, 720, 92
DUREE = 5.0            # secondes par étape


def _silence() -> None:
    """Les boîtes de message ne bloquent pas l'enregistrement."""
    for k in ("critical", "warning", "information", "question"):
        setattr(QMessageBox, k, staticmethod(lambda *a, **kw: QMessageBox.Ok))
    QMessageBox.exec = lambda self: 0
    QInputDialog.getText = staticmethod(lambda *a, **kw: ("", False))


class Studio:
    def __init__(self, dossier: Path):
        from epp.core import licence
        from epp.core.db import open_database
        from epp.core.security import system_session
        from epp.demo import creer_ecole_demo
        from epp.ui.main import FenetrePrincipale, appliquer_theme
        from epp.ui.widgets import Contexte
        self.app = QApplication.instance() or QApplication([])
        appliquer_theme(self.app)
        _silence()
        self.dossier = dossier
        self.db = open_database(dossier / "demo.sqlite")
        s = system_session()
        annee = creer_ecole_demo(self.db, s)
        etat = licence.Etat("active", type="vie", ecole="EPP OUANINOU 2")
        self.w = FenetrePrincipale(Contexte(self.db, s, annee, etat))
        self.w.resize(LARGEUR, HAUTEUR - BANDE)
        self.w.show()
        self.images: list[Path] = []
        self.captures: list = []

    def attendre(self) -> None:
        for _ in range(4):
            self.app.processEvents()

    def page(self, cle: str):
        p = self.w.page(cle)
        self.attendre()
        return p

    def capture(self, texte: str, dialogue=None) -> None:
        """Image de l'écran (avec la fenêtre de dialogue au premier plan) ; la légende est ajoutée à la fin."""
        self.attendre()
        img = QImage(LARGEUR, HAUTEUR, QImage.Format_RGB32)
        img.fill(QColor("#F4F3EE"))
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.drawPixmap(0, 0, self.w.grab())
        if dialogue is not None:
            dialogue.show()
            self.attendre()
            d = dialogue.grab()
            p.fillRect(QRect(0, 0, LARGEUR, HAUTEUR - BANDE), QColor(0, 0, 0, 95))
            k = min(1.0, (LARGEUR - 80) / d.width(), (HAUTEUR - BANDE - 40) / d.height())
            dw, dh = int(d.width() * k), int(d.height() * k)
            x, y = (LARGEUR - dw) // 2, max(20, (HAUTEUR - BANDE - dh) // 2)
            p.fillRect(QRect(x - 1, y - 1, dw + 2, dh + 2), QColor("#0A4D35"))
            p.drawPixmap(QRect(x, y, dw, dh), d)
            dialogue.hide()
        p.end()
        self.captures.append((img, texte))

    def legendes(self, titre: str) -> None:
        total = len(self.captures)
        for n, (img, texte) in enumerate(self.captures, 1):
            p = QPainter(img)
            p.setRenderHint(QPainter.Antialiasing)
            p.fillRect(QRect(0, HAUTEUR - BANDE, LARGEUR, BANDE), QColor("#0A4D35"))
            p.fillRect(QRect(0, HAUTEUR - BANDE, LARGEUR, 4), QColor("#E8892F"))
            f = QFont("Segoe UI")
            f.setPixelSize(15)
            f.setBold(True)
            p.setFont(f)
            p.setPen(QColor("#F6C08A"))
            p.drawText(QRect(28, HAUTEUR - BANDE + 12, LARGEUR - 56, 22), Qt.AlignLeft | Qt.AlignVCenter,
                       f"{titre}  ·  étape {n} sur {total}")
            f.setPixelSize(19)
            f.setBold(False)
            p.setFont(f)
            p.setPen(QColor("white"))
            p.drawText(QRect(28, HAUTEUR - BANDE + 36, LARGEUR - 56, BANDE - 42),
                       Qt.AlignLeft | Qt.AlignTop | Qt.TextWordWrap, texte)
            p.end()
            fich = self.dossier / f"img_{n:04d}.png"
            img.save(str(fich))
            self.images.append(fich)
        self.captures = []

    def video(self, sortie: Path) -> Path:
        liste = self.dossier / "liste.txt"
        lignes = []
        for f in self.images:
            lignes += [f"file '{f.as_posix()}'", f"duration {DUREE}"]
        lignes.append(f"file '{self.images[-1].as_posix()}'")      # la dernière image reste affichée
        liste.write_text("\n".join(lignes) + "\n", encoding="utf-8")
        sortie.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(liste),
                        "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "28",
                        "-tune", "stillimage", "-movflags", "+faststart", str(sortie)], check=True)
        self.images = []
        return sortie


# =================================================================== tutoriels
def premiers_pas(st: Studio, T: str):
    yield "tableau", None, ("Le tableau de bord résume l'année : effectifs, filles, admis, enseignants, élèves "
                            "sans extrait de naissance et graphiques par classe.")
    p = st.page("parametres")
    yield None, None, ("Paramètres › Établissement et en-tête : vérifiez le nom de l'école, l'IEPP, la DRENAET "
                       "et le directeur, puis ajoutez les logos imprimés sur tous les documents.")
    p.onglets.setCurrentIndex(3)
    yield None, None, ("Paramètres › Calendrier : les jours fériés sont préremplis. Ajoutez les fêtes "
                       "musulmanes et les congés scolaires : ils ne comptent pas comme jours de classe.")
    p.onglets.setCurrentIndex(1)
    yield None, None, ("Paramètres › Bulletin et autorisation : titre, slogan, devise, couleurs et colonnes "
                       "du bulletin (trimestres ou évaluations).")
    yield "aide", None, "Aide et tutoriels : le guide d'utilisation et ces vidéos sont toujours à portée de main (F1)."


def inscrire_eleve(st: Studio, T: str):
    from epp.ui.pages.eleves import DialogueEleve
    p = st.page("eleves")
    yield None, None, "Élèves : la liste de tous les élèves inscrits. Filtrez par classe ou tapez un nom pour chercher."
    d = DialogueEleve(p, None)
    d.f_id.remplir({"nom": "YAO Ange Emmanuel", "sexe": "M", "date_naissance": "2019-04-12"})
    yield None, d, ("« Nouvel élève » : saisissez le nom, le sexe et la date de naissance. Les champs marqués * "
                    "sont obligatoires ; une photo peut être ajoutée.")
    d.onglets.setCurrentIndex(d.onglets.count() - 1)
    d.f_sco.remplir({"classe": "CP1"})
    yield None, d, ("Onglet Scolarité : choisissez la classe. Le matricule de l'école est attribué "
                    "automatiquement à l'enregistrement.")
    d._enregistrer()
    p.recherche.setText("YAO")
    p.rafraichir()                      # la recherche est différée : on l'applique tout de suite
    if p.table.proxy.rowCount() == 0:
        raise RuntimeError("tutoriel « Inscrire un élève » : l'élève YAO n'a pas été enregistré")
    yield None, None, "L'élève apparaît dans la liste. Double-cliquez sur une ligne pour modifier la fiche."
    p.recherche.setText("")
    p.rafraichir()
    yield "inscriptions", None, ("Inscriptions : réinscrivez un ancien élève ou suivez les nouveaux inscrits, "
                                 "les redoublants et les transferts.")


def notes_bulletins(st: Studio, T: str):
    p = st.page("notes")
    yield None, None, ("Notes : choisissez la classe et l'évaluation. Tapez chaque note puis Entrée pour passer "
                       "à l'élève suivant ; total, moyenne et rang se calculent seuls.")
    p.vue.setCurrentIndex(p.modele.index(2, 4))
    p.vue.setFocus()
    yield None, None, ("Décochez « Présent » pour un élève absent à l'évaluation. Une note hors barème est "
                       "refusée.")
    r = st.page("rapports")
    it = next((i for i in r._items() if "ulletin" in i.text(0)), None)
    if it is not None:
        r.arbre.setCurrentItem(it)
        r._apercu()
    yield None, None, ("Rapports : choisissez « Bulletins », la classe et la période, puis Aperçu. Imprimez ou "
                       "enregistrez en PDF ou en Word, une page par élève.")
    it = next((i for i in r._items() if "ffectifs" in i.text(0)), None)
    if it is not None:
        r.arbre.setCurrentItem(it)
        r._apercu()
    yield None, None, ("Tous les états officiels (effectifs, rapports mensuels, résultats...) se préparent de la "
                       "même façon, avec l'en-tête et les logos de l'école.")


def absences(st: Studio, T: str):
    from epp.domain import repo
    from epp.ui.pages.absences import DialogueAutorisation
    p = st.page("absences")
    yield None, None, "Absences et autorisations : les absences des élèves et du personnel, mois par mois."
    agent = [x for x in repo.personnel(st.db, st.w.ctx.annee) if x.get("fonction")][1]
    d = DialogueAutorisation(p, None, agent["matricule"])
    yield None, d, ("Nouvelle demande d'autorisation : tapez le matricule (ou un nom, une classe) puis "
                    "« Remplir la fiche ».")
    d._remplir()
    d.f.remplir({"date_debut": "2026-11-16", "date_fin": "2026-11-18", "motif": "Convocation IEPP",
                 "precisions": "Conférence pédagogique"})
    yield None, d, ("La fiche se remplit avec les informations de l'agent. Indiquez les dates et le motif : "
                    "les jours de classe sont comptés sans week-ends ni jours fériés.")
    yield None, None, ("Une demande accordée par le directeur crée automatiquement les absences justifiées. "
                       "La lettre s'imprime par son numéro, le matricule ou une recherche.")


def fin_annee(st: Studio, T: str):
    from epp.domain import fin_annee as fa
    from epp.ui.pages.resultats import DialoguePassage
    p = st.page("resultats")
    yield None, None, ("Résultats et fin d'année : décisions proposées par classe (admis, redoublants). "
                       "Corrigez si besoin puis validez chaque classe.")
    for i in range(len(p.etat.lignes())):
        p.etat.selectRow(i)
        p._valider_classe()
    p.rafraichir()
    yield None, None, "Toutes les classes validées : le passage à l'année suivante devient possible."
    d = DialoguePassage(p, fa.apercu_passage(st.db, st.w.ctx.annee))
    yield None, d, ("« Passer à l'année suivante » : une sauvegarde est faite, les élèves sont réinscrits dans "
                    "leur nouvelle classe et l'année terminée reste consultable en lecture seule.")


def sauvegardes(st: Studio, T: str):
    p = st.page("sauvegarde")
    p._maintenant()
    yield None, None, ("Sauvegarde : « Sauvegarder maintenant » crée une copie vérifiée de toutes les données. "
                       "Des sauvegardes automatiques sont faites à l'ouverture et à la fermeture.")
    yield None, None, ("« Copier sur une clé USB » : gardez une copie hors de l'école. La restauration "
                       "remplace toutes les données, après une sauvegarde de sécurité.")
    yield "import_export", None, ("Import / Export : modèles Excel à remplir (élèves, notes, absences, "
                                  "personnel), vérifiés ligne par ligne avant l'import.")


TUTORIELS = [
    ("01_Premiers pas", premiers_pas),
    ("02_Inscrire un élève", inscrire_eleve),
    ("03_Saisir les notes et imprimer les bulletins", notes_bulletins),
    ("04_Absences et demandes d'autorisation", absences),
    ("05_Fin d'année et passage", fin_annee),
    ("06_Sauvegarder ses données", sauvegardes),
]


def fabriquer(sortie: Path, garder_images: bool = False) -> list[Path]:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg est nécessaire pour assembler les vidéos.")
    out = []
    for nom, scenario in TUTORIELS:
        with tempfile.TemporaryDirectory() as tmp:
            st = Studio(Path(tmp))
            titre = nom.split("_", 1)[1]
            for cle, dlg, texte in scenario(st, titre):
                if cle:
                    st.page(cle)
                st.capture(texte, dlg)
            st.legendes(titre)
            if garder_images:
                dest = sortie / "images" / nom
                dest.mkdir(parents=True, exist_ok=True)
                for f in st.images:
                    shutil.copy(f, dest / f.name)
            out.append(st.video(sortie / f"{nom}.mp4"))
            st.w.timer_licence.stop()
            st.w.hide()
            st.w.deleteLater()
            QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)   # avant de fermer la base
            st.app.processEvents()
            st.db.close()
            print("vidéo :", out[-1])
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sortie", default=str(RACINE / "epp" / "resources" / "videos" / "tutoriels"))
    ap.add_argument("--images", action="store_true")
    a = ap.parse_args()
    fabriquer(Path(a.sortie), a.images)
