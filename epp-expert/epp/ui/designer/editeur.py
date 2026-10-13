"""Concepteur de rapports : mise en page, sections, colonnes, filtres et tris, avec aperçu immédiat.

Chaque enregistrement crée une nouvelle version du modèle (historique consultable et restaurable).
Les sections spécialisées (bulletins, tableaux statistiques…) se règlent dans « Réglages avancés ».
"""
from __future__ import annotations

import copy
import json

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFormLayout, QGroupBox, QHBoxLayout, QHeaderView,
                               QInputDialog, QLineEdit, QListWidget, QListWidgetItem, QMenu, QPlainTextEdit,
                               QSpinBox, QSplitter, QStackedWidget, QTableWidget, QTabWidget, QToolButton,
                               QVBoxLayout, QWidget)

from epp.reports import datasets, engine, model, render_pdf, store
from epp.ui.dialogs.export import DialogueApercu, fichier_apercu
from epp.ui.widgets import afficher_erreur, bouton, info, label, ligne


def _combo(items: dict | list, valeur=None, editable: bool = False) -> QComboBox:
    c = QComboBox()
    c.setEditable(editable)
    for k, t in (items.items() if isinstance(items, dict) else [(x, x) for x in items]):
        c.addItem(t, k)
    if valeur is not None:
        i = c.findData(valeur)
        if i >= 0:
            c.setCurrentIndex(i)
        elif editable:
            c.setEditText(str(valeur))
    return c


class _TableLignes(QWidget):
    """Petite grille éditable (colonnes, filtres, tris) avec ajout, retrait et déplacement."""

    def __init__(self, entetes: list[str], fabrique, lire):
        super().__init__()
        self.fabrique, self.lire = fabrique, lire
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        self.t = QTableWidget(0, len(entetes))
        self.t.setHorizontalHeaderLabels(entetes)
        self.t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.t.verticalHeader().setVisible(False)
        v.addWidget(self.t, 1)
        v.addLayout(ligne(bouton("Ajouter", lambda: self.ajouter({})), bouton("Retirer", self._retirer),
                          bouton("▲", lambda: self._deplacer(-1)), bouton("▼", lambda: self._deplacer(1)), None))

    def ajouter(self, data: dict):
        r = self.t.rowCount()
        self.t.insertRow(r)
        for c, w in enumerate(self.fabrique(data)):
            self.t.setCellWidget(r, c, w)

    def remplir(self, lignes: list[dict]):
        self.t.setRowCount(0)
        for d in lignes:
            self.ajouter(d)

    def valeurs(self) -> list[dict]:
        out = []
        for r in range(self.t.rowCount()):
            d = self.lire([self.t.cellWidget(r, c) for c in range(self.t.columnCount())])
            if d:
                out.append(d)
        return out

    def _retirer(self):
        r = self.t.currentRow()
        if r >= 0:
            self.t.removeRow(r)

    def _deplacer(self, pas: int):
        r = self.t.currentRow()
        lignes = self.valeurs()
        if r < 0 or not 0 <= r + pas < len(lignes):
            return
        lignes[r], lignes[r + pas] = lignes[r + pas], lignes[r]
        self.remplir(lignes)
        self.t.setCurrentCell(r + pas, 0)


def _texte(w) -> str:
    return w.currentText().strip() if isinstance(w, QComboBox) else w.text().strip()


class EditeurTableau(QWidget):
    """Section « tableau de données » : source, colonnes, filtres, tri, regroupement, totaux."""

    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        v = QVBoxLayout(self)
        f = QFormLayout()
        self.source = _combo({k: s.libelle for k, s in datasets.SOURCES.items()})
        self.source.currentIndexChanged.connect(self._source)
        self.regroupement = QComboBox()
        f.addRow("Données", self.source)
        f.addRow("Regrouper par", self.regroupement)
        v.addLayout(f)
        self.desc = label("", discret=True, wrap=True)
        v.addWidget(self.desc)
        self.champs: dict[str, str] = {}
        self.onglets = QTabWidget()
        self.colonnes = _TableLignes(["Champ", "Titre (vide = libellé)", "Format", "Alignement", "Largeur (mm)",
                                      "Total"], self._f_col, self._l_col)
        self.filtres = _TableLignes(["Champ", "Condition", "Valeur", "ou paramètre"], self._f_fil, self._l_fil)
        self.tri = _TableLignes(["Champ", "Ordre"], self._f_tri, self._l_tri)
        self.onglets.addTab(self.colonnes, "Colonnes")
        self.onglets.addTab(self.filtres, "Filtres")
        self.onglets.addTab(self.tri, "Tri")
        v.addWidget(self.onglets, 1)
        self.c_saut = QCheckBox("Nouvelle page à chaque groupe")
        self.c_sous = QCheckBox("Sous-totaux par groupe")
        self.c_total = QCheckBox("Total général")
        self.c_renum = QCheckBox("Renuméroter la colonne N°")
        v.addLayout(ligne(self.c_saut, self.c_sous, self.c_total, self.c_renum, None))

    def _source(self):
        src = self.source.currentData()
        self.desc.setText(datasets.SOURCES[src].description)
        ctx = None
        try:
            ctx = datasets.Contexte(self.ctx.db, self.ctx.annee, {})
        except TypeError:
            pass
        try:
            ch = datasets.champs(src, ctx)
        except Exception:      # noqa: BLE001 - champs dynamiques indisponibles sans paramètres
            ch = datasets.champs(src)
        self.champs = {c.nom: c.libelle for c in ch}
        if src == "notes":
            self.champs["*notes*"] = "(toutes les matières de l'évaluation)"
        g = self.regroupement.currentData()
        self.regroupement.clear()
        self.regroupement.addItem("(aucun)", "")
        for k, t in self.champs.items():
            if not k.startswith("*"):
                self.regroupement.addItem(t, k)
        self.regroupement.setCurrentIndex(max(0, self.regroupement.findData(g or "")))

    def _f_col(self, d):
        largeur = QSpinBox()
        largeur.setRange(0, 200)
        largeur.setValue(int(d.get("largeur") or 0))
        return [_combo(self.champs, d.get("champ")), QLineEdit(d.get("titre") or ""),
                _combo(model.FORMATS, d.get("format") or "auto"), _combo(model.ALIGNEMENTS, d.get("alignement") or "auto"),
                largeur, _combo(model.AGREGATS, d.get("_agregat") or "")]

    def _l_col(self, w):
        d = {"champ": w[0].currentData()}
        if w[1].text().strip():
            d["titre"] = w[1].text().strip()
        if w[2].currentData() != "auto":
            d["format"] = w[2].currentData()
        if w[3].currentData() != "auto":
            d["alignement"] = w[3].currentData()
        if w[4].value():
            d["largeur"] = w[4].value()
        d["_agregat"] = w[5].currentData()
        return d if d["champ"] else None

    def _f_fil(self, d):
        return [_combo(self.champs, d.get("champ")), _combo(model.OPERATEURS, d.get("op") or "="),
                QLineEdit("" if d.get("valeur") is None else str(d.get("valeur"))),
                _combo({"": "(valeur fixe)", **model.PARAMETRES}, d.get("parametre") or "")]

    def _l_fil(self, w):
        d = {"champ": w[0].currentData(), "op": w[1].currentData()}
        if w[3].currentData():
            d["parametre"] = w[3].currentData()
        else:
            d["valeur"] = w[2].text().strip()
        return d if d["champ"] else None

    def _f_tri(self, d):
        return [_combo(self.champs, d.get("champ")), _combo({"asc": "Croissant", "desc": "Décroissant"},
                                                             d.get("ordre") or "asc")]

    def _l_tri(self, w):
        return {"champ": w[0].currentData(), "ordre": w[1].currentData()} if w[0].currentData() else None

    def charger(self, s: dict):
        self.source.blockSignals(True)
        self.source.setCurrentIndex(max(0, self.source.findData(s.get("source") or "eleves")))
        self.source.blockSignals(False)
        self._source()
        self.regroupement.setCurrentIndex(max(0, self.regroupement.findData(s.get("regroupement") or "")))
        ag = s.get("agregats") or {}
        self.colonnes.remplir([c | {"_agregat": ag.get(c.get("champ"), "")} for c in s.get("colonnes", [])])
        self.filtres.remplir(s.get("filtres", []))
        self.tri.remplir(s.get("tri", []))
        self.c_saut.setChecked(bool(s.get("saut_page_groupe")))
        self.c_sous.setChecked(s.get("sous_totaux", True))
        self.c_total.setChecked(s.get("total_general", True))
        self.c_renum.setChecked(s.get("renumeroter", True))

    def ecrire(self, s: dict) -> None:
        cols = self.colonnes.valeurs()
        s["agregats"] = {c["champ"]: c["_agregat"] for c in cols if c.get("_agregat")}
        for c in cols:
            c.pop("_agregat", None)
        s.update(source=self.source.currentData(), colonnes=cols, filtres=self.filtres.valeurs(),
                 tri=self.tri.valeurs(), regroupement=self.regroupement.currentData() or "",
                 saut_page_groupe=self.c_saut.isChecked(), sous_totaux=self.c_sous.isChecked(),
                 total_general=self.c_total.isChecked(), renumeroter=self.c_renum.isChecked())


class EditeurTexte(QWidget):
    def __init__(self):
        super().__init__()
        f = QFormLayout(self)
        self.texte = QPlainTextEdit()
        self.style = _combo({"normal": "Normal", "titre2": "Sous-titre", "note": "Note (italique)"})
        f.addRow("Texte", self.texte)
        f.addRow("Style", self.style)
        f.addRow(label("Variables utilisables : " + ", ".join(model.VARIABLES), discret=True, wrap=True))

    def charger(self, s):
        self.texte.setPlainText(s.get("texte") or "")
        self.style.setCurrentIndex(max(0, self.style.findData(s.get("style") or "normal")))

    def ecrire(self, s):
        s.update(texte=self.texte.toPlainText(), style=self.style.currentData())


class EditeurSignature(QWidget):
    def __init__(self):
        super().__init__()
        f = QFormLayout(self)
        self.fonction = QLineEdit()
        self.nom = QLineEdit()
        self.lieu = QCheckBox("Afficher « Fait à …, le … »")
        f.addRow("Fonction", self.fonction)
        f.addRow("Nom", self.nom)
        f.addRow("", self.lieu)

    def charger(self, s):
        self.fonction.setText(s.get("fonction") or "")
        self.nom.setText(s.get("nom") or "")
        self.lieu.setChecked(s.get("lieu_date", True))

    def ecrire(self, s):
        s.update(fonction=self.fonction.text(), nom=self.nom.text(), lieu_date=self.lieu.isChecked())


class EditeurAvance(QWidget):
    """Réglages de la section au format JSON (sections spécialisées)."""

    def __init__(self):
        super().__init__()
        v = QVBoxLayout(self)
        v.addWidget(label("Réglages détaillés de la section. Modifiez les valeurs avec précaution : le modèle est "
                          "vérifié à l'aperçu et à l'enregistrement.", discret=True, wrap=True))
        self.json = QPlainTextEdit()
        self.json.setStyleSheet("font-family: Consolas, 'DejaVu Sans Mono', monospace;")
        v.addWidget(self.json, 1)

    def charger(self, s):
        self.json.setPlainText(json.dumps({k: v for k, v in s.items() if k not in ("type", "titre")},
                                          ensure_ascii=False, indent=2))

    def ecrire(self, s):
        try:
            d = json.loads(self.json.toPlainText() or "{}")
        except json.JSONDecodeError as e:
            raise model.ModeleInvalide(f"Réglages avancés : JSON invalide ({e.msg}, ligne {e.lineno}).") from None
        if not isinstance(d, dict):
            raise model.ModeleInvalide("Réglages avancés : un objet { … } est attendu.")
        s.update(d)


class EditeurModele(QDialog):
    def __init__(self, page, ref: int):
        super().__init__(page)
        self.page, self.ctx, self.ref = page, page.ctx, ref
        m = store.get(page.db, ref)
        self.defn = copy.deepcopy(store.definition(page.db, ref))
        self.setWindowTitle(f"Concepteur – {m['nom']}")
        self.resize(1100, 720)
        v = QVBoxLayout(self)
        self.onglets = QTabWidget()
        v.addWidget(self.onglets, 1)
        self.onglets.addTab(self._doc(), "Document")
        self.onglets.addTab(self._sections(), "Sections")
        v.addLayout(ligne(label("Chaque enregistrement crée une nouvelle version (historique restaurable).",
                                discret=True), None, bouton("Aperçu", self._apercu), bouton("Annuler", self.reject),
                          bouton("Enregistrer", self._enregistrer, "primaire")))
        self._charger_doc()
        self._liste_sections()

    # ------------------------------------------------------------------ document
    def _doc(self) -> QWidget:
        w = QWidget()
        h = QHBoxLayout(w)
        g1 = QGroupBox("Titre et page")
        f = QFormLayout(g1)
        self.titre = QLineEdit()
        self.sous_titre = QLineEdit()
        self.orientation = _combo({"portrait": "Portrait", "paysage": "Paysage"})
        self.repeter = _combo({"": "Non", "classe": "Oui : une partie par classe (nouvelle page)"})
        f.addRow("Titre", self.titre)
        f.addRow("Sous-titre", self.sous_titre)
        f.addRow("Orientation", self.orientation)
        f.addRow("Répéter par classe", self.repeter)
        h.addWidget(g1, 1)
        g2 = QGroupBox("En-tête et pied de page")
        f2 = QFormLayout(g2)
        self.officiel = QCheckBox("En-tête officiel (ministère, DRENAET, IEPP, école)")
        self.logo = QCheckBox("Logos")
        self.entete_txt = QLineEdit()
        self.pied = QLineEdit()
        self.numeros = QCheckBox("Numéros de page")
        self.date_ed = QCheckBox("Date d'édition")
        f2.addRow("", self.officiel)
        f2.addRow("", self.logo)
        f2.addRow("Texte d'en-tête", self.entete_txt)
        f2.addRow("Pied de page", self.pied)
        f2.addRow("", self.numeros)
        f2.addRow("", self.date_ed)
        h.addWidget(g2, 1)
        g3 = QGroupBox("Paramètres demandés à l'impression")
        v3 = QVBoxLayout(g3)
        self.params = {}
        for k, t in model.PARAMETRES.items():
            c = QCheckBox(t)
            self.params[k] = c
            v3.addWidget(c)
        v3.addStretch(1)
        h.addWidget(g3)
        return w

    def _charger_doc(self):
        d = self.defn
        self.titre.setText(d.get("titre") or "")
        self.sous_titre.setText(d.get("sous_titre") or "")
        self.orientation.setCurrentIndex(max(0, self.orientation.findData(d["page"].get("orientation", "portrait"))))
        self.repeter.setCurrentIndex(max(0, self.repeter.findData(d.get("repeter_par") or "")))
        e, p = d.get("entete", {}), d.get("pied", {})
        self.officiel.setChecked(e.get("officiel", True))
        self.logo.setChecked(e.get("logo", True))
        self.entete_txt.setText(e.get("texte") or "")
        self.pied.setText(p.get("texte") or "")
        self.numeros.setChecked(p.get("numerotation", True))
        self.date_ed.setChecked(p.get("date_edition", True))
        for k, c in self.params.items():
            c.setChecked(k in d.get("parametres", []))

    def _ecrire_doc(self):
        d = self.defn
        d.update(titre=self.titre.text(), sous_titre=self.sous_titre.text(), repeter_par=self.repeter.currentData(),
                 parametres=[k for k, c in self.params.items() if c.isChecked()])
        d["page"]["orientation"] = self.orientation.currentData()
        d.setdefault("entete", {}).update(officiel=self.officiel.isChecked(), logo=self.logo.isChecked(),
                                          texte=self.entete_txt.text())
        d.setdefault("pied", {}).update(texte=self.pied.text(), numerotation=self.numeros.isChecked(),
                                        date_edition=self.date_ed.isChecked())

    # ------------------------------------------------------------------ sections
    def _sections(self) -> QWidget:
        w = QWidget()
        h = QHBoxLayout(w)
        split = QSplitter()
        g = QWidget()
        gv = QVBoxLayout(g)
        gv.setContentsMargins(0, 0, 0, 0)
        self.liste = QListWidget()
        self.liste.currentRowChanged.connect(self._choisir_section)
        gv.addWidget(self.liste, 1)
        b_aj = QToolButton()
        b_aj.setText("Ajouter ▾")
        b_aj.setPopupMode(QToolButton.InstantPopup)
        m = QMenu(b_aj)
        for k, t in model.SECTION_TYPES.items():
            m.addAction(t, lambda k=k: self._ajouter(k))
        b_aj.setMenu(m)
        gv.addLayout(ligne(b_aj, bouton("Retirer", self._retirer), bouton("▲", lambda: self._deplacer(-1)),
                           bouton("▼", lambda: self._deplacer(1))))
        split.addWidget(g)
        d = QWidget()
        dv = QVBoxLayout(d)
        dv.setContentsMargins(0, 0, 0, 0)
        self.s_titre = QLineEdit()
        self.s_type = label("", discret=True)
        dv.addLayout(ligne(label("Titre de la section"), self.s_titre, self.s_type))
        self.pile = QStackedWidget()
        self.e_tableau = EditeurTableau(self.ctx)
        self.e_texte = EditeurTexte()
        self.e_signature = EditeurSignature()
        self.e_avance = EditeurAvance()
        self.e_vide = label("Cette section n'a pas de réglage.", discret=True)
        for x in (self.e_tableau, self.e_texte, self.e_signature, self.e_avance, self.e_vide):
            self.pile.addWidget(x)
        self.s_onglets = QTabWidget()
        self.s_onglets.addTab(self.pile, "Réglages")
        self.av2 = EditeurAvance()
        self.s_onglets.addTab(self.av2, "Réglages avancés")
        dv.addWidget(self.s_onglets, 1)
        split.addWidget(d)
        split.setSizes([300, 780])
        h.addWidget(split)
        self.courante = -1
        return w

    def _editeur(self, t: str):
        return {"tableau": self.e_tableau, "texte": self.e_texte, "signature": self.e_signature,
                "saut_page": self.e_vide}.get(t, self.e_avance)

    def _liste_sections(self, garder: int | None = None):
        self.liste.blockSignals(True)
        self.liste.clear()
        for s in self.defn["sections"]:
            t = model.SECTION_TYPES.get(s["type"], s["type"])
            self.liste.addItem(QListWidgetItem(f"{s.get('titre') or t}" + (f"  ·  {t}" if s.get("titre") else "")))
        self.liste.blockSignals(False)
        self.courante = -1
        if self.defn["sections"]:
            self.liste.setCurrentRow(min(garder or 0, len(self.defn["sections"]) - 1))

    def _sauver_section(self) -> None:
        i = self.courante
        if i < 0 or i >= len(self.defn["sections"]):
            return
        s = self.defn["sections"][i]
        s["titre"] = self.s_titre.text()
        if self.s_onglets.currentWidget() is self.av2:
            self.av2.ecrire(s)
        else:
            self._editeur(s["type"]).ecrire(s) if self._editeur(s["type"]) is not self.e_vide else None

    def _choisir_section(self, i: int):
        try:
            self._sauver_section()
        except Exception as e:     # noqa: BLE001
            afficher_erreur(self, e)
        self.courante = i
        if i < 0:
            return
        s = self.defn["sections"][i]
        self.s_titre.setText(s.get("titre") or "")
        self.s_type.setText(model.SECTION_TYPES.get(s["type"], s["type"]))
        ed = self._editeur(s["type"])
        if ed is not self.e_vide:
            ed.charger(s)
        self.av2.charger(s)
        self.pile.setCurrentWidget(ed)
        self.s_onglets.setCurrentIndex(0)

    def _ajouter(self, t: str):
        self._sauver_section()
        self.defn["sections"].append(model.nouvelle_section(t))
        self._liste_sections(len(self.defn["sections"]) - 1)

    def _retirer(self):
        i = self.liste.currentRow()
        if i >= 0:
            self.courante = -1
            del self.defn["sections"][i]
            self._liste_sections(max(0, i - 1))

    def _deplacer(self, pas: int):
        i = self.liste.currentRow()
        ss = self.defn["sections"]
        if i < 0 or not 0 <= i + pas < len(ss):
            return
        self._sauver_section()
        ss[i], ss[i + pas] = ss[i + pas], ss[i]
        self.courante = -1
        self._liste_sections(i + pas)

    # ------------------------------------------------------------------ aperçu / enregistrement
    def _definition(self) -> dict:
        self._sauver_section()
        self._ecrire_doc()
        return model.valider(copy.deepcopy(self.defn))

    def _apercu(self):
        try:
            d = self._definition()
            a = self.ctx.annee
            params = {"compo": a.eval_nums()[0], "mois": 10}
            if "classe" in d.get("parametres", []) and a.codes:
                params["classe"] = a.codes[0]
            QGuiApplication.setOverrideCursor(Qt.WaitCursor)
            try:
                doc = engine.build_document(self.ctx.db, a, d, params, d.get("titre") or "Aperçu")
                chemin = fichier_apercu("apercu_modele")
                render_pdf.render(doc, chemin)
            finally:
                QGuiApplication.restoreOverrideCursor()
        except Exception as e:     # noqa: BLE001
            afficher_erreur(self, e, "Aperçu impossible")
            return
        DialogueApercu(self, d.get("titre") or "Aperçu", chemin).exec()

    def _enregistrer(self):
        try:
            d = self._definition()
            com, ok = QInputDialog.getText(self, "Enregistrer", "Commentaire de version (facultatif) :")
            if not ok:
                return
            store.enregistrer(self.ctx.db, self.ctx.session, self.ref, d, com)
        except Exception as e:     # noqa: BLE001
            afficher_erreur(self, e, "Enregistrement impossible")
            return
        info(self, "Modèle enregistré", "La nouvelle version du modèle a été enregistrée.")
        self.accept()
