"""Inscriptions de l'année : nouvelles inscriptions, anciens élèves, réinscriptions depuis l'année précédente."""
from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QDialog, QHBoxLayout, QLineEdit, QVBoxLayout

from epp.domain import fin_annee, repo
from epp.ui.pages.base import Page
from epp.ui.widgets import Col, Kpi, Tableau, bouton, info, label, ligne, protege

TYPES = {"INSCRIPTION": "Nouvelle inscription", "REINSCRIPTION": "Réinscription"}


class DialogueAncienEleve(QDialog):
    """Inscrire un élève déjà connu (année antérieure, retour après un départ)."""

    def __init__(self, page: Page):
        super().__init__(page)
        self.page = page
        self.setWindowTitle("Inscrire un ancien élève")
        self.resize(720, 480)
        v = QVBoxLayout(self)
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Nom ou matricule DESPS")
        self.recherche.textChanged.connect(self._chercher)
        v.addWidget(self.recherche)
        self.table = Tableau([Col("nom", "Nom et prénoms", largeur=260), Col("sexe", "Sexe", largeur=50),
                              Col("date_naissance", "Naissance", "date", 100),
                              Col("matricule_desps", "DESPS", largeur=110), Col("derniere", "Dernière inscription")])
        v.addWidget(self.table, 1)
        self.classe = QComboBox()
        for c in page.annee.classes:
            self.classe.addItem(c.code, c.code)
        self.red = QComboBox()
        self.red.addItems(["NON", "OUI"])
        v.addLayout(ligne(label("Classe"), self.classe, label("Redoublant"), self.red, None))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Inscrire", self._ok, "primaire")))
        self._chercher()

    def _chercher(self):
        q = f"%{self.recherche.text().strip()}%"
        rows = self.page.db.query(
            "SELECT e.id AS eleve_id, e.nom, e.sexe, e.date_naissance, e.matricule_desps, "
            "(SELECT a.libelle || ' – ' || c.code FROM inscription i JOIN annee_scolaire a ON a.id=i.annee_id "
            " JOIN classe c ON c.id=i.classe_id WHERE i.eleve_id=e.id ORDER BY a.libelle DESC LIMIT 1) AS derniere "
            "FROM eleve e WHERE e.id NOT IN (SELECT eleve_id FROM inscription WHERE annee_id=?) "
            "AND (e.nom LIKE ? OR IFNULL(e.matricule_desps,'') LIKE ?) ORDER BY e.nom LIMIT 300",
            (self.page.annee.id, q, q))
        self.table.set_lignes([dict(r) for r in rows])

    @protege
    def _ok(self):
        r = self.table.ligne_courante()
        if not r:
            info(self, "Inscription", "Choisissez l'élève dans la liste.")
            return
        repo.inscrire(self.page.db, self.page.s, r["eleve_id"], self.page.annee, self.classe.currentData(),
                      self.red.currentText(), "PRESENT", "REINSCRIPTION")
        self.accept()


class DialogueReinscription(QDialog):
    """Réinscrit les élèves de l'année précédente selon les décisions de fin d'année."""

    def __init__(self, page: Page, precedente: repo.Annee):
        super().__init__(page)
        self.page, self.src = page, precedente
        self.setWindowTitle("Réinscriptions depuis l'année précédente")
        self.resize(760, 520)
        v = QVBoxLayout(self)
        props = fin_annee.propositions(page.db, precedente)
        deja = {r[0] for r in page.db.query("SELECT eleve_id FROM inscription WHERE annee_id=?", (page.annee.id,))}
        for r in props:
            r["deja"] = "OUI" if r["eleve_id"] in deja else ""
            r["cible"] = (r["classe_suivante"] or "sortie") if r["decision"] == "ADMIS" else \
                r["classe"] if r["decision"] == "REDOUBLE" else "–"
        nv = sum(1 for r in props if not r["validee"])
        v.addWidget(label(
            f"{len(props)} élève(s) en {precedente.libelle}. Les admis passent en classe supérieure, les redoublants "
            "restent dans leur classe ; abandons, exclus et transférés ne sont pas réinscrits. Les élèves déjà "
            "inscrits cette année sont ignorés." + (f"\n{nv} décision(s) ne sont pas encore validées : la décision "
                                                    "calculée sera utilisée." if nv else ""), wrap=True))
        t = Tableau([Col("classe", "Classe", largeur=60), Col("nom", "Nom et prénoms", largeur=240),
                     Col("mga", "MGA", "decimal", 60), Col("decision", "Décision", "pastille", 100),
                     Col("cible", "Classe en " + page.annee.libelle, largeur=130), Col("deja", "Déjà inscrit")])
        t.set_lignes(props)
        v.addWidget(t, 1)
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Réinscrire", self._ok, "primaire")))

    @protege
    def _ok(self):
        b = repo.reinscrire(self.page.db, self.page.s, self.src, self.page.annee)
        info(self, "Réinscriptions",
             f"{b['reinscrits']} élève(s) réinscrit(s), {b['sortants']} sortant(s) (CM2 admis), "
             f"{b['partants']} départ(s), {b['deja']} déjà inscrit(s), {b['ignores']} ignoré(s).")
        self.accept()


class PageInscriptions(Page):
    titre = "Inscriptions"
    sous_titre = "Nouvelles inscriptions et réinscriptions de l'année"
    permission = "eleves.lire"
    ecoute = ("eleves", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.b_reinscrire = bouton("Réinscrire l'année précédente…", self._reinscrire)
        self.b_ancien = bouton("Inscrire un ancien élève…", self._ancien)
        self.b_nouveau = bouton("Nouvelle inscription", self._nouveau, "primaire")
        for b in (self.b_reinscrire, self.b_ancien, self.b_nouveau):
            self.actions.addWidget(b)
        k = QHBoxLayout()
        self.k_total, self.k_nouv, self.k_rein, self.k_red = (Kpi("Inscrits"), Kpi("Nouvelles inscriptions"),
                                                               Kpi("Réinscriptions"), Kpi("Redoublants"))
        for w in (self.k_total, self.k_nouv, self.k_rein, self.k_red):
            k.addWidget(w)
        self.corps.addLayout(k)
        f = QHBoxLayout()
        self.type = QComboBox()
        self.type.addItem("Tous les types", "")
        for c, t in TYPES.items():
            self.type.addItem(t, c)
        self.type.activated.connect(lambda _: self.rafraichir())
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Rechercher…")
        self.recherche.textChanged.connect(lambda _: self.rafraichir())
        f.addWidget(self.recherche, 3)
        f.addWidget(self.type, 1)
        self.corps.addLayout(f)
        self.table = Tableau([Col("numero", "N°", "nombre", 46), Col("date_inscription", "Date", "date", 96),
                              Col("type_lib", "Type", largeur=150), Col("matricule_ecole", "Matricule", largeur=110),
                              Col("nom", "Nom et prénoms", largeur=240), Col("sexe", "Sexe", largeur=46),
                              Col("classe", "Classe", largeur=60), Col("redoublant", "Redoublant", largeur=80),
                              Col("statut", "Statut", "pastille", 90)])
        self.corps.addWidget(self.table, 1)

    def _precedente(self) -> repo.Annee | None:
        prec = f"{self.annee.an_debut() - 1}-{self.annee.an_debut()}"
        aid = self.db.scalar("SELECT id FROM annee_scolaire WHERE libelle=?", (prec,))
        return repo.load_annee(self.db, aid) if aid else None

    def rafraichir(self):
        tous = repo.inscriptions(self.db, self.annee)
        for r in tous:
            r["type_lib"] = TYPES.get(r["type"], r["type"])
        self.k_total.set(str(len(tous)))
        self.k_nouv.set(str(sum(1 for r in tous if r["type"] == "INSCRIPTION")))
        self.k_rein.set(str(sum(1 for r in tous if r["type"] == "REINSCRIPTION")))
        self.k_red.set(str(sum(1 for r in tous if r["redoublant"] == "OUI")))
        q = self.recherche.text().strip().lower()
        t = self.type.currentData()
        self.table.set_lignes([r for r in tous if (not t or r["type"] == t) and
                               (not q or q in f"{r['nom']} {r['matricule_ecole']} {r['classe']}".lower())])
        ok = self.modifiable() and self.peut("eleves.modifier")
        for b in (self.b_nouveau, self.b_ancien):
            b.setEnabled(ok)
        self.b_reinscrire.setEnabled(ok and self._precedente() is not None)

    def _nouveau(self):
        p = self.fenetre.page("eleves")
        if p:
            p.nouveau()

    def _ancien(self):
        if DialogueAncienEleve(self).exec():
            self.ctx.modifie("eleves")

    def _reinscrire(self):
        src = self._precedente()
        if src and DialogueReinscription(self, src).exec():
            self.ctx.modifie("eleves")
