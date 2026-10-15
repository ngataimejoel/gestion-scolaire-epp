"""Structure par défaut d'une école créée sur le téléphone utilisé seul : la même que celle d'une nouvelle année
sur l'ordinateur (epp/core/seed.py : grilles de notes, classes, évaluations, motifs d'absence, identité).

    python outils/defauts_telephone.py    # réécrit android/app/src/main/assets/www/defauts.js

tests/test_synchro.py vérifie que le fichier livré correspond à seed.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))
FICHIER = RACINE / "android" / "app" / "src" / "main" / "assets" / "www" / "defauts.js"


def defauts() -> dict:
    from epp.core import seed
    return {
        "grilles": [{"code": code, "libelle": lib, "mode": mode, "echelle": ech, "note_max": nmax,
                     "matieres": {str(n): [{"libelle": m, "valeur": v} for m, v in ms] for n, ms in evals.items()}}
                    for code, (lib, mode, ech, nmax, evals) in seed.GRILLES.items()],
        "classes": [{"code": code, "grille": g, "seuil": seuil, "bareme": bareme, "calendrier": cal, "regle_mga": regle,
                     "niveau_suivant": suiv} for code, g, seuil, bareme, cal, regle, suiv in seed.CLASSES],
        "evaluations": {cal: [{"num": i + 1, "libelle": lib, "mois": seed.EVAL_DATES[cal][i][0],
                               "jour": seed.EVAL_DATES[cal][i][1], "decalage": seed.EVAL_DATES[cal][i][2]}
                              for i, lib in enumerate(libs)] for cal, libs in seed.EVALUATIONS.items()},
        "motifs_absence": seed.DEFAULT_LISTS["MOTIF_ABSENCE"],
        "fonctions": seed.DEFAULT_LISTS["FONCTION"],
        "nationalites": seed.DEFAULT_LISTS["NATIONALITE"],
        "ecole": {k: seed.DEFAULT_PARAMS[k] for k in ("pays", "devise_pays", "ministere", "dren", "iepp")},
    }


def contenu() -> str:
    return ("/* Fichier produit par outils/defauts_telephone.py à partir de epp/core/seed.py : ne pas modifier à la main. */\n"
            "window.AKWA_DEFAUTS = " + json.dumps(defauts(), ensure_ascii=False, indent=1) + ";\n")


if __name__ == "__main__":
    FICHIER.write_text(contenu(), encoding="utf-8")
    print(f"écrit : {FICHIER}")
