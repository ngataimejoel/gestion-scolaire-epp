"""Données de démonstration entièrement fictives (noms générés au hasard).

Utilisées par les tests sur les machines sans le classeur réel, par les tutoriels
vidéo et par l'option « Créer une école de démonstration » : aucune donnée
personnelle réelle n'est jamais exposée.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from epp.core import seed
from epp.core.db import Database
from epp.core.security import Session
from epp.domain import repo

NOMS = ["KOUASSI", "KOFFI", "KONAN", "YAO", "N'GUESSAN", "TRAORE", "COULIBALY", "OUATTARA", "BAMBA", "KONE",
        "DIABATE", "SORO", "GBAGBO", "ZADI", "DIGBEU", "AKA", "TANOH", "LOBA", "SERI", "GNAGNE"]
PRENOMS_M = ["Ismaël", "Franck", "Cédric", "Junior", "Ange", "Moussa", "Yves", "Serge", "Hervé", "Adama"]
PRENOMS_F = ["Aya", "Awa", "Estelle", "Mariam", "Clarisse", "Affoué", "Amenan", "Grâce", "Adjoua", "Fatou"]
AGE_NORMAL = {"CP1": 6, "CP2": 7, "CE1": 8, "CE2": 9, "CM1": 10, "CM2": 11}


def creer_ecole_demo(db: Database, s: Session, annee_libelle: str = "2026-2027", par_classe: int = 8,
                     graine: int = 2026) -> repo.Annee:
    rnd = random.Random(graine)
    if repo.list_annees(db) and any(a["libelle"] == annee_libelle for a in repo.list_annees(db)):
        raise repo.ValidationError(f"L'année {annee_libelle} existe déjà.")
    aid = seed.create_year(db, annee_libelle)
    annee = repo.load_annee(db, aid)
    an0 = annee.an_debut()
    ref = date(an0, 12, 31)
    noms_pris = set()
    for cl in annee.classes:
        age0 = AGE_NORMAL.get(cl.code, 8)
        for i in range(par_classe):
            sexe = "F" if rnd.random() < 0.48 else "M"
            while True:
                nom = f"{rnd.choice(NOMS)} {rnd.choice(PRENOMS_F if sexe == 'F' else PRENOMS_M)} " \
                      f"{rnd.choice(PRENOMS_F if sexe == 'F' else PRENOMS_M)}"
                if nom not in noms_pris:
                    noms_pris.add(nom)
                    break
            dn = ref - timedelta(days=365 * (age0 + rnd.choice([0, 0, 0, 1])) + rnd.randint(0, 360))
            eid = repo.save_eleve(db, s, None, {
                "nom": nom, "sexe": sexe, "date_naissance": dn.isoformat(),
                "nationalite": "IVOIRIENNE" if rnd.random() < 0.85 else rnd.choice(["BURKINABE", "MALIENNE"]),
                "extrait": "OUI" if rnd.random() < 0.8 else "NON", "orphelin": "NON",
                "pere_nom": f"{nom.split()[0]} {rnd.choice(PRENOMS_M)}", "pere_tel": "07 00 00 00 00",
                "mere_nom": f"{rnd.choice(NOMS)} {rnd.choice(PRENOMS_F)}", "localite": "OUANINOU"}, annee)
            statut = "ABANDON" if rnd.random() < 0.05 else "PRESENT"
            repo.inscrire(db, s, eid, annee, cl.code, redoublant="OUI" if rnd.random() < 0.15 else "NON",
                          statut=statut)
    annee = repo.load_annee(db, aid)
    # notes des 4 évaluations
    for g in annee.grilles.values():
        for num, mats in g.matieres.items():
            _, lignes = repo.notes_grille(db, annee, g.id, num)
            for r in lignes:
                if r["statut"] != "PRESENT":
                    continue
                niveau = rnd.uniform(0.3, 0.95)
                for m in mats:
                    vmax = repo.max_note(g, m)
                    v = round(min(vmax, max(0, rnd.gauss(niveau, 0.12) * vmax)) * 4) / 4
                    repo.set_note(db, s, annee, r["inscription_id"], m["id"], v)
    # personnel
    fonctions = ["DIRECTEUR"] + ["INSTITUTEUR ORDINAIRE"] * (len(annee.codes) - 1) + ["GARDIEN"]
    classes = ["-"] + list(annee.codes[1:]) + ["-"]
    if len(annee.codes) and fonctions[0] == "DIRECTEUR":
        classes[0] = annee.codes[0]     # le directeur tient aussi une classe
    for i, (f, c) in enumerate(zip(fonctions, classes)):
        sexe = "F" if i % 3 == 1 else "M"
        repo.save_personnel(db, s, None, {
            "matricule": f"{100000 + i * 7919}{'ABCDEFGH'[i % 8]}", "sexe": sexe,
            "nom": f"{rnd.choice(NOMS)} {rnd.choice(PRENOMS_F if sexe == 'F' else PRENOMS_M)}",
            "fonction": f, "grade": "IO / A3" if f != "GARDIEN" else "", "date_naissance": f"{1975 + i}-03-1{i % 9}",
            "date_prise_service": f"{2000 + i}-10-01", "telephone": "07 00 00 00 00", "classe_tenue": c}, annee)
    # absences d'octobre
    _, lignes = repo.notes_grille(db, annee, annee.classes[0].grille_id, 1)
    insc = [r["inscription_id"] for r in repo.inscriptions(db, annee)]
    for k in range(10):
        nature = "ABSENCE" if k % 3 else "RETARD"
        repo.save_absence(db, s, "eleve", None, annee, {
            "inscription_id": rnd.choice(insc), "date": f"{an0}-10-{5 + k:02d}", "nature": nature,
            "jours": rnd.choice([0.5, 1, 2]) if nature == "ABSENCE" else None,
            "retard_min": rnd.choice([10, 15, 30]) if nature == "RETARD" else None,
            "motif": rnd.choice(["Maladie", "Pluie / route coupée", "Sans motif"]), "justifie": "OUI"})
    return repo.load_annee(db, aid)
