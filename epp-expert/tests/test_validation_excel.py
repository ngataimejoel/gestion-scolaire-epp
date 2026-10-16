"""Validation des calculs de l'application contre les valeurs calculées par Excel.

Les valeurs attendues sont lues dans le cache du classeur source (data_only=True) :
aucune valeur n'est recopiée à la main. Un écart signifie que l'application ne
reproduit pas la formule du classeur.
Exception documentée : l'alerte « sur-âge » du tableau de bord (anomalie A1 de l'audit).
"""
from __future__ import annotations

import pytest

from epp.domain import resultats, stats

CLASSES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]
COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def col(i: int) -> str:
    return COLS[i] if i < 26 else COLS[i // 26 - 1] + COLS[i % 26]


def num(v):
    if v in (None, "", "-"):
        return 0
    if isinstance(v, str):
        return float(v.replace(",", ".").replace("%", ""))
    return v


def close(a, b, tol=1e-9):
    return abs(num(a) - num(b)) <= tol


def _check_grid(ws, st, rows: dict[int, str], first_col: int, metrics: list[str], sexes=("M", "F", "T")):
    ecarts = []
    for r, cl in rows.items():
        c = first_col
        for m in metrics:
            for sx in (["T"] if m == "seuil" else sexes):
                expected = ws[f"{col(c)}{r}"].value
                c += 1
                if m == "seuil":
                    continue
                got = st.val(cl, sx, m)
                if not close(expected, got):
                    ecarts.append(f"{ws.title}!{col(c - 1)}{r} {cl}/{sx}/{m}: Excel={expected!r} appli={got!r}")
    assert not ecarts, "\n".join(ecarts)


# ------------------------------------------------------------------ résultats élève par élève
@pytest.mark.parametrize("sheet,cols", [
    ("RESULTATS", dict(F="statut", G="moy1", H="moy2", I="moy3", J="moy_compos", K="moy4", L="mga", M="bareme",
                       N="seuil", O="decision", P="rang", Q="observation")),
    ("RESULTATS CM2", dict(E="statut", F="moy1", G="moy2", H="moy3", I="moy4", J="mga", K="bareme", L="seuil",
                           M="decision", N="rang", O="observation")),
])
def test_resultats_par_eleve(idb, annee, excel, sheet, cols):
    res = {r["matricule_ecole"]: r for r in resultats.compute(idb, annee)}
    ws = excel[sheet]
    n, ecarts = 0, []
    for r in range(10, 260):
        m = ws[f"B{r}"].value
        if not m:
            continue
        n += 1
        x = res.get(m)
        assert x is not None, f"{m} absent de l'application"
        for c, key in cols.items():
            ev, av = ws[f"{c}{r}"].value, x.get(key)
            if ev in ("", None) and av in ("", None):
                continue
            if isinstance(ev, (int, float)):
                ok = isinstance(av, (int, float)) and abs(ev - av) <= 1e-9
            else:
                ok = str(ev).strip() == str(av).strip()
            if not ok:
                ecarts.append(f"{sheet} {m} {key}: Excel={ev!r} appli={av!r}")
    assert n > 0
    assert not ecarts, "\n".join(ecarts)


def test_nombre_eleves_resultats(idb, annee, excel):
    res = resultats.compute(idb, annee)
    n_excel = sum(1 for s in ("RESULTATS", "RESULTATS CM2") for r in range(10, 260) if excel[s][f"B{r}"].value)
    assert len(res) == n_excel == 64


# ------------------------------------------------------------------ états statistiques
def test_effectifs(idb, annee, excel):
    st = stats.compute(idb, annee)
    _check_grid(excel["EFFECTIFS"], st, {11 + i: c for i, c in enumerate(CLASSES)} | {17: "TOTAL"}, 1,
                ["inscrits", "ivoiriens", "etrangers", "orphelins", "avec_extrait", "sans_extrait", "redoublants",
                 "abandons"])


def test_synthese_fin_annee(idb, annee, excel):
    st = stats.compute(idb, annee)
    ws = excel["SYNTHESE FIN D'ANNEE"]
    _check_grid(ws, st, {11 + i: c for i, c in enumerate(CLASSES)} | {17: "TOTAL"}, 1,
                ["inscrits", "presents", "abandons", "seuil", "admis", "taux_admission", "redoublent",
                 "effectif_probable"])
    assert close(ws["Q17"].value, 32 / 59)


def test_etat_par_classe(idb, annee, excel):
    ws = excel["ETAT PAR CLASSE"]
    classe = ws["C8"].value
    st = stats.compute(idb, annee)
    metrics = ["inscrits", "presents", "abandons", "ivoiriens", "etrangers", "orphelins", "orphelins_pere",
               "orphelins_mere", "orphelins_pere_mere", "avec_extrait", "sans_extrait", "redoublants"]
    ecarts = []
    for i, m in enumerate(metrics):
        for c, sx in (("C", "M"), ("D", "F"), ("E", "T")):
            ev = ws[f"{c}{93 + i}"].value
            if not close(ev, st.val(classe, sx, m)):
                ecarts.append(f"{classe} {m} {sx}: Excel={ev} appli={st.val(classe, sx, m)}")
    assert not ecarts, "\n".join(ecarts)
    # liste des élèves de la classe : mêmes matricules, même ordre
    from epp.domain import repo
    noms_excel = [ws[f"B{r}"].value for r in range(10, 90) if ws[f"C{r}"].value]
    assert [r["matricule_ecole"] for r in repo.inscriptions(idb, annee, classe)] == noms_excel


def test_rapport_de_composition(idb, annee, excel):
    ws = excel["RAPPORT DE COMPOSITION"]
    compo = int(ws["C9"].value)
    st = stats.compute(idb, annee, compo=compo)
    ecarts = []
    for i, m in enumerate(["compo_inscrits", "compo_presents", "compo_absents", "compo_admis", "compo_taux"]):
        c = 1
        for cl in CLASSES + ["TOTAL"]:
            for sx in ("M", "F", "T"):
                ev = ws[f"{col(c)}{15 + i}"].value
                c += 1
                if not close(ev, st.val(cl, sx, m)):
                    ecarts.append(f"{m} {cl}/{sx}: Excel={ev} appli={st.val(cl, sx, m)}")
    assert not ecarts, "\n".join(ecarts)
    # trois meilleurs par niveau
    top = stats.classement(idb, annee, compo, 3)
    for k, cl in enumerate(CLASSES):
        r = 25 + k
        for j, (cn, cm) in enumerate((("B", "G"), ("I", "N"), ("P", "U"))):
            nom_x, moy_x = ws[f"{cn}{r}"].value, ws[f"{cm}{r}"].value
            lst = top.get(cl, [])
            if not nom_x:
                assert j >= len(lst)
                continue
            assert lst[j]["nom"] == nom_x, (cl, j, lst[j]["nom"], nom_x)
            assert close(lst[j]["moyenne"], moy_x)


def test_rapport_de_rentree(idb, annee, excel):
    ws = excel["RAPPORT DE RENTREE"]
    st = stats.compute(idb, annee)
    ecarts = []
    for i, m in enumerate(["non_redoublants", "redoublants", "inscrits"]):
        c = 1
        for cl in CLASSES + ["TOTAL"]:
            for sx in ("M", "F", "T"):
                ev = ws[f"{col(c)}{31 + i}"].value
                c += 1
                if not close(ev, st.val(cl, sx, m)):
                    ecarts.append(f"{m} {cl}/{sx}: Excel={ev} appli={st.val(cl, sx, m)}")
    assert not ecarts, "\n".join(ecarts)


def test_rapport_mensuel(idb, annee, excel):
    from epp.io.import_excel import MOIS
    ws = excel["RAPPORT MENSUEL"]
    mois = MOIS[ws["C8"].value.lower()]
    st = stats.compute(idb, annee, mois=mois)
    ecarts = []
    for k, cl in enumerate(CLASSES + ["TOTAL"]):
        r = 16 + k
        for i, m in enumerate(["inscrits", "abandons", "mois_frequentation"]):
            for j, sx in enumerate(("M", "F", "T")):
                ev = ws[f"{col(1 + 3 * i + j)}{r}"].value
                got = st.val(cl, sx, m)
                if m == "mois_frequentation" and isinstance(ev, (int, float)) and ev > 1.5:
                    ev = ev / 100   # pourcentage saisi sur 100 dans la feuille
                if not close(ev, got, 1e-6):
                    ecarts.append(f"fréquentation {cl}/{sx}/{m}: Excel={ev!r} appli={got!r}")
        r = 48 + k
        for i, m in enumerate(["inscrits", "eval_composes", "eval_moyenne", "eval_taux"]):
            for j, sx in enumerate(("M", "F", "T")):
                ev = ws[f"{col(1 + 3 * i + j)}{r}"].value
                got = st.val(cl, sx, m)
                if not close(ev, got, 1e-6):
                    ecarts.append(f"évaluation {cl}/{sx}/{m}: Excel={ev!r} appli={got!r}")
    assert not ecarts, "\n".join(ecarts)
    assert close(st.val("TOTAL", "T", "mois_jours_absence"), 22.5)


def test_assiduite_personnel_mensuel(idb, annee, excel):
    from epp.io.import_excel import MOIS
    ws = excel["RAPPORT MENSUEL"]
    mois = MOIS[ws["C8"].value.lower()]
    rows = stats.assiduite_personnel(idb, annee, mois)
    ecarts = []
    for i, r in enumerate(rows):
        x = 26 + i
        for c, key in (("B", "nom"), ("E", "cours_tenu"), ("F", "retard_ou_absence"), ("H", "duree"),
                       ("J", "motif")):
            ev = ws[f"{c}{x}"].value
            ev = "" if ev is None else str(ev).replace("22.5", "22,5")
            if str(ev).strip() != str(r[key] or "").strip():
                ecarts.append(f"ligne {x} {key}: Excel={ev!r} appli={r[key]!r}")
    assert not ecarts, "\n".join(ecarts)


def test_tableau_de_bord(idb, annee, excel):
    ws = excel["TABLEAU DE BORD"]
    t = stats.tableau_de_bord(idb, annee)
    assert t["effectif"] == ws["B5"].value == 64
    assert close(t["filles_pct"], ws["D5"].value)
    assert t["presents"] == ws["F5"].value
    assert close(t["taux_abandon"], ws["H5"].value)
    assert close(t["taux_admission"], ws["B8"].value)
    assert t["sans_extrait"] == ws["D8"].value
    assert t["enseignants"] == ws["F8"].value
    assert close(t["ratio"], ws["H8"].value)
    for k, cl in enumerate(CLASSES):
        r = 13 + k
        pc = t["par_classe"][k]
        assert pc["classe"] == cl
        for c, key in (("C", "garcons"), ("D", "filles"), ("E", "total"), ("F", "admis"), ("G", "taux_admission"),
                       ("H", "abandons")):
            assert close(pc[key], ws[f"{c}{r}"].value), (cl, key, pc[key], ws[f"{c}{r}"].value)
    al = t["alertes"]
    for cell, key in (("J12", "sans_extrait"), ("J13", "homonymes"), ("J14", "sans_classe"),
                      ("J15", "mga_manquantes"), ("J16", "classes_sans_enseignant")):
        assert str(ws[cell].value).endswith(f": {al[key]}"), (cell, ws[cell].value, al[key])


def test_alerte_sur_age_corrigee(idb, annee, excel):
    """Anomalie A1 : la formule Excel compare une date à un âge (résultat 64) ; l'application compte
    réellement les élèves ayant au moins 3 ans de plus que l'âge normal."""
    t = stats.tableau_de_bord(idb, annee)
    assert str(excel["TABLEAU DE BORD"]["J17"].value).endswith(": 64")
    from epp.domain import calculs, repo
    attendu = sum(1 for r in repo.inscriptions(idb, annee) if calculs.sur_age(r["classe"], r["age"]))
    assert t["alertes"]["sur_age"] == attendu
    assert attendu < 64


def test_recap_personnel(idb, annee, excel):
    ws = excel["PERSONNEL"]
    rec = {r["fonction"]: r for r in stats.recap_personnel(idb, annee)}
    n = 0
    for r in range(72, 82):
        f = ws[f"B{r}"].value
        if f and f in rec:
            n += 1
            assert rec[f]["hommes"] == num(ws[f"C{r}"].value), f
            assert rec[f]["femmes"] == num(ws[f"D{r}"].value), f
            assert rec[f]["total"] == num(ws[f"E{r}"].value), f
    assert n > 0
