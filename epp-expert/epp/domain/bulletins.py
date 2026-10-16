"""Bulletins de notes des élèves (fonction ajoutée : absente du classeur d'origine).

Deux bulletins, calculés avec exactement les mêmes moyennes que les feuilles NOTES et
RESULTATS du classeur :
  - bulletin d'évaluation : notes par matière, total, moyenne, rang dans la classe ;
  - bulletin annuel : moyennes des 4 évaluations, MGA, rang, décision, observation.
Le rang suit la règle du classeur : 1 + nombre d'élèves présents de la classe ayant une
moyenne strictement supérieure (ex æquo au même rang).
"""
from __future__ import annotations

from epp.core.db import Database
from epp.domain import calculs, repo, resultats
from epp.domain.repo import Annee


def appreciation(valeur: float | None, maximum: float) -> str:
    """Appréciation d'une note ou d'une moyenne, ramenée sur 10 (mêmes paliers que l'observation
    du classeur, complétés sous la moyenne)."""
    if valeur is None or not maximum:
        return ""
    s = valeur / maximum * 10
    for seuil, txt in ((8, "Très bien"), (7, "Bien"), (6, "Assez bien"), (5, "Passable"), (4, "Insuffisant")):
        if s >= seuil:
            return txt
    return "Faible"


def _stats_classe(valeurs: list[float]) -> dict:
    v = [x for x in valeurs if x is not None]
    if not v:
        return {"moy_classe": None, "moy_max": None, "moy_min": None, "classes": 0}
    return {"moy_classe": calculs.xround(sum(v) / len(v), 2), "moy_max": max(v), "moy_min": min(v),
            "classes": len(v)}


def _moyenne_annuelle(valeurs: dict[int, float | None], regle: str) -> float | None:
    """Moyenne annuelle d'une discipline, avec la même règle que la MGA de la classe :
    STANDARD = (moyenne des compositions + 2 × composition de passage) ÷ 3 ; sinon moyenne simple."""
    v = {n: x for n, x in valeurs.items() if x is not None}
    if not v:
        return None
    compos = [v[n] for n in (1, 2, 3) if n in v]
    if regle == "STANDARD" and 4 in v and compos:
        return calculs.xround((sum(compos) / len(compos) + 2 * v[4]) / 3, 2)
    return calculs.xround(sum(v.values()) / len(v), 2)


TRIMESTRES = ("1er trimestre", "2e trimestre", "3e trimestre")


def trimestre(date_iso: str | None, num: int) -> int:
    """Trimestre d'une évaluation d'après sa date : septembre à décembre = 1, janvier à mars = 2,
    avril à août = 3. Sans date : 1re évaluation = 1, 2e = 2, les suivantes = 3."""
    if date_iso:
        m = int(str(date_iso)[5:7])
        return 1 if m >= 9 else 2 if m <= 3 else 3
    return min(num, 3)


def _moyenne(valeurs) -> float | None:
    v = [x for x in valeurs if x is not None]
    return calculs.xround(sum(v) / len(v), 2) if v else None


def _par_trimestre(out: dict) -> None:
    """Regroupe les évaluations par trimestre : note d'une discipline et moyenne générale du trimestre =
    moyenne des évaluations du trimestre ; rang du trimestre dans la classe. La moyenne annuelle reste
    calculée sur les évaluations, avec la règle du classeur."""
    groupes: dict[int, list[int]] = {}
    for p in out["periodes"]:
        p["trimestre"] = trimestre(p.get("date"), p["num"])
        groupes.setdefault(p["trimestre"], []).append(p["num"])
    out["trimestres"] = [{"num": t, "libelle": TRIMESTRES[t - 1], "evaluations": groupes.get(t, [])}
                         for t in (1, 2, 3)]
    moys: dict[int, dict] = {t: {} for t in (1, 2, 3)}
    for iid, e in out["eleves"].items():
        e["notes_trim"] = {lib: {t: _moyenne(v.get(n) for n in nums) for t, nums in groupes.items()}
                           for lib, v in e["notes"].items()}
        e["moyennes_trim"], e["presents_trim"] = {}, {}
        for t, nums in groupes.items():
            e["moyennes_trim"][t] = _moyenne(e["moyennes"].get(n) for n in nums)
            e["presents_trim"][t] = any(e["presents"].get(n) for n in nums)
            moys[t][iid] = e["moyennes_trim"][t]
    out["effectifs_trim"] = {}
    for t, m in moys.items():
        rk = calculs.rangs(m, {i for i, e in out["eleves"].items() if e.get("statut") == "PRESENT"})
        out["effectifs_trim"][t] = len(rk)
        out.setdefault("stats_trim", {})[t] = _stats_classe([m[i] for i in rk])
        for iid, e in out["eleves"].items():
            e.setdefault("rangs_trim", {})[t] = rk.get(iid)


def releve_classe(db: Database, annee: Annee, classe_code: str) -> dict:
    """Relevé de toute l'année d'une classe : disciplines du niveau, évaluations du calendrier de la
    classe, notes, moyennes et rangs de chaque élève pour chaque évaluation."""
    cl = annee.classe(classe_code)
    g = annee.grilles.get(cl.grille_id)
    evs = annee.evaluations.get(cl.calendrier, {})
    out = {"periodes": [], "disciplines": [], "echelle": g.echelle if g else cl.bareme, "eleves": {}}
    if g is None:
        return out
    vues: dict[str, dict] = {}
    for num in sorted(g.matieres):
        if num not in evs:
            continue
        out["periodes"].append({"num": num, "libelle": evs[num].get("libelle") or f"Évaluation {num}",
                                "date": evs[num].get("date")})
        mats, lignes = repo.notes_grille(db, annee, g.id, num, cl.code, valides_seulement=True)
        for m in mats:
            if m["libelle"] not in vues:
                vues[m["libelle"]] = {"libelle": m["libelle"], "max": repo.max_note(g, m)}
        moys = {r["inscription_id"]: r["moyenne"] for r in lignes}
        rk = calculs.rangs(moys, {r["inscription_id"] for r in lignes if r["statut"] == "PRESENT" and r["present"]})
        for r in lignes:
            e = out["eleves"].setdefault(r["inscription_id"], {"notes": {}, "moyennes": {}, "rangs": {},
                                                               "presents": {}})
            for m in mats:
                e["notes"].setdefault(m["libelle"], {})[num] = r["notes"].get(m["id"])
            e["moyennes"][num] = r["moyenne"] if r["present"] else None
            e["rangs"][num] = rk.get(r["inscription_id"])
            e["presents"][num] = bool(r["present"])
            e["statut"] = r["statut"]
    out["disciplines"] = list(vues.values())
    for e in out["eleves"].values():
        e["moyennes_disciplines"] = {lib: _moyenne_annuelle(v, cl.regle_mga) for lib, v in e["notes"].items()}
    _par_trimestre(out)
    return out


def _enseignants(db: Database, annee: Annee) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in repo.personnel(db, annee):
        c = p.get("classe_tenue")
        if c and c != "-" and c not in out:
            out[c] = p.get("nom") or ""
    return out


def _completer(db: Database, annee: Annee, bulletins: list[dict]) -> list[dict]:
    """Ajoute à chaque bulletin le relevé de l'année et le nom de l'enseignant(e) de la classe."""
    releves: dict[str, dict] = {}
    profs = _enseignants(db, annee)
    for b in bulletins:
        if b["classe"] not in releves:
            releves[b["classe"]] = releve_classe(db, annee, b["classe"])
        rel = releves[b["classe"]]
        e = rel["eleves"].get(b["inscription_id"], {"notes": {}, "moyennes": {}, "rangs": {}, "presents": {},
                                                     "moyennes_disciplines": {}})
        b["releve"] = {k: rel.get(k) for k in ("periodes", "trimestres", "effectifs_trim", "stats_trim", "disciplines",
                                                   "echelle")} | e
        b["enseignant"] = profs.get(b["classe"], "")
        b["regle_mga"] = annee.classe(b["classe"]).regle_mga
    return bulletins


def _identite(r: dict) -> dict:
    return {k: r.get(k) for k in ("inscription_id", "eleve_id", "matricule_ecole", "matricule_desps", "nom", "sexe",
                                  "classe", "date_naissance", "age", "redoublant", "statut", "numero")}


def bulletins_evaluation(db: Database, annee: Annee, num: int, classe_code: str | None = None,
                         inscription_id: int | None = None) -> list[dict]:
    out = []
    for cl in annee.classes:
        if classe_code and cl.code != classe_code:
            continue
        g = annee.grilles.get(cl.grille_id)
        if g is None or num not in g.matieres:
            continue
        mats, lignes = repo.notes_grille(db, annee, g.id, num, cl.code, valides_seulement=True)
        moys = {r["inscription_id"]: r["moyenne"] for r in lignes}
        eligibles = {r["inscription_id"] for r in lignes if r["statut"] == "PRESENT" and r["present"]}
        rk = calculs.rangs(moys, eligibles)
        st = _stats_classe([moys[i] for i in eligibles])
        cal = cl.calendrier
        ev = annee.evaluations.get(cal, {}).get(num, {})
        for r in lignes:
            if inscription_id and r["inscription_id"] != inscription_id:
                continue
            notes = []
            for m in mats:
                mx = repo.max_note(g, m)
                v = r["notes"].get(m["id"])
                notes.append({"matiere": m["libelle"], "note": v, "max": mx,
                              "coef": m["valeur"] if g.mode == "COEF" else None,
                              "appreciation": appreciation(v, mx) if r["present"] else "Absent"})
            moy = r["moyenne"]
            b = _identite(r) | {
                "type": "evaluation", "evaluation": ev.get("libelle") or f"Évaluation {num}",
                "eval_num": num, "date_evaluation": ev.get("date"), "mode": g.mode, "echelle": g.echelle,
                "present": bool(r["present"]), "notes": notes, "total": r["total"],
                "total_max": sum(n["max"] * (n["coef"] or 1) for n in notes) if g.mode == "COEF" else
                sum(n["max"] for n in notes),
                "moyenne": moy, "rang": rk.get(r["inscription_id"]), "effectif": len(eligibles),
                "seuil": cl.seuil, "bareme": cl.bareme,
                "appreciation": "Absent(e) à l'évaluation" if not r["present"] else appreciation(moy, g.echelle),
                "resultat": None if moy is None or not r["present"] else (
                    "Moyenne atteinte" if moy >= cl.seuil else "Moyenne non atteinte"),
            } | st
            out.append(b)
    return _completer(db, annee, out)


def bulletins_annuels(db: Database, annee: Annee, classe_code: str | None = None,
                      inscription_id: int | None = None) -> list[dict]:
    res = resultats.compute(db, annee, classe_code)
    out = []
    par_classe: dict[str, list[dict]] = {}
    for r in res:
        par_classe.setdefault(r["classe"], []).append(r)
    for code, rows in par_classe.items():
        cl = annee.classe(code)
        st = _stats_classe([r["mga"] for r in rows if r["statut"] == "PRESENT"])
        evs = annee.evaluations.get(cl.calendrier, {})
        for r in rows:
            if inscription_id and r["inscription_id"] != inscription_id:
                continue
            lignes = []
            for n in (1, 2, 3, 4):
                if n not in evs:
                    continue
                m = r.get(f"moy{n}")
                lignes.append({"evaluation": evs[n].get("libelle") or f"Évaluation {n}", "date": evs[n].get("date"),
                               "moyenne": m, "present": r["presence"].get(n, True),
                               "appreciation": appreciation(m, cl.bareme) if r["presence"].get(n, True) else "Absent"})
            out.append(_identite(r) | {
                "type": "annuel", "evaluations": lignes, "moy_compos": r.get("moy_compos"), "mga": r["mga"],
                "regle_mga": cl.regle_mga, "rang": r.get("rang"),
                "effectif": sum(1 for x in rows if x["statut"] == "PRESENT" and x["mga"] is not None),
                "decision": r["decision"], "observation": r["observation"], "seuil": cl.seuil,
                "bareme": cl.bareme, "classe_suivante": cl.niveau_suivant,
            } | st)
    return _completer(db, annee, out)
