"""Sources de données disponibles pour les modèles de rapports.

Chaque source déclare ses champs (nom technique, libellé, type) et une fonction de
chargement. Le concepteur de rapports propose ces champs à l'utilisateur : ajouter
une source ici la rend immédiatement utilisable dans tous les modèles.
Types : texte, entier, decimal, pourcent, date, monnaie.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from epp.core.db import Database
from epp.domain import repo, resultats, stats
from epp.domain.repo import Annee


@dataclass
class Champ:
    nom: str
    libelle: str
    type: str = "texte"


@dataclass
class Source:
    code: str
    libelle: str
    description: str
    champs: list[Champ]
    charger: Callable[["Contexte"], list[dict]]
    parametres: list[str] = field(default_factory=list)   # paramètres utiles (classe, mois, compo...)
    champs_dynamiques: Callable[["Contexte"], list[Champ]] | None = None

    def champ(self, nom: str) -> Champ | None:
        return next((c for c in self.champs if c.nom == nom), None)


@dataclass
class Contexte:
    db: Database
    annee: Annee
    params: dict
    _cache: dict = field(default_factory=dict)

    def get(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def stats(self) -> stats.Stats:
        return self.get(("stats", self.params.get("compo"), self.params.get("mois"),
                         tuple(self.params.get("classes_extra") or ())),
                        lambda: stats.compute(self.db, self.annee, self.params.get("compo"), self.params.get("mois"),
                                              extra_classes=self.params.get("classes_extra")))

    def resultats(self) -> list[dict]:
        return self.get("resultats", lambda: resultats.compute(self.db, self.annee))


C = Champ

ELEVE_CHAMPS = [
    C("numero", "N°", "entier"), C("matricule_ecole", "Matricule école"), C("matricule_desps", "Matricule DESPS"),
    C("nom", "Nom et prénoms"), C("sexe", "Sexe"), C("classe", "Classe"), C("date_naissance", "Date de naissance", "date"),
    C("age", "Âge", "entier"), C("nationalite", "Nationalité"), C("localite", "Localité"),
    C("sous_prefecture", "Sous-préfecture"), C("extrait", "Extrait ?"), C("acte_num", "Acte N°"),
    C("acte_date", "Acte du", "date"), C("centre_etat_civil", "Centre d'état civil"), C("orphelin", "Orphelin"),
    C("orphelin_de", "Orphelin de"), C("pere_nom", "Père"), C("pere_profession", "Profession père"),
    C("pere_residence", "Résidence père"), C("pere_tel", "Tél. père"), C("mere_nom", "Mère"),
    C("mere_profession", "Profession mère"), C("mere_residence", "Résidence mère"), C("mere_tel", "Tél. mère"),
    C("tuteur_nom", "Tuteur"), C("tuteur_profession", "Profession tuteur"), C("tuteur_residence", "Résidence tuteur"),
    C("tuteur_tel", "Tél. tuteur"), C("redoublant", "Redoublant"), C("statut", "Statut"),
    C("type", "Inscription / réinscription"), C("date_inscription", "Date d'inscription", "date"),
    C("observations", "Observations"),
]

RESULTAT_CHAMPS = [
    C("numero", "N°", "entier"), C("matricule_ecole", "Matricule école"), C("nom", "Nom et prénoms"),
    C("sexe", "Sexe"), C("classe", "Classe"), C("statut", "Statut"),
    C("moy1", "Moy. 1re évaluation", "decimal"), C("moy2", "Moy. 2e évaluation", "decimal"),
    C("moy3", "Moy. 3e évaluation", "decimal"), C("moy_compos", "Moyenne des 3 compos", "decimal"),
    C("moy4", "Moy. 4e évaluation (passage)", "decimal"), C("mga", "MGA", "decimal"),
    C("bareme", "Barème", "entier"), C("seuil", "Seuil", "decimal"), C("decision", "Décision"),
    C("rang", "Rang", "entier"), C("observation", "Observation"), C("regle_mga", "Règle de MGA"),
    C("decision_calculee", "Décision calculée"), C("decision_validee", "Décision validée (OUI/NON)"),
    C("motif_decision", "Motif de la décision"),
]

PERSONNEL_CHAMPS = [
    C("numero", "N°", "entier"), C("matricule", "Matricule"), C("nom", "Nom et prénoms"), C("sexe", "Sexe"),
    C("genre", "Genre (H/F)"), C("date_naissance", "Date de naissance", "date"), C("age", "Âge", "entier"),
    C("fonction", "Fonction"), C("grade", "Grade / Emploi"), C("classe_tenue", "Classe tenue"),
    C("diplome", "Diplôme"), C("date_prise_service", "Prise de service", "date"),
    C("anciennete", "Ancienneté (ans)", "entier"), C("date_arrivee", "Arrivée dans l'école", "date"),
    C("telephone", "Téléphone"), C("situation_matrimoniale", "Situation matrimoniale"),
    C("observations", "Observations"), C("est_enseignant", "Enseignant (OUI/NON)"),
]

ABS_ELEVE_CHAMPS = [
    C("numero", "N°", "entier"), C("date", "Date", "date"), C("matricule_ecole", "Matricule école"),
    C("nom", "Nom et prénoms"), C("classe", "Classe"), C("sexe", "Sexe"), C("nature", "Nature"),
    C("jours", "Jours d'absence", "decimal"), C("retard_min", "Retard (minutes)", "entier"), C("motif", "Motif"),
    C("justifie", "Justifié ?"), C("observations", "Observations"), C("mois", "Mois (n°)", "entier"),
]

ABS_PERS_CHAMPS = [
    C("numero", "N°", "entier"), C("date", "Date", "date"), C("matricule", "Matricule"),
    C("nom", "Nom et prénoms"), C("cours_tenu", "Cours tenu"), C("sexe", "Sexe"), C("nature", "Nature"),
    C("jours", "Jours d'absence", "decimal"), C("retard_min", "Retard (minutes)", "entier"), C("motif", "Motif"),
    C("justifie", "Justifié ?"), C("observations", "Observations"), C("mois", "Mois (n°)", "entier"),
]


def _filtre_periode(rows: list[dict], ctx: Contexte) -> list[dict]:
    d1, d2 = ctx.params.get("date_debut"), ctx.params.get("date_fin")
    if d1:
        rows = [r for r in rows if r["date"] >= d1]
    if d2:
        rows = [r for r in rows if r["date"] <= d2]
    return rows


def _eleves(ctx: Contexte) -> list[dict]:
    return repo.inscriptions(ctx.db, ctx.annee)


def _resultats(ctx: Contexte) -> list[dict]:
    rows = [dict(r) for r in ctx.resultats()]
    for r in rows:
        r["regle_mga"] = ctx.annee.classe(r["classe"]).regle_mga
        if r["regle_mga"] == "MOYENNE4":
            r["moy_compos"] = None
    return rows


def _personnel(ctx: Contexte) -> list[dict]:
    rows = repo.personnel(ctx.db, ctx.annee)
    for r in rows:
        r["genre"] = "H" if r["sexe"] == "M" else "F"
        r["est_enseignant"] = "OUI" if (r.get("fonction") or "").upper().startswith(("INSTITUTEUR", "DIRECTEUR")) else "NON"
    return rows


def _abs_eleves(ctx: Contexte) -> list[dict]:
    rows = repo.absences_eleves(ctx.db, ctx.annee, ctx.params.get("mois"))
    if ctx.params.get("mois"):
        an = stats.annee_civile(ctx.annee, ctx.params["mois"])
        rows = [r for r in rows if r["annee_civile"] == an]
    return _filtre_periode(rows, ctx)


def _abs_pers(ctx: Contexte) -> list[dict]:
    rows = repo.absences_personnel(ctx.db, ctx.annee, ctx.params.get("mois"))
    if ctx.params.get("mois"):
        an = stats.annee_civile(ctx.annee, ctx.params["mois"])
        rows = [r for r in rows if r["annee_civile"] == an]
    return _filtre_periode(rows, ctx)


def _assiduite(ctx: Contexte) -> list[dict]:
    mois = ctx.params.get("mois")
    if not mois:
        return []
    return stats.assiduite_personnel(ctx.db, ctx.annee, mois)


def _stats_champs() -> list[Champ]:
    out = [C("classe", "Classe")]
    for code, (lib, typ) in stats.METRIQUES.items():
        t = {"n": "entier", "p": "pourcent", "d": "decimal"}[typ]
        for sx, sl in (("M", "G"), ("F", "F"), ("T", "T")):
            out.append(C(f"{code}_{sx}", f"{lib.strip()} ({sl})", t))
    return out


def _stats_classe(ctx: Contexte) -> list[dict]:
    st = ctx.stats()
    rows = []
    for cl in st.classes + ["TOTAL"]:
        r = {"classe": cl}
        for code in stats.METRIQUES:
            for sx in ("M", "F", "T"):
                r[f"{code}_{sx}"] = st.val(cl, sx, code)
        rows.append(r)
    return rows


def _recap_personnel(ctx: Contexte) -> list[dict]:
    return stats.recap_personnel(ctx.db, ctx.annee)


def _classes(ctx: Contexte) -> list[dict]:
    st = ctx.stats()
    pers = repo.personnel(ctx.db, ctx.annee)
    out = []
    for cl in ctx.annee.classes:
        ens = [p["nom"] for p in pers if p.get("classe_code") == cl.code]
        g = ctx.annee.grilles.get(cl.grille_id)
        out.append({"classe": cl.code, "libelle": cl.libelle, "seuil": cl.seuil, "bareme": cl.bareme,
                    "seuil_texte": f"{cl.seuil:g}/{cl.bareme:g}", "grille": g.libelle if g else "",
                    "enseignant": ", ".join(ens) or "(aucun)", "effectif": st.val(cl.code, "T", "inscrits"),
                    "garcons": st.val(cl.code, "M", "inscrits"), "filles": st.val(cl.code, "F", "inscrits"),
                    "classe_suivante": cl.niveau_suivant or "(sortie)"})
    return out


def _notes_champs(ctx: Contexte) -> list[Champ]:
    g = _grille_param(ctx)
    if g is None:
        return []
    mats = g.matieres.get(int(ctx.params.get("compo") or 1), [])
    unit = "coef. " if g.mode == "COEF" else "/"
    return [C(f"note_{i}", f"{m['libelle']} ({unit}{m['valeur']:g})", "decimal") for i, m in enumerate(mats)]


def _grille_param(ctx: Contexte):
    code = ctx.params.get("classe")
    cl = ctx.annee.classe(code) if code else (ctx.annee.classes[0] if ctx.annee.classes else None)
    return ctx.annee.grilles.get(cl.grille_id) if cl else None


def _notes(ctx: Contexte) -> list[dict]:
    g = _grille_param(ctx)
    if g is None:
        return []
    num = int(ctx.params.get("compo") or 1)
    mats, rows = repo.notes_grille(ctx.db, ctx.annee, g.id, num, ctx.params.get("classe"))
    out = []
    for n, r in enumerate(rows, 1):
        d = {"numero": n, "matricule_ecole": r["matricule_ecole"], "nom": r["nom"], "sexe": r["sexe"],
             "classe": r["classe"], "statut": r["statut"], "present": "OUI" if r["present"] else "NON",
             "total": r["total"], "moyenne": r["moyenne"]}
        for i, m in enumerate(mats):
            d[f"note_{i}"] = r["notes"].get(m["id"])
        out.append(d)
    return out


def _evaluations(ctx: Contexte) -> list[dict]:
    out = []
    for cal, evs in ctx.annee.evaluations.items():
        for num, e in evs.items():
            out.append({"calendrier": "CP1 à CM1" if cal == "STD" else cal, "num": num, "libelle": e["libelle"],
                        "date": e["date"]})
    return out


SOURCES: dict[str, Source] = {s.code: s for s in [
    Source("eleves", "Élèves (registre)", "Une ligne par élève inscrit dans l'année.", ELEVE_CHAMPS, _eleves),
    Source("resultats", "Résultats annuels", "Moyennes, MGA, décision, rang et observation de chaque élève.",
           RESULTAT_CHAMPS, _resultats),
    Source("notes", "Feuille de notes", "Notes par matière pour une classe et une évaluation.",
           [C("numero", "N°", "entier"), C("matricule_ecole", "Matricule école"), C("nom", "Nom et prénoms"),
            C("sexe", "Sexe"), C("classe", "Classe"), C("statut", "Statut"), C("present", "Présent ?"),
            C("total", "Total", "decimal"), C("moyenne", "Moyenne", "decimal")],
           _notes, ["classe", "compo"], _notes_champs),
    Source("personnel", "Personnel", "Une ligne par agent, avec la classe tenue dans l'année.", PERSONNEL_CHAMPS,
           _personnel),
    Source("absences_eleves", "Absences et retards des élèves", "Journal des absences et retards des élèves.",
           ABS_ELEVE_CHAMPS, _abs_eleves, ["mois", "date_debut", "date_fin"]),
    Source("absences_personnel", "Absences et retards du personnel", "Journal des absences et retards du personnel.",
           ABS_PERS_CHAMPS, _abs_pers, ["mois", "date_debut", "date_fin"]),
    Source("assiduite_personnel", "Assiduité du personnel (mois)", "Synthèse mensuelle des retards et absences par agent.",
           [C("numero", "N°", "entier"), C("nom", "Nom et prénoms"), C("matricule", "Matricule"),
            C("cours_tenu", "Cours tenu"), C("fonction", "Fonction"), C("retards", "Retards", "entier"),
            C("absences", "Absences", "entier"), C("jours", "Jours d'absence", "decimal"),
            C("minutes", "Minutes de retard", "entier"), C("retard_ou_absence", "Retard ou absence"),
            C("duree", "Durée du retard / absence"), C("motif", "Motif du retard / absence"),
            C("emargement", "Émargement")], _assiduite, ["mois"]),
    Source("stats_classe", "Statistiques par classe", "Une ligne par classe (et une ligne TOTAL) ; chaque indicateur "
           "est disponible pour les garçons (G), les filles (F) et le total (T).", _stats_champs(), _stats_classe,
           ["compo", "mois"]),
    Source("recap_personnel", "Récapitulatif du personnel", "Effectif par fonction et par sexe.",
           [C("fonction", "Fonction"), C("hommes", "Hommes", "entier"), C("femmes", "Femmes", "entier"),
            C("total", "Total", "entier")], _recap_personnel),
    Source("classes", "Classes", "Configuration des classes, effectifs et enseignants.",
           [C("classe", "Classe"), C("libelle", "Libellé"), C("enseignant", "Enseignant"),
            C("effectif", "Effectif", "entier"), C("garcons", "Garçons", "entier"), C("filles", "Filles", "entier"),
            C("seuil", "Seuil", "decimal"), C("bareme", "Barème", "entier"), C("seuil_texte", "Seuil / barème"),
            C("grille", "Grille de notes"), C("classe_suivante", "Classe suivante")], _classes),
    Source("evaluations", "Calendrier des évaluations", "Évaluations et dates de l'année.",
           [C("calendrier", "Calendrier"), C("num", "N°", "entier"), C("libelle", "Évaluation"),
            C("date", "Date", "date")], _evaluations),
]}


def champs(source: str, ctx: Contexte | None = None) -> list[Champ]:
    s = SOURCES[source]
    extra = s.champs_dynamiques(ctx) if (s.champs_dynamiques and ctx) else []
    return s.champs + extra
