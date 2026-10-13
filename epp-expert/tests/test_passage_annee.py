"""Passage à l'année suivante après validation, archivage de l'année en lecture seule, sauvegarde."""
from __future__ import annotations

import zipfile

import pytest

from epp.core import backup
from epp.core.db import AnneeCloturee
from epp.core.security import AccessDenied, Session, system_session
from epp.domain import fin_annee, repo
from epp.reports import service


def _tout_valider(db, s, annee, choix_par_classe=None):
    for c in annee.codes:
        fin_annee.valider_classe(db, s, annee, c, (choix_par_classe or {}).get(c))


def test_passage_refuse_tant_que_tout_n_est_pas_valide(demo):
    db, annee = demo
    s = system_session()
    fin_annee.valider_classe(db, s, annee, annee.codes[0])
    ap = fin_annee.apercu_passage(db, annee)
    assert not ap["pret"] and ap["classes_non_validees"] == annee.codes[1:]
    with pytest.raises(repo.ValidationError, match="Validez d'abord"):
        fin_annee.passer_annee_suivante(db, s, annee)
    assert repo.list_annees(db)[0]["libelle"] == annee.libelle          # rien n'a été créé


def test_passage_complet(demo, tmp_path):
    db, annee = demo
    s = system_session()
    code = annee.codes[1]
    lignes = [r for r in fin_annee.propositions(db, annee, code) if r["decision_calculee"] == "ADMIS"]
    red, exc = lignes[0], lignes[1]
    _tout_valider(db, s, annee, {code: {red["inscription_id"]: "REDOUBLE",
                                        exc["inscription_id"]: ("EXCLU", "Conseil de discipline")}})
    ap = fin_annee.apercu_passage(db, annee)
    assert ap["pret"] and ap["annee_suivante"] == "2027-2028" and ap["partants"]["EXCLU"] == 1
    attendu = sum(v["admis"] + v["redoublants"] for v in ap["effectifs_suivants"].values())
    assert attendu == ap["montent"] + ap["redoublent"]

    res = fin_annee.passer_annee_suivante(db, s, annee)
    # sauvegarde faite avant, vérifiable
    assert res["sauvegarde"].exists()
    m = backup.verifier(res["sauvegarde"])
    assert m["annees"] == [annee.libelle] and m["version_schema"] == "3"
    # nouvelle année active, ancienne clôturée
    nouv = repo.load_annee(db, repo.active_annee_id(db))
    anc = repo.load_annee(db, annee.id)
    assert nouv.libelle == "2027-2028" and nouv.active and anc.cloturee and not anc.active
    assert nouv.codes == annee.codes
    inscrits = {r["eleve_id"]: r for r in repo.inscriptions(db, nouv)}
    assert res["reinscrits"] == len(inscrits) == attendu
    for cl, v in ap["effectifs_suivants"].items():
        rs = [r for r in inscrits.values() if r["classe"] == cl]
        assert len(rs) == v["admis"] + v["redoublants"]
        assert sum(r["redoublant"] == "OUI" for r in rs) == v["redoublants"]
    assert inscrits[red["eleve_id"]]["classe"] == code and inscrits[red["eleve_id"]]["redoublant"] == "OUI"
    assert exc["eleve_id"] not in inscrits
    # les élèves gardent leur fiche (photo, parents…) : même eleve_id d'une année à l'autre
    assert all(repo.get_eleve(db, eid) for eid in inscrits)
    # l'année archivée reste consultable et imprimable
    assert service.generer(db, s, anc, "DECISIONS_FIN_ANNEE", {}, tmp_path / "d.pdf").exists()
    assert service.generer(db, s, anc, "RESULTATS", {}, tmp_path / "r.pdf").exists()
    # un second passage de la même année est refusé
    with pytest.raises(repo.ValidationError, match="déjà clôturée"):
        fin_annee.passer_annee_suivante(db, s, anc)


def test_annee_cloturee_en_lecture_seule(demo):
    db, annee = demo
    s = system_session()
    _tout_valider(db, s, annee)
    fin_annee.passer_annee_suivante(db, s, annee)
    anc = repo.load_annee(db, annee.id)
    r = repo.inscriptions(db, anc)[0]
    g = anc.grilles[anc.classe(r["classe"]).grille_id]
    m = g.matieres[1][0]
    with pytest.raises(AnneeCloturee):
        repo.set_note(db, s, anc, r["inscription_id"], m["id"], 1)
    with pytest.raises(AnneeCloturee):
        fin_annee.valider(db, s, anc, {r["inscription_id"]: "REDOUBLE"})
    with pytest.raises(AnneeCloturee):
        fin_annee.annuler_validation(db, s, anc, r["classe"])
    with pytest.raises(AnneeCloturee):
        repo.save_absence(db, s, "eleve", None, anc, {"inscription_id": r["inscription_id"],
                                                      "date": f"{anc.an_debut()}-11-03", "nature": "ABSENCE",
                                                      "jours": 1, "motif": "Maladie", "justifie": "OUI"})
    with pytest.raises(AnneeCloturee):
        repo.delete_eleve(db, s, r["eleve_id"])                  # supprimerait son historique archivé
    with pytest.raises(AnneeCloturee):
        db.execute("DELETE FROM annee_scolaire WHERE id=?", (anc.id,))
    with pytest.raises(AnneeCloturee):
        repo.update_annee(db, s, anc.id, date_edition="2027-07-01")
    assert db.scalar("SELECT COUNT(*) FROM note WHERE inscription_id=?", (r["inscription_id"],))   # données intactes
    # la fiche de l'élève (commune aux années) reste modifiable, ainsi que la nouvelle année
    repo.set_photo(db, s, "eleve", r["eleve_id"], None)
    # réouverture par un administrateur
    with pytest.raises(AccessDenied):
        fin_annee.rouvrir_annee(db, Session(3, "d", "D", "DIRECTEUR", "D", {"fin_annee.valider"}), anc)
    fin_annee.rouvrir_annee(db, s, anc)
    repo.set_note(db, s, repo.load_annee(db, anc.id), r["inscription_id"], m["id"], 1)


def test_passage_droits(demo):
    db, annee = demo
    sec = Session(4, "sec", "Secrétariat", "SECRETARIAT", "S", {"eleves.lire", "eleves.modifier"})
    with pytest.raises(AccessDenied):
        fin_annee.passer_annee_suivante(db, sec, annee)


def test_sauvegarde_endommagee_detectee(demo, tmp_path):
    db, _ = demo
    f = backup.creer_sauvegarde(db, system_session(), "test", tmp_path)
    assert backup.verifier(f)["motif"] == "test"
    abime = tmp_path / "abime.zip"
    with zipfile.ZipFile(f) as z, zipfile.ZipFile(abime, "w") as w:
        w.writestr("manifeste.json", z.read("manifeste.json"))
        data = bytearray(z.read("epp.db"))
        data[5000] ^= 0xFF
        w.writestr("epp.db", bytes(data))
    with pytest.raises(backup.SauvegardeInvalide):
        backup.verifier(abime)
    with pytest.raises(AccessDenied):
        backup.creer_sauvegarde(db, Session(9, "e", "E", "ENSEIGNANT", "E", {"notes.lire"}), "x", tmp_path)
