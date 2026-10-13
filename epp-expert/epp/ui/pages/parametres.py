"""Paramètres : établissement et en-tête d'impression, bulletin, année scolaire, calendrier (jours fériés et
vacances), listes de valeurs, utilisateurs."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (QComboBox, QDialog, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QInputDialog,
                               QLabel, QLineEdit, QPlainTextEdit, QScrollArea, QSpinBox, QTableWidget,
                               QTableWidgetItem, QTabWidget, QVBoxLayout, QWidget)

from epp.core import security, seed
from epp.domain import calendrier, repo
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.widgets import (Col, Formulaire, Tableau, afficher_erreur, bouton, confirmer, info, label, ligne,
                            protege)

LISTES = {"NATIONALITE": "Nationalités", "MOTIF_ABSENCE": "Motifs d'absence", "FONCTION": "Fonctions du personnel",
          "SITUATION_MATRIMONIALE": "Situations matrimoniales", "ORPHELIN_DE": "Orphelin de",
          "CATEGORIE_RAPPORT": "Catégories de rapports"}


def _defilant(w: QWidget) -> QScrollArea:
    s = QScrollArea()
    s.setWidgetResizable(True)
    s.setWidget(w)
    return s


class _Logo(QWidget):
    def __init__(self, page, quel: str):
        super().__init__()
        self.page, self.quel = page, quel
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(label(repo.LOGOS[quel], gras=True))
        self.img = QLabel()
        self.img.setFixedSize(120, 120)
        self.img.setAlignment(Qt.AlignCenter)
        self.img.setStyleSheet(f"background: white; border: 1px dashed {theme.BORDURE_FORTE}; border-radius: 6px;")
        v.addWidget(self.img)
        self.b1 = bouton("Choisir…", self._choisir)
        self.b2 = bouton("Retirer", self._retirer)
        v.addLayout(ligne(self.b1, self.b2))

    def charger(self):
        pm = QPixmap()
        data = repo.get_logo(self.page.db, self.quel)
        if data and pm.loadFromData(data):
            self.img.setPixmap(pm.scaled(112, 112, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            self.img.clear()
            self.img.setText("Aucun logo")

    @protege
    def _choisir(self):
        f, _ = QFileDialog.getOpenFileName(self, repo.LOGOS[self.quel], "", "Images (*.png *.jpg *.jpeg *.bmp *.gif)")
        if f:
            with open(f, "rb") as fh:
                repo.set_logo(self.page.db, self.page.s, self.quel, fh.read())
            self.charger()
            self.page.ctx.modifie("parametres")
            self.page.ctx.annee_changee.emit()

    @protege
    def _retirer(self):
        repo.set_logo(self.page.db, self.page.s, self.quel, None)
        self.charger()
        self.page.ctx.annee_changee.emit()


class OngletEtablissement(QWidget):
    CHAMPS = [("pays", "Pays"), ("devise_pays", "Devise du pays"), ("ministere", "Ministère"),
              ("dren", "Direction régionale (DRENAET)"), ("iepp", "Inspection (IEPP)"), ("ecole_nom", "École"),
              ("ecole_code", "Code de l'école"), ("localite", "Localité"), ("directeur", "Directeur / Directrice"),
              ("secteur", "Secteur pédagogique")]

    def __init__(self, page):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        h = QHBoxLayout()
        self.f = Formulaire([(k, t, "texte") for k, t in self.CHAMPS])
        g = QGroupBox("Identité de l'établissement")
        QVBoxLayout(g).addWidget(self.f)
        h.addWidget(g, 1)
        self.logos = [_Logo(page, "logo_iepp"), _Logo(page, "logo_ecole")]
        gl = QGroupBox("Logos (imprimés dans l'en-tête officiel)")
        hl = QHBoxLayout(gl)
        for l in self.logos:
            hl.addWidget(l)
        h.addWidget(gl)
        v.addLayout(h)
        ge = QGroupBox("En-tête d'impression")
        fe = QFormLayout(ge)
        self.gauche = QPlainTextEdit()
        self.droite = QPlainTextEdit()
        for w in (self.gauche, self.droite):
            w.setFixedHeight(90)
        fe.addRow("Colonne de gauche", self.gauche)
        fe.addRow("Colonne de droite", self.droite)
        fe.addRow(label("Une ligne par ligne imprimée. Variables : {ministere}, {dren}, {iepp}, {ecole}, "
                        "{code_ecole}, {pays}, {devise_pays}, {annee}, {localite}, {directeur}.", discret=True,
                        wrap=True))
        v.addWidget(ge)
        self.b_reset = bouton("Rétablir l'en-tête officiel", self._reset)
        self.b_ok = bouton("Enregistrer", self._ok, "primaire")
        v.addLayout(ligne(self.b_reset, None, self.b_ok))
        v.addStretch(1)

    def charger(self):
        e = repo.etablissement(self.page.db)
        self.f.remplir(e)
        self.gauche.setPlainText(e.get("entete_gauche") or "")
        self.droite.setPlainText(e.get("entete_droite") or "")
        for l in self.logos:
            l.charger()
        ok = self.page.peut("parametres.modifier")
        self.f.activer(ok)
        for w in (self.gauche, self.droite, self.b_reset, self.b_ok, *[b for l in self.logos for b in (l.b1, l.b2)]):
            w.setEnabled(ok)

    @protege
    def _ok(self):
        d = self.f.valeurs()
        d = {k: v or "" for k, v in d.items()}
        d["entete_gauche"] = self.gauche.toPlainText().strip()
        d["entete_droite"] = self.droite.toPlainText().strip()
        repo.save_etablissement(self.page.db, self.page.s, d)
        self.page.ctx.annee_changee.emit()
        info(self, "Paramètres", "Les informations de l'établissement ont été enregistrées.")

    @protege
    def _reset(self):
        repo.reset_entete(self.page.db, self.page.s)
        self.charger()


class OngletBulletin(QWidget):
    def __init__(self, page):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        self.f = Formulaire([
            ("bulletin_titre", "Grand titre", "texte"), ("bulletin_slogan", "Slogan", "texte"),
            ("bulletin_devise", "Devise", "texte"), ("bulletin_pied", "Pied de page", "texte"),
            ("bulletin_palette", "Couleurs", "liste",
             [("", "Selon le modèle (douces par défaut)"),
              ("douce", "Douces : lisibles en noir et blanc, peu d'encre"),
              ("vive", "Vives : pour une impression en couleur")])])
        v.addWidget(self.f)
        v.addWidget(label("Ces textes apparaissent sur le bulletin coloré. Variables : {ecole}, {annee}, {iepp}.",
                          discret=True, wrap=True))
        self.b_ok = bouton("Enregistrer", self._ok, "primaire")
        v.addLayout(ligne(None, self.b_ok))
        v.addStretch(1)

    def charger(self):
        self.f.remplir(repo.etablissement(self.page.db))
        ok = self.page.peut("parametres.modifier")
        self.f.activer(ok)
        self.b_ok.setEnabled(ok)

    @protege
    def _ok(self):
        repo.save_etablissement(self.page.db, self.page.s, {k: v or "" for k, v in self.f.valeurs().items()})
        info(self, "Bulletin", "Les réglages du bulletin ont été enregistrés.")


class OngletAnnee(QWidget):
    def __init__(self, page):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        self.titre = label("", gras=True, taille=11)
        v.addWidget(self.titre)
        self.f = Formulaire([("date_debut", "Début de l'année", "date_obl"), ("date_fin", "Fin de l'année", "date_obl"),
                             ("date_edition", "Date d'édition des états", "date_obl"),
                             ("date_ref_age", "Date de référence pour l'âge", "date_obl"),
                             ("nouveaux_cp1", "Nouveaux inscrits attendus en CP1", "entier", (0, 1000))])
        v.addWidget(self.f)
        self.b_ok = bouton("Enregistrer", self._ok, "primaire")
        self.b_active = bouton("Définir comme année en cours", self._active)
        self.b_nouvelle = bouton("Créer une autre année scolaire…", self._nouvelle)
        v.addLayout(ligne(self.b_nouvelle, self.b_active, None, self.b_ok))
        v.addWidget(label("Le passage normal à l'année suivante (réinscription des admis et redoublants, archivage) "
                          "se fait depuis « Résultats et fin d'année ».", discret=True, wrap=True))
        v.addStretch(1)

    def charger(self):
        a = self.page.annee
        self.titre.setText(f"Année scolaire {a.libelle}" + (" (clôturée)" if a.cloturee else "")
                           + (" – année en cours" if a.active else ""))
        self.f.remplir(vars(a))
        ok = self.page.peut("parametres.modifier")
        self.f.activer(ok and not a.cloturee)
        self.b_ok.setEnabled(ok and not a.cloturee)
        self.b_active.setEnabled(ok and not a.active)
        self.b_nouvelle.setEnabled(ok)

    @protege
    def _ok(self):
        repo.update_annee(self.page.db, self.page.s, self.page.annee.id, **self.f.valeurs())
        self.page.ctx.recharger_annee()
        info(self, "Année scolaire", "Les dates ont été enregistrées.")

    @protege
    def _active(self):
        self.page.s.require("parametres.modifier")
        repo.set_active_annee(self.page.db, self.page.annee.id)
        self.page.ctx.modifie("annees")
        self.page.ctx.recharger_annee()

    @protege
    def _nouvelle(self):
        self.page.s.require("parametres.modifier")
        a = self.page.annee
        lib, ok = QInputDialog.getText(self, "Nouvelle année scolaire",
                                       "Libellé (même classes, grilles et matières que l'année affichée) :",
                                       text=f"{a.an_debut() + 1}-{a.an_debut() + 2}")
        if not ok:
            return
        seed.create_year(self.page.db, lib.strip(), copy_from=a.id, active=False)
        security.log(self.page.db, self.page.s.login, "NOUVELLE_ANNEE", lib.strip(), f"copie de {a.libelle}")
        self.page.ctx.modifie("annees")
        info(self, "Nouvelle année", f"L'année {lib.strip()} a été créée. Choisissez-la dans la liste en haut de "
                                     "l'écran ; inscrivez les élèves depuis « Inscriptions ».")


class DialogueConge(QDialog):
    def __init__(self, page, c: dict | None):
        super().__init__(page)
        self.page, self.c = page, c
        self.setWindowTitle("Jour férié ou vacances")
        v = QVBoxLayout(self)
        self.f = Formulaire([("type", "Type", "liste", list(calendrier.TYPES.items())),
                             ("libelle", "Libellé *", "texte", "ex. Tabaski, Congés de Noël"),
                             ("date_debut", "Du *", "date_obl"), ("date_fin", "Au *", "date_obl")])
        v.addWidget(self.f)
        if c:
            self.f.remplir(c)
        else:
            self.f.remplir({"type": "FERIE"})
            self.f.widgets["date_debut"].dateChanged.connect(
                lambda d: self.f.widgets["date_fin"].date() < d and self.f.widgets["date_fin"].setDate(d))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Enregistrer", self._ok, "primaire")))

    def marquer_erreur(self, champ):
        self.f.marquer_erreur(champ)

    @protege
    def _ok(self):
        calendrier.enregistrer(self.page.db, self.page.s, self.page.annee, self.c["id"] if self.c else None,
                               self.f.valeurs())
        self.accept()


class OngletCalendrier(QWidget):
    def __init__(self, page):
        super().__init__()
        self.page = page
        h = QHBoxLayout(self)
        g = QGroupBox("Jours fériés et vacances")
        v = QVBoxLayout(g)
        v.addWidget(label("Ces jours ne sont pas comptés comme jours de classe : les autorisations d'absence et les "
                          "absences qu'elles créent en tiennent compte automatiquement. Les fêtes à date fixe et "
                          "celles liées à Pâques sont préremplies ; ajoutez les fêtes musulmanes (Ramadan, Tabaski, "
                          "Maouloud…) et les congés scolaires de l'année.", discret=True, wrap=True))
        self.table = Tableau([Col("type_libelle", "Type", largeur=150), Col("libelle", "Libellé", largeur=200),
                              Col("date_debut", "Du", "date", 92), Col("date_fin", "Au", "date", 92),
                              Col("jours_classe_perdus", "Jours de semaine", "nombre")])
        self.table.double_clic.connect(lambda _: self._modifier())
        v.addWidget(self.table, 1)
        self.b_aj = bouton("Ajouter…", self._ajouter, "primaire")
        self.b_mod = bouton("Modifier…", self._modifier)
        self.b_sup = bouton("Supprimer", self._supprimer, "danger")
        self.b_fer = bouton("Ajouter les jours fériés connus", self._feries)
        v.addLayout(ligne(self.b_aj, self.b_mod, self.b_sup, None, self.b_fer))
        h.addWidget(g, 3)
        g2 = QGroupBox("Jours de classe par mois")
        v2 = QVBoxLayout(g2)
        v2.addWidget(label("Utilisés pour le taux de fréquentation des rapports mensuels.", discret=True, wrap=True))
        self.jours = QTableWidget(0, 2)
        self.jours.setHorizontalHeaderLabels(["Mois", "Jours"])
        self.jours.verticalHeader().setVisible(False)
        self.jours.horizontalHeader().setStretchLastSection(True)
        v2.addWidget(self.jours, 1)
        self.b_calc = bouton("Recalculer d'après le calendrier", self._recalculer)
        self.b_jours = bouton("Enregistrer", self._enregistrer_jours, "primaire")
        v2.addLayout(ligne(self.b_calc, None, self.b_jours))
        h.addWidget(g2, 2)

    def charger(self):
        a = self.page.annee
        self.table.set_lignes(calendrier.conges(self.page.db, a))
        self.jours.setRowCount(0)
        for m, j in a.jours.items():
            r = self.jours.rowCount()
            self.jours.insertRow(r)
            it = QTableWidgetItem(seed.MOIS_FR[m - 1])
            it.setData(Qt.UserRole, m)
            it.setFlags(Qt.ItemIsEnabled)
            self.jours.setItem(r, 0, it)
            sp = QSpinBox()
            sp.setRange(0, 31)
            sp.setValue(int(j["jours"] or 0))
            self.jours.setCellWidget(r, 1, sp)
        ok = self.page.peut("parametres.modifier") and not a.cloturee
        for b in (self.b_aj, self.b_mod, self.b_sup, self.b_fer, self.b_calc, self.b_jours):
            b.setEnabled(ok)

    def _apres(self):
        self.charger()
        self.page.ctx.modifie("absences")

    def _ajouter(self):
        if DialogueConge(self.page, None).exec():
            self._apres()

    def _modifier(self):
        c = self.table.ligne_courante()
        if c and self.b_mod.isEnabled() and DialogueConge(self.page, c).exec():
            self._apres()

    @protege
    def _supprimer(self):
        c = self.table.ligne_courante()
        if c and confirmer(self, "Supprimer", f"Retirer « {c['libelle']} » du calendrier ?", "Supprimer", True):
            calendrier.supprimer(self.page.db, self.page.s, self.page.annee, c["id"])
            self._apres()

    @protege
    def _feries(self):
        n = calendrier.ajouter_feries(self.page.db, self.page.s, self.page.annee)
        self._apres()
        info(self, "Jours fériés", f"{n} jour(s) férié(s) ajouté(s)." if n else "Les jours fériés connus sont déjà "
                                                                                  "dans la liste.")

    def _recalculer(self):
        j = calendrier.jours_de_classe_par_mois(self.page.db, self.page.annee)
        for r in range(self.jours.rowCount()):
            m = self.jours.item(r, 0).data(Qt.UserRole)
            if m in j:
                self.jours.cellWidget(r, 1).setValue(j[m])
        info(self, "Jours de classe", "Valeurs recalculées (lundi à vendredi, hors jours fériés et vacances). "
                                      "Vérifiez-les puis cliquez sur « Enregistrer ».")

    @protege
    def _enregistrer_jours(self):
        j = {self.jours.item(r, 0).data(Qt.UserRole): self.jours.cellWidget(r, 1).value()
             for r in range(self.jours.rowCount())}
        calendrier.set_jours_classe(self.page.db, self.page.s, self.page.annee, j)
        self.page.ctx.recharger_annee()
        info(self, "Jours de classe", "Les jours de classe ont été enregistrés.")


class OngletListes(QWidget):
    def __init__(self, page):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        self.liste = QComboBox()
        for k, t in LISTES.items():
            self.liste.addItem(t, k)
        self.liste.currentIndexChanged.connect(lambda _: self.charger())
        v.addLayout(ligne(label("Liste"), self.liste, None))
        self.valeurs = QPlainTextEdit()
        v.addWidget(self.valeurs, 1)
        v.addWidget(label("Une valeur par ligne, dans l'ordre d'affichage des listes déroulantes.", discret=True))
        self.b_ok = bouton("Enregistrer", self._ok, "primaire")
        v.addLayout(ligne(None, self.b_ok))

    def charger(self):
        self.valeurs.setPlainText("\n".join(repo.liste(self.page.db, self.liste.currentData())))
        ok = self.page.peut("parametres.modifier")
        self.valeurs.setReadOnly(not ok)
        self.b_ok.setEnabled(ok)

    @protege
    def _ok(self):
        repo.set_liste(self.page.db, self.page.s, self.liste.currentData(), self.valeurs.toPlainText().splitlines())
        info(self, "Listes", "La liste a été enregistrée.")


class DialogueUtilisateur(QDialog):
    def __init__(self, page, u: dict | None):
        super().__init__(page)
        self.page, self.u = page, u
        self.setWindowTitle("Modifier l'utilisateur" if u else "Nouvel utilisateur")
        v = QVBoxLayout(self)
        f = QFormLayout()
        self.login = QLineEdit(u["login"] if u else "")
        self.login.setEnabled(u is None)
        self.nom = QLineEdit(u["nom"] if u else "")
        self.role = QComboBox()
        for r in security.lister_roles(page.db):
            self.role.addItem(r["libelle"], r["code"])
        if u:
            self.role.setCurrentIndex(max(0, self.role.findData(u["role"])))
        self.mdp = QLineEdit()
        self.mdp.setEchoMode(QLineEdit.Password)
        self.mdp.setPlaceholderText(f"provisoire, au moins {security.MIN_PASSWORD} caractères")
        f.addRow("Identifiant", self.login)
        f.addRow("Nom complet", self.nom)
        f.addRow("Rôle", self.role)
        if not u:
            f.addRow("Mot de passe", self.mdp)
        v.addLayout(f)
        if not u:
            v.addWidget(label("L'utilisateur devra choisir son propre mot de passe à la première connexion.",
                              discret=True, wrap=True))
        v.addLayout(ligne(None, bouton("Annuler", self.reject), bouton("Enregistrer", self._ok, "primaire")))

    @protege
    def _ok(self):
        p = self.page
        if self.u:
            security.modifier_utilisateur(p.db, p.s, self.u["id"], self.nom.text(), self.role.currentData())
        else:
            security.ajouter_utilisateur(p.db, p.s, self.login.text(), self.nom.text(), self.mdp.text(),
                                         self.role.currentData())
        self.accept()


class OngletUtilisateurs(QWidget):
    def __init__(self, page):
        super().__init__()
        self.page = page
        v = QVBoxLayout(self)
        self.table = Tableau([Col("login", "Identifiant", largeur=120), Col("nom", "Nom", largeur=200),
                              Col("role_libelle", "Rôle", largeur=230), Col("etat", "État", largeur=90),
                              Col("derniere_connexion", "Dernière connexion")])
        self.table.double_clic.connect(lambda _: self._modifier())
        v.addWidget(self.table, 1)
        v.addLayout(ligne(bouton("Nouvel utilisateur…", self._nouveau, "primaire"), bouton("Modifier…", self._modifier),
                          bouton("Mot de passe provisoire…", self._mdp), bouton("Activer / désactiver", self._actif),
                          None))
        v.addWidget(label("Les mots de passe sont enregistrés sous forme chiffrée irréversible : personne ne peut "
                          "les lire. Un mot de passe oublié se remplace par un mot de passe provisoire.",
                          discret=True, wrap=True))

    def charger(self):
        us = security.lister_utilisateurs(self.page.db)
        for u in us:
            u["etat"] = ("Actif" if u["actif"] else "Désactivé") + (" · à changer" if u["doit_changer"] else "")
        self.table.set_lignes(us)

    def _nouveau(self):
        if DialogueUtilisateur(self.page, None).exec():
            self.charger()

    def _modifier(self):
        u = self.table.ligne_courante()
        if u and DialogueUtilisateur(self.page, u).exec():
            self.charger()

    @protege
    def _mdp(self):
        u = self.table.ligne_courante()
        if not u:
            return
        m, ok = QInputDialog.getText(self, "Mot de passe provisoire", f"Mot de passe provisoire pour {u['login']} :",
                                     QLineEdit.Password)
        if ok and m:
            security.reinitialiser_mot_de_passe(self.page.db, self.page.s, u["id"], m)
            info(self, "Mot de passe", f"{u['login']} devra choisir un nouveau mot de passe à sa prochaine connexion.")
            self.charger()

    @protege
    def _actif(self):
        u = self.table.ligne_courante()
        if u:
            security.modifier_utilisateur(self.page.db, self.page.s, u["id"], actif=not u["actif"])
            self.charger()


class PageParametres(Page):
    titre = "Paramètres"
    sous_titre = "Établissement, impression, année scolaire, calendrier, listes et utilisateurs"
    ecoute = ("annees",)

    def __init__(self, ctx):
        super().__init__(ctx)
        self.onglets = QTabWidget()
        self.o = {"etab": OngletEtablissement(self), "bulletin": OngletBulletin(self), "annee": OngletAnnee(self),
                  "calendrier": OngletCalendrier(self), "listes": OngletListes(self)}
        self.onglets.addTab(_defilant(self.o["etab"]), "Établissement et en-tête")
        self.onglets.addTab(self.o["bulletin"], "Bulletin")
        self.onglets.addTab(self.o["annee"], "Année scolaire")
        self.onglets.addTab(self.o["calendrier"], "Calendrier")
        self.onglets.addTab(self.o["listes"], "Listes de valeurs")
        self.o_users = OngletUtilisateurs(self)
        self.i_users = self.onglets.addTab(self.o_users, "Utilisateurs")
        self.corps.addWidget(self.onglets, 1)

    def rafraichir(self):
        for o in self.o.values():
            try:
                o.charger()
            except Exception as e:     # noqa: BLE001
                afficher_erreur(self, e)
        peut = self.peut("utilisateurs.gerer")
        self.onglets.setTabVisible(self.i_users, peut)
        if peut:
            self.o_users.charger()
        if not self.peut("parametres.modifier"):
            self.set_sous_titre("Consultation seulement : votre profil ne permet pas de modifier les paramètres.")

