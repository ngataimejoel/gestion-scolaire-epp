"""Personnel de l'école : liste, fiche, classe tenue, photo, récapitulatif par fonction."""
from __future__ import annotations

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QDialog, QFileDialog, QHBoxLayout, QLineEdit, QSplitter, QVBoxLayout

from epp.domain import repo, stats
from epp.ui.pages.base import Page
from epp.ui.pages.eleves import Photo
from epp.ui.widgets import (Carte, Col, Formulaire, Tableau, afficher_erreur, bouton, confirmer, label, ligne,
                            protege)


class DialogueAgent(QDialog):
    def __init__(self, page: Page, agent: dict | None):
        super().__init__(page)
        self.page, self.agent = page, agent
        self.photo_data, self.photo_modifiee = None, False
        self.setWindowTitle("Modifier l'agent" if agent else "Nouvel agent")
        self.resize(720, 430)
        v = QVBoxLayout(self)
        h = QHBoxLayout()
        pv = QVBoxLayout()
        self.photo = Photo()
        pv.addWidget(self.photo)
        pv.addWidget(bouton("Choisir…", self._choisir))
        pv.addWidget(bouton("Retirer", self._retirer))
        pv.addStretch(1)
        h.addLayout(pv)
        db, a = page.db, page.annee
        self.f = Formulaire([
            ("matricule", "Matricule *", "texte"), ("nom", "Nom et prénoms *", "texte"), ("sexe", "Sexe *", "sexe"),
            ("date_naissance", "Date de naissance", "date"),
            ("fonction", "Fonction", "liste_libre", repo.liste(db, "FONCTION")), ("grade", "Grade", "texte"),
            ("diplome", "Diplôme", "texte"), ("date_prise_service", "Prise de service", "date"),
            ("date_arrivee", "Arrivée à l'école", "date"), ("telephone", "Téléphone", "texte"),
            ("situation_matrimoniale", "Situation matrimoniale", "liste",
             [("", "")] + [(x, x) for x in repo.liste(db, "SITUATION_MATRIMONIALE")]),
            ("classe_tenue", f"Classe tenue ({a.libelle})", "liste", [("-", "–")] + [(c, c) for c in a.codes]),
            ("observations", "Observations", "multiligne")], colonnes=2)
        h.addWidget(self.f, 1)
        v.addLayout(h, 1)
        if agent:
            self.f.remplir(agent)
            self.photo.set_donnees(repo.get_photo(db, "personnel", agent["id"]))
        else:
            self.f.remplir({"sexe": "M", "classe_tenue": "-"})
        v.addLayout(ligne(label("* champ obligatoire", discret=True), None, bouton("Annuler", self.reject),
                          bouton("Enregistrer", self._ok, "primaire")))

    def _choisir(self):
        f, _ = QFileDialog.getOpenFileName(self, "Photo", "", "Images (*.jpg *.jpeg *.png *.bmp *.gif)")
        if f:
            try:
                with open(f, "rb") as fh:
                    self.photo_data = repo.normaliser_photo(fh.read())
            except Exception as e:     # noqa: BLE001
                afficher_erreur(self, e)
                return
            self.photo_modifiee = True
            self.photo.set_donnees(self.photo_data)

    def _retirer(self):
        self.photo_data, self.photo_modifiee = None, True
        self.photo.vider()

    def marquer_erreur(self, champ):
        self.f.marquer_erreur(champ)

    @protege
    def _ok(self):
        d = self.f.valeurs()
        d["classe_tenue"] = d.get("classe_tenue") or "-"
        p = self.page
        with p.db.transaction():
            pid = repo.save_personnel(p.db, p.s, self.agent["id"] if self.agent else None, d, p.annee)
            if self.photo_modifiee:
                repo.set_photo(p.db, p.s, "personnel", pid, self.photo_data)
        self.pid = pid
        self.accept()


class PagePersonnel(Page):
    titre = "Personnel"
    sous_titre = "Enseignants et agents de l'école"
    permission = "personnel.lire"
    ecoute = ("personnel", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.b_nouveau = bouton("Nouvel agent", self._nouveau, "primaire")
        self.actions.addWidget(bouton("Imprimer la liste", self._imprimer))
        self.actions.addWidget(self.b_nouveau)
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Rechercher : nom, matricule, fonction…")
        self.recherche.setClearButtonEnabled(True)
        self._delai = QTimer(self, singleShot=True, interval=250, timeout=self.rafraichir)
        self.recherche.textChanged.connect(self._delai.start)
        self.compte = label("", discret=True)
        self.corps.addLayout(ligne(self.recherche, self.compte))
        split = QSplitter()
        c = Carte()
        self.table = Tableau([Col("numero", "N°", "nombre", 44), Col("matricule", "Matricule", largeur=100),
                              Col("nom", "Nom et prénoms", largeur=220), Col("sexe", "Sexe", largeur=44),
                              Col("fonction", "Fonction", largeur=170), Col("grade", "Grade", largeur=80),
                              Col("classe_tenue", "Classe", largeur=60), Col("anciennete", "Ancienneté", "nombre", 80),
                              Col("telephone", "Téléphone", largeur=110)])
        self.table.double_clic.connect(lambda _: self._modifier())
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._etat())
        c.lay.addWidget(self.table, 1)
        self.b_mod = bouton("Modifier", self._modifier)
        self.b_sup = bouton("Supprimer…", self._supprimer, "danger")
        c.lay.addLayout(ligne(self.b_mod, None, self.b_sup))
        split.addWidget(c)
        c2 = Carte("Effectif par fonction")
        self.recap = Tableau([Col("fonction", "Fonction", largeur=170), Col("hommes", "H", "nombre"),
                              Col("femmes", "F", "nombre"), Col("total", "Total", "nombre")])
        self.recap.etirer()
        c2.lay.addWidget(self.recap, 1)
        split.addWidget(c2)
        split.setSizes([860, 330])
        self.corps.addWidget(split, 1)

    def rafraichir(self):
        lignes = repo.personnel(self.db, self.annee, recherche=self.recherche.text().strip() or None)
        self.table.set_lignes(lignes)
        self.compte.setText(f"{len(lignes)} agent(s)")
        rec = [r for r in stats.recap_personnel(self.db, self.annee) if r["total"]]
        rec.append({"fonction": "TOTAL", "hommes": sum(r["hommes"] for r in rec),
                    "femmes": sum(r["femmes"] for r in rec), "total": sum(r["total"] for r in rec)})
        self.recap.set_lignes(rec)
        self._etat()

    def _etat(self):
        r = self.table.ligne_courante()
        self.b_nouveau.setEnabled(self.modifiable() and self.peut("personnel.modifier"))
        self.b_mod.setEnabled(bool(r) and self.modifiable() and self.peut("personnel.modifier"))
        self.b_sup.setEnabled(bool(r) and self.modifiable() and self.peut("personnel.supprimer"))

    def _nouveau(self):
        d = DialogueAgent(self, None)
        if d.exec():
            self.ctx.modifie("personnel")
            self.table.selectionner(lambda r: r["id"] == d.pid)

    def _modifier(self):
        r = self.table.ligne_courante()
        if r and self.b_mod.isEnabled() and DialogueAgent(self, r).exec():
            self.ctx.modifie("personnel")

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if r and confirmer(self, "Supprimer l'agent",
                           f"Supprimer définitivement {r['nom']} ({r['matricule']}) et ses absences ?",
                           "Supprimer", True):
            repo.delete_personnel(self.db, self.s, r["id"])
            self.ctx.modifie("personnel")

    def _imprimer(self):
        from epp.ui.dialogs.export import exporter_rapport
        exporter_rapport(self, "PERSONNEL", {}, "Liste du personnel")
