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
        mats, lignes = repo.notes_grille(db, annee, g.id, num, cl.code)
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
    return out


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
    return out
