"""École de démonstration fictive : génération de tous les modèles sans le classeur réel
(ces tests tournent aussi sur la CI Windows, où le classeur n'est pas disponible)."""
from __future__ import annotations

from pypdf import PdfReader

from epp.core.security import system_session
from epp.domain import resultats, stats
from epp.reports import service, store


def test_ecole_demo_coherente(demo):
    db, annee = demo
    res = resultats.compute(db, annee)
    assert len(res) == 8 * len(annee.codes)
    assert any(r["decision"] == "ADMIS" for r in res) and any(r["decision"] == "REDOUBLE" for r in res)
    st = stats.compute(db, annee)
    assert st.val("TOTAL", "T", "inscrits") == len(res)
    assert st.val("TOTAL", "T", "inscrits") == st.val("TOTAL", "T", "presents") + st.val("TOTAL", "T", "sortis")


def test_tous_les_modeles_sur_la_demo(demo, tmp_path):
    db, annee = demo
    s = system_session()
    for m in store.lister(db):
        p = {"mois": 10, "compo": 1, "classe": annee.codes[2]}
        pdf = service.generer(db, s, annee, m["code"], p, tmp_path / f"{m['code']}.pdf")
        pages = PdfReader(pdf).pages
        assert pages, m["code"]
        for i, pg in enumerate(pages, 1):
            assert f"Page {i} / {len(pages)}" in (pg.extract_text() or ""), m["code"]
        service.generer(db, s, annee, m["code"], p, tmp_path / f"{m['code']}.xlsx")
