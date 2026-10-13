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
        for x in ("1er Trimestre", "2e Trimestre", "3e Trimestre", "Moyenne annuelle"):
            assert x in " ".join(t.split())                        # colonnes du modèle de l'école
        assert b["enseignant"] and b["enseignant"] in t
        assert f"/{int(g.echelle)})" in t                          # échelle du niveau (/10 ou /20)
        dec = {"ADMIS": "ADMIS(E)", "REDOUBLE": "REDOUBLE"}.get(b["decision"], b["decision"] or "")
        assert dec in t


def test_colonnes_par_evaluation_en_option(demo, tmp_path):
    db, annee = demo
    s = system_session()
    repo.save_etablissement(db, s, {"bulletin_colonnes": "evaluations"})
    for code in ("CP1", "CM2"):
        cl = annee.classe(code)
        el = [r for r in repo.inscriptions(db, annee, code) if r["statut"] == "PRESENT"][0]
        t = _texte(service.generer(db, s, annee, "BULLETIN_ANNUEL", {"eleve": el["inscription_id"]},
                                   tmp_path / f"{code}.pdf"))
        assert "Trimestre" not in t
        for ev in annee.evaluations[cl.calendrier].values():
            for mot in ev["libelle"].split():
                assert mot in t                                    # évaluations du calendrier du niveau


def test_trimestres_regroupent_les_evaluations_selon_leur_date(demo, tmp_path):
    db, annee = demo
    s = system_session()
    assert [bulletins.trimestre(d, 0) for d in ("2026-12-09", "2027-03-10", "2027-05-26", "2027-06-16")] == \
        [1, 2, 3, 3]
    assert [bulletins.trimestre(None, n) for n in (1, 2, 3, 4)] == [1, 2, 3, 3]
    rel = bulletins.releve_classe(db, annee, "CP1")
    assert [x["evaluations"] for x in rel["trimestres"]] == [[1], [2], [3, 4]]
    iid, e = next((i, e) for i, e in rel["eleves"].items() if all(e["moyennes"].get(n) for n in (1, 2, 3, 4)))
    lib = rel["disciplines"][0]["libelle"]
    n = e["notes"][lib]
    assert e["notes_trim"][lib][1] == n[1] and e["notes_trim"][lib][2] == n[2]
    assert abs(e["notes_trim"][lib][3] - (n[3] + n[4]) / 2) < 0.006
    assert abs(e["moyennes_trim"][3] - (e["moyennes"][3] + e["moyennes"][4]) / 2) < 0.006
    m3 = {i: x["moyennes_trim"][3] for i, x in rel["eleves"].items() if x.get("statut") == "PRESENT"}
    assert e["rangs_trim"][3] == 1 + sum(1 for v in m3.values() if v is not None and v > m3[iid])
    # bulletin de la 2e composition : 1er et 2e trimestres remplis, le 2e coché, le 3e vide
    b = bulletins.bulletins_evaluation(db, annee, 2, inscription_id=iid)[0]
    t = _texte(service.generer(db, s, annee, "BULLETIN_EVAL", {"eleve": iid, "compo": 2}, tmp_path / "t.pdf"))
    assert "Trimestre :" in t and "Bilan du trimestre" in t and b["nom"] in t
    # bulletin de la composition de passage : rang et statistiques du 3e trimestre (3e compo + passage)
    from epp.reports import bulletin_colore
    from epp.reports.engine import Bulletin, Document
    b4 = bulletins.bulletins_evaluation(db, annee, 4, inscription_id=iid)[0]
    doc = Document("b", "", "", "portrait", {}, repo.etablissement(db), {}, variables={})
    K = bulletin_colore.contenu(doc, Bulletin(b4))
    assert K["decision"].startswith(("1er" if e["rangs_trim"][3] == 1 else f"{e['rangs_trim'][3]}e") + " sur ")
    assert [c for c, coche in K["choix_periode"] if coche] == ["3e"]


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


def test_couleurs_douces_pour_le_noir_et_blanc(demo, tmp_path):
    """Par défaut, fonds très clairs et textes foncés (lisible en noir et blanc) ; palette vive au choix."""
    from epp.reports.bulletin_colore import teintes

    def lum(h):
        h = h.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return 0.299 * r + 0.587 * g + 0.114 * b

    douce = teintes("douce")
    for fond, texte, _ in douce["tete"].values():
        assert lum(fond) > 0.85 and lum(texte) < 0.35            # contraste suffisant sans couleur
    for k in ("ligne_a", "ligne_b", "pied_tab", "identite", "bande_fond", "app_fond"):
        assert lum(douce[k]) > 0.85
    assert lum(teintes("vive")["bande_fond"]) < 0.5               # l'ancienne version reste disponible
    db, annee = demo
    s = system_session()
    m = store.get(db, "BULLETIN_ANNUEL")
    defn = copy.deepcopy(store.definition(db, m["id"]))
    assert defn["sections"][0]["palette"] == "douce"
    defn["sections"][0]["palette"] = "vive"
    store.creer(db, s, "Bulletin couleurs vives", defn, "Bulletins", code="BUL_VIF")
    for code in ("BULLETIN_ANNUEL", "BUL_VIF"):
        t = _texte(service.generer(db, s, annee, code, {"classe": "CM2"}, tmp_path / f"{code}.pdf"))
        assert "BULLETIN ANNUEL" in t
