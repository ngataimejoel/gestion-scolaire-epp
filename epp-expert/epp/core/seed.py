"""Données initiales : listes de choix, structure d'une année scolaire, rôles, modèles.

Les valeurs par défaut reprennent exactement la configuration du classeur
GESTION_SCOLAIRE_EPP_MODELE_EXPERT (feuille PARAMETRES).
"""
from __future__ import annotations

from datetime import date

from epp.core.db import Database

# En-tête officiel des impressions : une ligne par ligne de texte, variables entre accolades.
ENTETE_GAUCHE_DEFAUT = "{ministere}\n{dren}\n{iepp}\n{ecole}  -  Code : {code_ecole}"
ENTETE_DROITE_DEFAUT = "{pays}\n{devise_pays}\nANNEE SCOLAIRE : {annee}"

DEFAULT_PARAMS = {
    "pays": "REPUBLIQUE DE COTE D'IVOIRE",
    "devise_pays": "Union - Discipline - Travail",
    "ministere": "MINISTERE DE L'EDUCATION NATIONALE ET DE L'ALPHABETISATION",
    "dren": "DRENAET DE TOUBA",
    "iepp": "IEPP OUANINOU",
    "ecole_nom": "EPP OUANINOU 2",
    "ecole_code": "",
    "localite": "OUANINOU",
    "directeur": "",
    "secteur": "",
    "monnaie": "FCFA",
    "logo": "",                 # ancien réglage (chemin d'un fichier), remplacé par logo_iepp / logo_ecole
    "logo_iepp": "",            # image PNG encodée en base64 (incluse dans les sauvegardes)
    "logo_ecole": "",
    "bulletin_titre": "{ecole}",                     # bulletin coloré : grand titre de l'en-tête
    "bulletin_slogan": "Apprendre aujourd'hui, réussir demain",
    "bulletin_devise": "Une école pour construire l'avenir !",
    "bulletin_pied": "L'éducation est la clé de la réussite",
    "bulletin_palette": "",                          # "" = selon le modèle, "douce" ou "vive"
    "bulletin_colonnes": "trimestres",               # bulletin coloré : "trimestres" ou "evaluations"
    # demande d'autorisation d'absence du personnel (modèle de l'école)
    "autorisation_destinataire": "Monsieur/Madame le Chef de Circonscription",
    "autorisation_avis": "LE DEP / CPPP / CPI",
    "autorisation_decision": "LE CHEF DE CIRCONSCRIPTION",
    "entete_gauche": ENTETE_GAUCHE_DEFAUT,
    "entete_droite": ENTETE_DROITE_DEFAUT,
    "sauvegarde_auto": "1",
    "sauvegarde_frequence_heures": "24",
    "sauvegarde_conserver": "20",
    "sauvegarde_dossier": "",
}

DEFAULT_LISTS = {
    "SEXE": ["M", "F"],
    "OUI_NON": ["OUI", "NON"],
    "NATIONALITE": ["IVOIRIENNE", "BURKINABE", "MALIENNE", "GUINEENNE", "GHANEENNE",
                    "NIGERIENNE", "TOGOLAISE", "BENINOISE", "AUTRE"],
    "ORPHELIN_DE": ["-", "PERE", "MERE", "PERE ET MERE"],
    "STATUT": ["PRESENT", "ABANDON", "TRANSFERE"],
    "FONCTION": ["DIRECTEUR", "DIRECTEUR ADJOINT", "INSTITUTEUR ORDINAIRE", "INSTITUTEUR ADJOINT",
                 "INSTITUTEUR STAGIAIRE", "GARDIEN", "CANTINIERE"],
    "NATURE_ABSENCE": ["RETARD", "ABSENCE"],
    "MOTIF_ABSENCE": ["Maladie", "Sans motif", "Pluie / route coupée", "Deuil familial", "Voyage",
                      "Travaux champêtres", "Convocation IEPP", "Formation", "Autre"],
    "SITUATION_MATRIMONIALE": ["CELIBATAIRE", "MARIE(E)", "DIVORCE(E)", "VEUF(VE)"],
    "CATEGORIE_RAPPORT": ["Officiel", "Élèves", "Effectifs", "Résultats", "Personnel", "Absences",
                          "Statistiques", "Autre"],
}

MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
           "Septembre", "Octobre", "Novembre", "Décembre"]

# (mois, jours de classe) — PARAMETRES B38:D48
DEFAULT_JOURS = [(9, 13), (10, 22), (11, 21), (12, 17), (1, 20), (2, 15), (3, 23),
                 (4, 15), (5, 21), (6, 22), (7, 12)]

CP_MATIERES = ["ECRITURE", "E.D.H.C", "EXPRESSION ECRITE", "MATHEMATIQUE", "ORTHOGRAPHE",
               "DESSIN", "CHANT ET POESIE", "LECTURE"]
GRILLES = {
    # code: (libellé, mode, échelle, note_max, {eval_num: [(matière, valeur)]})
    "CP": ("CP1 et CP2", "COEF", 10, 10, {n: [(m, 1) for m in CP_MATIERES] for n in (1, 2, 3, 4)}),
    "CE1": ("CE1", "BAREME", 10, 10, {n: [("EXPLOITATION DE TEXTE", 50), ("EVEIL AU MILIEU", 40),
                                          ("MATHEMATIQUES", 40), ("DICTEE", 10)] for n in (1, 2, 3, 4)}),
    "CE2-CM1": ("CE2 et CM1", "BAREME", 10, 10, {n: [("EXPLOITATION DE TEXTE", 50), ("EVEIL AU MILIEU", 50),
                                                     ("MATHEMATIQUES", 50), ("DICTEE", 20)] for n in (1, 2, 3, 4)}),
    "CM2": ("CM2", "BAREME", 20, 20, {
        **{n: [("EXPLOITATION DE TEXTE", 50), ("EVEIL AU MILIEU", 50), ("MATHEMATIQUES", 50), ("DICTEE", 20)]
           for n in (1, 2)},
        **{n: [("EXPLOITATION DE TEXTE", 50), ("EVEIL AU MILIEU", 50), ("MATHEMATIQUES", 50), ("DICTEE", 20),
               ("EPREUVES PHYSIQUES", 20)] for n in (3, 4)}}),
}
# code, grille, seuil, barème, calendrier, règle MGA, classe suivante
CLASSES = [
    ("CP1", "CP", 5, 10, "STD", "STANDARD", "CP2"),
    ("CP2", "CP", 5, 10, "STD", "STANDARD", "CE1"),
    ("CE1", "CE1", 5, 10, "STD", "STANDARD", "CE2"),
    ("CE2", "CE2-CM1", 5, 10, "STD", "STANDARD", "CM1"),
    ("CM1", "CE2-CM1", 5, 10, "STD", "STANDARD", "CM2"),
    ("CM2", "CM2", 10, 20, "CM2", "MOYENNE4", None),
]
EVALUATIONS = {
    "STD": ["1re composition", "2e composition", "3e composition", "Composition de passage"],
    "CM2": ["1re composition", "2e composition", "1er examen blanc", "2e examen blanc"],
}
# Calendrier 2026-2027 du classeur (mois, jour, décalage d'année par rapport à l'année de rentrée)
EVAL_DATES = {
    "STD": [(12, 9, 0), (3, 10, 1), (5, 26, 1), (6, 16, 1)],
    "CM2": [(12, 9, 0), (3, 10, 1), (3, 4, 1), (4, 27, 1)],
}


def ensure_params(db: Database) -> None:
    """Ajoute les paramètres apparus avec une mise à jour, sans toucher aux valeurs existantes."""
    for k, v in DEFAULT_PARAMS.items():
        db.execute("INSERT OR IGNORE INTO parametre(cle, valeur) VALUES(?,?)", (k, v))


def seed_database(db: Database) -> None:
    from epp.core import security
    with db.transaction():
        for k, v in DEFAULT_PARAMS.items():
            db.execute("INSERT OR IGNORE INTO parametre(cle, valeur) VALUES(?,?)", (k, v))
        for liste, valeurs in DEFAULT_LISTS.items():
            for i, v in enumerate(valeurs):
                db.execute("INSERT OR IGNORE INTO liste_valeur(liste, valeur, ordre) VALUES(?,?,?)",
                           (liste, v, i))
        security.ensure_roles(db)
    from epp.reports import store
    store.install_builtin_templates(db)


def year_bounds(libelle: str) -> tuple[int, int]:
    a = int(libelle[:4])
    return a, a + 1


def create_year(db: Database, libelle: str, copy_from: int | None = None, active: bool = True) -> int:
    """Crée une année scolaire avec sa structure (classes, grilles, évaluations, jours de classe).

    Si copy_from est fourni, la structure de cette année est recopiée (seuils, matières,
    barèmes modifiés par l'utilisateur), les dates étant décalées d'un an.
    """
    if len(libelle) != 9 or libelle[4] != "-" or not (libelle[:4] + libelle[5:]).isdigit() \
            or int(libelle[5:]) != int(libelle[:4]) + 1:
        raise ValueError("L'année scolaire doit être de la forme 2026-2027.")
    if db.scalar("SELECT id FROM annee_scolaire WHERE libelle=?", (libelle,)):
        raise ValueError(f"L'année scolaire {libelle} existe déjà.")
    a1, a2 = year_bounds(libelle)
    with db.transaction():
        if active:
            db.execute("UPDATE annee_scolaire SET active=0")
        src = db.one("SELECT * FROM annee_scolaire WHERE id=?", (copy_from,)) if copy_from else None
        nouveaux = src["nouveaux_cp1"] if src else 0
        aid = db.execute(
            "INSERT INTO annee_scolaire(libelle, date_debut, date_fin, date_edition, date_ref_age, "
            "nouveaux_cp1, active) VALUES(?,?,?,?,?,?,?)",
            (libelle, f"{a1}-09-01", f"{a2}-08-31", f"{a2}-06-30", f"{a1}-12-31", nouveaux, int(active))
        ).lastrowid
        if src:
            _copy_structure(db, copy_from, aid)
        else:
            _default_structure(db, aid, a1)
        _feries(db, aid, a1, a2)
    return aid


def _feries(db: Database, aid: int, a1: int, a2: int) -> None:
    """Jours fériés de date connue préremplis (les fêtes musulmanes et les vacances sont à saisir)."""
    from types import SimpleNamespace

    from epp.domain import calendrier
    for f in calendrier.feries_de_date_connue(SimpleNamespace(date_debut=f"{a1}-09-01", date_fin=f"{a2}-08-31")):
        db.execute("INSERT INTO conge(annee_id, type, libelle, date_debut, date_fin) VALUES(?,?,?,?,?)",
                   (aid, f["type"], f["libelle"], f["date_debut"], f["date_fin"]))


def _default_structure(db: Database, aid: int, a1: int) -> None:
    gid = {}
    for code, (lib, mode, echelle, note_max, evals) in GRILLES.items():
        gid[code] = db.execute(
            "INSERT INTO grille_notes(annee_id, code, libelle, mode, echelle, note_max) VALUES(?,?,?,?,?,?)",
            (aid, code, lib, mode, echelle, note_max)).lastrowid
        for num, mats in evals.items():
            for i, (m, v) in enumerate(mats):
                db.execute("INSERT INTO matiere(grille_id, eval_num, ordre, libelle, valeur) VALUES(?,?,?,?,?)",
                           (gid[code], num, i, m, v))
    for i, (code, g, seuil, bareme, cal, regle, suiv) in enumerate(CLASSES):
        db.execute(
            "INSERT INTO classe(annee_id, code, libelle, ordre, niveau_suivant, seuil, bareme, grille_id, "
            "calendrier, regle_mga) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (aid, code, code, i, suiv, seuil, bareme, gid[g], cal, regle))
    for cal, libs in EVALUATIONS.items():
        for num, lib in enumerate(libs, start=1):
            m, d, off = EVAL_DATES[cal][num - 1]
            db.execute("INSERT INTO evaluation(annee_id, calendrier, num, libelle, date) VALUES(?,?,?,?,?)",
                       (aid, cal, num, lib, date(a1 + off, m, d).isoformat()))
    for mois, jours in DEFAULT_JOURS:
        db.execute("INSERT INTO jours_classe(annee_id, mois, libelle, jours) VALUES(?,?,?,?)",
                   (aid, mois, MOIS_FR[mois - 1], jours))


def _shift_year(iso: str | None, delta: int) -> str | None:
    if not iso:
        return iso
    y, m, d = (int(x) for x in iso[:10].split("-"))
    if m == 2 and d == 29:
        d = 28
    return date(y + delta, m, d).isoformat()


def _copy_structure(db: Database, src: int, aid: int) -> None:
    src_lib = db.scalar("SELECT libelle FROM annee_scolaire WHERE id=?", (src,))
    dst_lib = db.scalar("SELECT libelle FROM annee_scolaire WHERE id=?", (aid,))
    delta = int(dst_lib[:4]) - int(src_lib[:4])
    gmap = {}
    for g in db.query("SELECT * FROM grille_notes WHERE annee_id=?", (src,)):
        gmap[g["id"]] = db.execute(
            "INSERT INTO grille_notes(annee_id, code, libelle, mode, echelle, note_max) VALUES(?,?,?,?,?,?)",
            (aid, g["code"], g["libelle"], g["mode"], g["echelle"], g["note_max"])).lastrowid
        for m in db.query("SELECT * FROM matiere WHERE grille_id=?", (g["id"],)):
            db.execute("INSERT INTO matiere(grille_id, eval_num, ordre, libelle, valeur) VALUES(?,?,?,?,?)",
                       (gmap[g["id"]], m["eval_num"], m["ordre"], m["libelle"], m["valeur"]))
    for c in db.query("SELECT * FROM classe WHERE annee_id=?", (src,)):
        db.execute(
            "INSERT INTO classe(annee_id, code, libelle, ordre, niveau_suivant, seuil, bareme, grille_id, "
            "calendrier, regle_mga) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (aid, c["code"], c["libelle"], c["ordre"], c["niveau_suivant"], c["seuil"], c["bareme"],
             gmap.get(c["grille_id"]), c["calendrier"], c["regle_mga"]))
    for e in db.query("SELECT * FROM evaluation WHERE annee_id=?", (src,)):
        db.execute("INSERT INTO evaluation(annee_id, calendrier, num, libelle, date) VALUES(?,?,?,?,?)",
                   (aid, e["calendrier"], e["num"], e["libelle"], _shift_year(e["date"], delta)))
    for j in db.query("SELECT * FROM jours_classe WHERE annee_id=?", (src,)):
        db.execute("INSERT INTO jours_classe(annee_id, mois, libelle, jours) VALUES(?,?,?,?)",
                   (aid, j["mois"], j["libelle"], j["jours"]))
