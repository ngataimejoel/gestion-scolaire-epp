"""Validation des décisions de fin d'année : admis, redoublants, abandons, exclus, transférés."""
from __future__ import annotations

import pytest
from pypdf import PdfReader

from epp.core import seed
from epp.core.security import AccessDenied, Session, system_session
from epp.domain import bulletins, fin_annee, repo, resultats, stats
from epp.reports import service


def _classe(annee, code=None):
    return code or annee.codes[1]


def test_sans_validation_les_propositions_sont_les_decisions_calculees(demo):
    db, annee = demo
    for r in fin_annee.propositions(db, annee):
        assert r["decision"] == r["decision_calculee"] and not r["validee"]
    assert not fin_annee.annee_validee(db, annee)
    assert all(e["valides"] == 0 for e in fin_annee.etat(db, annee))


def test_valider_une_classe_et_corriger_des_decisions(demo, tmp_path):
    db, annee = demo
    s = system_session()
    code = _classe(annee)
    lignes = [r for r in fin_annee.propositions(db, annee, code) if r["statut"] == "PRESENT"]
    admis = next(r for r in lignes if r["decision_calculee"] == "ADMIS")
    autre = next(r for r in lignes if r["inscription_id"] != admis["inscription_id"])
    admis_avant = stats.compute(db, annee).val(code, "T", "admis")
    # « Exclu » exige un motif
    with pytest.raises(repo.ValidationError):
        fin_annee.valider_classe(db, s, annee, code, {admis["inscription_id"]: "EXCLU"})
    with pytest.raises(repo.ValidationError):
        fin_annee.valider_classe(db, s, annee, code, {admis["inscription_id"]: "RENVOYE"})
    assert fin_annee.etat(db, annee)[1]["valides"] == 0          # rien n'a été enregistré (tout ou rien)
    bilan = fin_annee.valider_classe(db, s, annee, code, {admis["inscription_id"]: ("EXCLU", "Indiscipline grave"),
                                                         autre["inscription_id"]: "TRANSFERE"})
    assert bilan["EXCLU"] == 1 and bilan["TRANSFERE"] == 1 and sum(bilan.values()) == len(
        fin_annee.propositions(db, annee, code))
    e = next(x for x in fin_annee.etat(db, annee) if x["classe"] == code)
    assert e["complete"] and e["EXCLU"] == 1
    # la décision validée remplace la proposition partout
    r = {x["inscription_id"]: x for x in resultats.compute(db, annee)}[admis["inscription_id"]]
    assert (r["decision"], r["decision_calculee"], r["motif_decision"]) == ("EXCLU", "ADMIS", "Indiscipline grave")
    assert r["observation"] is None
    assert stats.compute(db, annee).val(code, "T", "admis") == admis_avant - 1 - (autre["decision_calculee"] == "ADMIS")
    b = bulletins.bulletins_annuels(db, annee, inscription_id=admis["inscription_id"])[0]
    assert b["decision"] == "EXCLU"
    t = PdfReader(service.generer(db, s, annee, "BULLETIN_ANNUEL", {"eleve": admis["inscription_id"]},
                                  tmp_path / "b.pdf")).pages[0].extract_text()
    assert "EXCLU(E)" in t
    # rapport des décisions
    t = "".join(p.extract_text() for p in PdfReader(service.generer(
        db, s, annee, "DECISIONS_FIN_ANNEE", {"classe": code}, tmp_path / "d.pdf")).pages)
    assert "DÉCISIONS DE FIN D'ANNÉE" in t and "Indiscipline grave" in t and "TRANSFERE" in t
    service.generer(db, s, annee, "DECISIONS_FIN_ANNEE", {}, tmp_path / "d.xlsx")
    # une seconde validation garde les corrections déjà faites
    fin_annee.valider_classe(db, s, annee, code)
    assert {x["inscription_id"]: x for x in resultats.compute(db, annee)}[admis["inscription_id"]]["decision"] == "EXCLU"
    # réouverture : retour aux propositions calculées
    assert fin_annee.annuler_validation(db, s, annee, code) == len(fin_annee.propositions(db, annee, code))
    assert {x["inscription_id"]: x for x in resultats.compute(db, annee)}[admis["inscription_id"]]["decision"] == "ADMIS"


def test_eleve_sans_moyenne_annuelle_doit_recevoir_une_decision(demo):
    db, annee = demo
    s = system_session()
    code = _classe(annee)
    eid = repo.save_eleve(db, s, None, {"nom": "NOUVEAU Arrivé Test", "sexe": "M", "date_naissance": "2018-01-01"},
                          annee)
    iid = repo.inscrire(db, s, eid, annee, code)
    with pytest.raises(repo.ValidationError, match="NOUVEAU Arrivé Test"):
        fin_annee.valider_classe(db, s, annee, code)
    fin_annee.valider_classe(db, s, annee, code, {iid: "REDOUBLE"})
    assert next(r for r in fin_annee.propositions(db, annee, code) if r["inscription_id"] == iid)["decision"] == "REDOUBLE"


def test_notes_modifiees_apres_validation_signalees(demo):
    db, annee = demo
    s = system_session()
    code = _classe(annee)
    fin_annee.valider_classe(db, s, annee, code)
    r = next(x for x in fin_annee.propositions(db, annee, code) if x["decision_calculee"] == "ADMIS")
    cl = annee.classe(code)
    g = annee.grilles[cl.grille_id]
    for num, mats in g.matieres.items():
        for m in mats:
            repo.set_note(db, s, annee, r["inscription_id"], m["id"], 0)
    r2 = next(x for x in fin_annee.propositions(db, annee, code) if x["inscription_id"] == r["inscription_id"])
    assert r2["decision"] == "ADMIS" and r2["decision_calculee"] == "REDOUBLE" and r2["a_revoir"]
    assert next(e for e in fin_annee.etat(db, annee) if e["classe"] == code)["a_revoir"] == 1


def test_reinscription_suit_les_decisions_validees(demo):
    db, annee = demo
    s = system_session()
    suivante = repo.load_annee(db, seed.create_year(db, "2027-2028", copy_from=annee.id, active=False))
    code = _classe(annee)
    lignes = [r for r in fin_annee.propositions(db, annee, code) if r["decision_calculee"] == "ADMIS"]
    redouble, exclu = lignes[0], lignes[1]
    with pytest.raises(repo.ValidationError, match="à valider"):
        repo.reinscrire(db, s, annee, suivante, exiger_validation=True)
    for c in annee.codes:
        fin_annee.valider_classe(db, s, annee, c, {redouble["inscription_id"]: "REDOUBLE",
                                                  exclu["inscription_id"]: ("EXCLU", "Conseil de discipline")}
                                 if c == code else None)
    assert fin_annee.annee_validee(db, annee)
    bilan = repo.reinscrire(db, s, annee, suivante, exiger_validation=True)
    assert bilan["non_valides"] == 0 and bilan["partants"] >= 1
    nouv = {r["eleve_id"]: r for r in repo.inscriptions(db, suivante)}
    assert nouv[redouble["eleve_id"]]["classe"] == code and nouv[redouble["eleve_id"]]["redoublant"] == "OUI"
    assert exclu["eleve_id"] not in nouv
    partis = [r for r in fin_annee.propositions(db, annee) if r["decision"] in fin_annee.PARTANTS]
    assert partis and all(r["eleve_id"] not in nouv for r in partis)
    admis = [r for r in fin_annee.propositions(db, annee) if r["decision"] == "ADMIS" and r["classe_suivante"]]
    assert all(nouv[r["eleve_id"]]["classe"] == r["classe_suivante"] for r in admis)


def test_droits_validation(demo, tmp_path):
    db, annee = demo
    ens = Session(7, "ens", "Enseignant", "ENSEIGNANT", "Enseignant", {"notes.lire", "notes.modifier"})
    with pytest.raises(AccessDenied):
        fin_annee.valider_classe(db, ens, annee, annee.codes[0])
    with pytest.raises(AccessDenied):
        fin_annee.annuler_validation(db, ens, annee, annee.codes[0])
    perms = lambda role: {r["permission"] for r in db.query(
        "SELECT permission FROM role_permission rp JOIN role r ON r.id = rp.role_id WHERE r.code=?", (role,))}
    assert "fin_annee.valider" in perms("DIRECTEUR") and "fin_annee.valider" not in perms("ENSEIGNANT")


def test_migration_v2_vers_v3(tmp_path):
    """Base de la version 2 : table des décisions créée, permission donnée au rôle Directeur."""
    from epp.core import db as dbmod
    path = tmp_path / "v2.sqlite"
    d = dbmod.open_database(path)
    d.execute("DROP TABLE decision_fin_annee")
    d.execute("DELETE FROM role_permission WHERE permission='fin_annee.valider'")
    d.execute("DELETE FROM meta WHERE cle LIKE 'permission_ajoutee:%'")
    d.set_meta("schema_version", 2)
    d.close()
    d = dbmod.open_database(path)
    assert d.meta("schema_version") == str(dbmod.SCHEMA_VERSION) == "3"
    assert d.scalar("SELECT COUNT(*) FROM decision_fin_annee") == 0
    assert d.scalar("SELECT COUNT(*) FROM role_permission rp JOIN role r ON r.id=rp.role_id "
                    "WHERE r.code IN ('ADMIN','DIRECTEUR') AND permission='fin_annee.valider'") == 2
    # un administrateur qui retire ensuite la permission n'est pas contredit au lancement suivant
    d.execute("DELETE FROM role_permission WHERE permission='fin_annee.valider' AND role_id="
              "(SELECT id FROM role WHERE code='DIRECTEUR')")
    d.close()
    d = dbmod.open_database(path)
    assert not d.scalar("SELECT 1 FROM role_permission rp JOIN role r ON r.id=rp.role_id "
                        "WHERE r.code='DIRECTEUR' AND permission='fin_annee.valider'")
    d.close()
