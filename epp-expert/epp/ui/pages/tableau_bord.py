"""Tableau de bord (modèle du prototype AKWA SCHOOL v6) : bandeau d'accueil avec actions rapides,
indicateurs cliquables, effectifs par classe (garçons / filles), liste « À faire », résultats de l'évaluation
en cours, absences des derniers jours de classe, premiers de classe, agenda et activité récente.
Chaque élément mène à l'écran qui permet d'agir."""
from __future__ import annotations

from datetime import date, datetime

from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QFrame, QGridLayout, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from epp.domain import accueil, calculs
from epp.ui import icones, theme
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, label

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
        "novembre", "décembre"]
MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def _pct(v) -> str:
    return "–" if v is None else f"{round(v * 100)}"


def _nb(v, d=2) -> str:
    return "–" if v is None else f"{v:.{d}f}".replace(".", ",")


def _vider(lay) -> None:
    while lay.count():
        it = lay.takeAt(0)
        if it.widget():
            it.widget().deleteLater()
        elif it.layout():
            _vider(it.layout())


# =================================================================== éléments dessinés
class Repartition(QWidget):
    """Barre fine garçons / filles sous un indicateur."""

    def __init__(self):
        super().__init__()
        self.setFixedHeight(8)
        self.valeurs: list[tuple[float, str]] = []

    def set(self, valeurs):
        self.valeurs = [(v, c) for v, c in valeurs if v]
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        tot = sum(v for v, _ in self.valeurs)
        if not tot:
            p.setBrush(QColor(theme.CREUX))
            p.setPen(Qt.NoPen)
            p.drawRoundedRect(QRectF(0, 1, self.width(), 6), 3, 3)
            return
        x, larg = 0.0, self.width() - 2 * (len(self.valeurs) - 1)
        for v, c in self.valeurs:
            w = larg * v / tot
            p.setBrush(QColor(c))
            p.setPen(Qt.NoPen)
            p.drawRoundedRect(QRectF(x, 1, w, 6), 3, 3)
            x += w + 2


class Kpi(QFrame):
    """Indicateur cliquable : libellé avec icône, valeur, précision, barre facultative."""
    clic = Signal()

    def __init__(self, icone: str, titre: str):
        super().__init__()
        self.setObjectName("kpi")
        self.setCursor(Qt.PointingHandCursor)
        v = QVBoxLayout(self)
        v.setContentsMargins(16, 14, 16, 14)
        v.setSpacing(2)
        h = QHBoxLayout()
        h.setSpacing(7)
        ic = QLabel()
        ic.setPixmap(icones.pixmap(icone, theme.PRIMAIRE, 16))
        h.addWidget(ic)
        self.titre = QLabel(titre)
        self.titre.setObjectName("kpiTitre")
        h.addWidget(self.titre, 1)
        fl = QLabel()
        fl.setPixmap(icones.pixmap("chev", theme.DISCRET, 14))
        h.addWidget(fl)
        v.addLayout(h)
        self.valeur = QLabel("–")
        self.valeur.setObjectName("kpiValeur")
        self.valeur.setTextFormat(Qt.RichText)
        v.addWidget(self.valeur)
        self.note = label("", discret=True, wrap=True)
        v.addWidget(self.note)
        self.barre = Repartition()
        self.barre.hide()
        v.addWidget(self.barre)
        v.addStretch(1)

    def set(self, valeur: str, note: str = "", unite: str = "") -> None:
        self.valeur.setText(valeur + (f"<span style='font-size:11pt; color:{theme.DISCRET}'> {unite}</span>"
                                      if unite else ""))
        self.note.setText(note)

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.LeftButton and self.rect().contains(e.position().toPoint()):
            self.clic.emit()
        super().mouseReleaseEvent(e)


class BarresClasses(QWidget):
    """Une ligne par classe : libellé, barre (segments ou jauge avec seuil), valeur ; ligne cliquable."""
    clic = Signal(str)
    HAUT = 30

    def __init__(self, larg_valeur: int = 90):
        super().__init__()
        self.lignes: list[dict] = []
        self.larg_valeur = larg_valeur
        self.setMouseTracking(True)
        self.survol = -1

    def set(self, lignes: list[dict]) -> None:
        """lignes : {cle, libelle, segments: [(valeur, couleur)], jauge: (valeur, max, seuil) ou None,
        texte, aide}"""
        self.lignes = lignes
        self.setMinimumHeight(self.HAUT * max(1, len(lignes)))
        self.update()

    def _ligne(self, y) -> int:
        i = int(y // self.HAUT)
        return i if 0 <= i < len(self.lignes) else -1

    def mouseMoveEvent(self, e):
        i = self._ligne(e.position().y())
        if i != self.survol:
            self.survol = i
            self.setCursor(Qt.PointingHandCursor if i >= 0 else Qt.ArrowCursor)
            self.setToolTip(self.lignes[i].get("aide", "") if i >= 0 else "")
            self.update()

    def leaveEvent(self, e):
        self.survol = -1
        self.update()

    def mouseReleaseEvent(self, e):
        i = self._ligne(e.position().y())
        if i >= 0:
            self.clic.emit(self.lignes[i]["cle"])

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        if not self.lignes:
            p.setPen(QColor(theme.DISCRET))
            p.drawText(self.rect(), Qt.AlignCenter, "Aucune donnée")
            return
        vmax = max([sum(v for v, _ in l.get("segments") or []) for l in self.lignes] + [1])
        x0, x1 = 50, w - self.larg_valeur - 8
        f = QFont(self.font())
        for i, l in enumerate(self.lignes):
            y = i * self.HAUT
            if i == self.survol:
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(theme.CREUX))
                p.drawRoundedRect(QRectF(0, y + 1, w, self.HAUT - 2), 8, 8)
            f.setBold(True)
            p.setFont(f)
            p.setPen(QColor(theme.TEXTE))
            p.drawText(QRectF(8, y, 44, self.HAUT), Qt.AlignVCenter, l["libelle"])
            f.setBold(False)
            p.setFont(f)
            yb = y + (self.HAUT - 14) / 2
            if l.get("jauge"):
                val, mx, seuil = l["jauge"]
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(theme.CREUX))
                p.drawRoundedRect(QRectF(x0, yb, x1 - x0, 14), 4, 4)
                if val is not None and mx:
                    p.setBrush(QColor(theme.PRIMAIRE))
                    p.drawRoundedRect(QRectF(x0, yb, (x1 - x0) * min(1, val / mx), 14), 4, 4)
                if seuil and mx:
                    xs = x0 + (x1 - x0) * seuil / mx
                    p.setPen(QPen(QColor(theme.DISCRET), 1.5, Qt.DashLine))
                    p.drawLine(int(xs), int(yb - 3), int(xs), int(yb + 17))
            else:
                segs = [(v, c) for v, c in l.get("segments") or [] if v]
                tot = sum(v for v, _ in segs)
                x, larg = float(x0), (x1 - x0) * tot / vmax
                for v, c in segs:
                    sw = larg * v / tot - 2
                    p.setPen(Qt.NoPen)
                    p.setBrush(QColor(c))
                    p.drawRoundedRect(QRectF(x, yb, max(2, sw), 14), 3, 3)
                    x += sw + 2
            p.setPen(QColor(theme.DISCRET))
            p.drawText(QRectF(x1 + 6, y, self.larg_valeur, self.HAUT), Qt.AlignVCenter | Qt.AlignRight, l["texte"])


class Colonnes(QWidget):
    """Absences des derniers jours de classe : colonnes empilées (justifiées / non justifiées)."""
    clic = Signal(str)

    def __init__(self):
        super().__init__()
        self.jours: list[dict] = []
        self.setMinimumHeight(170)
        self.setMouseTracking(True)

    def set(self, jours):
        self.jours = jours
        self.update()

    def _jour(self, x) -> int:
        n = len(self.jours)
        if not n:
            return -1
        i = int(x // (self.width() / n))
        return i if 0 <= i < n else -1

    def mouseMoveEvent(self, e):
        i = self._jour(e.position().x())
        if i >= 0:
            j = self.jours[i]
            self.setToolTip(f"{j['jour']} {j['num']} : {j['non_justifiees']} absence(s) non justifiée(s), "
                            f"{j['justifiees']} justifiée(s)")
            self.setCursor(Qt.PointingHandCursor)

    def mouseReleaseEvent(self, e):
        i = self._jour(e.position().x())
        if i >= 0:
            self.clic.emit(self.jours[i]["date"])

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        n = len(self.jours)
        if not n:
            p.setPen(QColor(theme.DISCRET))
            p.drawText(self.rect(), Qt.AlignCenter, "Aucune donnée")
            return
        bas, haut = self.height() - 34, 18
        zone = bas - haut
        mx = max([4] + [j["justifiees"] + j["non_justifiees"] for j in self.jours])
        larg = self.width() / n
        p.setPen(QPen(QColor(theme.BORDURE), 1))
        p.drawLine(0, bas, self.width(), bas)
        for i, j in enumerate(self.jours):
            x = i * larg + 3
            bw = larg - 6
            y = bas
            for v, c in ((j["justifiees"], theme.GARCONS), (j["non_justifiees"], theme.FILLES)):
                if v:
                    h = zone * v / mx
                    p.setPen(Qt.NoPen)
                    p.setBrush(QColor(c))
                    p.drawRoundedRect(QRectF(x, y - h, bw, h - 1), 3, 3)
                    y -= h
            tot = j["justifiees"] + j["non_justifiees"]
            p.setPen(QColor(theme.TEXTE))
            if tot:
                p.drawText(QRectF(x, y - 16, bw, 14), Qt.AlignCenter, str(tot))
            p.setPen(QColor(theme.DISCRET))
            p.drawText(QRectF(i * larg, bas + 2, larg, 30), Qt.AlignHCenter | Qt.AlignTop, f"{j['jour']}\n{j['num']}")


class Hero(QFrame):
    """Bandeau vert d'accueil, avec l'anneau orange du prototype."""

    def paintEvent(self, e):
        super().paintEvent(e)
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setClipRect(self.rect())
        c = QColor(theme.ACCENT)
        c.setAlphaF(0.22)
        p.setPen(QPen(c, 38))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(QRectF(self.width() - 220 + 19, -80 + 19, 280 - 38, 280 - 38))


def _legende(*items) -> QHBoxLayout:
    h = QHBoxLayout()
    h.setSpacing(12)
    for t, c in items:
        pastille = QLabel()
        pastille.setFixedSize(10, 10)
        pastille.setStyleSheet(f"background: {c}; border-radius: 3px;")
        h.addWidget(pastille)
        h.addWidget(label(t, discret=True))
    return h


def _entete_carte(c: Carte, titre: str, sous: str = "", droite=None):
    h = QHBoxLayout()
    v = QVBoxLayout()
    v.setSpacing(0)
    t = QLabel(titre)
    t.setObjectName("titreCarte")
    v.addWidget(t)
    s = label(sous, discret=True)
    v.addWidget(s)
    h.addLayout(v, 1)
    if droite is not None:
        if isinstance(droite, QWidget):
            h.addWidget(droite, 0, Qt.AlignTop)
        else:
            h.addLayout(droite)
    c.lay.addLayout(h)
    return s


# =================================================================== page
class PageTableauBord(Page):
    titre = "Tableau de bord"
    sous_titre = ""
    permission = "eleves.lire"
    ecoute = ("eleves", "notes", "personnel", "classes", "parametres", "absences", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.l_titre.hide()
        self.l_sous.hide()
        self.donnees: dict = {}
        self.corps.addWidget(self._hero())
        g = QGridLayout()
        g.setSpacing(14)
        self.k_eleves = Kpi("users", "Élèves inscrits")
        self.k_presence = Kpi("clip", "Présence aujourd'hui")
        self.k_reussite = Kpi("award", "Réussite")
        self.k_dossiers = Kpi("file", "Dossiers à régulariser")
        self.k_eleves.clic.connect(lambda: self._aller("eleves"))
        self.k_presence.clic.connect(lambda: self._aller("absences"))
        self.k_reussite.clic.connect(lambda: self._aller("resultats"))
        self.k_dossiers.clic.connect(lambda: self._aller("eleves"))
        for i, k in enumerate((self.k_eleves, self.k_presence, self.k_reussite, self.k_dossiers)):
            g.addWidget(k, 0, i)
        for i in range(4):
            g.setColumnStretch(i, 1)

        c = Carte()
        self.s_eff = _entete_carte(c, "Effectifs par classe", "",
                                   _legende(("Garçons", theme.GARCONS), ("Filles", theme.FILLES)))
        self.b_eff = BarresClasses(90)
        self.b_eff.clic.connect(self._classe_eleves)
        c.lay.addWidget(self.b_eff)
        c.lay.addStretch(1)
        g.addWidget(c, 1, 0, 1, 3)
        c = Carte()
        self.n_todo = QLabel("0")
        self.n_todo.setStyleSheet(f"background: {theme.CREUX}; border-radius: 10px; padding: 2px 10px; "
                                  f"color: {theme.DISCRET}; font-weight: 600;")
        _entete_carte(c, "À faire", "", self.n_todo)
        self.l_todo = QVBoxLayout()
        self.l_todo.setSpacing(0)
        c.lay.addLayout(self.l_todo)
        c.lay.addStretch(1)
        g.addWidget(c, 1, 3)

        c = Carte()
        self.s_res = _entete_carte(c, "Résultats par classe", "")
        self.b_res = BarresClasses(118)
        self.b_res.clic.connect(lambda _: self._aller("resultats"))
        c.lay.addWidget(self.b_res)
        c.lay.addStretch(1)
        g.addWidget(c, 2, 0, 1, 2)
        c = Carte()
        _entete_carte(c, "Absences", "10 derniers jours de classe",
                      _legende(("Non justifiées", theme.FILLES), ("Justifiées", theme.GARCONS)))
        self.col_abs = Colonnes()
        self.col_abs.clic.connect(lambda _: self._aller("absences"))
        c.lay.addWidget(self.col_abs, 1)
        g.addWidget(c, 2, 2)
        c = Carte()
        b = QPushButton("Classements")
        b.setProperty("role", "lien")
        b.clicked.connect(lambda: self._aller("resultats"))
        self.s_maj = _entete_carte(c, "Premiers de classe", "", b)
        self.l_majors = QVBoxLayout()
        self.l_majors.setSpacing(0)
        c.lay.addLayout(self.l_majors)
        c.lay.addStretch(1)
        g.addWidget(c, 2, 3)

        c = Carte()
        b = QPushButton("Calendrier")
        b.setProperty("role", "lien")
        b.clicked.connect(lambda: self._aller("parametres"))
        _entete_carte(c, "Agenda", "", b)
        self.l_agenda = QVBoxLayout()
        self.l_agenda.setSpacing(0)
        c.lay.addLayout(self.l_agenda)
        c.lay.addStretch(1)
        g.addWidget(c, 3, 0, 1, 2)
        c = Carte()
        _entete_carte(c, "Activité récente", "")
        self.l_activite = QVBoxLayout()
        self.l_activite.setSpacing(0)
        c.lay.addLayout(self.l_activite)
        c.lay.addStretch(1)
        g.addWidget(c, 3, 2, 1, 2)
        self.corps.addLayout(g)
        self.corps.addStretch(1)

    # ------------------------------------------------------------------ bandeau
    def _hero(self) -> QFrame:
        h = Hero()
        h.setObjectName("hero")
        lay = QHBoxLayout(h)
        lay.setContentsMargins(24, 22, 24, 22)
        v = QVBoxLayout()
        v.setSpacing(4)
        self.h_titre = QLabel("")
        self.h_titre.setObjectName("heroTitre")
        self.h_sous = QLabel("")
        self.h_sous.setStyleSheet("color: rgba(255,255,255,0.85);")
        v.addWidget(self.h_titre)
        v.addWidget(self.h_sous)
        self.h_puces = QHBoxLayout()
        self.h_puces.setSpacing(6)
        v.addSpacing(6)
        v.addLayout(self.h_puces)
        lay.addLayout(v, 1)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        self.b_inscrire = self._action("plus", "Inscrire un élève", self._nouvel_eleve, blanc=True)
        actions.addWidget(self.b_inscrire)
        actions.addWidget(self._action("clip", "Faire l'appel", lambda: self._aller("absences")))
        actions.addWidget(self._action("edit", "Saisir des notes", lambda: self._aller("notes")))
        actions.addWidget(self._action("book", "Rapports", lambda: self._aller("rapports")))
        lay.addLayout(actions)
        lay.setAlignment(actions, Qt.AlignBottom)
        return h

    def _action(self, ic, texte, slot, blanc=False) -> QPushButton:
        b = QPushButton(texte)
        b.setObjectName("actionHeroBlanc" if blanc else "actionHero")
        b.setIcon(icones.icone(ic, "#0B3D2A" if blanc else "#FFFFFF"))
        b.setCursor(Qt.PointingHandCursor)
        b.clicked.connect(slot)
        return b

    # ------------------------------------------------------------------ navigation
    def _aller(self, cle: str):
        f = getattr(self, "fenetre", None)
        if f:
            f.aller(cle)

    def _classe_eleves(self, classe: str):
        f = getattr(self, "fenetre", None)
        p = f.page("eleves") if f else None
        if p:
            p.recherche.clear()
            p.statut.setCurrentIndex(0)
            p.classe.setCurrentIndex(max(0, p.classe.findData(classe)))
            p.rafraichir()

    def _nouvel_eleve(self):
        f = getattr(self, "fenetre", None)
        p = f.page("eleves") if f else None
        if p:
            p.nouveau()

    def _fiche(self, inscription_id: int):
        f = getattr(self, "fenetre", None)
        if f:
            f.ouvrir_fiche(inscription_id)

    def _bouton_ligne(self, slot) -> QPushButton:
        b = QPushButton()
        b.setObjectName("ligneListe")
        b.setCursor(Qt.PointingHandCursor)
        b.setMinimumHeight(46)
        b.clicked.connect(slot)
        return b

    def _ligne(self, slot, gauche: QWidget | None, titre: str, detail: str, droite: str = "",
               couleur_droite: tuple | None = None) -> QPushButton:
        b = self._bouton_ligne(slot)
        h = QHBoxLayout(b)
        h.setContentsMargins(4, 4, 4, 4)
        h.setSpacing(10)
        if gauche is not None:
            h.addWidget(gauche)
        v = QVBoxLayout()
        v.setSpacing(0)
        t = QLabel(titre)
        t.setStyleSheet("font-weight: 600; background: transparent;")
        d = QLabel(detail)
        d.setStyleSheet(f"color: {theme.DISCRET}; font-size: 9pt; background: transparent;")
        v.addWidget(t)
        v.addWidget(d)
        h.addLayout(v, 1)
        if droite:
            e = QLabel(droite)
            e.setObjectName("etiquette")
            fond, txt = couleur_droite or (theme.CREUX, theme.DISCRET)
            e.setStyleSheet(f"background: {fond}; color: {txt};")
            h.addWidget(e)
        for w in b.findChildren(QLabel):
            w.setAttribute(Qt.WA_TransparentForMouseEvents)
        return b

    # ------------------------------------------------------------------ données
    def rafraichir(self):
        a = self.annee
        db = self.db
        d = accueil.tableau(db, a)
        self.donnees = d
        today = date.today()
        directeur = db.get_param("directeur") or ""
        self.h_titre.setText(("Bonjour" if datetime.now().hour < 13 else "Bon après-midi")
                             + (f", {directeur}" if directeur else ""))
        self.h_sous.setText(f"{JOURS[today.weekday()].capitalize()} {today.day} {MOIS[today.month - 1]} "
                            f"{today.year} · {db.get_param('ecole_nom') or ''}")
        _vider(self.h_puces)
        lic = self.ctx.licence
        puces = [f"Année {a.libelle}", d["evaluation_libelle"], db.get_param("iepp") or ""]
        for t in [x for x in puces if x]:
            l = QLabel(t)
            l.setObjectName("puce")
            self.h_puces.addWidget(l)
        if lic is not None and lic.statut == "essai":
            l = QLabel(f"Essai : {lic.jours_restants} j")
            l.setObjectName("puceOrange")
            self.h_puces.addWidget(l)
        self.h_puces.addStretch(1)
        self.b_inscrire.setEnabled(self.modifiable() and self.peut("eleves.modifier"))

        self.k_eleves.set(str(d["effectif"]), f"{d['garcons']} garçons · {d['filles']} filles")
        self.k_eleves.barre.set([(d["garcons"], theme.GARCONS), (d["filles"], theme.FILLES)])
        self.k_eleves.barre.show()
        self.k_presence.set(_pct(d["presence"]), f"{d['absents_aujourdhui']} absent(s) aujourd'hui",
                            "%" if d["presence"] is not None else "")
        ev = d["evaluation_libelle"]
        self.k_reussite.titre.setText(f"Réussite · {ev}")
        self.k_reussite.set(_pct(d["reussite"]), f"{d['admis']} élèves sur {d['evalues']} ont atteint le seuil",
                            "%" if d["reussite"] is not None else "")
        self.k_dossiers.set(str(d["sans_extrait"]), "élèves sans extrait de naissance")

        cp = sum(c["total"] for c in d["par_classe"] if c["classe"].startswith("CP"))
        self.s_eff.setText(f"{d['effectif']} élèves inscrits, dont {cp} au CP (CP1 + CP2)")
        self.b_eff.set([{"cle": c["classe"], "libelle": c["classe"],
                         "segments": [(c["garcons"], theme.GARCONS), (c["filles"], theme.FILLES)],
                         "texte": f"{c['total']} élèves",
                         "aide": f"{c['classe']} : {c['garcons']} garçon(s), {c['filles']} fille(s). "
                                 "Cliquez pour voir la liste."} for c in d["par_classe"]])
        self.s_res.setText(f"{ev} · moyenne et part des élèves au seuil (trait)")
        self.b_res.set([{"cle": c["classe"], "libelle": c["classe"],
                         "jauge": (c["moyenne"], c["bareme"], c["seuil"]),
                         "texte": f"{_nb(c['moyenne'])}/{c['bareme']:g} · {_pct(c['taux'])} %",
                         "aide": f"{c['classe']} : moyenne {_nb(c['moyenne'])} / {c['bareme']:g}, "
                                 f"{_pct(c['taux'])} % au seuil ({c['seuil']:g}/{c['bareme']:g}). "
                                 "Cliquez pour le classement."} for c in d["resultats"]])
        self.col_abs.set(d["absences"])

        _vider(self.l_todo)
        self.n_todo.setText(str(len(d["a_faire"])))
        cible = {"absences": "absences", "notes": "notes", "personnel": "personnel", "eleves": "eleves",
                 "sauvegarde": "sauvegarde"}
        for niveau, titre, detail, cle in d["a_faire"]:
            pastille = QLabel()
            pastille.setFixedSize(8, 28)
            pastille.setStyleSheet(f"background: {theme.DANGER if niveau == 'danger' else theme.ALERTE}; "
                                   "border-radius: 4px;")
            self.l_todo.addWidget(self._ligne(lambda _=False, c=cible.get(cle, cle): self._aller(c), pastille,
                                              titre, detail))
        if not d["a_faire"]:
            ok = label("Tout est à jour.", discret=True)
            ok.setAlignment(Qt.AlignCenter)
            self.l_todo.addWidget(ok)

        _vider(self.l_majors)
        self.s_maj.setText(ev)
        for m in d["premiers"]:
            av = QLabel("".join(x[0] for x in m["nom"].split()[:2]).upper())
            av.setFixedSize(30, 30)
            av.setAlignment(Qt.AlignCenter)
            av.setStyleSheet(f"background: {theme.PRIMAIRE_PALE}; color: {theme.PRIMAIRE}; border-radius: 9px; "
                             "font-size: 8pt; font-weight: 800;")
            self.l_majors.addWidget(self._ligne(lambda _=False, i=m["inscription_id"]: self._fiche(i), av,
                                                m["nom"], m["classe"], f"{_nb(m['moyenne'])} / {m['bareme']:g}"))
        if not d["premiers"]:
            self.l_majors.addWidget(label("Aucune note saisie.", discret=True))

        _vider(self.l_agenda)
        couleurs = {"À décider": ("#F6ECDD", theme.ALERTE), "Évaluation": (theme.PRIMAIRE_PALE, theme.PRIMAIRE)}
        for e in d["agenda"]:
            dt = calculs.to_date(e["date"])
            case = QLabel(f"<b style='font-size:12pt; color:{theme.TEXTE}'>{dt.day}</b><br>{MOIS_COURTS[dt.month - 1]}")
            case.setFixedSize(46, 40)
            case.setAlignment(Qt.AlignCenter)
            case.setStyleSheet(f"background: {theme.CREUX}; border-radius: 9px; color: {theme.DISCRET}; "
                               "font-size: 8pt;")
            self.l_agenda.addWidget(self._ligne(lambda _=False, c=e["cle"]: self._aller(c), case, e["titre"],
                                                e["detail"], e["etiquette"], couleurs.get(e["etiquette"])))
        if not d["agenda"]:
            self.l_agenda.addWidget(label("Rien de prévu.", discret=True))

        _vider(self.l_activite)
        for e in d["activite"]:
            h = QHBoxLayout()
            h.setContentsMargins(0, 6, 0, 6)
            dt = QLabel(f"{e['date'][8:10]}/{e['date'][5:7]}")
            dt.setObjectName("etiquette")
            dt.setStyleSheet(f"background: {theme.PRIMAIRE_PALE}; color: {theme.PRIMAIRE};")
            h.addWidget(dt)
            t = QLabel(e["texte"])
            t.setWordWrap(True)
            h.addWidget(t, 1)
            self.l_activite.addLayout(h)
        if not d["activite"]:
            self.l_activite.addWidget(label("Aucune activité enregistrée.", discret=True))
