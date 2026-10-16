"""Fenêtre principale et démarrage de l'interface.

Ordre au lancement : licence (si elle n'est pas valable, seul l'écran d'activation est accessible et
aucune donnée n'est consultable), premier lancement ou connexion, mot de passe provisoire à changer,
sauvegarde automatique, puis la fenêtre principale.
"""
from __future__ import annotations

import importlib
import logging
import sys

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QKeySequence, QPalette, QShortcut
from PySide6.QtWidgets import (QApplication, QComboBox, QFrame, QHBoxLayout, QLabel, QMainWindow, QMenu, QMessageBox,
                               QScrollArea, QStackedWidget, QTabWidget, QToolButton, QVBoxLayout, QWidget)

from epp import APP_NAME, __version__
from epp.core import backup, licence, security
from epp.core.db import open_database
from epp.domain import repo
from epp.ui import logo as logo_app
from epp.ui import theme
from epp.ui.navigation import (PAGES, PAGES_ECOLE, VOLETS, BarreLaterale, Recherche, Tiroir, info_page, info_volet,  # noqa: F401
                               volet_de)
from epp.ui.dialogs.acces import (DialogueActivation, DialogueConnexion, DialogueMotDePasse,
                                  DialoguePremierLancement)
from epp.ui.synchro import PARAM_AUTO, GestionSynchro
from epp.ui.widgets import Contexte, afficher_erreur, bouton, info

log = logging.getLogger(__name__)

# Rapports et administration : un volet, dont chaque page est un onglet
ADMINISTRATION = "administration"
ADMIN_VOLETS = info_volet(ADMINISTRATION)[4]

VERIF_LICENCE_MS = 15 * 60 * 1000
# parties de la page « Import, export & sauvegarde » (modèle v8), ouvertes par leur ancienne clé
PARTIES_DONNEES = {"sauvegarde": 0, "import_export": 1}


def classe_page(chemin: str):
    mod, cls = chemin.split(":")
    return getattr(importlib.import_module(f"epp.ui.pages.{mod}"), cls)


class FenetrePrincipale(QMainWindow):
    """Barre latérale (six volets), barre du haut (fil d'Ariane, recherche, année, compte), volets à onglets,
    fiche de l'élève dans un panneau à droite."""

    def __init__(self, ctx: Contexte):
        super().__init__()
        self.ctx = ctx
        self.action_fin: str | None = None          # « deconnexion », « reconnexion » ou None (quitter)
        self.setWindowTitle(APP_NAME)
        self.resize(1360, 820)
        self.setMinimumSize(1080, 660)
        self.pages: dict[str, QWidget] = {}
        self.zones: dict[str, QScrollArea] = {}
        self.volets: dict[str, QTabWidget] = {}      # volets à plusieurs onglets, créés à la première ouverture
        self._hotes: dict[str, QWidget] = {}
        self._dernier: dict[str, str] = {}           # dernier onglet ouvert de chaque volet
        self.volet_courant: str | None = None
        self.page_courante: str | None = None
        central = QWidget()
        self.setCentralWidget(central)
        h = QHBoxLayout(central)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)
        self.barre = BarreLaterale()
        self.barre.choisi.connect(self.aller)
        self.logo = self.barre.logo
        h.addWidget(self.barre)
        droite = QVBoxLayout()
        droite.setSpacing(0)
        droite.addWidget(self._barre_haute())
        self.bandeau_essai = self._bandeau("bandeauEssai")
        self.bandeau_archive = self._bandeau("bandeauArchive")
        droite.addWidget(self.bandeau_essai)
        droite.addWidget(self.bandeau_archive)
        self.contenu = QWidget()
        self.contenu.setObjectName("contenu")
        cv = QVBoxLayout(self.contenu)
        cv.setContentsMargins(0, 0, 0, 0)
        self.pile = QStackedWidget()
        cv.addWidget(self.pile)
        droite.addWidget(self.contenu, 1)
        h.addLayout(droite, 1)
        self.tiroir = Tiroir(self.contenu, self)
        self.recherche.panneau.setParent(central)
        self.recherche.panneau.hide()
        for cle, _, rac, _, _ in VOLETS:
            if rac:
                QShortcut(QKeySequence(rac), self, activated=lambda c=cle: self.aller(c))
        QShortcut(QKeySequence("Ctrl+K"), self, activated=self._focus_recherche)
        QShortcut(QKeySequence("Escape"), self, activated=self._echap)
        ctx.annee_changee.connect(self._maj_entete)
        ctx.donnees_modifiees.connect(lambda q: q == "annees" and self._remplir_annees())
        ctx.donnees_modifiees.connect(lambda q: q == "parametres" and self._maj_entete())
        self._remplir_annees()
        self._maj_licence()
        self._maj_entete()
        self._maj_menu()
        self.synchro = GestionSynchro(ctx, self)
        if ctx.db.get_param(PARAM_AUTO) == "1":
            try:
                self.synchro.demarrer()
            except OSError:
                log.exception("Synchronisation des téléphones : démarrage automatique impossible")
        self.aller("accueil" if self._volet_permis("accueil") else "notes_bulletins")
        QTimer.singleShot(600, self._messages_recus)
        self.timer_licence = QTimer(self)
        self.timer_licence.timeout.connect(self.verifier_licence)
        self.timer_licence.start(VERIF_LICENCE_MS)

    # ------------------------------------------------------------------ construction
    def _barre_haute(self) -> QWidget:
        w = QFrame()
        w.setObjectName("barre")
        w.setFixedHeight(58)
        h = QHBoxLayout(w)
        h.setContentsMargins(22, 8, 16, 8)
        h.setSpacing(10)
        self.fil = QLabel("")
        self.fil.setObjectName("fil")
        h.addWidget(self.fil)
        h.addStretch(1)
        self.recherche = Recherche(self._resultats_recherche, self)
        self.recherche.setToolTip("Recherche globale (Ctrl + K)")
        self.recherche.active.connect(self._ouvrir_resultat)
        h.addWidget(self.recherche)
        self.annees = QComboBox()
        self.annees.setMinimumWidth(170)
        self.annees.setToolTip("Année scolaire affichée")
        self.annees.activated.connect(self._choisir_annee)
        h.addWidget(self.annees)
        self.badge = QLabel("")
        self.badge.setObjectName("badgeLicence")
        h.addWidget(self.badge)
        self.b_compte = QToolButton()
        self.b_compte.setObjectName("compte")
        self.b_compte.setPopupMode(QToolButton.InstantPopup)
        menu = QMenu(self.b_compte)
        menu.addAction("Changer mon mot de passe", self._mot_de_passe)
        menu.addAction("Licence et activation", self._licence)
        menu.addSeparator()
        menu.addAction("Se déconnecter", self._deconnexion)
        menu.addAction("Quitter", self.close)
        self.b_compte.setMenu(menu)
        h.addWidget(self.b_compte)
        return w

    def _bandeau(self, nom: str) -> QFrame:
        f = QFrame()
        f.setObjectName(nom)
        h = QHBoxLayout(f)
        h.setContentsMargins(20, 6, 16, 6)
        f.texte = QLabel("")
        f.texte.setWordWrap(True)
        h.addWidget(f.texte, 1)
        if nom == "bandeauEssai":
            h.addWidget(bouton("Activer maintenant", self._licence, "accent"))
        f.hide()
        return f

    def resizeEvent(self, e):
        super().resizeEvent(e)
        if self.tiroir.isVisible():
            self.tiroir.placer()
        if self.recherche.panneau.isVisible():
            self.recherche.placer()

    # ------------------------------------------------------------------ navigation
    def _permis(self, cle: str) -> bool:
        p = info_page(cle)
        if p and self.ctx.session and self.ctx.session.restreint and cle in PAGES_ECOLE:
            return False
        return bool(p) and (not p[4] or self.ctx.peut(p[4]))

    def _volet_permis(self, cle: str) -> bool:
        v = info_volet(cle)
        return bool(v) and any(self._permis(p) for p in v[4])

    def _maj_menu(self) -> None:
        for cle, *_ in VOLETS:
            self.barre.groupes[cle].setHidden(not self._volet_permis(cle))
        for cle, b in self.barre.sous.items():
            b.setHidden(not self._permis(cle))
        for cle, t in self.volets.items():
            for i, p in enumerate(info_volet(cle)[4]):
                t.setTabVisible(i, self._permis(p))

    @property
    def onglets_admin(self) -> QTabWidget | None:
        return self.volets.get(ADMINISTRATION)

    def _volet(self, cle: str) -> QTabWidget:
        """Volet à plusieurs onglets : un onglet par page, la page étant créée à sa première ouverture."""
        if cle not in self.volets:
            t = QTabWidget()
            t.setObjectName("ongletsAdmin" if cle == ADMINISTRATION else "volet")
            t.setDocumentMode(True)
            t.blockSignals(True)
            pages = info_volet(cle)[4]
            for k in pages:
                hote = QWidget()
                lay = QVBoxLayout(hote)
                lay.setContentsMargins(0, 0, 0, 0)
                t.addTab(hote, info_page(k)[1])
                self._hotes[k] = hote
            t.blockSignals(False)
            t.currentChanged.connect(lambda i, ps=pages: 0 <= i < len(ps) and self.aller(ps[i]))
            self.pile.addWidget(t)
            self.volets[cle] = t
            self._maj_menu()
        return self.volets[cle]

    def _creer_page(self, cle: str) -> bool:
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            page = classe_page(info_page(cle)[3])(self.ctx)
        except Exception as e:     # noqa: BLE001
            QApplication.restoreOverrideCursor()
            afficher_erreur(self, e, "Ouverture de la page impossible")
            return False
        QApplication.restoreOverrideCursor()
        page.fenetre = self
        self.pages[cle] = page
        zone = QScrollArea()        # petits écrans (1366 × 768) : la page défile au lieu d'être coupée
        zone.setWidgetResizable(True)
        zone.setFrameShape(QFrame.NoFrame)
        zone.setWidget(page)
        self.zones[cle] = zone
        v = volet_de(cle)
        if len(v[4]) > 1:
            self._volet(v[0])
            self._hotes[cle].layout().addWidget(zone)
        else:
            self.pile.addWidget(zone)
        return True

    def _messages_recus(self) -> None:
        """Messages du directeur pas encore lus (comptes enseignants) : affichés puis marqués lus."""
        from epp.domain import enseignants
        s = self.ctx.session
        if not s or not s.user_id:
            return
        try:
            nouveaux = [m for m in enseignants.messages_pour(self.ctx.db, s) if not m["lu"]]
        except Exception:      # noqa: BLE001 - ne bloque jamais l'ouverture
            log.exception("Messages du directeur illisibles")
            return
        if not nouveaux:
            return
        texte = "\n\n".join(f"{m['titre']} ({m['auteur']}, {m['cree_le'][:16]})\n{m['texte']}" for m in reversed(nouveaux))
        info(self, "Messages du directeur", texte)
        for m in nouveaux:
            enseignants.marquer_lu(self.ctx.db, s, m["id"])

    def aller(self, cle: str) -> None:
        """Ouvre une page (clé de PAGES) ou un volet (clé de VOLETS : son dernier onglet ouvert)."""
        if cle in PARTIES_DONNEES:
            self.aller("donnees")
            p = self.pages.get("donnees")
            partie = p.partie(cle) if p else None
            if partie is not None:
                p.onglets.setCurrentWidget(partie)
            return
        if not info_page(cle):
            v = info_volet(cle)
            if not v:
                return
            dernier = self._dernier.get(cle)
            cle = dernier if dernier and self._permis(dernier) else next((p for p in v[4] if self._permis(p)), "")
            if not cle:
                return
        if not self._permis(cle):
            return
        v = volet_de(cle)
        if cle not in self.pages and not self._creer_page(cle):
            return
        if len(v[4]) > 1:
            t = self._volet(v[0])
            t.blockSignals(True)
            t.setCurrentIndex(v[4].index(cle))
            t.blockSignals(False)
            self.pile.setCurrentWidget(t)
        else:
            self.pile.setCurrentWidget(self.zones[cle])
        self._dernier[v[0]] = cle
        self.volet_courant, self.page_courante = v[0], cle
        self.barre.marquer(v[0], cle)
        self.fil.setText(f"<b>{v[1]}</b>" if len(v[4]) == 1 else
                         f"{v[1]}  ›  <b>{info_page(cle)[1]}</b>")
        self.tiroir.hide()

    def page_affichee(self) -> QWidget | None:
        """Page actuellement à l'écran (y compris dans un onglet de volet)."""
        return self.pages.get(self.page_courante) if self.page_courante else None

    def page(self, cle: str):
        self.aller(cle)
        if cle in PARTIES_DONNEES:
            return self.pages["donnees"].partie(cle) if "donnees" in self.pages else None
        return self.pages.get(cle)

    # ------------------------------------------------------------------ recherche et fiche
    def _focus_recherche(self):
        self.recherche.setFocus()
        self.recherche.selectAll()

    def _echap(self):
        if self.recherche.panneau.isVisible():
            self.recherche.panneau.hide()
        elif self.tiroir.isVisible():
            self.tiroir.hide()

    def _resultats_recherche(self, texte: str) -> list[dict]:
        from epp.domain import accueil
        t = texte.strip().lower()
        out = []
        for cle, lib, _, _, perm in PAGES:
            v = volet_de(cle)
            if self._permis(cle) and (t in lib.lower() or t in v[1].lower()):
                out.append({"type": "ecran", "titre": lib, "cle": cle,
                            "detail": f"Écran · {v[1]}" if len(v[4]) > 1 else "Écran"})
        try:
            if self.ctx.peut("eleves.lire") or self.ctx.peut("personnel.lire"):
                for r in accueil.rechercher(self.ctx.db, self.ctx.annee, texte):
                    s = self.ctx.session
                    if s.restreint and r["type"] == "eleve" and not s.voit_classe(
                            self.ctx.annee.id if self.ctx.annee else None, r.get("classe")):
                        continue
                    if self.ctx.peut("eleves.lire" if r["type"] == "eleve" else "personnel.lire"):
                        out.append(r)
        except Exception:      # noqa: BLE001 - la recherche ne doit jamais bloquer la saisie
            log.exception("Recherche impossible")
        return out[:14]

    def _ouvrir_resultat(self, r: dict) -> None:
        if r["type"] == "ecran":
            self.aller(r["cle"])
        elif r["type"] == "eleve":
            self.ouvrir_fiche(r["inscription_id"])
        elif r["type"] == "personnel":
            p = self.page("personnel")
            if p is not None and hasattr(p, "table"):
                p.table.selectionner(lambda x: x.get("id") == r["id"])

    def ouvrir_fiche(self, inscription_id: int) -> None:
        """Fiche de l'élève dans le panneau de droite (recherche, tableau de bord)."""
        try:
            self.tiroir.ouvrir(inscription_id)
        except Exception as e:     # noqa: BLE001
            afficher_erreur(self, e, "Fiche de l'élève")

    # ------------------------------------------------------------------ en-tête
    def _remplir_annees(self) -> None:
        self.annees.blockSignals(True)
        self.annees.clear()
        for a in repo.list_annees(self.ctx.db):
            t = a["libelle"] + (" (en cours)" if a["active"] else "") + (" – clôturée" if a["cloturee"] else "")
            self.annees.addItem(t, a["id"])
        if self.ctx.annee:
            self.annees.setCurrentIndex(max(0, self.annees.findData(self.ctx.annee.id)))
        self.annees.blockSignals(False)

    def _choisir_annee(self, i: int) -> None:
        aid = self.annees.itemData(i)
        if aid and (not self.ctx.annee or aid != self.ctx.annee.id):
            self.ctx.recharger_annee(aid)

    def _maj_entete(self) -> None:
        db, s = self.ctx.db, self.ctx.session
        b = self.barre
        b.l_ecole.setText(db.get_param("ecole_nom") or "École à renseigner")
        a = self.ctx.annee
        b.l_details.setText(" · ".join(x for x in (db.get_param("iepp") or "",
                                                     f"Année {a.libelle}" if a else "") if x))
        b.l_utilisateur.setText(f"{s.nom} · {s.role_libelle}")
        self.b_compte.setText(f"{s.nom}  ▾")
        self._remplir_annees()
        if a and a.cloturee:
            self.bandeau_archive.texte.setText(
                f"Année {a.libelle} clôturée : consultation et impression uniquement (archive en lecture seule).")
            self.bandeau_archive.show()
        else:
            self.bandeau_archive.hide()

    def _maj_licence(self) -> None:
        e = self.ctx.licence or licence.etat()
        if e.statut == "essai":
            self.badge.setText(f"Essai : {e.jours_restants} j")
            self.badge.setStyleSheet(f"background: #F6ECDD; color: {theme.ALERTE};")
            self.bandeau_essai.texte.setText(
                f"Version d'essai : {e.jours_restants} jour(s) restant(s). À la fin de l'essai, l'application et "
                "les données ne sont plus accessibles tant qu'un code d'activation n'est pas saisi.")
            self.bandeau_essai.show()
        else:
            self.badge.setText("Licence à vie" if e.type == "vie" else
                               f"Licence jusqu'au {e.expire_le:%d/%m/%Y}" if e.expire_le else "Licence active")
            self.badge.setStyleSheet(f"background: #E1F0E8; color: {theme.SUCCES};")
            self.bandeau_essai.hide()

    # ------------------------------------------------------------------ actions du compte
    def _mot_de_passe(self):
        DialogueMotDePasse(self.ctx.db, self.ctx.session, parent=self).exec()

    def _licence(self):
        d = DialogueActivation(self.ctx.db, bloquant=False, parent=self)
        if d.exec():
            self.ctx.licence = licence.etat()
            self._maj_licence()

    def _deconnexion(self):
        security.log(self.ctx.db, self.ctx.session.login, "DECONNEXION", "utilisateur", self.ctx.session.login)
        self.action_fin = "deconnexion"
        self.close()

    def reconnexion(self, db) -> None:
        """Après une restauration : la base a changé, il faut se reconnecter."""
        self.ctx.db = db
        self.action_fin = "reconnexion"
        self.close()

    def verifier_licence(self) -> None:
        e = licence.etat()
        self.ctx.licence = e
        if not licence.verrouillee(e):
            self._maj_licence()
            return
        # licence échue pendant l'utilisation : plus aucune donnée visible
        self.hide()
        d = DialogueActivation(self.ctx.db, bloquant=True)
        if d.exec() and not licence.verrouillee(licence.etat()):
            self.ctx.licence = licence.etat()
            self._maj_licence()
            self.show()
        else:
            self.action_fin = None
            self.close()

    def closeEvent(self, e):
        try:
            backup.sauvegarde_periodique(self.ctx.db)
        except Exception:      # noqa: BLE001 - ne bloque pas la fermeture
            log.exception("Sauvegarde automatique à la fermeture impossible")
        self.timer_licence.stop()
        self.synchro.arreter()
        super().closeEvent(e)
        QApplication.instance().quit()


# =================================================================== démarrage
def appliquer_theme(app: QApplication) -> None:
    app.setStyle("Fusion")
    pal = app.palette()
    pal.setColor(QPalette.Window, QColor(theme.FOND))
    pal.setColor(QPalette.Base, QColor(theme.CARTE))
    pal.setColor(QPalette.Text, QColor(theme.TEXTE))
    pal.setColor(QPalette.WindowText, QColor(theme.TEXTE))
    pal.setColor(QPalette.Highlight, QColor("#D9EADF"))
    pal.setColor(QPalette.HighlightedText, QColor(theme.TEXTE))
    pal.setColor(QPalette.Button, QColor(theme.CARTE))
    pal.setColor(QPalette.ButtonText, QColor(theme.TEXTE))
    app.setPalette(pal)
    app.setStyleSheet(theme.QSS)


def verifier_acces_licence(db) -> licence.Etat | None:
    """Tant que la licence n'est pas valable, seul l'écran d'activation s'affiche. None = l'utilisateur quitte."""
    while True:
        e = licence.etat()
        if not licence.verrouillee(e):
            return e
        if not DialogueActivation(db, bloquant=True).exec():
            return None


def ouvrir_session(db) -> security.Session | None:
    if not security.has_users(db):
        d = DialoguePremierLancement(db)
        if not d.exec():
            return None
        if d.resume:
            QMessageBox.information(None, "Configuration terminée", d.resume)
        return d.session
    d = DialogueConnexion(db, licence.etat())
    if not d.exec():
        return None
    s = d.session
    if security.doit_changer(db, s.user_id):
        if not DialogueMotDePasse(db, s, ancien_connu=d.mot_de_passe).exec():
            return None
    return s


def run(argv: list[str]) -> int:
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication.instance() or QApplication(argv)
    app.setApplicationName(APP_NAME)
    app.setWindowIcon(logo_app.icone())
    app.setApplicationVersion(__version__)
    app.setOrganizationName("GestionScolaireEPP")
    app.setQuitOnLastWindowClosed(False)          # la fenêtre principale décide (verrouillage, déconnexion)
    appliquer_theme(app)
    from epp.ui import animations
    app._survol = animations.installer(app)
    try:
        db = open_database()
    except Exception as e:     # noqa: BLE001
        log.exception("Ouverture de la base impossible")
        QMessageBox.critical(None, APP_NAME, f"La base de données ne peut pas être ouverte :\n{e}\n\n"
                                             "Restaurez une sauvegarde ou contactez l'assistance.")
        return 1
    code = 0
    try:
        while True:
            etat = verifier_acces_licence(db)
            if etat is None:
                break
            s = ouvrir_session(db)
            if s is None:
                break
            try:
                backup.sauvegarde_periodique(db)
            except Exception:      # noqa: BLE001
                log.exception("Sauvegarde automatique impossible")
            ctx = Contexte(db, licence.restreindre(s, etat), None, etat)
            aid = repo.active_annee_id(db)
            ctx.annee = repo.load_annee(db, aid) if aid else None
            win = FenetrePrincipale(ctx)
            win.show()
            app.exec()
            db = ctx.db
            if win.action_fin not in ("deconnexion", "reconnexion"):
                break
    finally:
        try:
            db.close()
        except Exception:      # noqa: BLE001
            pass
    return code


if __name__ == "__main__":
    sys.exit(run(sys.argv))
