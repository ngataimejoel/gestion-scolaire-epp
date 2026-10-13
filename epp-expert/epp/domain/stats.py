"""Statistiques par classe et par sexe : reproduit EFFECTIFS, SYNTHESE FIN D'ANNEE,
ETAT PAR CLASSE (statistiques), RAPPORT DE COMPOSITION, RAPPORT DE RENTREE,
RAPPORT MENSUEL et TABLEAU DE BORD.

Les métriques « comptage » sont calculées par (classe, sexe) puis additionnées ;
les métriques « taux » sont recalculées à chaque niveau (classe, total) à partir
des comptages, comme dans le classeur (le taux global n'est pas une moyenne de taux).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from epp.core.db import Database
from epp.domain import calculs, repo, resultats
from epp.domain.repo import Annee

SEXES = ("M", "F")

# code -> (libellé, type) ; type : 'n' entier, 'p' pourcentage, 'd' décimal
METRIQUES: dict[str, tuple[str, str]] = {
    "inscrits": ("Effectif inscrit", "n"),
    "presents": ("Présents (fin d'année)", "n"),
    "abandons": ("Abandons", "n"),
    "transferes": ("Transférés", "n"),
    "sortis": ("Abandons et transferts", "n"),
    "ivoiriens": ("Ivoiriens", "n"),
    "etrangers": ("Étrangers", "n"),
    "orphelins": ("Orphelins", "n"),
    "orphelins_pere": ("  dont de père", "n"),
    "orphelins_mere": ("  dont de mère", "n"),
    "orphelins_pere_mere": ("  dont de père et mère", "n"),
    "avec_extrait": ("Avec extrait", "n"),
    "sans_extrait": ("Sans extrait", "n"),
    "redoublants": ("Redoublants (cette année)", "n"),
    "non_redoublants": ("Non redoublants", "n"),
    "sur_age": ("Élèves en sur-âge", "n"),
    "admis": ("Admis", "n"),
    "redoublent": ("Redoublent", "n"),
    "taux_admission": ("Taux d'admission", "p"),
    "effectif_probable": ("Effectif probable année suivante", "n"),
    "compo_inscrits": ("Inscrits", "n"),
    "compo_presents": ("Présents", "n"),
    "compo_absents": ("Absents", "n"),
    "compo_admis": ("Admis", "n"),
    "compo_taux": ("Taux d'admis", "p"),
    "mois_jours_absence": ("Jours d'absence du mois", "d"),
    "mois_retards": ("Retards du mois", "n"),
    "mois_frequentation": ("Taux de fréquentation", "p"),
    "eval_composes": ("Ont composé", "n"),
    "eval_moyenne": ("Ont obtenu la moyenne", "n"),
    "eval_taux": ("% des admis", "p"),
}

DERIVEES = {
    "taux_admission": lambda c, ctx: calculs.taux(c["admis"], c["presents"]),
    "compo_taux": lambda c, ctx: calculs.taux(c["compo_admis"], c["compo_presents"]),
    "eval_taux": lambda c, ctx: calculs.taux(c["eval_moyenne"], c["eval_composes"]),
    "mois_frequentation": lambda c, ctx: calculs.taux_frequentation(
        c["mois_jours_absence"], c["inscrits"], ctx.get("jours_mois")),
    "sortis": lambda c, ctx: c["inscrits"] - c["presents"],
    "non_redoublants": lambda c, ctx: c["inscrits"] - c["redoublants"],
}


@dataclass
class Stats:
    annee: Annee
    classes: list[str]
    counts: dict = field(default_factory=dict)        # (classe, sexe) -> {métrique: valeur}
    ctx: dict = field(default_factory=dict)
    resultats: list[dict] = field(default_factory=list)

    def _agg(self, classes: list[str], sexes: tuple[str, ...]) -> dict:
        acc: dict[str, float] = defaultdict(float)
        for c in classes:
            for s in sexes:
                for k, v in self.counts.get((c, s), {}).items():
                    acc[k] += v or 0
        for k, fn in DERIVEES.items():
            acc[k] = fn(acc, self.ctx)
        return acc

    def val(self, classe: str, sexe: str, metrique: str):
        """classe : code ou 'TOTAL' ; sexe : 'M', 'F' ou 'T'."""
        cls = self.classes if classe == "TOTAL" else [classe]
        sx = SEXES if sexe == "T" else (sexe,)
        v = self._agg(cls, sx).get(metrique, 0)
        if METRIQUES.get(metrique, ("", "n"))[1] == "n" and v is not None:
            return int(round(v))
        return v


def _empty() -> dict:
    return {k: 0 for k in METRIQUES if k not in DERIVEES}


def evaluation_du_mois(annee: Annee, calendrier: str, mois: int, an: int) -> int:
    """RAPPORT MENSUEL!P8/P10 : dernière évaluation dont la date tombe dans le mois."""
    best = 0
    for num, e in annee.evaluations.get(calendrier, {}).items():
        d = calculs.to_date(e.get("date"))
        if d and d.month == mois and d.year == an:
            best = max(best, num)
    return best


def annee_civile(annee: Annee, mois: int) -> int:
    """RAPPORT MENSUEL!P4 : septembre à décembre = 1re année, sinon 2e année."""
    return annee.an_debut() if mois >= 9 else annee.an_debut() + 1


def compute(db: Database, annee: Annee, compo: int | None = None, mois: int | None = None,
            extra_classes: list[str] | None = None) -> Stats:
    st = Stats(annee, annee.codes + [c for c in (extra_classes or []) if c not in annee.codes])
    res = resultats.compute(db, annee)
    st.resultats = res
    for c in st.classes:
        for s in SEXES:
            st.counts[(c, s)] = _empty()
    by_id = {}
    for r in res:
        key = (r["classe"], r["sexe"])
        if key not in st.counts:
            continue
        k = st.counts[key]
        by_id[r["inscription_id"]] = r
        k["inscrits"] += 1
        k["presents"] += r["statut"] == "PRESENT"
        k["abandons"] += r["statut"] == "ABANDON"
        k["transferes"] += r["statut"] == "TRANSFERE"
        nat = (r.get("nationalite") or "").strip()
        k["ivoiriens"] += nat == "IVOIRIENNE"
        k["etrangers"] += bool(nat) and nat != "IVOIRIENNE"
        k["orphelins"] += r.get("orphelin") == "OUI"
        k["orphelins_pere"] += r.get("orphelin_de") == "PERE"
        k["orphelins_mere"] += r.get("orphelin_de") == "MERE"
        k["orphelins_pere_mere"] += r.get("orphelin_de") == "PERE ET MERE"
        k["avec_extrait"] += r.get("extrait") == "OUI"
        k["sans_extrait"] += r.get("extrait") == "NON"
        k["redoublants"] += r.get("redoublant") == "OUI"
        k["sur_age"] += calculs.sur_age(r["classe"], r.get("age"))
        k["admis"] += r["decision"] == "ADMIS"
        k["redoublent"] += r["decision"] == "REDOUBLE"
        k["compo_inscrits"] += 1
    # Effectif probable de l'année suivante (SYNTHESE U:W)
    moitie = calculs.xround(annee.nouveaux_cp1 / 2, 0)
    for cl in annee.classes:
        prev = annee.classe_precedente(cl.code)
        for s in SEXES:
            k = st.counts[(cl.code, s)]
            k["effectif_probable"] = k["redoublent"] + (st.counts[(prev.code, s)]["admis"] if prev else moitie)
    # Composition n (RAPPORT DE COMPOSITION)
    if compo:
        st.ctx["compo"] = compo
        moys = resultats.moyennes_par_evaluation(db, annee)
        for iid, r in by_id.items():
            m = moys.get(iid, {}).get(compo, {})
            k = st.counts[(r["classe"], r["sexe"])]
            cl = annee.classe(r["classe"])
            present = m.get("present", True)
            moy = m.get("moyenne")
            if not present:
                k["compo_absents"] += 1
            elif moy is not None:
                k["compo_presents"] += 1
                k["compo_admis"] += moy >= cl.seuil
    # Mois (RAPPORT MENSUEL)
    if mois:
        an = annee_civile(annee, mois)
        st.ctx.update(mois=mois, an=an, jours_mois=(annee.jours.get(mois) or {}).get("jours"))
        for a in repo.absences_eleves(db, annee, mois):
            if a["annee_civile"] != an or (a["classe"], a["sexe"]) not in st.counts:
                continue
            k = st.counts[(a["classe"], a["sexe"])]
            k["mois_jours_absence"] += a["jours"] or 0
            k["mois_retards"] += a["nature"] == "RETARD"
        evals = {cal: evaluation_du_mois(annee, cal, mois, an) for cal in annee.evaluations}
        st.ctx["evals_du_mois"] = evals
        if any(evals.values()):
            moys = resultats.moyennes_par_evaluation(db, annee)
            for iid, r in by_id.items():
                cl = annee.classe(r["classe"])
                num = evals.get(cl.calendrier, 0)
                if not num:
                    continue
                m = moys.get(iid, {}).get(num, {})
                k = st.counts[(r["classe"], r["sexe"])]
                if m.get("present", True) and m.get("moyenne") is not None:
                    k["eval_composes"] += 1
                    k["eval_moyenne"] += m["moyenne"] >= cl.seuil
    return st


def classement(db: Database, annee: Annee, compo: int, top: int = 3) -> dict[str, list[dict]]:
    """Trois meilleurs par niveau (RAPPORT DE COMPOSITION) ; ex æquo : premier inscrit d'abord."""
    moys = resultats.moyennes_par_evaluation(db, annee)
    out: dict[str, list[dict]] = {}
    for cl in annee.classes:
        rows = repo.inscriptions(db, annee, cl.code)
        cand = []
        for pos, r in enumerate(rows):
            m = moys.get(r["inscription_id"], {}).get(compo, {})
            if m.get("moyenne") is not None:
                cand.append((m["moyenne"], -pos, r))
        cand.sort(key=lambda t: (t[0], t[1]), reverse=True)
        out[cl.code] = [{"rang": i + 1, "nom": r["nom"], "matricule_ecole": r["matricule_ecole"], "moyenne": m}
                        for i, (m, _, r) in enumerate(cand[:top])]
    return out


def tableau_de_bord(db: Database, annee: Annee) -> dict:
    st = compute(db, annee)
    pers = repo.personnel(db, annee)
    ens = [p for p in pers if (p.get("fonction") or "").upper().startswith(("INSTITUTEUR", "DIRECTEUR"))]
    eff = st.val("TOTAL", "T", "inscrits")
    noms = [r["nom"] for r in st.resultats]
    homonymes = sum(1 for n in noms if noms.count(n) > 1)
    classes_tenues = {p.get("classe_code") for p in pers if p.get("classe_code")}
    return {
        "effectif": eff,
        "filles_pct": calculs.taux(st.val("TOTAL", "F", "inscrits"), eff),
        "presents": st.val("TOTAL", "T", "presents"),
        "taux_abandon": calculs.taux(st.val("TOTAL", "T", "abandons"), eff),
        "taux_admission": st.val("TOTAL", "T", "taux_admission"),
        "sans_extrait": st.val("TOTAL", "T", "sans_extrait"),
        "enseignants": len(ens),
        "ratio": calculs.taux(eff, len(ens)),
        "par_classe": [{
            "classe": c, "garcons": st.val(c, "M", "inscrits"), "filles": st.val(c, "F", "inscrits"),
            "total": st.val(c, "T", "inscrits"), "admis": st.val(c, "T", "admis"),
            "taux_admission": st.val(c, "T", "taux_admission"), "abandons": st.val(c, "T", "abandons")}
            for c in st.classes],
        "alertes": {
            "sans_extrait": st.val("TOTAL", "T", "sans_extrait"),
            "homonymes": homonymes,
            "sans_classe": 0,
            "mga_manquantes": sum(1 for r in st.resultats if r["statut"] == "PRESENT" and r["mga"] is None),
            "classes_sans_enseignant": len([c for c in annee.codes if c not in classes_tenues]),
            "sur_age": st.val("TOTAL", "T", "sur_age"),
        },
        "stats": st,
    }


def recap_personnel(db: Database, annee: Annee) -> list[dict]:
    """PERSONNEL!B72:E80 : effectif par fonction et par sexe."""
    pers = repo.personnel(db, annee)
    fonctions = repo.liste(db, "FONCTION")
    for p in pers:
        if p.get("fonction") and p["fonction"] not in fonctions:
            fonctions.append(p["fonction"])
    out = []
    for f in fonctions:
        h = sum(1 for p in pers if p.get("fonction") == f and p["sexe"] == "M")
        fe = sum(1 for p in pers if p.get("fonction") == f and p["sexe"] == "F")
        out.append({"fonction": f, "hommes": h, "femmes": fe, "total": h + fe})
    return out


def _fmt_nombre(v: float) -> str:
    return (f"{v:g}").replace(".", ",")


def assiduite_personnel(db: Database, annee: Annee, mois: int) -> list[dict]:
    """RAPPORT MENSUEL!A26:M37 : retards / absences du personnel pour le mois."""
    an = annee_civile(annee, mois)
    abs_ = [a for a in repo.absences_personnel(db, annee, mois) if a["annee_civile"] == an]
    out = []
    for p in repo.personnel(db, annee):
        ev = [a for a in abs_ if a["personnel_id"] == p["id"]]
        nr = sum(1 for a in ev if a["nature"] == "RETARD")
        na = sum(1 for a in ev if a["nature"] == "ABSENCE")
        j = sum(a["jours"] or 0 for a in ev)
        mn = sum(a["retard_min"] or 0 for a in ev)
        if not ev:
            nature = duree = motif = "-"
        else:
            nature = " / ".join(x for x in [f"{nr} retard(s)" if nr else "", f"{na} absence(s)" if na else ""] if x)
            duree = " / ".join(x for x in [f"{_fmt_nombre(j)} j" if j else "", f"{mn} min" if mn else ""] if x)
            motif = (ev[0]["motif"] or "") + (f" (+{len(ev) - 1} autre(s))" if len(ev) > 1 else "")
        out.append({"numero": p["numero"], "nom": p["nom"], "matricule": p["matricule"],
                    "cours_tenu": p["classe_tenue"], "fonction": p.get("fonction"),
                    "retards": nr, "absences": na, "jours": j, "minutes": mn,
                    "retard_ou_absence": nature, "duree": duree, "motif": motif, "emargement": ""})
    return out
