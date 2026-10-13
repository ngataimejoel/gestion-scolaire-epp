"""Résultats annuels (feuilles RESULTATS et RESULTATS CM2)."""
from __future__ import annotations

from epp.core.db import Database
from epp.domain import calculs, repo
from epp.domain.repo import Annee


def moyennes_par_evaluation(db: Database, annee: Annee) -> dict[int, dict[int, dict]]:
    """{inscription_id: {eval_num: {'moyenne', 'total', 'present', 'saisie'}}}"""
    notes: dict[int, dict[int, float]] = {}
    for n in db.query("SELECT n.inscription_id, n.matiere_id, n.valeur FROM note n "
                      "JOIN inscription i ON i.id=n.inscription_id WHERE i.annee_id=?", (annee.id,)):
        notes.setdefault(n["inscription_id"], {})[n["matiere_id"]] = n["valeur"]
    pres: dict[tuple[int, int], bool] = {}
    for p in db.query("SELECT p.* FROM presence_eval p JOIN inscription i ON i.id=p.inscription_id "
                      "WHERE i.annee_id=?", (annee.id,)):
        pres[(p["inscription_id"], p["eval_num"])] = bool(p["present"])
    out: dict[int, dict[int, dict]] = {}
    for r in db.query("SELECT id, classe_id FROM inscription WHERE annee_id=?", (annee.id,)):
        cl = annee.classe_par_id(r["classe_id"])
        g = annee.grilles.get(cl.grille_id) if cl else None
        res = {}
        for num in annee.eval_nums():
            mats = g.matieres.get(num, []) if g else []
            present = pres.get((r["id"], num), True)
            n = notes.get(r["id"], {})
            vals = [(n.get(m["id"]), m["valeur"]) for m in mats]
            total, moy = calculs.moyenne_evaluation(vals, g.mode if g else "BAREME", g.echelle if g else 10, present)
            res[num] = {"moyenne": moy, "total": total, "present": present,
                        "saisie": any(v is not None for v, _ in vals)}
        out[r["id"]] = res
    return out


def compute(db: Database, annee: Annee, classe_code: str | None = None) -> list[dict]:
    """Une ligne par inscription : moyennes, MGA, décision, rang, observation."""
    rows = repo.inscriptions(db, annee)
    moys = moyennes_par_evaluation(db, annee)
    for r in rows:
        cl = annee.classe(r["classe"])
        m = moys.get(r["inscription_id"], {})
        e = [m.get(n, {}).get("moyenne") for n in (1, 2, 3, 4)]
        r.update({"moy1": e[0], "moy2": e[1], "moy3": e[2], "moy4": e[3],
                  "presence": {n: m.get(n, {}).get("present", True) for n in (1, 2, 3, 4)}})
        if cl.regle_mga == "MOYENNE4":
            r["moy_compos"] = None
            r["mga"] = calculs.mga_moyenne4(e)
        else:
            r["moy_compos"] = calculs.moyenne_compositions(e[:3])
            r["mga"] = calculs.mga_standard(r["moy_compos"], e[3])
        r["bareme"] = cl.bareme
        r["seuil"] = cl.seuil
        r["decision"] = calculs.decision(r["statut"], r["mga"], cl.seuil)
        r["observation"] = calculs.observation(r["decision"], r["mga"], cl.bareme)
    for code in annee.codes:
        groupe = {r["inscription_id"]: r["mga"] for r in rows if r["classe"] == code}
        eligibles = {r["inscription_id"] for r in rows if r["classe"] == code and r["statut"] == "PRESENT"}
        rk = calculs.rangs(groupe, eligibles)
        for r in rows:
            if r["classe"] == code:
                r["rang"] = rk.get(r["inscription_id"])
    if classe_code:
        rows = [r for r in rows if r["classe"] == classe_code]
    return rows
