"""Interface (PySide6, sans écran) : accès, verrouillage, pages et principales actions.

Les boîtes de message sont remplacées par un enregistreur (aucune fenêtre bloquante)."""
from __future__ import annotations

import os
from datetime import date

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["EPP_SANS_ANIMATION"] = "1"
os.environ["EPP_SANS_VIDEO"] = "1"

from PySide6.QtCore import QDate, Qt                                   # noqa: E402
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
    return a


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
        assert fenetre.pile.currentWidget() is fenetre.pages[cle], cle
    assert not [m for m in messages if m[0] == "critical"], _textes(messages)


def test_menu_selon_le_role(app, demo, messages):
    from epp.ui.main import FenetrePrincipale
    from epp.ui.widgets import Contexte
    db, annee = demo
    ens = Session(5, "ens", "Enseignant", "ENSEIGNANT", "Enseignant", set(security.DEFAULT_ROLES["ENSEIGNANT"][1]))
    w = FenetrePrincipale(Contexte(db, ens, annee, ESSAI))
    caches = {w.menu.item(i).data(Qt.UserRole) for i in range(w.menu.count()) if w.menu.item(i).isHidden()}
    assert {"personnel", "sauvegarde"} <= caches and "notes" not in caches
    w.aller("personnel")
    assert "personnel" not in w.pages
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


def test_saisie_des_notes(fenetre, messages):
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
