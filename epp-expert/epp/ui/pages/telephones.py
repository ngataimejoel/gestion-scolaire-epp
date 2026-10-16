"""Téléphones : synchronisation avec l'application Android AKWA SCHOOL par le Wi-Fi de l'école (sans Internet,
sans abonnement), ou par fichier quand le téléphone est ailleurs (WhatsApp, e-mail). Démarrage du serveur,
association d'un téléphone par code, import d'un fichier du téléphone, liste des téléphones associés."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QHBoxLayout,
                               QLabel, QLineEdit, QVBoxLayout)

from epp.core import licence, paths, security
from epp.synchro import fichier as F
from epp.synchro import protocole
from epp.synchro.serveur import lister_appareils, revoquer
from epp.ui import theme
from epp.ui.pages.base import Page
from epp.ui.synchro import LIEN_APK, PARAM_AUTO, image_qr
from epp.ui.widgets import Carte, Col, Tableau, bouton, confirmer, info, label, ligne, protege


class PageTelephones(Page):
    titre = "Téléphones"
    sous_titre = "Application Android AKWA SCHOOL : synchronisée par le Wi-Fi de l'école, ou par fichier (WhatsApp, e-mail)"
    permission = None
    besoin_annee = False

    def __init__(self, ctx):
        super().__init__(ctx)
        # ---------------------------------------------------------------- serveur
        c = Carte("Synchronisation par le Wi-Fi de l'école")
        self.l_etat = label("", gras=True)
        self.l_adr = label("", wrap=True)
        self.l_adr.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.b_marche = bouton("Démarrer la synchronisation", self._basculer, "primaire")
        self.auto = QCheckBox("Démarrer automatiquement à l'ouverture de l'application")
        self.auto.toggled.connect(self._auto)
        c.lay.addLayout(ligne(self.l_etat, None, self.b_marche))
        c.lay.addWidget(self.l_adr)
        c.lay.addWidget(self.auto)
        c.lay.addWidget(label(
            "Le téléphone et cet ordinateur doivent être connectés au même réseau Wi-Fi (celui de l'école, ou le "
            "partage de connexion d'un téléphone). Au premier démarrage, Windows peut demander d'autoriser "
            "AKWA SCHOOL sur les réseaux privés : cliquez sur « Autoriser ». Les données échangées sont chiffrées.",
            discret=True, wrap=True))
        self.corps.addWidget(c)

        h = QHBoxLayout()
        h.setSpacing(12)
        # ---------------------------------------------------------------- association
        c2 = Carte("Associer un téléphone")
        f = QFormLayout()
        self.compte = QComboBox()
        f.addRow("Compte utilisé par le téléphone", self.compte)
        c2.lay.addLayout(f)
        self.b_code = bouton("Afficher un code d'association", self._code, "primaire")
        self.b_annuler = bouton("Annuler le code", self._annuler)
        c2.lay.addLayout(ligne(self.b_code, self.b_annuler, None))
        self.l_code = QLabel("")
        self.l_code.setAlignment(Qt.AlignCenter)
        self.l_code.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.l_code.setStyleSheet(f"font-size: 30pt; font-weight: 700; letter-spacing: 4px; color: {theme.PRIMAIRE};")
        self.l_code_info = label("", discret=True, wrap=True)
        self.l_code_info.setAlignment(Qt.AlignCenter)
        c2.lay.addWidget(self.l_code)
        c2.lay.addWidget(self.l_code_info)
        c2.lay.addWidget(label(
            "Sur le téléphone : ouvrez AKWA SCHOOL, touchez « Associer ce téléphone », choisissez cet ordinateur "
            "(ou saisissez son adresse), puis tapez le code. Le téléphone reçoit les données que ce compte peut "
            "consulter ; ses saisies respectent les mêmes droits et le même mot de passe administrateur.",
            discret=True, wrap=True))
        c2.lay.addStretch(1)
        h.addWidget(c2, 3)
        # ---------------------------------------------------------------- téléchargement
        c3 = Carte("Installer l'application sur un téléphone")
        qr = QLabel()
        qr.setPixmap(image_qr(LIEN_APK))
        qr.setAlignment(Qt.AlignCenter)
        c3.lay.addWidget(qr)
        lien = label(f'<a href="{LIEN_APK}">{LIEN_APK}</a>', wrap=True)
        lien.setOpenExternalLinks(True)
        lien.setTextInteractionFlags(Qt.TextBrowserInteraction)
        c3.lay.addWidget(label("Scannez ce code avec l'appareil photo du téléphone (Android 8 ou plus récent), "
                               "téléchargez AkwaSchool.apk puis ouvrez-le pour l'installer.", discret=True, wrap=True))
        c3.lay.addWidget(lien)
        c3.lay.addStretch(1)
        h.addWidget(c3, 2)
        self.corps.addLayout(h)

        # ---------------------------------------------------------------- par fichier
        c5 = Carte("Téléphone hors du Wi-Fi de l'école : synchronisation par fichier")
        c5.lay.addWidget(label(
            "Le téléphone (déjà associé) crée un fichier chiffré (.akwasync) qu'on vous envoie par WhatsApp ou e-mail. "
            "Importez-le ici : ses saisies sont appliquées avec les mêmes droits et contrôles que par le Wi-Fi, puis un "
            "fichier de réponse est créé. Renvoyez-le au téléphone : il l'ouvre avec AKWA SCHOOL et reçoit les données à "
            "jour. La synchronisation par le Wi-Fi n'a pas besoin d'être démarrée.", discret=True, wrap=True))
        self.b_fichier = bouton("Importer un fichier du téléphone…", self._importer_fichier, "primaire")
        c5.lay.addLayout(ligne(self.b_fichier, None))
        self.corps.addWidget(c5)

        # ---------------------------------------------------------------- appareils
        c4 = Carte("Téléphones associés")
        self.table = Tableau([Col("nom", "Téléphone", largeur=200), Col("utilisateur", "Compte", largeur=180),
                              Col("cree_le", "Associé le", largeur=140),
                              Col("dernier_contact", "Dernière synchronisation", largeur=170), Col("etat", "État")])
        self.table.setMinimumHeight(170)
        c4.lay.addWidget(self.table, 1)
        self.b_revoquer = bouton("Retirer ce téléphone", self._revoquer, "danger",
                                 "Téléphone perdu ou remplacé : il ne pourra plus se synchroniser")
        self.b_maj = bouton("Actualiser", self.rafraichir)
        c4.lay.addLayout(ligne(label("Un téléphone retiré ne reçoit plus rien et ses données se verrouillent à sa "
                                     "prochaine tentative de synchronisation.", discret=True, wrap=True),
                               self.b_maj, self.b_revoquer))
        self.corps.addWidget(c4, 1)

        self.minuteur = QTimer(self)
        self.minuteur.setInterval(1000)
        self.minuteur.timeout.connect(self._maj_code)

    # ------------------------------------------------------------------ utilitaires
    @property
    def synchro(self):
        return self.fenetre.synchro

    def showEvent(self, e):
        super().showEvent(e)
        if not getattr(self, "_relie", False):
            self.synchro.etat_change.connect(self.invalider)
            self._relie = True

    def rafraichir(self):
        en_marche = self.synchro.en_marche
        regler = self.peut("parametres.modifier")
        self.l_etat.setText("● En marche" if en_marche else "○ Arrêtée")
        self.l_etat.setStyleSheet(f"color: {theme.PRIMAIRE if en_marche else theme.DISCRET};")
        if en_marche:
            adr = self.synchro.adresses()
            txt = "Adresse de cet ordinateur sur le réseau : <b>" + "</b> ou <b>".join(adr) + "</b>"
            if self.synchro.dernier_message:
                txt += f"<br>Dernière réception : {self.synchro.dernier_message}"
            self.l_adr.setText(txt)
        else:
            self.l_adr.setText("Les téléphones ne peuvent pas se synchroniser tant que la synchronisation est arrêtée."
                               + ("" if regler else " Demandez à un administrateur ou au directeur de la démarrer."))
        self.b_marche.setText("Arrêter la synchronisation" if en_marche else "Démarrer la synchronisation")
        self.b_marche.setProperty("role", "danger" if en_marche else "primaire")
        self.b_marche.style().unpolish(self.b_marche)
        self.b_marche.style().polish(self.b_marche)
        self.b_marche.setEnabled(regler)
        self.auto.blockSignals(True)
        self.auto.setChecked(self.db.get_param(PARAM_AUTO) == "1")
        self.auto.blockSignals(False)
        self.auto.setEnabled(regler)
        # comptes : le sien, ou tous pour qui gère les utilisateurs
        courant = self.compte.currentData()
        self.compte.clear()
        tous = self.peut("utilisateurs.gerer")
        profs = self.peut("enseignants.gerer")       # le directeur associe les téléphones des enseignants
        for u in security.lister_utilisateurs(self.db):
            if u["actif"] and (tous or u["id"] == self.s.user_id or (profs and u["role"] == security.ROLE_ENSEIGNANT)):
                self.compte.addItem(f"{u['nom']} ({u['login']} – {u['role_libelle']})", u["id"])
        i = self.compte.findData(courant if courant is not None else self.s.user_id)
        self.compte.setCurrentIndex(max(i, 0))
        self.b_code.setEnabled(self.compte.count() > 0 and (en_marche or regler))
        lignes = lister_appareils(self.db, None if tous or profs else self.s.user_id)
        for r in lignes:
            r["utilisateur"] = f"{r['utilisateur']} ({r['login']})"
            r["dernier_contact"] = r["dernier_contact"] or "jamais"
            r["etat"] = "actif" if r["actif"] else "retiré"
            if not r["actif"]:
                r["_couleur"] = theme.DISCRET
        self.table.set_lignes(lignes)
        self._maj_code()

    def _maj_code(self):
        code = self.synchro.srv.code if self.synchro.en_marche else None
        self.b_annuler.setVisible(code is not None)
        if code is None:
            self.minuteur.stop()
            self.l_code.setText("")
            self.l_code_info.setText("")
            return
        m, s = divmod(code.secondes_restantes, 60)
        self.l_code.setText(protocole.afficher_code(code.code))
        self.l_code_info.setText(f"Adresse : {' ou '.join(self.synchro.adresses())} · code valable encore "
                                 f"{m} min {s:02d} s, une seule fois")

    # ------------------------------------------------------------------ actions
    @protege
    def _basculer(self):
        if self.synchro.en_marche:
            self.synchro.arreter()
        else:
            self.synchro.demarrer()
        security.log(self.db, self.s.login, "SYNCHRO_" + ("DEMARREE" if self.synchro.en_marche else "ARRETEE"),
                     "appareil", "")
        self.rafraichir()

    @protege
    def _auto(self, oui: bool):
        self.s.require("parametres.modifier")
        self.db.set_param(PARAM_AUTO, "1" if oui else "0")

    @protege
    def _code(self):
        uid = self.compte.currentData()
        if uid is None:
            return
        if uid != self.s.user_id:
            self.s.require("utilisateurs.gerer")
        if not self.synchro.en_marche:
            self.synchro.demarrer()
        self.synchro.srv.nouveau_code(uid, self.s.login)
        security.log(self.db, self.s.login, "CODE_ASSOCIATION", "appareil", f"compte {self.compte.currentText()}")
        self.minuteur.start()
        self.rafraichir()

    def _annuler(self):
        if self.synchro.en_marche:
            self.synchro.srv.annuler_code()
        self._maj_code()

    @protege
    def _revoquer(self):
        r = self.table.ligne_courante()
        if not r or not r["actif"]:
            return
        if not confirmer(self, "Retirer un téléphone", f"Le téléphone « {r['nom']} » ne pourra plus se "
                                                       "synchroniser. Continuer ?", "Retirer", danger=True):
            return
        revoquer(self.db, self.s, r["id"])
        self.rafraichir()
        info(self, "Téléphone retiré", f"« {r['nom']} » est retiré. Pour l'utiliser de nouveau, associez-le avec "
                                       "un nouveau code.")

    # ------------------------------------------------------------------ synchronisation par fichier
    @protege
    def _importer_fichier(self):
        dossier = Path.home() / "Downloads"
        ch, _ = QFileDialog.getOpenFileName(self, "Fichier envoyé par le téléphone", str(dossier if dossier.is_dir() else
                                                                                         Path.home()),
                                            "Fichiers du téléphone AKWA SCHOOL (*.akwasync);;Tous les fichiers (*)")
        if not ch:
            return
        data = Path(ch).read_bytes()
        imp = F.ImportFichier(self.db.path, licence.etat,
                              quand_modifie=lambda q, nom, n: self.synchro.recu.emit(q, nom, n))
        try:
            ap = imp.examiner(data)
        except F.FichierInvalide as e:
            info(self, "Fichier non reconnu", str(e))
            return
        if ap.get("erreur"):
            info(self, "Fichier non importé", ap["erreur"])
            return
        mdp = self._confirmer_import(ap)
        if mdp is None:
            return
        nom, reponse, rep = imp.importer(data, mdp or None)
        defaut = Path(ch).parent / nom
        dest, _ = QFileDialog.getSaveFileName(self, "Réponse à renvoyer au téléphone", str(defaut),
                                              "Réponse AKWA SCHOOL (*.akwasync)")
        dest = Path(dest) if dest else paths.exports_dir() / nom      # les saisies sont appliquées : la réponse est gardée
        if dest.suffix.lower() != F.EXTENSION:
            dest = dest.with_suffix(F.EXTENSION)
        dest.write_bytes(reponse)
        security.log(self.db, self.s.login, "IMPORT_FICHIER_TELEPHONE", "appareil", f"« {ap['appareil']} » : {Path(ch).name}")
        self.rafraichir()
        info(self, "Fichier du téléphone importé",
             f"{F.resume_reponse(rep)}\n\nRenvoyez maintenant au téléphone « {ap['appareil']} » le fichier :\n{dest}\n\n"
             "(par WhatsApp ou e-mail) : il l'ouvre avec AKWA SCHOOL pour recevoir les données à jour.")

    def _confirmer_import(self, ap: dict) -> str | None:
        """Aperçu du fichier et mot de passe administrateur (facultatif, sauf premier envoi d'un téléphone utilisé
        seul) : renvoie le mot de passe vérifié, « » sans mot de passe, ou None si l'import est annulé."""
        noms = {"note": "note(s)", "presence": "présence(s) aux évaluations", "absence": "absence(s) ou retard(s)",
                "suppr_absence": "suppression(s) d'absence", "eleve": "inscription(s) ou fiche(s) d'élève"}
        detail = ", ".join(f"{n} {noms.get(k, k)}" for k, n in sorted(ap["par_type"].items())) or "aucune saisie"
        texte = (f"Téléphone « {ap['appareil']} » (compte {ap['compte']}), fichier créé le "
                 f"{(ap.get('cree_le') or '?').replace('T', ' à ')[:19]}.\n\nContenu : {detail}.")
        f = ap.get("fusion")
        if f:
            texte += (f"\n\nPremier envoi d'un téléphone utilisé seul : {f['eleves']} élève(s), {f['classes']} classe(s), "
                      f"{f['notes']} note(s), ajoutés à l'année en cours sans rien remplacer. Le mot de passe d'un "
                      "administrateur est obligatoire.")
        else:
            texte += ("\n\nLes corrections de notes et les suppressions demandent le mot de passe d'un administrateur : "
                      "laissez vide pour les laisser en attente sur le téléphone.")
        d = QDialog(self)
        d.setWindowTitle("Importer le fichier du téléphone")
        v = QVBoxLayout(d)
        v.addWidget(label(texte, wrap=True))
        champ = QLineEdit()
        champ.setEchoMode(QLineEdit.Password)
        champ.setPlaceholderText("Mot de passe d'un administrateur" + ("" if f else " (facultatif)"))
        v.addWidget(champ)
        erreur = label("")
        erreur.setStyleSheet(f"color: {theme.DANGER};")
        v.addWidget(erreur)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText("Importer")
        bb.button(QDialogButtonBox.Cancel).setText("Annuler")
        v.addWidget(bb)
        resultat: list[str] = []

        def valider():
            mdp = champ.text()
            if not mdp and f:
                erreur.setText("Le mot de passe d'un administrateur est obligatoire pour ce premier envoi.")
                return
            if mdp and not security.verifier_admin(self.db, self.s, mdp, f"import du fichier du téléphone « {ap['appareil']} »"):
                erreur.setText("Mot de passe incorrect.")
                champ.selectAll()
                champ.setFocus()
                return
            resultat.append(mdp)
            d.accept()

        bb.accepted.connect(valider)
        bb.rejected.connect(d.reject)
        d.setMinimumWidth(460)
        d.exec()
        return resultat[0] if resultat else None
