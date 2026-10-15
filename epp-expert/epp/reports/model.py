"""Définition d'un modèle de rapport (format JSON versionné) et validation.

Un modèle est un document JSON indépendant du code :

{
  "format": 1,
  "page": {"taille": "A4", "orientation": "portrait" | "paysage"},
  "entete": {"officiel": true, "logo": true, "texte": ""},
  "titre": "...", "sous_titre": "...",
  "pied": {"texte": "...", "numerotation": true, "date_edition": true},
  "parametres": ["classe", "mois", "compo", "date_debut", "date_fin"],
  "repeter_par": "" | "classe",
  "sections": [ {"type": "tableau", ...}, ... ]
}

Les textes peuvent contenir des variables entre accolades : {ecole}, {annee}, {classe}...
"""
from __future__ import annotations

import copy
import json

FORMAT_VERSION = 1

SECTION_TYPES = {
    "tableau": "Tableau de données",
    "tableau_croise": "Tableau statistique (classes × sexe)",
    "repartition": "Répartition (comptage par valeur)",
    "repartition_ages": "Élèves par âge, niveau et sexe",
    "classement": "Meilleurs élèves par classe",
    "cles_valeurs": "Indicateurs (clé / valeur)",
    "graphique": "Graphique en barres",
    "texte": "Texte libre",
    "zone_redaction": "Zones à rédiger",
    "signature": "Bloc signature",
    "saut_page": "Saut de page",
    "bulletin": "Bulletins des élèves (une page par élève)",
    "fiche_scolaire": "Fiches scolaires des élèves (une page par élève, code QR)",
}

PARAMETRES = {
    "classe": "Classe",
    "mois": "Mois",
    "compo": "Évaluation / composition",
    "date_debut": "Du (date)",
    "date_fin": "Au (date)",
    "eleve": "Élève (un seul bulletin ou une seule fiche)",
}

OPERATEURS = {
    "=": "est égal à", "!=": "est différent de", "contient": "contient", "commence": "commence par",
    ">": "supérieur à", ">=": "supérieur ou égal à", "<": "inférieur à", "<=": "inférieur ou égal à",
    "vide": "est vide", "non_vide": "n'est pas vide", "dans": "est parmi (séparés par ;)",
}

AGREGATS = {"": "(aucun)", "compte": "Nombre", "somme": "Somme", "moyenne": "Moyenne", "min": "Minimum",
            "max": "Maximum"}

FORMATS = {"auto": "Automatique", "texte": "Texte", "entier": "Entier", "decimal": "Décimal (2 chiffres)",
           "pourcent": "Pourcentage", "date": "Date (jj/mm/aaaa)", "monnaie": "Montant (FCFA)"}

ALIGNEMENTS = {"auto": "Automatique", "gauche": "Gauche", "centre": "Centre", "droite": "Droite"}

VARIABLES = {
    "{ecole}": "Nom de l'établissement", "{code_ecole}": "Code de l'établissement", "{annee}": "Année scolaire",
    "{directeur}": "Nom du directeur", "{localite}": "Localité", "{iepp}": "Inspection (IEPP)",
    "{dren}": "Direction régionale", "{ministere}": "Ministère", "{secteur}": "Secteur pédagogique",
    "{date_edition}": "Date d'édition des états", "{date_ref_age}": "Date de référence de l'âge",
    "{date_jour}": "Date du jour", "{classe}": "Classe choisie",
    "{mois}": "Mois choisi", "{mois_annee}": "Mois et année", "{compo}": "N° de l'évaluation",
    "{compo_libelle}": "Libellé de l'évaluation", "{compo_date}": "Date de l'évaluation",
    "{jours_classe}": "Jours de classe du mois", "{effectif}": "Effectif total",
    "{nb_enseignants}": "Nombre d'enseignants", "{nb_enseignantes}": "Nombre d'enseignantes",
    "{nb_personnel}": "Personnel total", "{controle_effectifs}": "Contrôle des effectifs",
    "{evaluation_du_mois}": "Évaluation(s) du mois", "{classes_sans_enseignant}": "Classes sans enseignant",
    "{periode}": "Période choisie (dates)",
}


class ModeleInvalide(ValueError):
    pass


def nouveau_modele() -> dict:
    return {
        "format": FORMAT_VERSION,
        "page": {"taille": "A4", "orientation": "portrait"},
        "entete": {"officiel": True, "logo": True, "texte": ""},
        "titre": "NOUVEAU RAPPORT",
        "sous_titre": "Année scolaire {annee}",
        "pied": {"texte": "{ecole}", "numerotation": True, "date_edition": True},
        "parametres": [],
        "repeter_par": "",
        "sections": [],
    }


def nouvelle_section(type_: str) -> dict:
    base = {"type": type_, "titre": ""}
    if type_ == "tableau":
        base.update(source="eleves", colonnes=[], filtres=[], tri=[], regroupement="", saut_page_groupe=False,
                    agregats={}, sous_totaux=True, total_general=True, renumeroter=True)
    elif type_ == "tableau_croise":
        base.update(lignes="classes", classes="toutes", metriques=["inscrits"], sexes=["M", "F", "T"],
                    total=True, libelles={}, classes_extra=[])
    elif type_ == "repartition":
        base.update(source="eleves", champ="classe", filtres=[], pourcentage=True)
    elif type_ == "repartition_ages":
        base.update(extrait="tous", sexes=["M", "F", "T"])
    elif type_ == "classement":
        base.update(top=3)
    elif type_ == "cles_valeurs":
        base.update(source="tableau_de_bord", elements=[])
    elif type_ == "graphique":
        base.update(metrique="inscrits", sexes=["M", "F"])
    elif type_ == "texte":
        base.update(texte="", style="normal")
    elif type_ == "zone_redaction":
        base.update(rapport="LIBRE", cle="", champs=[{"champ": "observations", "titre": "OBSERVATIONS :"}], lignes=4)
    elif type_ == "bulletin":
        base.update(periode="evaluation", style="colore", mention_officielle=True, bilan_felicitations=7,
                    bilan_suivi=4, photo=True, appreciations=True, statistiques_classe=True,
                    observations=True, inclure_sortis=False, titre_bulletin="",
                    signatures=["L'enseignant(e)", "Le Directeur", "Les parents"])
    elif type_ == "fiche_scolaire":
        base.update(photo=True, qr=True, inclure_sortis=True, titre_fiche="FICHE SCOLAIRE")
    elif type_ == "signature":
        base.update(lieu_date=True, fonction="LE DIRECTEUR", nom="{directeur}")
    return base


def valider(defn: dict) -> dict:
    """Contrôle et complète un modèle ; lève ModeleInvalide avec un message clair."""
    from epp.reports.datasets import SOURCES
    if not isinstance(defn, dict):
        raise ModeleInvalide("Le modèle doit être un objet JSON.")
    d = copy.deepcopy(defn)
    if int(d.get("format", 1)) > FORMAT_VERSION:
        raise ModeleInvalide("Ce modèle a été créé avec une version plus récente de l'application.")
    base = nouveau_modele()
    for k, v in base.items():
        d.setdefault(k, copy.deepcopy(v))
    if d["page"].get("orientation") not in ("portrait", "paysage"):
        raise ModeleInvalide("Orientation de page inconnue (portrait ou paysage).")
    for p in d.get("parametres", []):
        if p not in PARAMETRES:
            raise ModeleInvalide(f"Paramètre inconnu : {p}")
    if not isinstance(d["sections"], list):
        raise ModeleInvalide("La liste des sections est invalide.")
    for i, s in enumerate(d["sections"], 1):
        t = s.get("type")
        if t not in SECTION_TYPES:
            raise ModeleInvalide(f"Section {i} : type inconnu « {t} ».")
        full = nouvelle_section(t)
        full.update(s)
        d["sections"][i - 1] = full
        if t in ("tableau", "repartition"):
            if full["source"] not in SOURCES:
                raise ModeleInvalide(f"Section {i} : source de données inconnue « {full['source']} ».")
            for f in full.get("filtres", []):
                if f.get("op") not in OPERATEURS:
                    raise ModeleInvalide(f"Section {i} : opérateur de filtre inconnu « {f.get('op')} ».")
        if t == "tableau" and not full["colonnes"]:
            raise ModeleInvalide(f"Section {i} ({full.get('titre') or 'tableau'}) : ajoutez au moins une colonne.")
    return d


def to_json(defn: dict) -> str:
    return json.dumps(defn, ensure_ascii=False, indent=2)


def from_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ModeleInvalide(f"Fichier de modèle illisible : {e}")
