"""Bulletin coloré (modèle fourni par l'école) : contenu par niveau, textes des paramètres, une page."""
from __future__ import annotations

import copy

from pypdf import PdfReader

from epp.core.security import system_session
from epp.domain import bulletins, repo
from epp.reports import service, store


def _texte(pdf, page=0):
    return PdfReader(pdf).pages[page].extract_text()


def test_contenu_selon_le_niveau(demo, tmp_path):
    db, annee = demo
    s = system_session()
    for code in ("CP1", "CE2", "CM2"):
        cl = annee.classe(code)
        g = annee.grilles[cl.grille_id]
        el = [r for r in repo.inscriptions(db, annee, code) if r["statut"] == "PRESENT"][0]
        b = bulletins.bulletins_annuels(db, annee, inscription_id=el["inscription_id"])[0]
        t = _texte(service.generer(db, s, annee, "BULLETIN_ANNUEL", {"eleve": el["inscription_id"]},
                                   tmp_path / f"{code}.pdf"))
        assert el["nom"] in t and "BULLETIN ANNUEL" in t and "EPP OUANINOU 2" in t
        for m in {m["libelle"] for ms in g.matieres.values() for m in ms}:
            assert (m[:1] + m[1:].lower()) in t                    # disciplines du niveau
        for ev in annee.evaluations[cl.calendrier].values():
            for mot in ev["libelle"].split():
                assert mot in t                                    # évaluations du calendrier du niveau
        assert b["enseignant"] and b["enseignant"] in t
        assert f"/{int(g.echelle)})" in t                          # échelle du niveau (/10 ou /20)
        dec = {"ADMIS": "ADMIS(E)", "REDOUBLE": "REDOUBLE"}.get(b["decision"], b["decision"] or "")
        assert dec in t


def test_textes_modifiables_dans_les_parametres(demo, tmp_path):
    db, annee = demo
    s = system_session()
    repo.save_etablissement(db, s, {"bulletin_titre": "École {ecole}", "bulletin_slogan": "Travail et réussite",
                                    "bulletin_devise": "Ensemble pour {localite}",
                                    "bulletin_pied": "Le savoir est une lumière"})
    t = _texte(service.generer(db, s, annee, "BULLETIN_EVAL", {"classe": annee.codes[0], "compo": 1},
                               tmp_path / "b.pdf"))
    for attendu in ("ÉCOLE EPP OUANINOU 2", "Travail et réussite", "Le savoir est une lumière"):
        assert attendu in t
    assert "Ensemble pour OUANINOU" in " ".join(t.split())     # devise inclinée, sur une ou deux lignes


def test_une_page_par_eleve_meme_avec_beaucoup_de_disciplines(demo, tmp_path):
    db, annee = demo
    s = system_session()
    cl = annee.classe("CE1")
    g = annee.grilles[cl.grille_id]
    for num, ms in g.matieres.items():
        repo.save_matieres(db, s, g.id, num, [{"id": m["id"], "libelle": m["libelle"], "valeur": m["valeur"]}
                                              for m in ms] + [{"libelle": f"Discipline {i}", "valeur": 10}
                                                              for i in range(10)])
    annee = repo.load_annee(db, annee.id)
    n = len([r for r in repo.inscriptions(db, annee, "CE1") if r["statut"] == "PRESENT"])
    pdf = service.generer(db, s, annee, "BULLETIN_EVAL", {"classe": "CE1", "compo": 3}, tmp_path / "b.pdf")
    rd = PdfReader(pdf)
    assert len(rd.pages) == n
    assert "Discipline 9" in rd.pages[0].extract_text()


def test_style_classique_toujours_disponible(demo, tmp_path):
    db, annee = demo
    s = system_session()
    defn = copy.deepcopy(store.definition(db, "BULLETIN_ANNUEL"))
    defn["sections"][0]["style"] = "classique"
    store.creer(db, s, "Bulletin classique", defn, "Bulletins", code="MON_BULLETIN")
    t = _texte(service.generer(db, s, annee, "MON_BULLETIN", {"classe": annee.codes[0]}, tmp_path / "c.pdf"))
    assert "BULLETIN ANNUEL DE NOTES" in t and "Bilan de l'année" not in t
