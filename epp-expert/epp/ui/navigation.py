"""Navigation de la fenêtre principale (modèle du prototype AKWA SCHOOL v6) : six volets dans une barre
latérale claire, onglets de chaque volet, recherche globale (Ctrl + K) et fiche de l'élève qui s'ouvre dans
un panneau à droite."""
from __future__ import annotations

from PySide6.QtCore import QEvent, QSize, Qt, QTimer, Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QPushButton,
                               QScrollArea, QVBoxLayout, QWidget)

from epp import APP_MARQUE, __version__
from epp.ui import animations, icones, theme
from epp.ui import logo as logo_app

# clé, libellé de l'onglet, raccourci, classe de la page, droit nécessaire pour la voir
PAGES = [
    ("tableau", "Tableau de bord", "", "tableau_bord:PageTableauBord", "eleves.lire"),
    ("eleves", "Élèves", "", "eleves:PageEleves", "eleves.lire"),
    ("inscriptions", "Inscriptions", "", "inscriptions:PageInscriptions", "eleves.lire"),
    ("classes", "Classes", "", "classes:PageClasses", "eleves.lire"),
    ("personnel", "Personnel", "", "personnel:PagePersonnel", "personnel.lire"),
    ("notes", "Saisie des notes", "", "notes:PageNotes", "notes.lire"),
    ("resultats", "Résultats, bulletins et fin d'année", "", "resultats:PageResultats", "notes.lire"),
    ("absences", "Absences et autorisations", "", "absences:PageAbsences", "absences.lire"),
    ("rapports", "Rapports officiels", "", "rapports:PageRapports", "rapports.generer"),
    ("generateur", "Générateur de rapports", "", "concepteur_rapports:PageConcepteurRapports", "rapports.generer"),
    ("statistiques", "Statistiques", "", "statistiques:PageStatistiques", "eleves.lire"),
    ("import_export", "Import et export", "", "import_export:PageImportExport", None),
    ("sauvegarde", "Sauvegarde", "", "sauvegarde:PageSauvegarde", "sauvegarde.creer"),
    ("parametres", "Paramètres", "", "parametres:PageParametres", None),
    ("aide", "Aide et tutoriels", "", "aide:PageAide", None),
]

# les volets du menu : clé, libellé, raccourci, icône, pages (onglets)
VOLETS = [
    ("accueil", "Tableau de bord", "Ctrl+1", "home", ["tableau"]),
    ("eleves_personnel", "Élèves & personnel", "Ctrl+2", "users", ["eleves", "inscriptions", "classes", "personnel"]),
    ("notes_bulletins", "Notes & bulletins", "Ctrl+3", "award", ["notes", "resultats"]),
    ("absences", "Absences", "Ctrl+4", "cal", ["absences"]),
    ("administration", "Rapports & administration", "Ctrl+5", "book",
     ["rapports", "generateur", "statistiques", "import_export", "sauvegarde"]),
    ("parametres", "Paramètres", "Ctrl+6", "set", ["parametres"]),
    ("aide", "Aide", "F1", "help", ["aide"]),
]

DESCRIPTIONS = {
    "eleves_personnel": "Élèves, inscriptions, classes et personnel de l'école",
    "notes_bulletins": "Saisie des notes, moyennes, classements, bulletins et passage en fin d'année",
    "administration": "Rapports officiels, générateur de rapports, statistiques, import, export et sauvegarde",
}


def info_page(cle: str) -> tuple | None:
    return next((p for p in PAGES if p[0] == cle), None)


def volet_de(cle_page: str) -> tuple | None:
    return next((v for v in VOLETS if cle_page in v[4]), None)


def info_volet(cle: str) -> tuple | None:
    return next((v for v in VOLETS if v[0] == cle), None)


# =================================================================== barre latérale
class BarreLaterale(QFrame):
    """Logo, volets (avec leurs onglets sous le volet ouvert), carte de l'école, version."""
    choisi = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setFixedWidth(250)
        v = QVBoxLayout(self)
        v.setContentsMargins(12, 16, 12, 12)
        v.setSpacing(2)
        tete = QHBoxLayout()
        tete.setContentsMargins(6, 0, 4, 14)
        tete.setSpacing(10)
        self.logo = QLabel()
        self.logo.setFixedSize(40, 40)
        self.logo.setPixmap(logo_app.pixmap("tuile", 40))
        tete.addWidget(self.logo)
        b = QVBoxLayout()
        b.setSpacing(0)
        m = QLabel(APP_MARQUE)
        m.setObjectName("marque")
        s = QLabel("Gestion scolaire EPP")
        s.setObjectName("marqueSous")
        b.addWidget(m)
        b.addWidget(s)
        tete.addLayout(b, 1)
        v.addLayout(tete)
        self.groupes: dict[str, QPushButton] = {}
        self.sous: dict[str, QPushButton] = {}
        self.blocs: dict[str, QWidget] = {}
        for cle, lib, rac, ic, pages in VOLETS:
            g = QPushButton(lib)
            g.setObjectName("navGroupe")
            g.setCheckable(True)
            g.setIcon(icones.icone(ic, theme.DISCRET, theme.PRIMAIRE))
            g.setIconSize(QSize(18, 18))
            g.setCursor(Qt.PointingHandCursor)
            g.setToolTip(f"{lib} ({rac})" if rac else lib)
            g.clicked.connect(lambda _=False, c=cle: self.choisi.emit(c))
            self.groupes[cle] = g
            v.addWidget(g)
            if len(pages) > 1:
                bloc = QWidget()
                bl = QVBoxLayout(bloc)
                bl.setContentsMargins(29, 2, 0, 8)
                bl.setSpacing(0)
                for p in pages:
                    sb = QPushButton(info_page(p)[1])
                    sb.setObjectName("navSous")
                    sb.setCheckable(True)
                    sb.setCursor(Qt.PointingHandCursor)
                    sb.clicked.connect(lambda _=False, c=p: self.choisi.emit(c))
                    self.sous[p] = sb
                    bl.addWidget(sb)
                bloc.hide()
                self.blocs[cle] = bloc
                v.addWidget(bloc)
        v.addStretch(1)
        self.carte = QFrame()
        self.carte.setObjectName("carteEcole")
        cl = QVBoxLayout(self.carte)
        cl.setContentsMargins(12, 10, 12, 10)
        cl.setSpacing(2)
        self.l_ecole = QLabel("")
        self.l_ecole.setObjectName("carteEcoleNom")
        self.l_ecole.setWordWrap(True)
        self.l_details = QLabel("")
        self.l_details.setWordWrap(True)
        self.l_utilisateur = QLabel("")
        self.l_utilisateur.setWordWrap(True)
        for w in (self.l_ecole, self.l_details, self.l_utilisateur):
            cl.addWidget(w)
        v.addWidget(self.carte)
        self.indicateur = animations.Indicateur(self)
        pied = QLabel(f"Version {__version__} · hors ligne")
        pied.setObjectName("sidebarPied")
        pied.setContentsMargins(6, 6, 0, 0)
        v.addWidget(pied)

    def marquer(self, volet: str, page: str) -> None:
        self._volet = volet
        for cle, g in self.groupes.items():
            g.setChecked(cle == volet)
        for cle, b in self.blocs.items():
            b.setVisible(cle == volet)
        for cle, b in self.sous.items():
            b.setChecked(cle == page)
        # le fond glisse vers le volet choisi, une fois la barre remise en page (sous-menu ouvert ou fermé)
        QTimer.singleShot(0, lambda: self.indicateur.aller(self.groupes.get(self._volet)))

    def resizeEvent(self, e):
        super().resizeEvent(e)
        if getattr(self, "_volet", None):
            QTimer.singleShot(0, lambda: self.indicateur.aller(self.groupes.get(self._volet)))


# =================================================================== recherche globale
class Recherche(QLineEdit):
    """Champ de recherche de la barre du haut ; la liste des résultats s'affiche dessous."""
    active = Signal(dict)

    def __init__(self, fournisseur, hote: QWidget):
        super().__init__()
        self.setObjectName("recherche")
        self.setPlaceholderText("Rechercher un élève, un agent, un écran…")
        self.setClearButtonEnabled(True)
        self.setMinimumWidth(320)
        self.addAction(icones.icone("search", theme.DISCRET), QLineEdit.LeadingPosition)
        self.fournisseur = fournisseur
        self.panneau = QFrame(hote)
        self.panneau.setObjectName("resultatsRecherche")
        pl = QVBoxLayout(self.panneau)
        pl.setContentsMargins(6, 6, 6, 6)
        self.liste = QListWidget()
        self.liste.setFocusPolicy(Qt.NoFocus)
        self.liste.itemClicked.connect(self._activer)
        pl.addWidget(self.liste)
        self.panneau.hide()
        self._delai = QTimer(self, singleShot=True, interval=180, timeout=self._chercher)
        self.textChanged.connect(lambda _: self._delai.start())
        self.installEventFilter(self)

    def resultats(self) -> list[dict]:
        return [self.liste.item(i).data(Qt.UserRole) for i in range(self.liste.count())]

    def _chercher(self):
        self.liste.clear()
        res = self.fournisseur(self.text()) if self.text().strip() else []
        if not res:
            self.panneau.hide()
            return
        for r in res:
            it = QListWidgetItem(f"{r['titre']}\n{r.get('detail', '')}")
            ic = {"eleve": "users", "personnel": "users", "ecran": "grid"}.get(r["type"], "chev")
            it.setIcon(icones.icone(ic, theme.PRIMAIRE))
            it.setData(Qt.UserRole, r)
            self.liste.addItem(it)
        self.liste.setCurrentRow(0)
        self.placer()
        self.panneau.show()
        self.panneau.raise_()

    def placer(self):
        hote = self.panneau.parentWidget()
        p = self.mapTo(hote, self.rect().bottomLeft())
        larg = max(self.width(), 380)
        haut = min(420, 16 + sum(max(44, self.liste.sizeHintForRow(i)) for i in range(self.liste.count())))
        self.panneau.setGeometry(min(p.x(), hote.width() - larg - 8), p.y() + 6, larg, haut)

    def _activer(self, it=None):
        it = it or self.liste.currentItem()
        if it is None:
            return
        r = it.data(Qt.UserRole)
        self.panneau.hide()
        self.clear()
        self.active.emit(r)

    def eventFilter(self, obj, e):
        if obj is self and e.type() == QEvent.KeyPress and self.panneau.isVisible():
            k = e.key()
            if k in (Qt.Key_Down, Qt.Key_Up):
                n = self.liste.count()
                self.liste.setCurrentRow((self.liste.currentRow() + (1 if k == Qt.Key_Down else -1)) % n)
                return True
            if k in (Qt.Key_Return, Qt.Key_Enter):
                self._activer()
                return True
            if k == Qt.Key_Escape:
                self.panneau.hide()
                return True
        if obj is self and e.type() == QEvent.FocusOut:
            QTimer.singleShot(150, self.panneau.hide)
        return super().eventFilter(obj, e)


# =================================================================== fiche de l'élève (panneau à droite)
class Tiroir(QFrame):
    """Fiche détaillée d'un élève : matricules, identité, parents, moyennes, absences, actions."""

    def __init__(self, hote: QWidget, fenetre):
        super().__init__(hote)
        self.setObjectName("tiroir")
        self.fenetre = fenetre
        self.ligne: dict | None = None
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        tete = QHBoxLayout()
        tete.setContentsMargins(18, 14, 10, 4)
        t = QLabel("Fiche de l'élève")
        t.setObjectName("titreCarte")
        tete.addWidget(t, 1)
        fermer = QPushButton()
        fermer.setIcon(icones.icone("x", theme.DISCRET))
        fermer.setFlat(True)
        fermer.setToolTip("Fermer (Échap)")
        fermer.setStyleSheet("border: none; padding: 4px;")
        fermer.clicked.connect(self.hide)
        tete.addWidget(fermer)
        v.addLayout(tete)
        zone = QScrollArea()
        zone.setWidgetResizable(True)
        zone.setFrameShape(QFrame.NoFrame)
        self.contenu = QWidget()
        self.contenu.setStyleSheet(f"background: {theme.CARTE};")
        self.lay = QVBoxLayout(self.contenu)
        self.lay.setContentsMargins(18, 4, 18, 18)
        self.lay.setSpacing(8)
        zone.setWidget(self.contenu)
        v.addWidget(zone, 1)
        bas = QHBoxLayout()
        bas.setContentsMargins(18, 8, 18, 14)
        self.b_ouvrir = QPushButton("Ouvrir dans Élèves")
        self.b_ouvrir.setProperty("role", "primaire")
        self.b_ouvrir.clicked.connect(self._ouvrir)
        self.b_fiche = QPushButton("Fiche scolaire")
        self.b_fiche.clicked.connect(self._fiche_scolaire)
        bas.addWidget(self.b_ouvrir)
        bas.addWidget(self.b_fiche)
        bas.addStretch(1)
        v.addLayout(bas)
        self.hide()

    def placer(self):
        h = self.parentWidget()
        larg = min(400, max(320, h.width() // 3))
        self.setGeometry(h.width() - larg, 0, larg, h.height())

    def _vider(self):
        while self.lay.count():
            it = self.lay.takeAt(0)
            if it.widget():
                it.widget().deleteLater()
            elif it.layout():
                while it.layout().count():
                    w = it.layout().takeAt(0).widget()
                    if w:
                        w.deleteLater()

    def _section(self, titre: str, lignes: list[tuple[str, object]]) -> None:
        t = QLabel(titre.upper())
        t.setStyleSheet(f"color: {theme.DISCRET}; font-size: 8pt; font-weight: 700; letter-spacing: 1px; "
                        "margin-top: 8px;")
        self.lay.addWidget(t)
        for k, val in lignes:
            h = QHBoxLayout()
            a = QLabel(k)
            a.setStyleSheet(f"color: {theme.DISCRET};")
            b = QLabel(str(val) if val not in (None, "") else "–")
            b.setWordWrap(True)
            b.setStyleSheet("font-weight: 600;")
            b.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            h.addWidget(a)
            h.addWidget(b, 1)
            self.lay.addLayout(h)

    def ouvrir(self, inscription_id: int) -> None:
        from epp.domain import calculs, repo, resultats
        ctx = self.fenetre.ctx
        a = ctx.annee
        r = next((x for x in repo.inscriptions(ctx.db, a) if x["inscription_id"] == inscription_id), None) if a \
            else None
        if r is None:
            return
        self.ligne = r
        self._vider()
        tete = QHBoxLayout()
        photo = QLabel()
        photo.setFixedSize(68, 82)
        photo.setAlignment(Qt.AlignCenter)
        data = repo.get_photo(ctx.db, "eleve", r["eleve_id"])
        from PySide6.QtGui import QPixmap
        pm = QPixmap()
        if data and pm.loadFromData(data):
            photo.setPixmap(pm.scaled(64, 78, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            initiales = "".join(m[0] for m in (r["nom"] or "?").split()[:2]).upper()
            photo.setText(initiales)
            photo.setStyleSheet(f"background: {theme.PRIMAIRE_PALE}; color: {theme.PRIMAIRE}; border-radius: 16px; "
                                "font-size: 18pt; font-weight: 800;")
        tete.addWidget(photo)
        b = QVBoxLayout()
        nom = QLabel(r["nom"])
        nom.setObjectName("tiroirNom")
        nom.setWordWrap(True)
        b.addWidget(nom)
        sous = QLabel(f"{r['classe']} · {'Fille' if r['sexe'] == 'F' else 'Garçon'}"
                      + (f" · {r['age']} ans" if r.get("age") is not None else "") + f" · {r['statut'].capitalize()}")
        sous.setStyleSheet(f"color: {theme.DISCRET};")
        b.addWidget(sous)
        b.addStretch(1)
        tete.addLayout(b, 1)
        self.lay.addLayout(tete)
        dn = calculs.to_date(r.get("date_naissance"))
        self._section("Matricules", [("Matricule école", r["matricule_ecole"]),
                                     ("Matricule DESPS", r.get("matricule_desps"))])
        self._section("Identité", [("Né(e) le", dn.strftime("%d/%m/%Y") if dn else ""),
                                   ("à", r.get("localite")), ("Nationalité", r.get("nationalite")),
                                   ("Extrait de naissance", r.get("extrait")),
                                   ("Groupe sanguin", r.get("groupe_sanguin"))])
        par = []
        for qui, t in (("pere", "Père"), ("mere", "Mère"), ("tuteur", "Tuteur")):
            if r.get(f"{qui}_nom"):
                prof = r.get(f"{qui}_profession")
                par.append((t, r[f"{qui}_nom"] + (f" ({prof})" if prof else "")))
                if r.get(f"{qui}_tel"):
                    par.append(("   Contact", r[f"{qui}_tel"]))
        self._section("Parents", par or [("Parents", "")])
        moys = resultats.moyennes_par_evaluation(ctx.db, a).get(inscription_id, {})
        cl = next((c for c in a.classes if c.code == r["classe"]), None)
        cal = cl.calendrier if cl else "STD"
        lignes = []
        for n in a.eval_nums():
            m = (moys.get(n) or {}).get("moyenne")
            if m is not None or (moys.get(n) or {}).get("saisie"):
                lignes.append((a.libelle_evaluation(cal, n),
                               "–" if m is None else f"{m:.2f}".replace(".", ",") + f" / {cl.bareme:g}" if cl else ""))
        self._section("Moyennes", lignes or [("Moyennes", "aucune note saisie")])
        nb = ctx.db.query("SELECT nature, COUNT(*) AS n, IFNULL(SUM(jours),0) AS j FROM absence_eleve "
                          "WHERE inscription_id=? GROUP BY nature", (inscription_id,))
        d = {x["nature"]: x for x in nb}
        self._section("Assiduité", [("Absences", f"{d['ABSENCE']['n']} ({d['ABSENCE']['j']:g} j)"
                                     if "ABSENCE" in d else "0"),
                                    ("Retards", d["RETARD"]["n"] if "RETARD" in d else 0)])
        self.lay.addStretch(1)
        self.b_fiche.setEnabled(ctx.peut("rapports.generer"))
        self.placer()
        self.show()
        self.raise_()

    def _ouvrir(self):
        r = self.ligne
        p = self.fenetre.page("eleves")
        if r and p:
            p.recherche.clear()
            p.classe.setCurrentIndex(0)
            p.statut.setCurrentIndex(0)
            p.rafraichir()
            p.table.selectionner(lambda x: x["inscription_id"] == r["inscription_id"])
        self.hide()

    def _fiche_scolaire(self):
        r = self.ligne
        if not r:
            return
        from epp.ui.dialogs.export import exporter_rapport
        exporter_rapport(self.fenetre, "FICHE_SCOLAIRE", {"classe": r["classe"], "eleve": r["inscription_id"]},
                         f"Fiche scolaire {r['nom']} {self.fenetre.ctx.annee.libelle}")
