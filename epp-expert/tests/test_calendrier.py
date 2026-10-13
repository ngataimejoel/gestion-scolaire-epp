"""Jours fériés et vacances : exclus des jours de classe et des autorisations d'absence."""
from __future__ import annotations

from datetime import date

import pytest

from epp.core.security import AccessDenied, Session, system_session
from epp.domain import autorisations as au
from epp.domain import calendrier, repo
from epp.domain.repo import ValidationError

S = system_session()


def test_paques_et_feries_preremplis(demo):
    db, annee = demo
    assert calendrier._paques(2027) == date(2027, 3, 28) and calendrier._paques(2026) == date(2026, 4, 5)
    libs = {(c["libelle"], c["date_debut"]) for c in calendrier.conges(db, annee)}
    assert ("Toussaint", "2026-11-01") in libs and ("Noël", "2026-12-25") in libs
    assert ("Lundi de Pâques", "2027-03-29") in libs and ("Fête de l'indépendance", "2027-08-07") in libs
    assert not [c for c in calendrier.conges(db, annee) if c["libelle"] == "Tabaski"]   # date lunaire : à saisir
    assert calendrier.ajouter_feries(db, S, annee) == 0                                   # rien en double


def test_vacances_exclues_des_autorisations_et_recalcul(demo):
    db, annee = demo
    agent = repo.personnel(db, annee)[1]
    f = au.preremplir(db, annee, agent["matricule"])
    # du lundi 21/12/2026 au vendredi 01/01/2027 : 10 jours ouvrés, dont Noël et le jour de l'an fériés
    aid = au.enregistrer(db, S, annee, None, f | {"date_debut": "2026-12-21", "date_fin": "2027-01-01",
                                                  "motif": "Voyage", "statut": "ACCORDEE"})
    assert au.get(db, aid)["jours"] == 8
    abs_ = [(r["date"], r["jours"]) for r in repo.absences_personnel(db, annee) if r["autorisation_id"] == aid]
    assert abs_ == [("2026-12-21", 8.0)]        # le 01/01 férié : rien en janvier
    # les congés de Noël saisis ensuite : la demande et ses absences suivent
    cid = calendrier.enregistrer(db, S, annee, None, {"type": "VACANCES", "libelle": "Congés de Noël",
                                                      "date_debut": "2026-12-23", "date_fin": "2027-01-04"})
    assert au.get(db, aid)["jours"] == 2
    assert [(r["date"], r["jours"]) for r in repo.absences_personnel(db, annee) if r["autorisation_id"] == aid] \
        == [("2026-12-21", 2.0)]
    with pytest.raises(ValidationError, match="aucun jour de classe"):
        au.enregistrer(db, S, annee, None, f | {"date_debut": "2026-12-28", "date_fin": "2026-12-31",
                                                "motif": "Voyage"})
    with pytest.raises(ValidationError, match="pas un jour de classe"):
        au.enregistrer(db, S, annee, None, f | {"date_debut": "2026-11-02", "demi_journee": "MATIN",
                                                "motif": "Maladie"} | {"date_debut": "2026-12-24"})
    calendrier.supprimer(db, S, annee, cid)
    assert au.get(db, aid)["jours"] == 8


def test_controles_et_droits(demo):
    db, annee = demo
    with pytest.raises(ValidationError, match="libellé"):
        calendrier.enregistrer(db, S, annee, None, {"type": "FERIE", "date_debut": "2026-12-01"})
    with pytest.raises(ValidationError, match="postérieure"):
        calendrier.enregistrer(db, S, annee, None, {"libelle": "x", "date_debut": "2026-12-05",
                                                    "date_fin": "2026-12-01"})
    with pytest.raises(ValidationError, match="année scolaire"):
        calendrier.enregistrer(db, S, annee, None, {"libelle": "x", "date_debut": "2028-01-01"})
    ens = Session(3, "e", "E", "ENSEIGNANT", "E", {"absences.lire"})
    with pytest.raises(AccessDenied):
        calendrier.enregistrer(db, ens, annee, None, {"libelle": "Tabaski", "date_debut": "2027-05-17"})


def test_jours_de_classe_par_mois(demo):
    db, annee = demo
    calendrier.enregistrer(db, S, annee, None, {"type": "VACANCES", "libelle": "Congés de Noël",
                                                "date_debut": "2026-12-19", "date_fin": "2027-01-04"})
    j = calendrier.jours_de_classe_par_mois(db, annee)
    assert j[12] == 14           # 23 jours ouvrés en décembre 2026, moins les 9 du 21 au 31
    assert j[11] == 21           # Toussaint et 15 novembre tombent un dimanche en 2026
    assert 8 not in j            # seuls les mois du tableau des jours de classe (septembre à juillet)

    calendrier.set_jours_classe(db, S, annee, {12: j[12]})
    assert repo.load_annee(db, annee.id).jours[12]["jours"] == 14
    with pytest.raises(ValidationError):
        calendrier.set_jours_classe(db, S, annee, {12: 40})


def test_migration_v4(tmp_path):
    import sqlite3

    from epp.core.db import SCHEMA_VERSION, open_database
    from epp.demo import creer_ecole_demo
    chemin = tmp_path / "v4.sqlite"
    db = open_database(chemin)
    a = creer_ecole_demo(db, system_session())
    db.close()
    con = sqlite3.connect(chemin)
    con.execute("DROP TABLE conge")
    con.execute("UPDATE meta SET valeur='4' WHERE cle='schema_version'")
    con.commit()
    con.close()
    db = open_database(chemin)
    assert db.meta("schema_version") == str(SCHEMA_VERSION)
    annee = repo.load_annee(db, a.id)
    assert calendrier.conges(db, annee) == []
    assert calendrier.ajouter_feries(db, S, annee) >= 8
    db.close()
