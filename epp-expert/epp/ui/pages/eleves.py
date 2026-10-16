"""Élèves : recherche, filtres, fiche détaillée (identité, état civil, parents, scolarité), photo."""
from __future__ import annotations

import html

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (QComboBox, QDialog, QFileDialog, QHBoxLayout, QLabel, QLineEdit, QSplitter,
                               QTabWidget, QTextBrowser, QVBoxLayout, QWidget)

from epp.domain import calculs, referentiels, repo
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.widgets import (Carte, Col, Formulaire, Tableau, afficher_erreur, bouton, confirmer, info, label,
                            ligne, protege, valider_modification, valider_suppression)

GROUPES_SANGUINS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
STATUTS = [("", "Tous les statuts"), ("PRESENT", "Présents"), ("ABANDON", "Abandons"), ("TRANSFERE", "Transférés")]


def _d(v) -> str:
    d = calculs.to_date(v) if v else None
    return d.strftime("%d/%m/%Y") if d else (v or "")


def _html(lignes: list[tuple[str, object]]) -> str:
    rows = "".join(
        f"<tr><td style='color:{theme.DISCRET}; padding:3px 12px 3px 0; white-space:nowrap'>{html.escape(k)}</td>"
        f"<td style='padding:3px 0'><b>{html.escape(str(v)) if v not in (None, '') else '–'}</b></td></tr>"
        for k, v in lignes)
    return f"<table>{rows}</table>"


class Photo(QLabel):
    def __init__(self, l: int = 96, h: int = 116):
        super().__init__()
        self.setFixedSize(l, h)
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet(f"background: #EEF3F0; border: 1px solid {theme.BORDURE}; border-radius: 6px; "
                           f"color: {theme.DISCRET};")
        self.vider()

    def vider(self):
        self.clear()
        self.setText("Photo")

    def set_donnees(self, data: bytes | None):
        pm = QPixmap()
        if data and pm.loadFromData(data):
            self.setPixmap(pm.scaled(self.width() - 4, self.height() - 4, Qt.KeepAspectRatio,
                                     Qt.SmoothTransformation))
        else:
            self.vider()


# =================================================================== fiche (modification)
class DialogueEleve(QDialog):
    def __init__(self, page: Page, ligne_: dict | None = None):
        super().__init__(page)
        self.page, self.db, self.annee = page, page.db, page.annee
        self.ligne = ligne_
        self.photo_data: bytes | None = None
        self.photo_modifiee = False
        self.setWindowTitle("Modifier l'élève" if ligne_ else "Nouvel élève")
        self.resize(760, 520)
        v = QVBoxLayout(self)
        # les matricules d'abord, avant les informations de l'élève
        self.f_mat = Formulaire([
            ("matricule_ecole", "Matricule école", "texte"),
            ("matricule_desps", "Matricule DESPS", "texte", "10 caractères, ex. 12345678A")], colonnes=2)
        self.f_mat.widgets["matricule_ecole"].setReadOnly(True)
        self.f_mat.widgets["matricule_ecole"].setPlaceholderText("attribué automatiquement")
        bloc = Carte("Matricules")
        bloc.lay.addWidget(self.f_mat)
        v.addWidget(bloc)
        tete = QHBoxLayout()
        self.photo = Photo()
        pv = QVBoxLayout()
        pv.addWidget(self.photo)
        pv.addWidget(bouton("Choisir…", self._choisir_photo))
        pv.addWidget(bouton("Retirer", self._retirer_photo))
        pv.addStretch(1)
        tete.addLayout(pv)
        self.onglets = QTabWidget()
        tete.addWidget(self.onglets, 1)
        v.addLayout(tete, 1)
        nat = repo.liste(self.db, "NATIONALITE")
        nat += [x for _, x in referentiels.nationalites() if x not in nat]      # liste officielle complète
        sp = [""] + sorted({x for _, x in referentiels.sous_prefectures()})
        self.f_id = Formulaire([
            ("nom", "Nom et prénoms *", "texte"), ("sexe", "Sexe *", "sexe"),
            ("date_naissance", "Date de naissance", "date"),
            ("nationalite", "Nationalité", "liste_libre", nat), ("observations", "Observations", "multiligne")])
        self.f_ec = Formulaire([
            ("localite", "Lieu de naissance", "texte"), ("sous_prefecture", "Sous-préfecture", "liste_libre", sp),
            ("extrait", "Extrait de naissance", "oui_non"), ("acte_num", "N° de l'acte", "texte"),
            ("acte_date", "Date de l'acte", "date"), ("centre_etat_civil", "Centre d'état civil", "texte"),
            ("orphelin", "Orphelin", "oui_non"), ("orphelin_de", "Orphelin de", "liste",
                                                  [("", "")] + [(x, x) for x in repo.liste(self.db, "ORPHELIN_DE")]),
            ("groupe_sanguin", "Groupe sanguin", "liste_libre", GROUPES_SANGUINS),
            ("allergies", "Allergies / handicap", "texte")])
        par = []
        for qui, t in (("pere", "Père"), ("mere", "Mère"), ("tuteur", "Tuteur")):
            par += [(f"{qui}_nom", f"{t} : nom et prénoms", "texte"), (f"{qui}_profession", "Profession", "texte"),
                    (f"{qui}_residence", "Résidence", "texte"), (f"{qui}_tel", "Téléphone", "texte")]
        self.f_par = Formulaire(par, colonnes=2)
        classes = [(c.code, f"{c.code} – {c.libelle}") for c in self.annee.classes]
        self.f_sco = Formulaire([
            ("classe", "Classe *", "liste", classes),
            ("redoublant", "Redoublant", "liste", [("NON", "NON"), ("OUI", "OUI")]),
            ("statut", "Statut", "liste", STATUTS[1:]),
            ("date_inscription", "Date d'inscription", "date"),
            ("observations_inscription", "Observations (année)", "multiligne")])
        for f, t in ((self.f_id, "Identité"), (self.f_ec, "État civil"), (self.f_par, "Parents"),
                     (self.f_sco, "Scolarité")):
            w = QWidget()
            l = QVBoxLayout(w)
            l.addWidget(f)
            l.addStretch(1)
            self.onglets.addTab(w, t)
        self.forms = [self.f_mat, self.f_id, self.f_ec, self.f_par, self.f_sco]
        if ligne_:
            data = dict(ligne_)
            for f in self.forms:
                f.remplir(data)
            self.photo_data = repo.get_photo(self.db, "eleve", ligne_["eleve_id"])
            self.photo.set_donnees(self.photo_data)
            self.f_sco.widgets["date_inscription"].setEnabled(False)
        else:
            for f in self.forms:
                f.remplir({"sexe": "M", "extrait": "OUI", "orphelin": "NON", "redoublant": "NON",
                           "statut": "PRESENT", "nationalite": nat[0] if nat else "",
                           "classe": page.filtre_classe() or (self.annee.codes[0] if self.annee.codes else None)})
            self.f_sco.widgets["date_inscription"].set_date(__import__("datetime").date.today())
        if ligne_:
            v.addWidget(label("Fiche déjà enregistrée : toute modification est validée par le mot de passe d'un "
                              "administrateur.", discret=True, wrap=True))
        v.addWidget(label("* champ obligatoire", discret=True))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Enregistrer", self._enregistrer, "primaire")))

    def _choisir_photo(self):
        f, _ = QFileDialog.getOpenFileName(self, "Photo de l'élève", "", "Images (*.jpg *.jpeg *.png *.bmp *.gif)")
        if not f:
            return
        try:
            with open(f, "rb") as fh:
                self.photo_data = repo.normaliser_photo(fh.read())
        except Exception as e:     # noqa: BLE001
            afficher_erreur(self, e)
            return
        self.photo_modifiee = True
        self.photo.set_donnees(self.photo_data)

    def _retirer_photo(self):
        # élève déjà enregistré : le mot de passe administrateur est demandé à l'enregistrement
        self.photo_data, self.photo_modifiee = None, True
        self.photo.vider()

    def marquer_erreur(self, champ):
        for i, f in enumerate(self.forms):
            if champ in f.widgets:
                if f is not self.f_mat:
                    self.onglets.setCurrentIndex(i - 1)
                f.marquer_erreur(champ)
                return

    @protege
    def _enregistrer(self):
        db, s, a = self.db, self.page.s, self.annee
        data = {}
        for f in self.forms:
            data.update(f.valeurs())
        if self.ligne:
            repo.validate_eleve(data, a)            # erreurs de saisie signalées avant le mot de passe
            quoi = f"fiche de l'élève {self.ligne['nom']} ({self.ligne['matricule_ecole']})"
            if repo.changement_efface_notes(db, a, self.ligne["inscription_id"], data["classe"]):
                quoi += ", changement de classe : les notes déjà saisies seront retirées"
            if not valider_modification(self, db, s, quoi):
                return
        with db.transaction():
            eid = repo.save_eleve(db, s, self.ligne["eleve_id"] if self.ligne else None, data, a)
            if self.ligne:
                repo.update_inscription(db, s, self.ligne["inscription_id"], a, data["classe"],
                                        data["redoublant"] or "NON", data["statut"] or "PRESENT",
                                        data.get("observations_inscription"))
            else:
                repo.inscrire(db, s, eid, a, data["classe"], data["redoublant"] or "NON",
                              data["statut"] or "PRESENT", date_inscription=data.get("date_inscription"),
                              observations=data.get("observations_inscription"))
            if self.photo_modifiee:
                repo.set_photo(db, s, "eleve", eid, self.photo_data)
        self.eleve_id = eid
        self.accept()


class DialogueChangerClasse(QDialog):
    def __init__(self, page: Page, r: dict):
        super().__init__(page)
        self.page, self.r = page, r
        self.setWindowTitle("Changer de classe")
        v = QVBoxLayout(self)
        v.addWidget(label(f"{r['nom']} est en {r['classe']} ({r['matricule_ecole']}).", wrap=True))
        self.classe = QComboBox()
        for c in page.annee.classes:
            self.classe.addItem(f"{c.code} – {c.libelle}", c.code)
        self.classe.setCurrentIndex(max(0, self.classe.findData(r["classe"])))
        v.addLayout(ligne(label("Nouvelle classe"), self.classe, None))
        v.addWidget(label("Un nouveau matricule école est attribué. Si la nouvelle classe utilise une autre grille de "
                          "notes, les notes déjà saisies ne s'appliquent plus et sont retirées.", discret=True,
                          wrap=True))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Changer", self._ok, "primaire")))

    @protege
    def _ok(self):
        r = self.r
        quoi = f"classe de l'élève {r['nom']} ({r['matricule_ecole']}) : {r['classe']} vers {self.classe.currentData()}"
        if repo.changement_efface_notes(self.page.db, self.page.annee, r["inscription_id"],
                                        self.classe.currentData()):
            quoi += ", les notes déjà saisies seront retirées"
        if not valider_modification(self, self.page.db, self.page.s, quoi):
            return
        repo.update_inscription(self.page.db, self.page.s, r["inscription_id"], self.page.annee,
                                self.classe.currentData(), r["redoublant"], r["statut"],
                                r.get("observations_inscription"))
        self.accept()


# =================================================================== page
class PageEleves(Page):
    titre = "Élèves"
    sous_titre = "Registre des élèves de l'année"
    permission = "eleves.lire"
    ecoute = ("eleves", "classes", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.b_nouveau = bouton("Nouvel élève", self.nouveau, "primaire")
        self.b_export = bouton("Exporter la liste", self._exporter)
        self.actions.addWidget(self.b_export)
        self.actions.addWidget(self.b_nouveau)
        filtres = QHBoxLayout()
        self.recherche = QLineEdit()
        self.recherche.setPlaceholderText("Rechercher : nom, matricule, DESPS, parent…")
        self.recherche.setClearButtonEnabled(True)
        self.classe = QComboBox()
        self.statut = QComboBox()
        for k, t in STATUTS:
            self.statut.addItem(t, k)
        self.compte = label("", discret=True)
        filtres.addWidget(self.recherche, 3)
        filtres.addWidget(self.classe, 1)
        filtres.addWidget(self.statut, 1)
        filtres.addWidget(self.compte)
        self.corps.addLayout(filtres)
        self._delai = QTimer(self, singleShot=True, interval=250, timeout=self.rafraichir)
        self.recherche.textChanged.connect(self._delai.start)
        self.classe.activated.connect(lambda _: self.rafraichir())
        self.statut.activated.connect(lambda _: self.rafraichir())

        split = QSplitter()
        self.table = Tableau([
            Col("numero", "N°", "nombre", 46), Col("matricule_ecole", "Matricule", largeur=110),
            Col("nom", "Nom et prénoms", largeur=230), Col("sexe", "Sexe", largeur=44),
            Col("date_naissance", "Naissance", "date", 92), Col("age", "Âge", "nombre", 44),
            Col("classe", "Classe", largeur=60), Col("redoublant", "Red.", largeur=46),
            Col("statut", "Statut", "pastille", 92), Col("extrait", "Extrait", largeur=60)])
        self.table.selectionModel().selectionChanged.connect(lambda *_: self._afficher_fiche())
        self.table.double_clic.connect(lambda r: self.modifier())
        split.addWidget(self.table)
        self.fiche = self._panneau_fiche()
        split.addWidget(self.fiche)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 2)
        split.setSizes([760, 420])
        self.corps.addWidget(split, 1)

    def _panneau_fiche(self) -> QWidget:
        c = Carte("Fiche de l'élève")
        tete = QHBoxLayout()
        self.f_photo = Photo(84, 102)
        tete.addWidget(self.f_photo)
        b = QVBoxLayout()
        self.f_nom = label("", gras=True, taille=12, wrap=True)
        self.f_sous = label("", discret=True, wrap=True)
        b.addWidget(self.f_nom)
        b.addWidget(self.f_sous)
        b.addStretch(1)
        tete.addLayout(b, 1)
        c.lay.addLayout(tete)
        self.f_onglets = QTabWidget()
        self.f_textes = []
        for t in ("Identité", "État civil", "Parents", "Scolarité"):
            tb = QTextBrowser()
            tb.setFrameShape(QTextBrowser.NoFrame)
            self.f_textes.append(tb)
            self.f_onglets.addTab(tb, t)
        c.lay.addWidget(self.f_onglets, 1)
        self.b_modifier = bouton("Modifier", self.modifier, "primaire")
        self.b_classe = bouton("Changer de classe", self._changer_classe)
        self.b_supprimer = bouton("Supprimer…", self._supprimer, "danger")
        self.b_fiche = bouton("Fiche scolaire", self._fiche_scolaire)
        self.b_fiche.setToolTip("Fiche scolaire de l'élève (en-tête officiel, parents, scolarité, code QR), "
                                "en PDF ou en Word")
        c.lay.addLayout(ligne(self.b_modifier, self.b_classe, self.b_fiche, None, self.b_supprimer))
        return c

    # ------------------------------------------------------------------ données
    def filtre_classe(self) -> str | None:
        return self.classe.currentData() or None

    def rafraichir(self):
        a = self.annee
        cl = self.classe.currentData()
        self.classe.blockSignals(True)
        self.classe.clear()
        if not self.restreint:
            self.classe.addItem("Toutes les classes", "")
        for c in self.classes_visibles():
            self.classe.addItem(c.code, c.code)
        self.classe.setCurrentIndex(max(0, self.classe.findData(cl or "")))
        self.classe.blockSignals(False)
        lignes = repo.inscriptions(self.db, a, self.filtre_classe(), self.recherche.text().strip() or None,
                                   self.statut.currentData() or None)
        lignes = [r for r in lignes if self.voit(r["classe"])]
        self.table.set_lignes(lignes)
        nf = sum(1 for r in lignes if r["sexe"] == "F")
        self.compte.setText(f"{len(lignes)} élève(s) · {len(lignes) - nf} G · {nf} F")
        ok = self.modifiable() and self.peut("eleves.modifier")
        self.b_nouveau.setEnabled(ok)
        self.b_export.setEnabled(self.peut("rapports.generer"))
        self._afficher_fiche()

    def _afficher_fiche(self):
        r = self.table.ligne_courante()
        ok = self.modifiable() and self.peut("eleves.modifier")
        self.b_modifier.setEnabled(bool(r) and ok)
        self.b_classe.setEnabled(bool(r) and ok)
        self.b_supprimer.setEnabled(bool(r) and self.peut("eleves.supprimer") and self.modifiable())
        self.b_fiche.setEnabled(bool(r) and self.peut("rapports.generer"))
        if not r:
            self.f_nom.setText("Aucun élève sélectionné")
            self.f_sous.setText("Choisissez un élève dans la liste.")
            self.f_photo.vider()
            for t in self.f_textes:
                t.setHtml("")
            return
        self.f_nom.setText(r["nom"])
        self.f_sous.setText(f"{r['matricule_ecole']} · {r['classe']} · "
                            f"{'Fille' if r['sexe'] == 'F' else 'Garçon'}"
                            + (f" · {r['age']} ans" if r.get("age") is not None else ""))
        self.f_photo.set_donnees(repo.get_photo(self.db, "eleve", r["eleve_id"]))
        self.f_textes[0].setHtml(_html([("Matricule école", r["matricule_ecole"]),
                                        ("Matricule DESPS", r.get("matricule_desps")),
                                        ("Nom et prénoms", r["nom"]), ("Sexe", r["sexe"]),
                                        ("Date de naissance", _d(r["date_naissance"])), ("Âge", r.get("age")),
                                        ("Nationalité", r.get("nationalite")),
                                        ("Observations", r.get("observations"))]))
        self.f_textes[1].setHtml(_html([("Lieu de naissance", r.get("localite")),
                                        ("Sous-préfecture", r.get("sous_prefecture")),
                                        ("Extrait de naissance", r.get("extrait")), ("N° de l'acte", r.get("acte_num")),
                                        ("Date de l'acte", _d(r.get("acte_date"))),
                                        ("Centre d'état civil", r.get("centre_etat_civil")),
                                        ("Orphelin", r.get("orphelin")), ("Orphelin de", r.get("orphelin_de")),
                                        ("Groupe sanguin", r.get("groupe_sanguin")),
                                        ("Allergies / handicap", r.get("allergies"))]))
        par = []
        for qui, t in (("pere", "Père"), ("mere", "Mère"), ("tuteur", "Tuteur")):
            par += [(t, r.get(f"{qui}_nom")), ("   Profession", r.get(f"{qui}_profession")),
                    ("   Résidence", r.get(f"{qui}_residence")), ("   Téléphone", r.get(f"{qui}_tel"))]
        self.f_textes[2].setHtml(_html(par))
        self.f_textes[3].setHtml(_html([("Classe", r["classe"]), ("Matricule école", r["matricule_ecole"]),
                                        ("Redoublant", r["redoublant"]), ("Statut", r["statut"]),
                                        ("Type", r.get("type")), ("Inscrit le", _d(r.get("date_inscription"))),
                                        ("Observations", r.get("observations_inscription"))]))

    # ------------------------------------------------------------------ actions
    def nouveau(self):
        if not self.annee or not self.modifiable() or not self.peut("eleves.modifier"):
            return
        d = DialogueEleve(self)
        if d.exec():
            self.ctx.modifie("eleves")
            self.table.selectionner(lambda r: r["eleve_id"] == d.eleve_id)

    def modifier(self):
        r = self.table.ligne_courante()
        if not r or not self.b_modifier.isEnabled():
            return
        d = DialogueEleve(self, r)
        if d.exec():
            self.ctx.modifie("eleves")
            self.table.selectionner(lambda x: x["eleve_id"] == r["eleve_id"])

    def _changer_classe(self):
        r = self.table.ligne_courante()
        if r and DialogueChangerClasse(self, r).exec():
            self.ctx.modifie("eleves")

    @protege
    def _supprimer(self):
        r = self.table.ligne_courante()
        if not r:
            return
        if not confirmer(self, "Supprimer l'élève",
                         f"Supprimer définitivement {r['nom']} ({r['matricule_ecole']}) ?\n\n"
                         "Sa fiche, ses inscriptions, ses notes et ses absences seront effacées. Pour un départ en "
                         "cours d'année, préférez le statut « Abandon » ou « Transféré » (Modifier › Scolarité), "
                         "qui conserve l'historique.", "Supprimer", danger=True):
            return
        if not valider_suppression(self, self.db, self.s, f"élève {r['nom']} ({r['matricule_ecole']})"):
            return
        repo.delete_eleve(self.db, self.s, r["eleve_id"])
        self.ctx.modifie("eleves")
        info(self, "Élève supprimé", f"{r['nom']} a été supprimé.")

    def _fiche_scolaire(self):
        r = self.table.ligne_courante()
        if not r:
            return
        from epp.ui.dialogs.export import exporter_rapport
        exporter_rapport(self, "FICHE_SCOLAIRE", {"classe": r["classe"], "eleve": r["inscription_id"]},
                         f"Fiche scolaire {r['nom']} {self.annee.libelle}")

    def _exporter(self):
        from epp.ui.dialogs.export import exporter_rapport
        c = self.filtre_classe()
        if c:
            exporter_rapport(self, "ETAT_CLASSE", {"classe": c}, f"Liste des élèves {c}")
        else:
            exporter_rapport(self, "REGISTRE", {}, "Registre des élèves")
