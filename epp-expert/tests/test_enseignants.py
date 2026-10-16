"""Accès des enseignants (version 1.2.0) : comptes créés par le directeur, classe seule, validation des notes,
période de saisie, appel, messages, demandes d'autorisation, journal et blocage du compte."""
from __future__ import annotations

import pytest

from epp.core import security
from epp.core.security import AccessDenied
from epp.domain import autorisations, enseignants, repo, resultats


@pytest.fixture
def ecole(demo):
    db, annee = demo
    security.create_user(db, "dir", "Directeur", "Direct!2026", "DIRECTEUR")
    d = security.load_session(db, db.scalar("SELECT id FROM utilisateur WHERE login='dir'"))
    classe = annee.classes[0].code
    pid = db.scalar("SELECT personnel_id FROM affectation WHERE annee_id=? AND classe_code=?", (annee.id, classe))
    uid = enseignants.creer_compte(db, d, pid, "ens", "provisoire")
    return db, annee, d, security.load_session(db, uid), classe, pid, uid


def _note(db, annee, s, classe, num=1):
    cl = annee.classe(classe)
    mats, lignes = repo.notes_grille(db, annee, cl.grille_id, num, classe)
    return lignes[0]["inscription_id"], mats[0]["id"]


def test_le_directeur_cree_le_compte_et_l_enseignant_ne_voit_que_sa_classe(ecole):
    db, annee, d, e, classe, pid, uid = ecole
    assert d.can("enseignants.gerer") and not d.can("utilisateurs.gerer")
    assert e.restreint and e.classes(annee.id) == {classe} and security.doit_changer(db, uid)
    autre = next(r for r in repo.inscriptions(db, annee) if r["classe"] != classe)
    m = annee.grilles[annee.classe(autre["classe"]).grille_id].matieres[1][0]["id"]
    with pytest.raises(AccessDenied, match="votre classe"):
        repo.set_note(db, e, annee, autre["inscription_id"], m, 5)
    with pytest.raises(AccessDenied):
        repo.save_absence(db, e, "eleve", None, annee, {"inscription_id": autre["inscription_id"],
                                                        "date": annee.date_debut, "nature": "ABSENCE", "jours": 1})
    with pytest.raises(AccessDenied):          # le directeur ne gère que les comptes enseignants
        enseignants.reinitialiser(db, d, d.user_id, "nouveau1")
    with pytest.raises(ValueError, match="déjà un compte"):
        enseignants.creer_compte(db, d, pid, "ens2", "provisoire")


def test_notes_en_attente_puis_validees_par_le_directeur(ecole):
    db, annee, d, e, classe, *_ = ecole
    iid, mid = _note(db, annee, e, classe)
    db.execute("DELETE FROM note WHERE inscription_id=?", (iid,))
    avant = resultats.moyennes_par_evaluation(db, annee)[iid][1]["saisie"]
    repo.set_note(db, e, annee, iid, mid, 7)
    assert db.scalar("SELECT en_attente FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid)) == 1
    assert resultats.moyennes_par_evaluation(db, annee)[iid][1]["saisie"] == avant is False   # ne compte pas
    att = enseignants.notes_en_attente(db, annee)
    assert att and att[0]["classe"] == classe and att[0]["saisi_par"] == "ens"
    assert enseignants.suivi(db, annee, 1)[0]["notes_en_attente"] >= 1
    assert enseignants.valider_notes(db, d, annee, classe, 1) >= 1
    assert resultats.moyennes_par_evaluation(db, annee)[iid][1]["saisie"]
    assert any(j["action"] == "NOTE_SAISIE" for j in enseignants.journal(db, "ens"))
    with pytest.raises(AccessDenied):
        enseignants.valider_notes(db, e, annee, classe, 1)


def test_saisie_fermee_par_le_directeur(ecole):
    db, annee, d, e, classe, *_ = ecole
    iid, mid = _note(db, annee, e, classe)
    cal = annee.classe(classe).calendrier
    enseignants.regler_saisie(db, d, annee, cal, 1, True, annee.date_fin)
    with pytest.raises(AccessDenied, match="fermée"):
        repo.set_note(db, e, annee, iid, mid, 6)
    repo.set_note(db, d, annee, iid, mid, 6)          # le directeur peut toujours corriger
    enseignants.regler_saisie(db, d, annee, cal, 1, False)
    repo.set_note(db, e, annee, iid, mid, 6.5)


def test_appel_messages_et_demande_d_autorisation(ecole):
    db, annee, d, e, classe, pid, uid = ecole
    eleves = repo.inscriptions(db, annee, classe)
    jour = db.scalar("SELECT date FROM evaluation WHERE annee_id=? ORDER BY num LIMIT 1", (annee.id,))
    assert enseignants.enregistrer_appel(db, e, annee, classe, jour, [eleves[0]["inscription_id"]]) == 1
    assert enseignants.enregistrer_appel(db, e, annee, classe, jour, [eleves[0]["inscription_id"]]) == 0
    assert enseignants.suivi(db, annee, 1, jour)[0]["appel"].endswith("(1 abs.)")
    mid = enseignants.envoyer_message(db, d, "Réunion", "Réunion des maîtres vendredi à 15 h.")
    assert [m["lu"] for m in enseignants.messages_pour(db, e)] == [False]
    enseignants.marquer_lu(db, e, mid)
    assert enseignants.messages_envoyes(db)[0]["lus"] == 1
    data = {"kind": "personnel", "personnel_id": pid, "date_debut": jour, "date_fin": jour, "motif": "Maladie"}
    aid = autorisations.enregistrer(db, e, annee, None, data)
    assert autorisations.get(db, aid)["statut"] == "EN_ATTENTE"
    autre = db.scalar("SELECT id FROM personnel WHERE id<>? LIMIT 1", (pid,))
    with pytest.raises(AccessDenied):
        autorisations.enregistrer(db, e, annee, None, {**data, "personnel_id": autre})


def test_fiche_du_personnel_desactivee_bloque_le_compte_et_les_telephones(ecole):
    db, annee, d, e, classe, pid, uid = ecole
    security.set_password(db, uid, "Ensei!2026")
    assert security.authenticate(db, "ens", "Ensei!2026")
    db.execute("INSERT INTO appareil(nom, utilisateur_id, cle) VALUES('Tel', ?, 'x')", (uid,))
    db.execute("UPDATE personnel SET actif=0 WHERE id=?", (pid,))
    assert security.authenticate(db, "ens", "Ensei!2026") is None
    assert db.scalar("SELECT actif FROM appareil WHERE utilisateur_id=?", (uid,)) == 0
    with pytest.raises(ValueError, match="désactivée"):
        enseignants.activer(db, d, uid, True)


def test_rapport_des_notes_par_classe_avec_synthese_par_sexe(demo, tmp_path):
    from epp.core.security import system_session
    from epp.reports import engine, service, store
    db, annee = demo
    classe = annee.classes[0].code
    doc = engine.build_document(db, annee, store.definition(db, "NOTES_CLASSE"), {"classe": classe, "compo": 1})
    notes, synthese = doc.blocks[1], doc.blocks[2]
    assert [h.text for h in notes.header[0]][-2:] == ["Rang", "Résultat"]
    lignes = {r.cells[0]: r.cells[1:] for r in synthese.rows}
    assert lignes["INSCRITS"][2] == len(repo.inscriptions(db, annee, classe))
    assert lignes["ADMIS"][2] + lignes["NON ADMIS"][2] == lignes["PRÉSENTS"][2]
    assert service.generer(db, system_session(), annee, "NOTES_CLASSE", {"compo": 1}, tmp_path / "n.pdf").exists()
