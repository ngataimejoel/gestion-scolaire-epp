"""Enseignants (directeur) : comptes des enseignants, suivi des classes, validation et période de saisie des notes,
messages et journal des enseignants. Chaque enseignant ne voit que sa classe, sur l'ordinateur comme sur son
téléphone ; une fiche du personnel désactivée bloque son compte et ses téléphones."""
from __future__ import annotations

from datetime import date

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout, QLineEdit, QTabWidget,
                               QTextEdit, QVBoxLayout, QWidget)

from epp.domain import enseignants as E
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.widgets import Carte, ChampDate, Col, Tableau, bouton, confirmer, info, label, ligne, protege


def _onglet() -> tuple[QWidget, QVBoxLayout]:
    w = QWidget()
    lay = QVBoxLayout(w)
    lay.setContentsMargins(0, 10, 0, 0)
    lay.setSpacing(10)
    return w, lay


class PageEnseignants(Page):
    titre = "Enseignants"
    sous_titre = "Comptes des enseignants, suivi des classes, validation des notes, messages et journal"
    permission = E.PERMISSION
    ecoute = ("notes", "absences", "personnel", "*")

    def __init__(self, ctx):
        super().__init__(ctx)
        self.onglets = QTabWidget()
        self.corps.addWidget(self.onglets, 1)
        self._comptes()
        self._suivi()
        self._notes()
        self._messages()
        self._journal()
        self.onglets.currentChanged.connect(lambda *_: self.rafraichir())

    # ================================================================== construction
    def _comptes(self):
        w, lay = _onglet()
        self.t_comptes = Tableau([Col("nom", "Enseignant", largeur=220), Col("matricule", "Matricule", largeur=90),
                                  Col("classe", "Classe", largeur=60), Col("login", "Identifiant", largeur=110),
                                  Col("etat", "Compte", largeur=150), Col("telephones", "Téléphones", "nombre", 80),
                                  Col("derniere_connexion", "Dernière connexion")])
        lay.addWidget(self.t_comptes, 1)
        self.b_creer = bouton("Créer le compte", self._creer, "primaire")
        self.b_mdp = bouton("Nouveau mot de passe", self._mdp)
        self.b_actif = bouton("Désactiver le compte", self._basculer)
        self.b_lier = bouton("Lier un ancien compte…", self._lier)
        lay.addLayout(ligne(self.b_creer, self.b_mdp, self.b_actif, self.b_lier, None))
        self.validation = QCheckBox("Les notes saisies par les enseignants comptent seulement après ma validation")
        self.validation.toggled.connect(self._validation)
        lay.addWidget(self.validation)
        lay.addWidget(label(
            "Un enseignant ne voit et ne saisit que la classe que sa fiche du personnel tient cette année (page "
            "Personnel). Il change son mot de passe provisoire à la première connexion. Désactiver sa fiche du "
            "personnel (départ, mutation) bloque son compte et ses téléphones.", discret=True, wrap=True))
        self.onglets.addTab(w, "Comptes")

    def _suivi(self):
        w, lay = _onglet()
        self.s_eval = QComboBox()
        self.s_eval.currentIndexChanged.connect(lambda *_: self.rafraichir())
        self.s_jour = ChampDate()
        self.s_jour.set_date(date.today())
        self.s_jour.dateChanged.connect(lambda *_: self.rafraichir())
        lay.addLayout(ligne(label("Évaluation"), self.s_eval, label("Jour"), self.s_jour, None))
        self.t_suivi = Tableau([Col("classe", "Classe", largeur=60), Col("enseignant", "Enseignant", largeur=200),
                                Col("notes", "Notes saisies", largeur=110),
                                Col("notes_manquantes", "Manquantes", "nombre", 90),
                                Col("notes_en_attente", "À valider", "nombre", 80),
                                Col("appel", "Appel du jour", largeur=120),
                                Col("absences_jour", "Absences du jour", "nombre", 110),
                                Col("derniere_synchro", "Dernière synchro du téléphone")])
        lay.addWidget(self.t_suivi, 1)
        self.onglets.addTab(w, "Suivi des classes")

    def _notes(self):
        w, lay = _onglet()
        c = Carte("Notes saisies par les enseignants, en attente de validation")
        self.t_attente = Tableau([Col("classe", "Classe", largeur=70), Col("evaluation", "Évaluation", largeur=200),
                                  Col("n", "Notes", "nombre", 70), Col("saisi_par", "Saisies par")])
        c.lay.addWidget(self.t_attente, 1)
        c.lay.addLayout(ligne(label("Vérifiez la feuille de notes de la classe (Saisie des notes) avant de valider.",
                                    discret=True, wrap=True), bouton("Valider ces notes", self._valider, "primaire")))
        lay.addWidget(c, 1)
        c2 = Carte("Période de saisie des notes")
        self.t_evals = Tableau([Col("calendrier", "Calendrier", largeur=90), Col("libelle", "Évaluation", largeur=200),
                                Col("date", "Date", "date", 100), Col("etat", "Saisie", largeur=90),
                                Col("fin_saisie", "Date limite (rappels)", "date")])
        c2.lay.addWidget(self.t_evals, 1)
        c2.lay.addLayout(ligne(label("Saisie fermée : les enseignants ne peuvent plus saisir ni corriger ; vous le "
                                     "pouvez toujours. La date limite déclenche les rappels sur leurs téléphones.",
                                     discret=True, wrap=True),
                               bouton("Ouvrir / fermer la saisie", self._ouvrir_fermer),
                               bouton("Date limite…", self._date_limite)))
        lay.addWidget(c2, 1)
        self.onglets.addTab(w, "Validation et saisie")

    def _messages(self):
        w, lay = _onglet()
        c = Carte("Nouveau message")
        f = QFormLayout()
        self.m_dest = QComboBox()
        self.m_titre = QLineEdit()
        self.m_texte = QTextEdit()
        self.m_texte.setFixedHeight(90)
        f.addRow("Destinataire", self.m_dest)
        f.addRow("Objet", self.m_titre)
        f.addRow("Message", self.m_texte)
        c.lay.addLayout(f)
        c.lay.addLayout(ligne(label("Les enseignants le reçoivent à la connexion et sur leur téléphone à la "
                                    "synchronisation ; vous voyez qui l'a lu.", discret=True, wrap=True),
                              bouton("Envoyer", self._envoyer, "primaire")))
        lay.addWidget(c)
        self.t_msg = Tableau([Col("cree_le", "Envoyé le", largeur=130), Col("destinataire", "À", largeur=170),
                              Col("titre", "Objet", largeur=220), Col("lecture", "Lu", largeur=60),
                              Col("lu_par", "Lu par")])
        lay.addWidget(self.t_msg, 1)
        self.onglets.addTab(w, "Messages")

    def _journal(self):
        w, lay = _onglet()
        self.j_qui = QComboBox()
        self.j_qui.currentIndexChanged.connect(lambda *_: self.rafraichir())
        lay.addLayout(ligne(label("Enseignant"), self.j_qui, None))
        self.t_journal = Tableau([Col("horodatage", "Date et heure", largeur=140),
                                  Col("utilisateur", "Compte", largeur=100), Col("action", "Action", largeur=170),
                                  Col("details", "Détails")])
        lay.addWidget(self.t_journal, 1)
        self.onglets.addTab(w, "Journal")

    # ================================================================== données
    def rafraichir(self):
        a = self.annee
        i = self.onglets.currentIndex()
        if i == 0:
            lignes = E.enseignants(self.db, a)
            for r in lignes:
                r["etat"] = ("aucun" if not r["utilisateur_id"] else
                             "désactivé" if not r["compte_actif"] else
                             "actif (mot de passe provisoire)" if r["doit_changer"] else "actif")
                r["derniere_connexion"] = r["derniere_connexion"] or ""
                if r["utilisateur_id"] and not r["compte_actif"]:
                    r["_couleur"] = theme.DISCRET
            self.t_comptes.set_lignes(lignes)
            self.b_lier.setVisible(bool(E.comptes_sans_fiche(self.db)))
            self.validation.blockSignals(True)
            self.validation.setChecked((self.db.get_param("validation_notes", "OUI") or "OUI") == "OUI")
            self.validation.blockSignals(False)
        elif i == 1 and a:
            v = self.s_eval.currentData()
            self.s_eval.blockSignals(True)
            self.s_eval.clear()
            for n in a.eval_nums():
                self.s_eval.addItem(a.libelle_evaluation("STD", n), n)
            self.s_eval.setCurrentIndex(max(0, self.s_eval.findData(v)))
            self.s_eval.blockSignals(False)
            lignes = E.suivi(self.db, a, self.s_eval.currentData() or 1, self.s_jour.iso())
            for r in lignes:
                r["notes"] = f"{r['notes_saisies']} / {r['notes_attendues']}"
                if r["notes_manquantes"] or not r["appel"]:
                    r["_couleur"] = theme.ALERTE
            self.t_suivi.set_lignes(lignes)
        elif i == 2 and a:
            att = E.notes_en_attente(self.db, a)
            for r in att:
                r["evaluation"] = a.libelle_evaluation(a.classe(r["classe"]).calendrier if a.classe(r["classe"])
                                                       else "STD", r["eval_num"])
            self.t_attente.set_lignes(att)
            evs = E.evaluations(self.db, a)
            for r in evs:
                r["etat"] = "fermée" if r["saisie_fermee"] else "ouverte"
                if r["saisie_fermee"]:
                    r["_couleur"] = theme.DISCRET
            self.t_evals.set_lignes(evs)
        elif i == 3:
            v = self.m_dest.currentData()
            self.m_dest.clear()
            self.m_dest.addItem("Tous les enseignants", None)
            for r in E.enseignants(self.db, a):
                if r["utilisateur_id"] and r["compte_actif"]:
                    self.m_dest.addItem(f"{r['nom']} ({r['classe'] or '–'})", r["utilisateur_id"])
            self.m_dest.setCurrentIndex(max(0, self.m_dest.findData(v)))
            msgs = E.messages_envoyes(self.db)
            for m in msgs:
                m["lecture"] = f"{m['lus']}/{m['attendus']}"
            self.t_msg.set_lignes(msgs)
        elif i == 4:
            v = self.j_qui.currentData()
            self.j_qui.blockSignals(True)
            self.j_qui.clear()
            self.j_qui.addItem("Tous les enseignants", None)
            for r in E.enseignants(self.db, a):
                if r["login"]:
                    self.j_qui.addItem(f"{r['nom']} ({r['login']})", r["login"])
            self.j_qui.setCurrentIndex(max(0, self.j_qui.findData(v)))
            self.j_qui.blockSignals(False)
            self.t_journal.set_lignes(E.journal(self.db, self.j_qui.currentData()))

    # ================================================================== actions
    def _choisi(self, t: Tableau, quoi: str) -> dict | None:
        r = t.ligne_courante()
        if r is None:
            info(self, "Enseignants", f"Choisissez d'abord {quoi} dans la liste.")
        return r

    @protege
    def _creer(self):
        r = self._choisi(self.t_comptes, "un enseignant")
        if not r:
            return
        if r["utilisateur_id"]:
            info(self, "Compte", f"{r['nom']} a déjà un compte ({r['login']}).")
            return
        dlg = QDialog(self)
        dlg.setWindowTitle(f"Compte de {r['nom']}")
        f = QFormLayout(dlg)
        login = QLineEdit((r["matricule"] or "").lower().replace(" ", ""))
        mdp = QLineEdit(E.mot_de_passe_provisoire())
        f.addRow("Identifiant", login)
        f.addRow("Mot de passe provisoire", mdp)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        f.addRow(bb)
        if dlg.exec() != QDialog.Accepted:
            return
        E.creer_compte(self.db, self.s, r["personnel_id"], login.text(), mdp.text())
        info(self, "Compte créé", f"Remettez ces informations à {r['nom']} :\n\nIdentifiant : {login.text()}\n"
                                  f"Mot de passe provisoire : {mdp.text()}\n\nIl le changera à sa première connexion. "
                                  "Pour son téléphone : page Téléphones, compte « " + r["nom"] + " ».")
        self.ctx.modifie("personnel")

    @protege
    def _mdp(self):
        r = self._choisi(self.t_comptes, "un enseignant")
        if not r or not r["utilisateur_id"]:
            return
        mdp = E.mot_de_passe_provisoire()
        if confirmer(self, "Nouveau mot de passe", f"Donner un nouveau mot de passe provisoire à {r['nom']} ?"):
            E.reinitialiser(self.db, self.s, r["utilisateur_id"], mdp)
            info(self, "Mot de passe", f"Nouveau mot de passe provisoire de {r['nom']} : {mdp}")
            self.rafraichir()

    @protege
    def _basculer(self):
        r = self._choisi(self.t_comptes, "un enseignant")
        if not r or not r["utilisateur_id"]:
            return
        actif = not r["compte_actif"]
        if actif or confirmer(self, "Désactiver", f"Désactiver le compte de {r['nom']} ? Ses téléphones seront "
                                                  "aussi coupés.", "Désactiver", danger=True):
            E.activer(self.db, self.s, r["utilisateur_id"], actif)
            self.rafraichir()

    @protege
    def _lier(self):
        r = self._choisi(self.t_comptes, "la fiche de l'enseignant")
        if not r:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("Lier un ancien compte enseignant")
        f = QFormLayout(dlg)
        cb = QComboBox()
        for u in E.comptes_sans_fiche(self.db):
            cb.addItem(f"{u['nom']} ({u['login']})", u["id"])
        f.addRow(f"Compte de {r['nom']}", cb)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        f.addRow(bb)
        if dlg.exec() == QDialog.Accepted and cb.currentData():
            E.lier_compte(self.db, self.s, cb.currentData(), r["personnel_id"])
            self.rafraichir()

    @protege
    def _validation(self, oui: bool):
        self.s.require(E.PERMISSION)
        self.db.set_param("validation_notes", "OUI" if oui else "NON")

    @protege
    def _valider(self):
        r = self._choisi(self.t_attente, "une classe")
        if r and confirmer(self, "Valider", f"Valider les {r['n']} note(s) de {r['classe']} – {r['evaluation']} ? "
                                            "Elles compteront dans les moyennes et les bulletins.", "Valider"):
            E.valider_notes(self.db, self.s, self.annee, r["classe"], r["eval_num"])
            self.ctx.modifie("notes")

    @protege
    def _ouvrir_fermer(self):
        r = self._choisi(self.t_evals, "une évaluation")
        if r:
            E.regler_saisie(self.db, self.s, self.annee, r["calendrier"], r["num"], not r["saisie_fermee"],
                            r["fin_saisie"])
            self.rafraichir()

    @protege
    def _date_limite(self):
        r = self._choisi(self.t_evals, "une évaluation")
        if not r:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle(f"Date limite de saisie – {r['libelle']}")
        f = QFormLayout(dlg)
        d = ChampDate()
        if r["fin_saisie"]:
            d.set_iso(r["fin_saisie"])
        else:
            d.set_iso(r["date"] or date.today().isoformat())
        f.addRow("Les notes doivent être saisies avant le", d)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(dlg.accept)
        bb.rejected.connect(dlg.reject)
        f.addRow(bb)
        if dlg.exec() == QDialog.Accepted:
            E.regler_saisie(self.db, self.s, self.annee, r["calendrier"], r["num"], bool(r["saisie_fermee"]), d.iso())
            self.rafraichir()

    @protege
    def _envoyer(self):
        E.envoyer_message(self.db, self.s, self.m_titre.text(), self.m_texte.toPlainText(), self.m_dest.currentData())
        self.m_titre.clear()
        self.m_texte.clear()
        self.rafraichir()
