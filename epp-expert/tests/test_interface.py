"""Interface (PySide6, sans écran) : accès, verrouillage, pages et principales actions.

Les boîtes de message sont remplacées par un enregistreur (aucune fenêtre bloquante)."""
from __future__ import annotations

import os
from datetime import date

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["EPP_SANS_ANIMATION"] = "1"
os.environ["EPP_SANS_VIDEO"] = "1"

from PySide6.QtCore import QCoreApplication, QDate, QEvent, Qt         # noqa: E402
from PySide6.QtWidgets import QApplication, QDialog, QInputDialog, QMessageBox   # noqa: E402

from epp.core import licence, security                                 # noqa: E402
from epp.core.security import Session, system_session                  # noqa: E402
from epp.domain import autorisations as au                              # noqa: E402
from epp.domain import repo                                             # noqa: E402

ESSAI = licence.Etat("essai", jours_restants=5)


@pytest.fixture(scope="module")
def app():
    a = QApplication.instance() or QApplication([])
    from epp.ui.main import appliquer_theme
    appliquer_theme(a)
    yield a
    # détruire les fenêtres tant que l'application Qt existe : sinon Python les libère à la sortie, après
    # elle, et l'interpréteur peut planter en quittant (tests tous réussis, code de sortie en erreur)
    import gc
    for w in QApplication.topLevelWidgets():
        w.close()
        w.deleteLater()
    QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)
    a.processEvents()
    gc.collect()
    QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)


@pytest.fixture
def messages(monkeypatch):
    journal = []

    def boite(kind):
        def f(parent, titre, texte, *a, **k):
            journal.append((kind, titre, texte))
            return QMessageBox.Ok
        return staticmethod(f)
    for k in ("critical", "warning", "information", "question"):
        monkeypatch.setattr(QMessageBox, k, boite(k))
    # confirmations (QMessageBox construite) : acceptées par défaut
    monkeypatch.setattr(QMessageBox, "exec", lambda self: journal.append(("box", self.windowTitle(), self.text())))
    monkeypatch.setattr(QMessageBox, "clickedButton", lambda self: self.buttons()[0] if self.buttons() else None)
    monkeypatch.setattr(licence, "etat", lambda *a, **k: ESSAI)
    return journal


@pytest.fixture
def fenetre(app, demo, messages):
    from epp.ui.main import FenetrePrincipale
    from epp.ui.widgets import Contexte
    db, annee = demo
    ctx = Contexte(db, system_session(), annee, ESSAI)
    w = FenetrePrincipale(ctx)
    w.show()
    yield w
    w.timer_licence.stop()
    w.hide()
    w.deleteLater()


def _textes(journal):
    return " | ".join(f"{t}: {x}" for _, t, x in journal)


# =================================================================== accès
def test_premier_lancement_cree_l_administrateur_et_l_annee(app, db, messages):
    from epp.ui.dialogs.acces import DialoguePremierLancement
    d = DialoguePremierLancement(db)
    d.ecole.setText("EPP TEST")
    d._aller(1)
    d.nom.setText("Directrice")
    d.login.setText("dir")
    d.mdp.setText("Secret!2026")
    d.mdp2.setText("Secret!2026")
    d._aller(1)
    assert d.pages.currentIndex() == 2
    d.r_demo.setChecked(True)
    d.libelle.setText("2026-2027")
    d._aller(1)
    assert d.result() == QDialog.Accepted, _textes(messages)
    assert d.session.role_code == "ADMIN" and d.session.can("utilisateurs.gerer")
    h = db.scalar("SELECT hash FROM utilisateur WHERE login='dir'")
    assert h.startswith("pbkdf2_sha256$") and "Secret" not in h
    assert db.get_param("ecole_nom") == "EPP TEST"
    assert repo.list_annees(db)[0]["libelle"] == "2026-2027" and repo.inscriptions(
        db, repo.load_annee(db, repo.active_annee_id(db)))


def test_premier_lancement_refuse_un_mot_de_passe_trop_court(app, db, messages):
    from epp.ui.dialogs.acces import DialoguePremierLancement
    d = DialoguePremierLancement(db)
    d._aller(1)
    d.mdp.setText("123")
    d.mdp2.setText("123")
    d._aller(1)
    assert d.pages.currentIndex() == 1 and "au moins" in _textes(messages)
    assert not security.has_users(db)


def test_connexion_et_mot_de_passe_provisoire(app, db, messages):
    from epp.ui.dialogs.acces import DialogueConnexion, DialogueMotDePasse
    security.create_user(db, "admin", "Admin", "Admin!2026", "ADMIN")
    adm = security.authenticate(db, "admin", "Admin!2026")
    uid = security.ajouter_utilisateur(db, adm, "sec", "Secrétaire", "Provisoire1", "SECRETARIAT")
    d = DialogueConnexion(db, ESSAI)
    d.login.setText("sec")
    d.mdp.setText("mauvais")
    d._valider()
    assert d.session is None and "incorrect" in d.erreur.text()
    d.mdp.setText("Provisoire1")
    d._valider()
    assert d.session and d.session.login == "sec" and security.doit_changer(db, uid)
    m = DialogueMotDePasse(db, d.session, ancien_connu="Provisoire1")
    m.nouveau.setText("MonSecret9")
    m.confirm.setText("MonSecret9")
    m._ok()
    assert not security.doit_changer(db, uid) and security.authenticate(db, "sec", "MonSecret9")


def test_licence_echue_seul_l_ecran_d_activation(app, db, monkeypatch, messages):
    """Essai terminé : aucune fenêtre de données n'est ouverte si l'utilisateur n'active pas de code."""
    from epp.ui import main
    fin = licence.Etat("essai_termine", jours_restants=0)
    monkeypatch.setattr(licence, "etat", lambda *a, **k: fin)
    vus = []
    monkeypatch.setattr(main.DialogueActivation, "exec", lambda self: vus.append(self.statut.text()) or 0)
    assert main.verifier_acces_licence(db) is None
    assert vus and "Période d'essai terminée" in vus[0]


def test_licence_qui_expire_pendant_l_utilisation_masque_les_donnees(fenetre, monkeypatch):
    from epp.ui import main
    monkeypatch.setattr(licence, "etat", lambda *a, **k: licence.Etat("expiree", "1an"))
    monkeypatch.setattr(main.DialogueActivation, "exec", lambda self: 0)
    fenetre.verifier_licence()
    assert not fenetre.isVisible() and fenetre.action_fin is None


# =================================================================== fenêtre et pages
def test_toutes_les_pages_s_ouvrent(fenetre, messages):
    from epp.ui.main import PAGES
    for cle, *_ in PAGES:
        fenetre.aller(cle)
        QApplication.processEvents()
        assert fenetre.page_affichee() is fenetre.pages[cle], cle
    assert not [m for m in messages if m[0] == "critical"], _textes(messages)


def test_menu_selon_le_role(app, demo, messages):
    from epp.ui.main import ADMIN_VOLETS, FenetrePrincipale
    from epp.ui.widgets import Contexte
    db, annee = demo
    ens = Session(5, "ens", "Enseignant", "ENSEIGNANT", "Enseignant", set(security.DEFAULT_ROLES["ENSEIGNANT"][1]))
    w = FenetrePrincipale(Contexte(db, ens, annee, ESSAI))
    assert w.barre.sous["personnel"].isHidden() and not w.barre.groupes["notes_bulletins"].isHidden()
    assert not w.barre.groupes["administration"].isHidden()
    w.aller("personnel")
    assert "personnel" not in w.pages
    w.aller("sauvegarde")                         # onglet sans droit : pas ouvert, et masqué
    assert "sauvegarde" not in w.pages
    w.aller("administration")
    assert w.onglets_admin is not None and not w.onglets_admin.isTabVisible(ADMIN_VOLETS.index("sauvegarde"))
    w.timer_licence.stop()


def test_nouvel_eleve(fenetre, messages):
    from epp.ui.pages.eleves import DialogueEleve
    p = fenetre.page("eleves")
    n = len(p.table.lignes())
    d = DialogueEleve(p)
    d.f_id.widgets["nom"].setText("KOFFI Test Élève")
    d.f_id.widgets["sexe"].setCurrentIndex(1)
    d.f_id.widgets["date_naissance"].setDate(QDate(2019, 3, 4))
    d.f_sco.widgets["classe"].setCurrentIndex(d.f_sco.widgets["classe"].findData("CP1"))
    d._enregistrer()
    assert d.result() == QDialog.Accepted, _textes(messages)
    p.ctx.modifie("eleves")
    lignes = p.table.lignes()
    assert len(lignes) == n + 1
    r = next(x for x in lignes if x["nom"] == "KOFFI Test Élève")
    assert r["sexe"] == "F" and r["classe"] == "CP1" and r["matricule_ecole"].startswith("CP1-")
    # nom manquant : refus, champ signalé
    d2 = DialogueEleve(p)
    d2._enregistrer()
    assert d2.result() != QDialog.Accepted and "obligatoires" in _textes(messages)
    assert d2.f_id.widgets["nom"].property("erreur") is True


def test_saisie_des_notes(fenetre, messages, monkeypatch):
    monkeypatch.setattr("epp.ui.pages.notes.mot_de_passe_admin", lambda *a, **k: "admin")  # corrections
    p = fenetre.page("notes")
    m = p.modele
    col = 4                                     # première matière
    idx = m.index(0, col)
    mat = m.mats[0]
    iid = m.lignes[0]["inscription_id"]
    assert m.setData(idx, "7,5")
    assert p.db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mat["id"])) == 7.5
    assert m.data(idx) == "7,50"
    assert not m.setData(idx, "15")                     # au-delà du barème
    assert "comprise entre 0 et 10" in _textes(messages)
    assert m.setData(m.index(0, 3), Qt.Unchecked.value, Qt.CheckStateRole)   # absent : notes effacées
    assert not m.lignes[0]["present"] and m.lignes[0]["moyenne"] == 0
    assert not (m.flags(idx) & Qt.ItemIsEditable)


def test_autorisation_preremplie_et_jours_feries(fenetre, messages):
    from epp.domain import calendrier
    from epp.ui.pages.absences import DialogueAutorisation
    p = fenetre.page("absences")
    db, annee = p.db, p.annee
    agent = repo.personnel(db, annee)[1]
    d = DialogueAutorisation(p, None, agent["matricule"])
    assert agent["nom"] in d.l_personne.text()
    d.f.widgets["date_debut"].set_date(date(2026, 12, 21))
    d.f.widgets["date_fin"].set_date(date(2026, 12, 25))
    assert "4 jour(s)" in d.l_jours.text()          # Noël férié
    d.f.widgets["motif"].setEditText("Deuil familial")
    d.f.widgets["statut"].setCurrentIndex(d.f.widgets["statut"].findData("ACCORDEE"))
    d._ok()
    assert d.result() == QDialog.Accepted, _textes(messages)
    a = au.get(db, d.aid)
    assert a["jours"] == 4 and a["statut"] == "ACCORDEE"
    assert sum(r["jours"] for r in repo.absences_personnel(db, annee) if r["autorisation_id"] == d.aid) == 4
    assert any(c["libelle"] == "Noël" for c in calendrier.conges(db, annee))


def test_apercu_d_un_rapport(fenetre, messages):
    p = fenetre.page("rapports")
    it = next(i for i in p._items() if i.text(0) == "Tableau des effectifs")
    p.arbre.setCurrentItem(it)
    p._apercu()
    assert p.apercu_pdf and p.apercu_pdf.exists() and p.apercu.pages() >= 1, _textes(messages)


def test_concepteur_enregistre_une_version(fenetre, messages, monkeypatch):
    from epp.reports import store
    from epp.ui.designer.editeur import EditeurModele
    p = fenetre.page("rapports")
    db = p.db
    mid = store.dupliquer(db, p.s, "EFFECTIFS", "Effectifs (copie)")
    v0 = store.get(db, mid)["version_courante"]
    e = EditeurModele(p, mid)
    e.titre.setText("EFFECTIFS PERSONNALISÉS")
    e._ajouter("texte")
    e.e_texte.texte.setPlainText("Document établi le {date_jour}.")
    monkeypatch.setattr(QInputDialog, "getText", staticmethod(lambda *a, **k: ("titre modifié", True)))
    e._enregistrer()
    assert e.result() == QDialog.Accepted, _textes(messages)
    d = store.definition(db, mid)
    assert store.get(db, mid)["version_courante"] == v0 + 1
    assert d["titre"] == "EFFECTIFS PERSONNALISÉS" and d["sections"][-1]["texte"].startswith("Document établi")


def test_sauvegarde_et_restauration(fenetre, messages, monkeypatch):
    p = fenetre.page("sauvegarde")
    db = p.db
    p._maintenant()
    assert p.table.lignes() and "Sauvegarde créée" in _textes(messages)
    fichier = p.table.lignes()[0]["fichier"]
    n = db.scalar("SELECT COUNT(*) FROM eleve")
    db.execute("DELETE FROM absence_eleve")
    db.execute("DELETE FROM eleve WHERE id IN (SELECT id FROM eleve LIMIT 5)")
    reco = []
    monkeypatch.setattr(fenetre, "reconnexion", lambda nouvelle: reco.append(nouvelle))
    monkeypatch.setattr("epp.ui.pages.sauvegarde.valider_suppression", lambda *a, **k: True)   # admin
    monkeypatch.setattr(QInputDialog, "getText", staticmethod(lambda *a, **k: ("non", True)))
    p._restaurer(fichier)
    assert not reco                                              # mot de confirmation absent : rien
    monkeypatch.setattr(QInputDialog, "getText", staticmethod(lambda *a, **k: ("RESTAURER", True)))
    p._restaurer(fichier)
    assert reco, _textes(messages)
    nouvelle = reco[0]
    assert nouvelle.scalar("SELECT COUNT(*) FROM eleve") == n
    assert nouvelle.scalar("SELECT COUNT(*) FROM journal WHERE action='RESTAURATION'") == 1
    nouvelle.close()


def test_calendrier_dans_les_parametres(fenetre, messages):
    from epp.domain import calendrier
    from epp.ui.pages.parametres import DialogueConge
    p = fenetre.page("parametres")
    d = DialogueConge(p, None)
    d.f.widgets["type"].setCurrentIndex(d.f.widgets["type"].findData("VACANCES"))
    d.f.widgets["libelle"].setText("Congés de Pâques")
    d.f.widgets["date_debut"].set_date(date(2027, 3, 29))
    d.f.widgets["date_fin"].set_date(date(2027, 4, 9))
    d._ok()
    assert d.result() == QDialog.Accepted, _textes(messages)
    c = [x for x in calendrier.conges(p.db, p.annee) if x["libelle"] == "Congés de Pâques"]
    assert c and c[0]["jours_classe_perdus"] == 10


def test_validation_et_passage_d_annee(fenetre, messages):
    from epp.ui.pages.resultats import DialoguePassage
    from epp.domain import fin_annee
    p = fenetre.page("resultats")
    for i in range(len(p.etat.lignes())):
        p.etat.selectRow(i)
        p._valider_classe()
    ap = fin_annee.apercu_passage(p.db, p.annee)
    assert ap["pret"], _textes(messages)
    d = DialoguePassage(p, ap)
    d._ok()
    assert d.result() == QDialog.Accepted and d.res["annee_suivante"] == "2027-2028"
    p.ctx.recharger_annee(d.res["annee_suivante_id"])
    assert p.ctx.annee.libelle == "2027-2028"


def test_tutoriels_video_livres_et_listes_dans_l_aide(fenetre, messages):
    """Les vidéos fabriquées par outils/tutoriels.py sont embarquées et proposées dans Aide › Tutoriels vidéo."""
    import shutil
    import subprocess

    from epp.ui.video import tutoriels
    vids = tutoriels()
    assert [v.stem[:2] for v in vids] == ["01", "02", "03", "04", "05", "06"]
    for v in vids:
        assert v.suffix == ".mp4" and 50_000 < v.stat().st_size < 2_000_000, v
    if shutil.which("ffprobe"):        # format lisible par Windows : H.264, 4:2:0
        for v in vids:
            r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=codec_name,pix_fmt", "-of", "csv=p=0", str(v)],
                               capture_output=True, text=True, check=True)
            assert r.stdout.strip() == "h264,yuv420p", v
    p = fenetre.page("aide")
    p.rafraichir()
    noms = [p.liste.item(i).text() for i in range(p.liste.count())]
    assert noms[0] == "01 Premiers pas" and len(noms) == 6


def test_logo_de_l_application_et_bouton_de_connexion_visible(app, demo, messages):
    """Logo AKWA SCHOOL : icône du programme (toutes tailles), menu, écran de connexion ; le bouton
    « Se connecter » garde son fond vert (il était blanc sur blanc)."""
    from PIL import Image

    from epp.core import paths
    from epp.ui import logo
    from epp.ui.dialogs.acces import DialogueConnexion
    from epp.ui.main import FenetrePrincipale
    from epp.ui.widgets import Contexte
    ico = Image.open(paths.resource_path("resources", "app.ico"))
    assert {(16, 16), (32, 32), (48, 48), (256, 256)} <= set(ico.info["sizes"])
    for nom in ("tuile", "symbole", "logo_complet"):
        assert not logo.pixmap(nom, 40).isNull()
    db, annee = demo
    w = FenetrePrincipale(Contexte(db, system_session(), annee, ESSAI))
    assert w.logo.pixmap() is not None and not w.logo.pixmap().isNull()
    w.timer_licence.stop()
    d = DialogueConnexion(db)
    d.show()
    app.processEvents()
    img = d.b_ok.grab().toImage()
    c = img.pixelColor(img.width() // 2, 3)
    assert c.green() < 150 and c.red() < 100, c.name()          # fond vert foncé, texte blanc lisible
    d.close()


# =================================================================== rapports et administration, suppressions
def test_six_volets_et_leurs_onglets(fenetre, messages):
    """Navigation du prototype v6 : six volets (plus l'aide), onglets dans chaque volet, Paramètres à part."""
    from epp.ui.main import ADMIN_VOLETS, ADMINISTRATION, VOLETS
    assert [v[1] for v in VOLETS][:6] == ["Tableau de bord", "Élèves & personnel", "Notes & bulletins", "Absences",
                                          "Rapports & administration", "Paramètres"]
    assert ADMIN_VOLETS[:2] == ["rapports", "generateur"] and "parametres" not in ADMIN_VOLETS
    fenetre.aller("classes")
    t = fenetre.volets["eleves_personnel"]
    assert fenetre.pile.currentWidget() is t and t.tabText(t.currentIndex()) == "Classes"
    assert fenetre.page_affichee() is fenetre.pages["classes"]
    assert fenetre.barre.groupes["eleves_personnel"].isChecked() and fenetre.barre.sous["classes"].isChecked()
    assert not fenetre.barre.blocs["administration"].isVisible()
    assert "Classes" in fenetre.fil.text()
    fenetre.aller("parametres")
    assert fenetre.page_affichee() is fenetre.pages["parametres"] and fenetre.barre.groupes["parametres"].isChecked()
    fenetre.aller("rapports")
    t = fenetre.onglets_admin
    t.setCurrentIndex(ADMIN_VOLETS.index("statistiques"))         # clic sur l'onglet Statistiques
    QApplication.processEvents()
    assert fenetre.page_affichee() is fenetre.pages["statistiques"]
    fenetre.aller("accueil")
    assert fenetre.page_affichee() is fenetre.pages["tableau"]
    fenetre.aller(ADMINISTRATION)                                # retour sur le dernier onglet ouvert
    assert fenetre.page_affichee() is fenetre.pages["statistiques"]
    fenetre.barre.sous["eleves"].click()                         # sous-menu de la barre latérale
    assert fenetre.page_affichee() is fenetre.pages["eleves"]


def test_tableau_de_bord_cliquable(fenetre, messages):
    p = fenetre.page("tableau")
    p.rafraichir()
    d = p.donnees
    assert d["effectif"] == d["garcons"] + d["filles"] > 0
    assert p.k_eleves.valeur.text().startswith(str(d["effectif"]))
    assert len(p.b_eff.lignes) == len(fenetre.ctx.annee.classes)
    p.k_presence.clic.emit()
    assert fenetre.page_affichee() is fenetre.pages["absences"]
    fenetre.aller("accueil")
    p.b_eff.clic.emit("CE1")                                   # ligne « CE1 » : liste des élèves de CE1
    e = fenetre.page_affichee()
    assert e is fenetre.pages["eleves"] and {r["classe"] for r in e.table.lignes()} == {"CE1"}
    fenetre.aller("accueil")
    m = d["premiers"][0]
    p._fiche(m["inscription_id"])                              # premier de classe : sa fiche à droite
    assert fenetre.tiroir.isVisible() and fenetre.tiroir.ligne["inscription_id"] == m["inscription_id"]


def test_recherche_globale_et_fiche_de_l_eleve(fenetre, messages):
    db, annee = fenetre.ctx.db, fenetre.ctx.annee
    r = repo.inscriptions(db, annee)[3]
    res = fenetre._resultats_recherche(r["nom"].split()[0])
    el = [x for x in res if x["type"] == "eleve"]
    assert any(x["inscription_id"] == r["inscription_id"] for x in el)
    assert any(x["type"] == "ecran" and x["cle"] == "notes" for x in fenetre._resultats_recherche("notes"))
    fenetre._ouvrir_resultat(next(x for x in el if x["inscription_id"] == r["inscription_id"]))
    t = fenetre.tiroir
    assert t.isVisible()
    textes = " ".join(w.text() for w in t.contenu.findChildren(type(fenetre.fil)))
    assert r["nom"] in textes and r["matricule_ecole"] in textes
    assert textes.index("Matricule école") < textes.index("Né(e) le")      # matricules en premier
    t._ouvrir()
    p = fenetre.page_affichee()
    assert p is fenetre.pages["eleves"] and p.table.ligne_courante()["inscription_id"] == r["inscription_id"]
    fenetre._ouvrir_resultat({"type": "ecran", "cle": "generateur", "titre": ""})
    assert fenetre.page_affichee() is fenetre.pages["generateur"]


def test_generateur_de_rapports(fenetre, messages, monkeypatch):
    from epp.reports import store
    from epp.ui.designer import editeur
    p = fenetre.page("generateur")
    p.rafraichir()
    assert p.table.lignes() and all(r["origine"] == "Officiel" for r in p.table.lignes())
    composes = []
    monkeypatch.setattr(editeur.EditeurModele, "exec", lambda self: composes.append(self.ref) or 0)
    monkeypatch.setattr(QInputDialog, "getText", lambda *a, **k: ("Mon rapport de test", True))
    p.nouveau_vide()
    db = fenetre.ctx.db
    mid = db.scalar("SELECT id FROM modele_rapport WHERE nom='Mon rapport de test'")
    assert mid and composes == [mid] and not store.get(db, mid)["integre"]
    p.table.selectionner(lambda r: r["integre"] == 1)
    assert not p.b_modifier.isEnabled() and p.b_copier.isEnabled()   # un rapport officiel se copie
    monkeypatch.setattr(QInputDialog, "getText", lambda *a, **k: ("Copie de test", True))
    p.copier()
    assert db.scalar("SELECT COUNT(*) FROM modele_rapport WHERE nom='Copie de test' AND integre=0") == 1
    p.table.selectionner(lambda r: r["nom"] == "Copie de test")
    p.apercu()
    assert fenetre.page_affichee() is fenetre.pages["rapports"]


def test_modifier_un_eleve_exige_l_administrateur(fenetre, messages, monkeypatch):
    """Matricules en tête de la fiche ; une fois l'élève enregistré, toute modification passe par
    l'administrateur (refus : rien n'est modifié)."""
    from epp.ui.pages.eleves import DialogueEleve
    p = fenetre.page("eleves")
    db = p.db
    r = p.table.lignes()[0]
    d = DialogueEleve(p, r)
    assert d.forms[0] is d.f_mat and set(d.f_mat.widgets) == {"matricule_ecole", "matricule_desps"}
    assert d.f_mat.widgets["matricule_ecole"].text() == r["matricule_ecole"]
    assert "matricule_desps" not in d.f_id.widgets
    demandes = []
    monkeypatch.setattr("epp.ui.pages.eleves.valider_modification", lambda *a: demandes.append(a[3]) or False)
    d.f_id.widgets["nom"].setText("NOM MODIFIE Refusé")
    d._enregistrer()
    assert demandes and r["nom"] in demandes[0] and d.result() != QDialog.Accepted
    assert db.scalar("SELECT nom FROM eleve WHERE id=?", (r["eleve_id"],)) == r["nom"]
    monkeypatch.setattr("epp.ui.pages.eleves.valider_modification", lambda *a: True)
    d._enregistrer()
    assert d.result() == QDialog.Accepted
    assert db.scalar("SELECT nom FROM eleve WHERE id=?", (r["eleve_id"],)) == "NOM MODIFIE Refusé"
    # un nouvel élève s'enregistre sans mot de passe
    monkeypatch.setattr("epp.ui.pages.eleves.valider_modification", lambda *a: pytest.fail("pas pour un ajout"))
    n = DialogueEleve(p)
    n.f_id.widgets["nom"].setText("NOUVEAU Sans Mot De Passe")
    n._enregistrer()
    assert n.result() == QDialog.Accepted, _textes(messages)


def test_suppression_d_un_eleve_validee_par_un_administrateur(fenetre, messages, monkeypatch):
    p = fenetre.page("eleves")
    db = p.db
    r = p.table.lignes()[0]
    p.table.selectionner(lambda x: x["eleve_id"] == r["eleve_id"])
    demandes = []
    monkeypatch.setattr("epp.ui.pages.eleves.valider_suppression", lambda *a: demandes.append(a[3]) or False)
    p._supprimer()
    assert demandes and r["nom"] in demandes[0]
    assert db.scalar("SELECT COUNT(*) FROM eleve WHERE id=?", (r["eleve_id"],)) == 1    # refusé : rien effacé
    monkeypatch.setattr("epp.ui.pages.eleves.valider_suppression", lambda *a: True)
    p.table.selectionner(lambda x: x["eleve_id"] == r["eleve_id"])
    p._supprimer()
    assert db.scalar("SELECT COUNT(*) FROM eleve WHERE id=?", (r["eleve_id"],)) == 0


def test_mot_de_passe_admin_exige_et_journalise(fenetre, messages, monkeypatch):
    from epp.ui import widgets
    db = fenetre.ctx.db
    security.create_user(db, "chef", "Chef", "Admin#2026x", "ADMIN")
    vus = []

    def faux_dialogue(parent, db_, s, texte, motif):
        vus.append(texte)
        return security.verifier_admin(db_, s, "mauvais", motif)
    monkeypatch.setattr(widgets, "mot_de_passe_admin", faux_dialogue)
    assert not widgets.valider_suppression(fenetre, db, fenetre.ctx.session, "classe CP1")
    assert "administrateur" in vus[0]
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='AUTORISATION_ADMIN_ECHEC' "
                     "AND details LIKE 'suppression : classe CP1%'") == 1
    monkeypatch.setattr(widgets, "mot_de_passe_admin",
                        lambda parent, db_, s, texte, motif: security.verifier_admin(db_, s, "Admin#2026x", motif))
    assert widgets.valider_suppression(fenetre, db, fenetre.ctx.session, "classe CP1")
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='AUTORISATION_ADMIN' "
                     "AND details LIKE 'chef : suppression : classe CP1%'") == 1


def test_suppressions_protegees_partout(fenetre, messages, monkeypatch):
    """Absence, agent, classe, demande d'autorisation : rien n'est supprimé sans l'administrateur."""
    for mod in ("absences", "personnel", "classes"):
        monkeypatch.setattr(f"epp.ui.pages.{mod}.valider_suppression", lambda *a: False)
    db = fenetre.ctx.db
    n_pers = db.scalar("SELECT COUNT(*) FROM personnel")
    p = fenetre.page("personnel")
    p.table.selectionner(lambda x: True)
    p._supprimer()
    n_cl = db.scalar("SELECT COUNT(*) FROM classe")
    c = fenetre.page("classes")
    c.table.selectionner(lambda x: True)
    c._supprimer()
    assert db.scalar("SELECT COUNT(*) FROM personnel") == n_pers and db.scalar("SELECT COUNT(*) FROM classe") == n_cl


def test_fiche_scolaire_depuis_la_fiche_eleve(fenetre, messages, monkeypatch, tmp_path):
    from epp.reports import service
    p = fenetre.page("eleves")
    r = p.table.lignes()[0]
    p.table.selectionner(lambda x: x["eleve_id"] == r["eleve_id"])
    assert p.b_fiche.isEnabled()
    appels = []

    def faux_export(page, code, params, nom):
        appels.append((code, params, nom))
        return service.generer(page.ctx.db, page.ctx.session, page.ctx.annee, code, params, tmp_path / "f.pdf")
    monkeypatch.setattr("epp.ui.dialogs.export.exporter_rapport", faux_export)
    p._fiche_scolaire()
    assert appels and appels[0][0] == "FICHE_SCOLAIRE" and appels[0][1]["eleve"] == r["inscription_id"]
    assert (tmp_path / "f.pdf").exists() and r["nom"] in appels[0][2]


def test_import_du_fichier_national_des_eleves(fenetre, messages, tmp_path):
    from epp.domain import repo
    from epp.io import import_eleves19
    from epp.ui.pages.import_export import DialogueEleves19
    p = fenetre.page("import_export")
    assert p.b_n_import.isEnabled() and p.b_n_export.isEnabled()
    ch = import_eleves19.modele(tmp_path / "eleves19.xlsx", p.db, exemple=True)
    bilan = import_eleves19.analyser(p.db, p.annee, ch)
    d = DialogueEleves19(p, bilan, ch)
    assert d.table.model().rowCount() == 1 and d.b_ok.isEnabled()
    d._importer()
    assert any(r["matricule_desps"] == "00000000A" for r in repo.inscriptions(p.db, p.annee, "CE1"))
    assert any(t == "Import terminé" for _, t, _ in messages)


def test_codes_dren_iepp_et_listes_officielles(fenetre):
    from epp.ui.pages.eleves import DialogueEleve
    from epp.ui.pages.parametres import OngletEtablissement
    assert {"code_dren", "code_iepp"} <= {k for k, _ in OngletEtablissement.CHAMPS}
    page = fenetre.page("eleves")
    d = DialogueEleve(page, None)
    sp = d.f_ec.widgets["sous_prefecture"]
    assert sp.isEditable() and sp.findText("TOUBA") >= 0
    assert d.f_id.widgets["nationalite"].findText("BURKINABE") >= 0
    d.reject()


# =================================================================== téléphones (application Android)
def test_page_telephones_association_et_retrait(fenetre, messages):
    from test_synchro import Client
    from epp.synchro import protocole as P
    security.create_user(fenetre.ctx.db, "ens", "Enseignant", "Ensei!2026", "ENSEIGNANT")
    fenetre.aller("telephones")
    p = fenetre.page("telephones")
    t = fenetre.onglets_admin
    assert fenetre.page_affichee() is p and t.tabText(t.currentIndex()) == "Téléphones"
    assert not fenetre.synchro.en_marche and p.b_marche.isEnabled()
    try:
        p.compte.setCurrentIndex(p.compte.findText("ens", Qt.MatchContains))
        p._code()                                          # démarre le serveur et affiche un code
        assert fenetre.synchro.en_marche, _textes(messages)
        code = fenetre.synchro.srv.code.code
        assert p.l_code.text() == P.afficher_code(code) and "Adresse" in p.l_code_info.text()
        c = Client(fenetre.synchro.srv.port)
        assert c.appairer(code)[0] == 200
        st, rep = c.synchro()
        assert st == 200 and rep["instantane"]["eleves"]
        p.rafraichir()
        lignes = p.table.lignes()
        assert len(lignes) == 1 and lignes[0]["etat"] == "actif" and "ens" in lignes[0]["utilisateur"]
        p.table.selectionner(lambda r: True)
        p._revoquer()
        assert p.table.lignes()[0]["etat"] == "retiré" and c.synchro()[0] == 401
    finally:
        fenetre.synchro.arreter()
    assert not fenetre.synchro.en_marche
    assert not [m for m in messages if m[0] == "critical"], _textes(messages)
