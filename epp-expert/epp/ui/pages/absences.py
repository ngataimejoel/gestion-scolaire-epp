"""Absences et retards (élèves, personnel) et demandes d'autorisation d'absence."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QComboBox, QCompleter, QDialog, QFormLayout, QInputDialog, QLineEdit, QTabWidget,
                               QVBoxLayout, QWidget)

from epp.core import seed
from epp.domain import autorisations as au
from epp.domain import calculs, repo
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.widgets import Col, Formulaire, Tableau, bouton, confirmer, info, label, ligne, protege, valider_suppression


def mois_de_l_annee(annee) -> list[tuple[int, str]]:
    return [(m, seed.MOIS_FR[m - 1]) for m in (9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7)]


# =================================================================== absences
class DialogueAbsence(QDialog):
    def __init__(self, page: "OngletAbsences", ligne_: dict | None):
        super().__init__(page)
        self.page, self.l = page, ligne_
        kind = page.kind
        self.setWindowTitle(("Modifier" if ligne_ else "Nouvelle") + " absence ou retard")
        v = QVBoxLayout(self)
        f = QFormLayout()
        self.cible = QComboBox()
        self.cible.setEditable(True)
        self.cible.setInsertPolicy(QComboBox.NoInsert)
        db, a = page.page.db, page.page.annee
        if kind == "eleve":
            for r in repo.inscriptions(db, a):
                self.cible.addItem(f"{r['nom']} ({r['matricule_ecole']}) – {r['classe']}", r["inscription_id"])
        else:
            for p in repo.personnel(db, a):
                self.cible.addItem(f"{p['nom']} ({p['matricule']}) – {p.get('fonction') or ''}", p["id"])
        comp = QCompleter([self.cible.itemText(i) for i in range(self.cible.count())], self)
        comp.setCaseSensitivity(Qt.CaseInsensitive)
        comp.setFilterMode(Qt.MatchContains)
        self.cible.setCompleter(comp)
        f.addRow("Élève" if kind == "eleve" else "Agent", self.cible)
        v.addLayout(f)
        self.form = Formulaire([
            ("date", "Date *", "date_obl"), ("nature", "Nature", "liste", [("ABSENCE", "Absence"), ("RETARD", "Retard")]),
            ("jours", "Jours d'absence", "nombre", (0, 31)), ("retard_min", "Retard (minutes)", "entier", (0, 600)),
            ("motif", "Motif", "liste_libre", repo.liste(db, "MOTIF_ABSENCE")), ("justifie", "Justifié", "oui_non"),
            ("observations", "Observations", "multiligne")])
        v.addWidget(self.form)
        self.form.widgets["nature"].currentIndexChanged.connect(self._nature)
        if ligne_:
            fk = "inscription_id" if kind == "eleve" else "personnel_id"
            self.cible.setCurrentIndex(max(0, self.cible.findData(ligne_[fk])))
            self.form.remplir(ligne_)
        else:
            self.form.remplir({"nature": "ABSENCE", "jours": 1, "justifie": "NON"})
            self.form.widgets["date"].set_date(min(date.today(), calculs.to_date(a.date_fin) or date.today()))
            self.cible.setCurrentIndex(-1)
            self.cible.setEditText("")
        self._nature()
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Enregistrer", self._ok, "primaire")))

    def _nature(self):
        absence = self.form.widgets["nature"].currentData() == "ABSENCE"
        self.form.widgets["jours"].setEnabled(absence)
        self.form.widgets["retard_min"].setEnabled(not absence)

    def marquer_erreur(self, champ):
        self.form.marquer_erreur(champ)

    @protege
    def _ok(self):
        i = self.cible.findText(self.cible.currentText())
        cible = self.cible.itemData(i) if i >= 0 else None
        d = self.form.valeurs()
        fk = "inscription_id" if self.page.kind == "eleve" else "personnel_id"
        d[fk] = cible
        p = self.page.page
        repo.save_absence(p.db, p.s, self.page.kind, self.l["id"] if self.l else None, p.annee, d)
        self.accept()


class OngletAbsences(QWidget):
    def __init__(self, page: Page, kind: str):
        super().__init__()
        self.page, self.kind = page, kind
        v = QVBoxLayout(self)
        self.mois = QComboBox()
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Rechercher : nom, matricule, motif…")
        self.recherche.textChanged.connect(lambda _: self.rafraichir())
        self.mois.activated.connect(lambda _: self.rafraichir())
        self.total = label("", discret=True)
        self.b_nouv = bouton("Nouvelle absence / retard", self._nouveau, "primaire")
        self.b_mod = bouton("Modifier", self._modifier)
        self.b_sup = bouton("Supprimer", self._supprimer, "danger")
        v.addLayout(ligne(self.recherche, self.mois, self.total, None, self.b_mod, self.b_sup, self.b_nouv))
        cols = [Col("numero", "N°", "nombre", 44), Col("date", "Date", "date", 92)]
        if kind == "eleve":
            cols += [Col("matricule_ecole", "Matricule", largeur=105), Col("nom", "Nom et prénoms", largeur=220),
                     Col("classe", "Classe", largeur=56)]
        else:
            cols += [Col("matricule", "Matricule", largeur=95), Col("nom", "Nom et prénoms", largeur=220),
                     Col("cours_tenu", "Classe", largeur=56)]
        cols += [Col("nature", "Nature", largeur=72), Col("jours", "Jours", "nombre", 52),
                 Col("retard_min", "Retard (min)", "nombre", 84), Col("motif", "Motif", largeur=150),
                 Col("justifie", "Justifié", "pastille", 64), Col("observations", "Observations")]
        self.table = Tableau(cols)
        self.table.double_clic.connect(lambda _: self._modifier())
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._etat())
        v.addWidget(self.table, 1)
        v.addWidget(label("Les absences créées par une autorisation accordée portent son numéro : elles se modifient "
                          "depuis la demande (onglet « Autorisations d'absence »).", discret=True, wrap=True))

    def rafraichir(self):
        m = self.mois.currentData()
        self.mois.clear()
        self.mois.addItem("Toute l'année", 0)
        for k, t in mois_de_l_annee(self.page.annee):
            self.mois.addItem(t, k)
        self.mois.setCurrentIndex(max(0, self.mois.findData(m or 0)))
        f = repo.absences_eleves if self.kind == "eleve" else repo.absences_personnel
        rows = f(self.page.db, self.page.annee, self.mois.currentData() or None)
        q = self.recherche.text().strip().lower()
        if q:
            rows = [r for r in rows if q in " ".join(str(r.get(k) or "") for k in (
                "nom", "matricule", "matricule_ecole", "motif", "classe", "observations")).lower()]
        self.table.set_lignes(rows)
        j = sum(r["jours"] or 0 for r in rows)
        nr = sum(1 for r in rows if r["nature"] == "RETARD")
        self.total.setText(f"{len(rows)} ligne(s) · {calculs.xround(j, 1):g} jour(s) d'absence · {nr} retard(s)")
        self._etat()

    def _etat(self):
        r = self.table.ligne_courante()
        ok = self.page.modifiable() and self.page.peut("absences.modifier")
        self.b_nouv.setEnabled(ok)
        self.b_mod.setEnabled(ok and bool(r))
        self.b_sup.setEnabled(ok and bool(r))

    def _issue_autorisation(self, r) -> bool:
        if r.get("autorisation_id"):
            info(self, "Absence liée à une autorisation",
                 "Cette absence a été créée par une autorisation d'absence accordée. Modifiez ou supprimez la "
                 "demande dans l'onglet « Autorisations d'absence » : les absences suivront.")
            return True
        return False

    def _nouveau(self):
        if DialogueAbsence(self, None).exec():
            self.page.ctx.modifie("absences")

    def _modifier(self):
        r = self.table.ligne_courante()
        if r and self.b_mod.isEnabled() and not self._issue_autorisation(r) and DialogueAbsence(self, r).exec():
            self.page.ctx.modifie("absences")

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if not r or self._issue_autorisation(r):
            return
        if confirmer(self, "Supprimer", f"Supprimer cette ligne ({r['nom']}, {calculs.to_date(r['date']):%d/%m/%Y}) ?",
                     "Supprimer", True) and valider_suppression(
                self, self.page.db, self.page.s, f"absence de {r['nom']} du {calculs.to_date(r['date']):%d/%m/%Y}"):
            repo.delete_absence(self.page.db, self.page.s, self.kind, r["id"])
            self.page.ctx.modifie("absences")


# =================================================================== autorisations d'absence
class DialogueAutorisation(QDialog):
    """Fiche de demande : préremplie à partir du matricule ou d'une recherche, champs modifiables."""

    def __init__(self, page: Page, demande: dict | None = None, recherche: str = ""):
        super().__init__(page)
        self.page, self.demande = page, demande
        self.personne: dict = {}
        self.setWindowTitle(f"Demande {demande['numero']}" if demande else "Nouvelle demande d'autorisation d'absence")
        self.resize(760, 600)
        v = QVBoxLayout(self)
        self.q = QLineEdit(recherche)
        self.q.setPlaceholderText("Matricule de l'élève ou de l'agent, ou nom, classe, fonction…")
        self.q.returnPressed.connect(self._remplir)
        self.b_remplir = bouton("Remplir la fiche", self._remplir, "primaire")
        v.addLayout(ligne(label("Personne"), self.q, self.b_remplir))
        self.l_personne = label("Recherchez la personne : ses informations sont reprises automatiquement.",
                                discret=True, wrap=True)
        self.l_personne.setStyleSheet(f"background: #EEF3F0; border-radius: 6px; padding: 8px; color: {theme.TEXTE};")
        v.addWidget(self.l_personne)
        db = page.db
        self.f = Formulaire([
            ("date_demande", "Date de la demande", "date_obl"), ("date_debut", "Du *", "date_obl"),
            ("date_fin", "Au *", "date_obl"),
            ("demi_journee", "Demi-journée", "liste", [("", "Non (journées entières)")] + list(au.DEMI.items())),
            ("motif", "Motif *", "liste_libre", repo.liste(db, "MOTIF_ABSENCE")),
            ("precisions", "Précisions", "multiligne"), ("lieu", "Lieu / destination", "texte"),
            ("contact", "Contact pendant l'absence", "texte"), ("demandeur", "Parent / tuteur demandeur", "texte"),
            ("interim", "Intérim / remplaçant", "texte"),
            ("statut", "Décision", "liste", list(au.STATUTS.items())), ("avis", "Avis du directeur", "multiligne")],
            colonnes=2)
        v.addWidget(self.f, 1)
        self.l_jours = label("", gras=True)
        v.addWidget(self.l_jours)
        for k in ("date_debut", "date_fin"):
            self.f.widgets[k].dateChanged.connect(self._jours)
        self.f.widgets["demi_journee"].currentIndexChanged.connect(self._jours)
        peut_decider = page.peut("absences.autoriser")
        self.f.widgets["statut"].setEnabled(peut_decider)
        self.f.widgets["avis"].setEnabled(peut_decider)
        if not peut_decider:
            v.addWidget(label("La décision (accorder ou refuser) revient au directeur : la demande sera enregistrée "
                              "« en attente ».", discret=True, wrap=True))
        v.addWidget(label("Une demande accordée crée automatiquement les absences justifiées correspondantes "
                          "(jours de classe du lundi au vendredi, une ligne par mois).", discret=True, wrap=True))
        self.b_impr = bouton("Enregistrer et imprimer…", lambda: self._ok(imprimer=True))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), self.b_impr,
                          bouton("Enregistrer", self._ok, "primaire")))
        a = page.annee
        auj = min(max(date.today(), calculs.to_date(a.date_debut)), calculs.to_date(a.date_fin))
        if demande:
            self.f.remplir(demande)
            fk = "inscription_id" if demande["kind"] == "eleve" else "personnel_id"
            pers = [p for p in au.personnes(db, a, demande.get("matricule") or "", demande["kind"])
                    if p.get(fk) == demande[fk]]
            self._afficher_personne(pers[0] if pers else {"kind": demande["kind"], fk: demande[fk],
                                                          "nom": demande.get("nom"), "matricule": demande.get("matricule")})
            self.q.setText(demande.get("matricule") or "")
        else:
            self.f.remplir({"statut": "EN_ATTENTE", "demi_journee": ""})
            for k in ("date_demande", "date_debut", "date_fin"):
                self.f.widgets[k].set_date(auj)
            if recherche:
                self._remplir()
        self._jours()

    def _afficher_personne(self, p: dict):
        self.personne = p
        if p.get("kind") == "eleve":
            t = (f"<b>{p.get('nom')}</b> · élève · matricule {p.get('matricule')} · classe {p.get('classe') or '–'}"
                 f"<br>Enseignant : {p.get('enseignant') or '–'} · Parent : {p.get('demandeur') or '–'} "
                 f"{p.get('telephone') or ''}")
        else:
            t = (f"<b>{p.get('nom')}</b> · {p.get('fonction') or 'agent'} {p.get('grade') or ''} · matricule "
                 f"{p.get('matricule')} · classe tenue {p.get('classe') or '–'} · {p.get('telephone') or ''}")
        self.l_personne.setText(t)
        self.f.widgets["demandeur"].setEnabled(p.get("kind") == "eleve")
        self.f.widgets["interim"].setEnabled(p.get("kind") == "personnel")

    @protege
    def _remplir(self):
        q = self.q.text().strip()
        if not q:
            return
        trouves = au.personnes(self.page.db, self.page.annee, q)
        if not trouves:
            raise repo.ValidationError(f"Aucun élève ni agent ne correspond à « {q} ».")
        p = trouves[0]
        if len(trouves) > 1:
            noms = [f"{t['nom']} ({t['matricule']}) – {'élève ' + t['classe'] if t['kind'] == 'eleve' else t.get('fonction') or 'agent'}"
                    for t in trouves]
            choix, ok = QInputDialog.getItem(self, "Plusieurs personnes", "Choisissez la personne :", noms, 0, False)
            if not ok:
                return
            p = trouves[noms.index(choix)]
        self._afficher_personne(p)
        w = self.f.widgets
        if p["kind"] == "eleve" and not w["demandeur"].text():
            w["demandeur"].setText(p.get("demandeur") or "")
        if not w["contact"].text():
            w["contact"].setText(p.get("telephone") or "")

    def _jours(self):
        d1, d2 = self.f.widgets["date_debut"].date().toPython(), self.f.widgets["date_fin"].date().toPython()
        if d2 < d1:
            self.f.widgets["date_fin"].setDate(self.f.widgets["date_debut"].date())
            return
        from epp.domain import calendrier
        exclus = calendrier.jours_sans_classe(self.page.db, self.page.annee)
        n = 0.5 if self.f.widgets["demi_journee"].currentData() else len(au.jours_ouvres(d1, d2, exclus))
        self.l_jours.setText(f"Durée : {n:g} jour(s) de classe".replace(".", ","))

    def marquer_erreur(self, champ):
        if champ in ("matricule", "kind", "recherche"):
            self.q.setFocus()
        else:
            self.f.marquer_erreur(champ)

    @protege
    def _ok(self, imprimer=False):
        p = self.personne
        if not p:
            raise repo.ValidationError("Recherchez d'abord l'élève ou l'agent concerné.", "recherche")
        d = self.f.valeurs()
        d.update(kind=p["kind"], personnel_id=p.get("personnel_id"), inscription_id=p.get("inscription_id"))
        if self.demande and not self.page.peut("absences.autoriser"):
            d["statut"], d["avis"] = self.demande["statut"], self.demande.get("avis")
        pg = self.page
        self.aid = au.enregistrer(pg.db, pg.s, pg.annee, self.demande["id"] if self.demande else None, d)
        if imprimer:
            pg.imprimer_fiche(au.get(pg.db, self.aid)["numero"])
        self.accept()


class OngletAutorisations(QWidget):
    def __init__(self, page: "PageAbsences"):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Matricule, n° de demande, nom, classe, motif, date (jj/mm/aaaa)…")
        self.recherche.textChanged.connect(lambda _: self.rafraichir())
        self.kind = QComboBox()
        for k, t in (("", "Élèves et personnel"), ("eleve", "Élèves"), ("personnel", "Personnel")):
            self.kind.addItem(t, k)
        self.statut = QComboBox()
        self.statut.addItem("Tous les statuts", "")
        for k, t in au.STATUTS.items():
            self.statut.addItem(t, k)
        self.kind.activated.connect(lambda _: self.rafraichir())
        self.statut.activated.connect(lambda _: self.rafraichir())
        self.b_nouv = bouton("Nouvelle demande", self._nouvelle, "primaire")
        v.addLayout(ligne(self.recherche, self.kind, self.statut, self.b_nouv))
        self.table = Tableau([Col("numero", "N°", largeur=96), Col("date_demande", "Demandée le", "date", 92),
                              Col("categorie", "Catégorie", largeur=80), Col("matricule", "Matricule", largeur=100),
                              Col("nom", "Nom et prénoms", largeur=200), Col("classe", "Classe", largeur=56),
                              Col("periode", "Période", largeur=250), Col("jours", "Jours", "nombre", 50),
                              Col("motif", "Motif", largeur=130), Col("statut", "Décision", "pastille", 90)])
        self.table.double_clic.connect(lambda _: self._modifier())
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._etat())
        v.addWidget(self.table, 1)
        self.b_mod = bouton("Ouvrir / modifier", self._modifier)
        self.b_acc = bouton("Accorder", lambda: self._decider("ACCORDEE"))
        self.b_ref = bouton("Refuser", lambda: self._decider("REFUSEE"))
        self.b_sup = bouton("Supprimer", self._supprimer, "danger")
        self.b_fiche = bouton("Imprimer la fiche", self._imprimer_selection)
        self.b_lot = bouton("Imprimer les fiches trouvées", self._imprimer_recherche)
        self.b_reg = bouton("Registre", self._registre)
        v.addLayout(ligne(self.b_mod, self.b_acc, self.b_ref, self.b_sup, None, self.b_reg, self.b_lot, self.b_fiche))
        self.compte = label("", discret=True)
        v.addWidget(self.compte)

    def rafraichir(self):
        rows = au.lister(self.page.db, self.page.annee, self.recherche.text().strip() or None,
                         self.kind.currentData() or None, self.statut.currentData() or None)
        self.table.set_lignes(rows)
        att = sum(1 for r in rows if r["statut"] == "EN_ATTENTE")
        self.compte.setText(f"{len(rows)} demande(s)" + (f" · {att} en attente de décision" if att else ""))
        self._etat()

    def _etat(self):
        r = self.table.ligne_courante()
        ok = self.page.modifiable() and self.page.peut("absences.modifier")
        dec = self.page.modifiable() and self.page.peut("absences.autoriser")
        self.b_nouv.setEnabled(ok)
        self.b_mod.setEnabled(bool(r))
        self.b_acc.setEnabled(dec and bool(r) and r["statut"] != "ACCORDEE")
        self.b_ref.setEnabled(dec and bool(r) and r["statut"] != "REFUSEE")
        self.b_sup.setEnabled(bool(r) and ok and (r["statut"] == "EN_ATTENTE" or dec))
        self.b_fiche.setEnabled(bool(r) and self.page.peut("rapports.generer"))
        self.b_lot.setEnabled(bool(self.table.lignes()) and self.page.peut("rapports.generer"))
        self.b_reg.setEnabled(self.page.peut("rapports.generer"))

    def _nouvelle(self):
        d = DialogueAutorisation(self.page, None, "")
        if d.exec():
            self.page.ctx.modifie("absences")
            self.table.selectionner(lambda r: r["id"] == d.aid)

    def _modifier(self):
        r = self.table.ligne_courante()
        if not r:
            return
        d = DialogueAutorisation(self.page, r)
        if not (self.page.modifiable() and self.page.peut("absences.modifier")):
            for w in d.findChildren(QWidget):
                if hasattr(w, "setReadOnly"):
                    w.setReadOnly(True)
            d.f.activer(False)
        if d.exec():
            self.page.ctx.modifie("absences")

    @protege
    def _decider(self, statut):
        r = self.table.ligne_courante()
        if not r:
            return
        avis = None
        if statut == "REFUSEE":
            avis, ok = QInputDialog.getText(self, "Refuser la demande", "Motif du refus (avis du directeur) :")
            if not ok:
                return
        au.decider(self.page.db, self.page.s, self.page.annee, r["id"], statut, avis or None)
        self.page.ctx.modifie("absences")

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if r and confirmer(self, "Supprimer la demande", f"Supprimer la demande {r['numero']} ({r['nom']}) ? Les "
                                                         "absences qu'elle avait créées sont retirées.", "Supprimer",
                           True) and valider_suppression(self, self.page.db, self.page.s,
                                                         f"demande d'autorisation {r['numero']} ({r['nom']})"):
            au.supprimer(self.page.db, self.page.s, r["id"])
            self.page.ctx.modifie("absences")

    def _imprimer_selection(self):
        r = self.table.ligne_courante()
        if r:
            self.page.imprimer_fiche(r["numero"])

    def _imprimer_recherche(self):
        q = self.recherche.text().strip()
        if q:
            self.page.imprimer_fiche(q)
        else:
            ids = [r["id"] for r in self.table.lignes()]
            self.page.imprimer_demandes(ids, "Demandes d'autorisation d'absence")

    def _registre(self):
        from epp.ui.dialogs.export import exporter_rapport
        exporter_rapport(self.page, "AUTORISATIONS", {}, "Registre des autorisations d'absence")


class PageAbsences(Page):
    titre = "Absences et autorisations"
    sous_titre = "Retards, absences et demandes d'autorisation d'absence"
    permission = "absences.lire"
    ecoute = ("absences", "eleves", "personnel", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Journal des absences", self._journal))
        self.onglets = QTabWidget()
        self.o_el = OngletAbsences(self, "eleve")
        self.o_pe = OngletAbsences(self, "personnel")
        self.o_au = OngletAutorisations(self)
        self.onglets.addTab(self.o_el, "Élèves")
        self.onglets.addTab(self.o_pe, "Personnel")
        self.onglets.addTab(self.o_au, "Autorisations d'absence")
        self.corps.addWidget(self.onglets, 1)

    def rafraichir(self):
        for o in (self.o_el, self.o_pe, self.o_au):
            o.rafraichir()

    def _journal(self):
        from epp.ui.dialogs.export import exporter_rapport
        i = self.onglets.currentIndex()
        if i == 2:
            exporter_rapport(self, "AUTORISATIONS", {}, "Registre des autorisations d'absence")
        else:
            o = self.o_el if i == 0 else self.o_pe
            m = o.mois.currentData()
            exporter_rapport(self, "ABS_ELEVES" if i == 0 else "ABS_PERSONNEL", {"mois": m} if m else {},
                             "Journal des absences " + ("des élèves" if i == 0 else "du personnel"))

    def imprimer_fiche(self, ref: str) -> None:
        """Fiche(s) par numéro, matricule ou recherche, au format choisi."""
        from epp.ui.dialogs.export import enregistrer, formats_autorises
        enregistrer(self, f"Autorisation d'absence {ref}",
                    lambda ch, f: au.imprimer(self.db, self.s, self.annee, ref, ch, f), formats_autorises(self.ctx))

    def imprimer_demandes(self, ids: list[int], nom: str) -> None:
        from epp.reports import service
        from epp.ui.dialogs.export import enregistrer, formats_autorises
        demandes = [d for d in au.lister(self.db, self.annee) if d["id"] in set(ids)]

        def produire(ch, f):
            service._droits_format(self.s, f)
            return service._ecrire(au.document(self.db, self.annee, demandes), f, ch, "Autorisations")
        enregistrer(self, nom, produire, formats_autorises(self.ctx))
