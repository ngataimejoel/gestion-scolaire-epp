"""Bulletins de notes et photos des élèves / du personnel."""
from __future__ import annotations

import sqlite3

import pytest
from pypdf import PdfReader

from epp.core.security import system_session
from epp.domain import bulletins, repo, resultats
from epp.reports import service


def _png(w=1200, h=1600) -> bytes:
    from PySide6.QtCore import QBuffer, QIODevice
    from PySide6.QtGui import QImage
    img = QImage(w, h, QImage.Format_RGB32)
    img.fill(0x0E6646)
    buf = QBuffer()
    buf.open(QIODevice.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def test_photo_eleve_reduite_et_supprimee_avec_l_eleve(demo):
    db, annee = demo
    s = system_session()
    r = repo.inscriptions(db, annee)[0]
    repo.set_photo(db, s, "eleve", r["eleve_id"], _png())
    jpeg = repo.get_photo(db, "eleve", r["eleve_id"])
    assert jpeg[:2] == b"\xff\xd8"            # JPEG
    from PySide6.QtGui import QImage
    img = QImage.fromData(jpeg)
    assert max(img.width(), img.height()) == repo.PHOTO_MAX_PX
    with pytest.raises(repo.ValidationError):
        repo.set_photo(db, s, "eleve", r["eleve_id"], b"pas une image")
    repo.delete_eleve(db, s, r["eleve_id"])
    assert repo.get_photo(db, "eleve", r["eleve_id"]) is None


def test_photo_personnel(demo):
    db, annee = demo
    s = system_session()
    p = repo.personnel(db, annee)[0]
    repo.set_photo(db, s, "personnel", p["id"], _png(300, 300))
    assert repo.get_photo(db, "personnel", p["id"])
    repo.set_photo(db, s, "personnel", p["id"], None)
    assert repo.get_photo(db, "personnel", p["id"]) is None


def test_photo_droits(demo):
    from epp.core.security import AccessDenied, Session
    db, annee = demo
    lecteur = Session(5, "l", "Lecteur", "X", "X", {"eleves.lire"})
    r = repo.inscriptions(db, annee)[0]
    with pytest.raises(AccessDenied):
        repo.set_photo(db, lecteur, "eleve", r["eleve_id"], _png())


def test_migration_v1_vers_v2(tmp_path):
    """Une base de la version 1 (sans table photo) est mise à niveau, avec copie de sécurité."""
    from epp.core import db as dbmod, paths
    path = tmp_path / "v1.sqlite"
    d = dbmod.open_database(path)
    d.execute("DROP TRIGGER photo_eleve_suppr")
    d.execute("DROP TRIGGER photo_personnel_suppr")
    d.execute("DROP TABLE photo")
    d.set_meta("schema_version", 1)
    d.close()
    d = dbmod.open_database(path)
    assert d.meta("schema_version") == str(dbmod.SCHEMA_VERSION)
    assert d.scalar("SELECT COUNT(*) FROM photo") == 0
    assert list(paths.backups_dir().glob("avant_migration_v1_*"))
    d.close()
    con = sqlite3.connect(path)
    assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    con.close()


def test_bulletin_evaluation_coherent_avec_les_notes(demo):
    db, annee = demo
    cl = annee.classes[2]
    bs = bulletins.bulletins_evaluation(db, annee, 1, cl.code)
    g = annee.grilles[cl.grille_id]
    _, lignes = repo.notes_grille(db, annee, g.id, 1, cl.code)
    assert len(bs) == len(lignes)
    for b, l in zip(bs, lignes):
        assert b["moyenne"] == l["moyenne"] and b["total"] == l["total"]
        assert len(b["notes"]) == len(g.matieres[1])
    # rang : 1 + nombre d'élèves présents ayant une moyenne strictement supérieure
    pres = [b for b in bs if b["statut"] == "PRESENT" and b["present"] and b["moyenne"] is not None]
    for b in pres:
        assert b["rang"] == 1 + sum(1 for x in pres if x["moyenne"] > b["moyenne"])


def test_bulletin_annuel_identique_aux_resultats(demo):
    db, annee = demo
    res = {r["inscription_id"]: r for r in resultats.compute(db, annee)}
    for b in bulletins.bulletins_annuels(db, annee):
        r = res[b["inscription_id"]]
        assert (b["mga"], b["rang"], b["decision"], b["observation"]) == \
            (r["mga"], r["rang"], r["decision"], r["observation"])


def test_bulletin_annuel_identique_a_excel(idb, annee, excel):
    """MGA, rang et décision du bulletin = valeurs calculées par Excel (feuilles RESULTATS)."""
    attendu = {}
    for sheet, cols in (("RESULTATS", ("L", "P", "O")), ("RESULTATS CM2", ("J", "N", "M"))):
        ws = excel[sheet]
        for r in range(10, 260):
            m = ws[f"B{r}"].value
            if m:
                attendu[m] = tuple(ws[f"{c}{r}"].value for c in cols)
    n = 0
    for b in bulletins.bulletins_annuels(idb, annee):
        mga, rang, dec = attendu[b["matricule_ecole"]]
        assert b["decision"] == dec
        if mga not in (None, ""):
            assert abs(b["mga"] - mga) < 1e-9 and b["rang"] == (rang or None)
        n += 1
    assert n == 64


def test_pdf_bulletins_une_page_par_eleve_avec_photo(demo, tmp_path):
    db, annee = demo
    s = system_session()
    code = annee.codes[0]
    eleves = [r for r in repo.inscriptions(db, annee, code) if r["statut"] == "PRESENT"]
    repo.set_photo(db, s, "eleve", eleves[0]["eleve_id"], _png())
    pdf = service.generer(db, s, annee, "BULLETIN_EVAL", {"classe": code, "compo": 1}, tmp_path / "b.pdf")
    rd = PdfReader(pdf)
    assert len(rd.pages) == len(eleves)
    t0 = rd.pages[0].extract_text()
    assert eleves[0]["nom"] in t0 and "BULLETIN DE NOTES" in t0 and "REPUBLIQUE DE COTE D'IVOIRE" in t0
    assert rd.pages[0].images, "la photo doit figurer sur le bulletin"
    # un seul élève
    one = service.generer(db, s, annee, "BULLETIN_ANNUEL", {"eleve": eleves[1]["inscription_id"]},
                          tmp_path / "un.pdf")
    rd = PdfReader(one)
    assert len(rd.pages) == 1 and eleves[1]["nom"] in rd.pages[0].extract_text()
    # export Excel
    service.generer(db, s, annee, "BULLETIN_ANNUEL", {"classe": code}, tmp_path / "b.xlsx")
