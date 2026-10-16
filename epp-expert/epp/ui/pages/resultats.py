"""Résultats et fin d'année : moyennes annuelles, rangs, décisions proposées, validation, passage d'année."""
from __future__ import annotations

from PySide6.QtWidgets import QComboBox, QDialog, QFormLayout, QLineEdit, QSplitter, QVBoxLayout

from epp.domain import fin_annee
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, Col, Tableau, bouton, confirmer, info, label, ligne, protege, valider_suppression


class DialogueDecision(QDialog):
    def __init__(self, page: Page, r: dict):
        super().__init__(page)
        self.page, self.r = page, r
        self.setWindowTitle("Décision de fin d'année")
        v = QVBoxLayout(self)
        mga = "–" if r["mga"] is None else f"{r['mga']:.2f}".replace(".", ",")
        v.addWidget(label(f"{r['nom']} ({r['classe']}) · MGA {mga} · rang {r.get('rang') or '–'}\n"
                          f"Proposition calculée : {fin_annee.DECISIONS.get(r['decision_calculee'], 'aucune')}",
                          wrap=True))
        f = QFormLayout()
        self.dec = QComboBox()
        for k, t in fin_annee.DECISIONS.items():
            self.dec.addItem(t, k)
        self.dec.setCurrentIndex(max(0, self.dec.findData(r["decision"] or r["decision_calculee"] or "ADMIS")))
        self.motif = QLineEdit(r.get("motif") or "")
        self.motif.setPlaceholderText("obligatoire pour une exclusion")
        f.addRow("Décision", self.dec)
        f.addRow("Motif", self.motif)
        v.addLayout(f)
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Valider", self._ok, "primaire")))

    @protege
    def _ok(self):
        p = self.page
        fin_annee.valider(p.db, p.s, p.annee, {self.r["inscription_id"]: (self.dec.currentData(),
                                                                          self.motif.text())})
        self.accept()


class DialoguePassage(QDialog):
    def __init__(self, page: Page, ap: dict):
        super().__init__(page)
        self.page, self.ap = page, ap
        self.setWindowTitle("Passage à l'année suivante")
        self.resize(560, 480)
        v = QVBoxLayout(self)
        v.addWidget(label(f"Passage de {ap['annee']} à {ap['annee_suivante']}", gras=True, taille=12))
        pa = ap["partants"]
        v.addWidget(label(
            f"• {ap['montent']} élève(s) admis passent en classe supérieure\n"
            f"• {ap['redoublent']} redoublant(s) restent dans leur classe\n"
            f"• {ap['sortants']} élève(s) de CM2 admis quittent l'école\n"
            f"• départs : {pa.get('ABANDON', 0)} abandon(s), {pa.get('EXCLU', 0)} exclusion(s), "
            f"{pa.get('TRANSFERE', 0)} transfert(s)", wrap=True))
        t = Tableau([Col("classe", "Classe"), Col("admis", "Admis venant d'en dessous", "nombre"),
                     Col("redoublants", "Redoublants", "nombre"), Col("total", "Effectif prévu", "nombre")])
        t.etirer()
        t.set_lignes([{"classe": c, **v_, "total": v_["admis"] + v_["redoublants"]}
                      for c, v_ in ap["effectifs_suivants"].items()])
        v.addWidget(t, 1)
        v.addWidget(label(
            "Une sauvegarde complète est faite automatiquement avant le passage. L'année "
            f"{ap['annee']} sera ensuite archivée en lecture seule (consultable et imprimable) et l'année "
            f"{ap['annee_suivante']} deviendra l'année en cours" +
            (" (elle existe déjà : les élèves y seront ajoutés)." if ap["existe_deja"] else "."), discret=True,
            wrap=True))
        v.addLayout(ligne(None, bouton("Annuler", self.reject),
                          bouton(f"Passer en {ap['annee_suivante']}", self._ok, "primaire")))

    @protege
    def _ok(self):
        p = self.page
        self.res = fin_annee.passer_annee_suivante(p.db, p.s, p.annee)
        self.accept()


class PageResultats(Page):
    titre = "Résultats et fin d'année"
    sous_titre = "Moyennes annuelles, décisions et passage à l'année suivante"
    permission = "notes.lire"
    ecoute = ("notes", "eleves", "classes", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.actions.addWidget(bouton("Bulletins annuels", lambda: self._imprimer("BULLETIN_ANNUEL",
                                                                                  "Bulletins annuels", True)))
        self.actions.addWidget(bouton("Résultats", lambda: self._imprimer("RESULTATS", "Résultats")))
        self.actions.addWidget(bouton("Procès-verbal des décisions",
                                      lambda: self._imprimer("DECISIONS_FIN_ANNEE", "Décisions de fin d'année")))
        split = QSplitter()
        c1 = Carte("Avancement par classe")
        self.etat = Tableau([Col("classe", "Classe", largeur=56), Col("effectif", "Élèves", "nombre", 54),
                             Col("valides", "Validés", "nombre", 60), Col("ADMIS", "Admis", "nombre", 54),
                             Col("REDOUBLE", "Red.", "nombre", 46), Col("partants", "Départs", "nombre", 60),
                             Col("etat_lib", "État")])
        self.etat.selectionModel().selectionChanged.connect(lambda *_: self._charger_classe())
        c1.lay.addWidget(self.etat, 1)
        self.b_passage = bouton("Passer à l'année suivante…", self._passage, "primaire")
        self.b_rouvrir = bouton("Rouvrir l'année archivée", self._rouvrir, "danger")
        c1.lay.addWidget(self.b_passage)
        c1.lay.addWidget(self.b_rouvrir)
        self.l_passage = label("", discret=True, wrap=True)
        c1.lay.addWidget(self.l_passage)
        split.addWidget(c1)
        c2 = Carte()
        self.t_classe = label("", gras=True)
        c2.lay.addWidget(self.t_classe)
        self.table = Tableau([Col("numero", "N°", "nombre", 40), Col("matricule_ecole", "Matricule", largeur=100),
                              Col("nom", "Nom et prénoms", largeur=210), Col("mga", "MGA", "decimal", 56),
                              Col("rang", "Rang", "nombre", 46),
                              Col("decision_calculee", "Proposition", "pastille", 92),
                              Col("decision", "Décision", "pastille", 92), Col("valide_lib", "Validée", largeur=60),
                              Col("motif", "Motif")])
        self.table.double_clic.connect(lambda _: self._decision())
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._boutons())
        c2.lay.addWidget(self.table, 1)
        self.b_dec = bouton("Changer la décision…", self._decision)
        self.b_val = bouton("Valider toute la classe", self._valider_classe, "primaire")
        self.b_ann = bouton("Annuler la validation", self._annuler)
        c2.lay.addLayout(ligne(self.b_dec, None, self.b_ann, self.b_val))
        c2.lay.addWidget(label("Les propositions sont calculées à partir de la moyenne annuelle et du seuil "
                               "d'admission de la classe. « Valider toute la classe » retient la proposition pour "
                               "chaque élève dont la décision n'a pas été changée.", discret=True, wrap=True))
        split.addWidget(c2)
        split.setSizes([420, 800])
        self.corps.addWidget(split, 1)

    def _classe(self):
        r = self.etat.ligne_courante()
        return r["classe"] if r else None

    def rafraichir(self):
        cl = self._classe()
        lignes = fin_annee.etat(self.db, self.annee)
        for e in lignes:
            e["partants"] = sum(e[k] for k in fin_annee.PARTANTS)
            e["etat_lib"] = ("Validée" if e["complete"] else "Vide" if not e["effectif"] else
                             f"{e['sans_proposition']} sans moyenne" if e["sans_proposition"] else "À valider")
            e["_couleur"] = "#1E7B4F" if e["complete"] else None
        self.etat.set_lignes(lignes)
        if not self.etat.selectionner(lambda e: e["classe"] == cl) and lignes:
            self.etat.selectRow(0)
        ap = fin_annee.apercu_passage(self.db, self.annee)
        peut = self.peut("fin_annee.valider")
        self.b_passage.setEnabled(peut and ap["pret"])
        self.b_passage.setText(f"Passer en {ap['annee_suivante']}…")
        self.b_rouvrir.setVisible(self.annee.cloturee and self.peut("parametres.modifier") and peut)
        if self.annee.cloturee:
            self.l_passage.setText("Cette année est archivée : les résultats restent consultables et imprimables.")
        elif ap["classes_non_validees"]:
            self.l_passage.setText("Pour passer à l'année suivante, validez d'abord : "
                                   + ", ".join(ap["classes_non_validees"]) + ".")
        else:
            self.l_passage.setText("Toutes les classes sont validées : le passage à l'année suivante est possible.")
        self._charger_classe()

    def _charger_classe(self):
        cl = self._classe()
        if not cl:
            self.table.set_lignes([])
            self.t_classe.setText("")
            self._boutons()
            return
        props = fin_annee.propositions(self.db, self.annee, cl)
        for r in props:
            r["valide_lib"] = "✓" if r["validee"] else ""
        self.table.set_lignes(props)
        self.t_classe.setText(f"Classe {cl} · {len(props)} élève(s)")
        self._boutons()

    def _boutons(self):
        ok = self.modifiable() and self.peut("fin_annee.valider")
        cl = self._classe()
        self.b_dec.setEnabled(ok and self.table.ligne_courante() is not None)
        self.b_val.setEnabled(ok and bool(cl))
        self.b_ann.setEnabled(ok and any(r["validee"] for r in self.table.lignes()))

    def _decision(self):
        r = self.table.ligne_courante()
        if r and self.b_dec.isEnabled() and DialogueDecision(self, r).exec():
            self.ctx.modifie("notes")

    @protege
    def _valider_classe(self):
        cl = self._classe()
        if not confirmer(self, "Valider la classe", f"Valider les décisions de fin d'année de la classe {cl} ?"):
            return
        b = fin_annee.valider_classe(self.db, self.s, self.annee, cl)
        info(self, "Classe validée", ", ".join(f"{fin_annee.DECISIONS[k]} : {n}" for k, n in b.items() if n)
             or "Aucun élève.")
        self.ctx.modifie("notes")

    @protege
    def _annuler(self):
        cl = self._classe()
        if confirmer(self, "Annuler la validation", f"Retirer les décisions validées de la classe {cl} ? "
                                                     "Les propositions calculées reviennent.") \
                and valider_suppression(self, self.db, self.s, f"décisions validées de la classe {cl}"):
            fin_annee.annuler_validation(self.db, self.s, self.annee, cl)
            self.ctx.modifie("notes")

    @protege
    def _passage(self):
        ap = fin_annee.apercu_passage(self.db, self.annee)
        d = DialoguePassage(self, ap)
        if d.exec():
            r = d.res
            info(self, "Passage effectué",
                 f"L'année {r['annee_suivante']} est maintenant l'année en cours : {r['reinscrits']} élève(s) "
                 f"réinscrit(s).\nSauvegarde faite avant le passage : {r['sauvegarde'].name}")
            self.ctx.modifie("annees")
            self.ctx.recharger_annee(r["annee_suivante_id"])

    @protege
    def _rouvrir(self):
        if confirmer(self, "Rouvrir l'année", f"Rouvrir l'année {self.annee.libelle} pour corriger une erreur ? "
                                              "Elle redevient modifiable. Les élèves déjà réinscrits l'année "
                                              "suivante n'en sont pas retirés.", "Rouvrir", True):
            fin_annee.rouvrir_annee(self.db, self.s, self.annee)
            self.ctx.modifie("annees")
            self.ctx.recharger_annee()

    def _imprimer(self, code, nom, par_classe=False):
        from epp.ui.dialogs.export import exporter_rapport
        cl = self._classe()
        params = {"classe": cl} if (par_classe and cl) else {}
        exporter_rapport(self, code, params, f"{nom} {cl}" if params else nom)
