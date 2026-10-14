"""Modèles de rapports livrés avec l'application.

Chaque état du classeur d'origine est reproduit par un modèle JSON exécuté par le
moteur générique : aucun code n'est propre à un rapport. Ces modèles sont copiés
dans la base au premier lancement (et mis à jour lors d'une nouvelle version de
l'application tant que l'utilisateur ne les a pas modifiés).

Catégories : « États officiels » (reproduction du classeur) et « Exemples ».
"""
from __future__ import annotations

OFFICIEL = "États officiels"
EXEMPLE = "Exemples"

SIGNATURE = {"type": "signature", "titre": "", "lieu_date": True, "fonction": "LE DIRECTEUR", "nom": "{directeur}"}


def _col(champ, titre=None, **kw):
    d = {"champ": champ}
    if titre:
        d["titre"] = titre
    d.update(kw)
    return d


def _modele(titre, sous_titre="Année scolaire {annee}", orientation="portrait", parametres=(), sections=(),
            repeter_par="", pied="{ecole} – {annee}"):
    return {
        "format": 1,
        "page": {"taille": "A4", "orientation": orientation},
        "entete": {"officiel": True, "logo": True, "texte": ""},
        "titre": titre, "sous_titre": sous_titre,
        "pied": {"texte": pied, "numerotation": True, "date_edition": True},
        "parametres": list(parametres), "repeter_par": repeter_par,
        "sections": list(sections),
    }


REGISTRE = _modele(
    "REGISTRE GÉNÉRAL DES ÉLÈVES (TOUTES CLASSES)", orientation="paysage",
    sections=[{"type": "tableau", "titre": "", "source": "eleves", "colonnes": [
        _col("numero"), _col("matricule_ecole", "Matricule école"), _col("matricule_desps", "Matricule DESPS"),
        _col("nom"), _col("sexe"), _col("classe"), _col("date_naissance", "Né(e) le"), _col("age"),
        _col("nationalite"), _col("extrait"), _col("orphelin"), _col("pere_nom", "Père"), _col("pere_tel"),
        _col("mere_nom", "Mère"), _col("mere_tel"), _col("redoublant", "Red."), _col("statut")],
        "filtres": [], "tri": [], "regroupement": "", "agregats": {}, "renumeroter": True}])

ETAT_CLASSE = _modele(
    "ÉTAT DES ÉLÈVES – CLASSE DE {classe}", orientation="paysage", parametres=["classe"], repeter_par="classe",
    sections=[
        {"type": "tableau", "titre": "", "source": "eleves", "colonnes": [
            _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("age"), _col("nationalite"),
            _col("extrait"), _col("orphelin"), _col("pere_nom", "Père"), _col("pere_tel"), _col("mere_nom", "Mère"),
            _col("mere_tel"), _col("redoublant"), _col("statut")],
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"}], "tri": [], "regroupement": "",
         "agregats": {}, "renumeroter": True},
        {"type": "tableau_croise", "titre": "STATISTIQUES DE LA CLASSE", "lignes": "metriques", "classes": "parametre",
         "metriques": ["inscrits", "presents", "abandons", "ivoiriens", "etrangers", "orphelins", "orphelins_pere",
                       "orphelins_mere", "orphelins_pere_mere", "avec_extrait", "sans_extrait", "redoublants"],
         "sexes": ["M", "F", "T"], "total": False},
        SIGNATURE])

EFFECTIFS = _modele(
    "TABLEAU DES EFFECTIFS DES ÉLÈVES", orientation="paysage",
    sections=[
        {"type": "tableau_croise", "titre": "", "lignes": "classes", "classes": "toutes",
         "metriques": ["inscrits", "ivoiriens", "etrangers", "orphelins", "avec_extrait", "sans_extrait",
                       "redoublants", "abandons"], "sexes": ["M", "F", "T"], "total": True,
         "libelles": {"redoublants": "REDOUBLANTS"}},
        {"type": "texte", "texte": "Contrôle : {controle_effectifs}", "style": "note"},
        SIGNATURE])

SYNTHESE = _modele(
    "TABLEAU DE SYNTHÈSE DE FIN D'ANNÉE", orientation="paysage",
    sections=[
        {"type": "tableau_croise", "titre": "", "lignes": "classes", "classes": "toutes", "titre_lignes": "COURS",
         "metriques": ["inscrits", {"metrique": "presents", "titre": "EFFECTIF PRÉSENT"}, "abandons",
                       {"metrique": "seuil", "titre": "SEUIL MGA"}, "admis", "taux_admission",
                       {"metrique": "redoublent", "titre": "REDOUBLANTS"},
                       {"metrique": "effectif_probable", "titre": "EFFECTIF PROBABLE ANNÉE SUIVANTE"}],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "texte", "style": "note", "texte":
            "• Le taux d'admission global est calculé sur les effectifs présents (admis ÷ présents), et non par "
            "moyenne des taux des classes.\n"
            "• Effectif probable = redoublants de la classe + admis de la classe précédente ; CP1 = redoublants + "
            "nouveaux CP1 attendus.\n"
            "• Les admis du CM2 sont les sortants (entrée en 6ème) ; ils ne figurent dans aucun effectif probable.\n"
            "• Contrôle : effectif inscrit = présents + abandons (+ transferts, comptés avec les abandons)."},
        SIGNATURE])

RESULTATS = _modele(
    "RÉSULTATS DES COMPOSITIONS", sous_titre="Classes de CP1 à CM1 – année scolaire {annee}", orientation="paysage",
    parametres=["classe"],
    sections=[{"type": "tableau", "titre": "", "source": "resultats", "colonnes": [
        _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("classe"), _col("statut"),
        _col("moy1", "Moy. 1re compo."), _col("moy2", "Moy. 2e compo."), _col("moy3", "Moy. 3e compo."),
        _col("moy_compos", "Moy. des 3 compos."), _col("moy4", "Moy. compo de passage"), _col("mga"),
        _col("bareme"), _col("seuil"), _col("decision"), _col("rang", "Rang (MGA)"), _col("observation")],
        "filtres": [{"champ": "regle_mga", "op": "=", "valeur": "STANDARD"},
                    {"champ": "classe", "op": "=", "parametre": "classe"}],
        "tri": [], "regroupement": "classe", "saut_page_groupe": True, "agregats": {"mga": "moyenne"},
        "sous_totaux": True, "total_general": False, "renumeroter": True},
        {"type": "texte", "style": "note", "texte":
            "Décision : ABANDON / TRANSFÉRÉ si statut ≠ PRÉSENT ; ADMIS si MGA ≥ seuil de la classe ; sinon "
            "REDOUBLE. MGA = (moyenne des 3 compositions + 2 × composition de passage) ÷ 3."}])

RESULTATS_CM2 = _modele(
    "RÉSULTATS DES COMPOSITIONS CM2", sous_titre="Classe de CM2 – année scolaire {annee}", orientation="paysage",
    sections=[{"type": "tableau", "titre": "", "source": "resultats", "colonnes": [
        _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("statut"),
        _col("moy1", "Moy. 1re compo. (/20)"), _col("moy2", "Moy. 2e compo. (/20)"),
        _col("moy3", "Moy. 1er examen blanc (/20)"), _col("moy4", "Moy. 2e examen blanc (/20)"),
        _col("mga", "MGA (/20)"), _col("bareme"), _col("seuil"), _col("decision"), _col("rang", "Rang (MGA)"),
        _col("observation")],
        "filtres": [{"champ": "regle_mga", "op": "=", "valeur": "MOYENNE4"}], "tri": [], "regroupement": "",
        "agregats": {}, "renumeroter": True},
        {"type": "texte", "style": "note", "texte":
            "Décision : ADMIS (entrée en 6ème) si MGA ≥ seuil CM2 ; MGA = moyenne des 4 évaluations, calculée "
            "seulement si les 4 moyennes existent."}])

COMPOSITION = _modele(
    "RAPPORT DE COMPOSITION", sous_titre="{compo_libelle} – {compo_date}", orientation="paysage",
    parametres=["compo"],
    sections=[
        {"type": "tableau_croise", "titre": "", "lignes": "metriques", "classes": "toutes",
         "metriques": [{"metrique": "compo_inscrits", "titre": "INSCRITS"},
                       {"metrique": "compo_presents", "titre": "PRÉSENTS"},
                       {"metrique": "compo_absents", "titre": "ABSENTS"},
                       {"metrique": "compo_admis", "titre": "ADMIS"},
                       {"metrique": "compo_taux", "titre": "TAUX D'ADMIS (%)"}],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "classement", "titre": "LISTE DES TROIS MEILLEURS PAR NIVEAU", "top": 3},
        {"type": "zone_redaction", "titre": "", "rapport": "COMPOSITION", "cle": "{compo}",
         "champs": [{"champ": "observations", "titre": "OBSERVATIONS DU DIRECTEUR :", "lignes": 5}]},
        SIGNATURE])

RENTREE = _modele(
    "RAPPORT DE RENTRÉE – EFFECTIFS ET PERSONNEL", orientation="paysage",
    sections=[
        {"type": "tableau", "titre": "1. LISTE DES ENSEIGNANTS", "source": "personnel", "colonnes": [
            _col("numero"), _col("nom"), _col("matricule"), _col("fonction"), _col("genre"),
            _col("grade", "Corps et grade"), _col("classe_tenue", "Cours tenu"), _col("telephone", "Contact")],
         "filtres": [{"champ": "est_enseignant", "op": "=", "valeur": "OUI"}], "tri": [], "regroupement": "",
         "agregats": {}, "renumeroter": True},
        {"type": "texte", "texte": "Personnel enseignant : {nb_enseignants} dont {nb_enseignantes} femme(s).",
         "style": "normal"},
        {"type": "tableau_croise", "titre": "2. TABLEAU DES EFFECTIFS ÉLÈVES", "lignes": "metriques",
         "classes": "toutes", "titre_lignes": "COURS",
         "metriques": [{"metrique": "non_redoublants", "titre": "N.RED"},
                       {"metrique": "redoublants", "titre": "RED"},
                       {"metrique": "inscrits", "titre": "TOTAL"}],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "texte", "texte": "Contrôle : {controle_effectifs}", "style": "note"},
        {"type": "zone_redaction", "titre": "", "rapport": "RENTREE", "cle": "",
         "champs": [{"champ": "observations", "titre": "OBSERVATIONS :", "lignes": 4}]},
        SIGNATURE])

_MENSUEL_ZONES_1 = [
    {"champ": "animations", "titre": "a. Animations pédagogiques :", "lignes": 3}]
MENSUEL = _modele(
    "RAPPORT MENSUEL DU DIRECTEUR",
    sous_titre="École : {ecole}  •  Période : {mois_annee}  •  Jours de classe : {jours_classe}",
    parametres=["mois"],
    sections=[
        {"type": "tableau_croise", "titre": "1. EFFECTIFS ET FRÉQUENTATION", "lignes": "classes",
         "classes": "toutes", "titre_lignes": "COURS", "classes_extra": ["PS", "MS", "GS"],
         "metriques": [{"metrique": "inscrits", "titre": "EFFECTIFS / RENTRÉE"}, "abandons",
                       {"metrique": "mois_frequentation", "titre": "TAUX DE FRÉQUENTATION (%)"},
                       {"metrique": "mois_observation", "titre": "OBSERVATIONS"}],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "tableau", "titre": "2. ASSIDUITÉ ET PONCTUALITÉ DU PERSONNEL ENSEIGNANT", "source": "assiduite_personnel",
         "colonnes": [_col("numero"), _col("nom"), _col("cours_tenu"), _col("retard_ou_absence"), _col("duree"),
                      _col("motif"), _col("emargement")],
         "filtres": [], "tri": [], "regroupement": "", "agregats": {}, "renumeroter": True},
        {"type": "texte", "texte": "3. ACTIVITÉS MENÉES", "style": "titre2"},
        {"type": "zone_redaction", "titre": "", "rapport": "MENSUEL", "cle": "{mois}", "champs": _MENSUEL_ZONES_1},
        {"type": "texte", "texte": "b. Résultats des évaluations du mois – {evaluation_du_mois}", "style": "normal"},
        {"type": "tableau_croise", "titre": "", "lignes": "classes", "classes": "toutes", "titre_lignes": "COURS",
         "metriques": [{"metrique": "inscrits", "titre": "EFFECTIF"}, "eval_composes", "eval_moyenne", "eval_taux"],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "zone_redaction", "titre": "c. Activités extra-scolaires", "rapport": "MENSUEL", "cle": "{mois}",
         "champs": [{"champ": "cooperatives", "titre": "ACTIVITÉS COOPÉRATIVES", "lignes": 3},
                    {"champ": "bibliotheque", "titre": "BIBLIOTHÈQUE", "lignes": 3},
                    {"champ": "cantine", "titre": "CANTINE", "lignes": 3}]},
        {"type": "zone_redaction", "titre": "4. RELATIONS HUMAINES", "rapport": "MENSUEL", "cle": "{mois}",
         "champs": [{"champ": "relations_enseignants", "titre": "Entre les enseignants :"},
                    {"champ": "relations_maitres_eleves", "titre": "Entre maîtres et élèves :"},
                    {"champ": "relations_autorites",
                     "titre": "Entre maîtres et autorités politiques et administratives :"}]},
        {"type": "zone_redaction", "titre": "5. ÉVÉNEMENTS AYANT MARQUÉ LA VIE DE L'ÉCOLE", "rapport": "MENSUEL",
         "cle": "{mois}", "champs": [{"champ": "evenements", "titre": ""}]},
        {"type": "zone_redaction", "titre": "6. DIFFICULTÉS RENCONTRÉES AU COURS DU MOIS", "rapport": "MENSUEL",
         "cle": "{mois}",
         "champs": [{"champ": "grossesses", "titre": "Nombre de filles en grossesse :", "lignes": 1},
                    {"champ": "deces", "titre": "Nombre d'élèves décédés :", "lignes": 1},
                    {"champ": "difficultes", "titre": "Autres difficultés :"}]},
        {"type": "zone_redaction", "titre": "7. SATISFACTIONS", "rapport": "MENSUEL", "cle": "{mois}",
         "champs": [{"champ": "satisfactions", "titre": ""}]},
        {"type": "zone_redaction", "titre": "8. CONCLUSION", "rapport": "MENSUEL", "cle": "{mois}",
         "champs": [{"champ": "conclusion", "titre": ""}]},
        SIGNATURE])

PERSONNEL = _modele(
    "LISTE DU PERSONNEL", orientation="paysage",
    sections=[
        {"type": "tableau", "titre": "", "source": "personnel", "colonnes": [
            _col("numero"), _col("matricule"), _col("nom"), _col("sexe"), _col("date_naissance", "Né(e) le"),
            _col("age"), _col("fonction"), _col("grade"), _col("classe_tenue"), _col("diplome"),
            _col("date_prise_service"), _col("anciennete"), _col("date_arrivee"), _col("telephone", "Tél."),
            _col("situation_matrimoniale", "Situation matr.")],
         "filtres": [], "tri": [], "regroupement": "", "agregats": {}, "renumeroter": True},
        {"type": "tableau", "titre": "RÉCAPITULATIF PAR FONCTION", "source": "recap_personnel", "colonnes": [
            _col("fonction"), _col("hommes"), _col("femmes"), _col("total")],
         "filtres": [], "tri": [], "regroupement": "",
         "agregats": {"hommes": "somme", "femmes": "somme", "total": "somme"}, "renumeroter": False},
        {"type": "texte", "texte": "Classes sans enseignant : {classes_sans_enseignant}", "style": "note"},
        SIGNATURE])

ABS_ELEVES = _modele(
    "CONTRÔLE DES RETARDS ET ABSENCES – ÉLÈVES", sous_titre="Année scolaire {annee} {mois_annee}{periode}",
    orientation="paysage", parametres=["mois", "date_debut", "date_fin"],
    sections=[{"type": "tableau", "titre": "", "source": "absences_eleves", "colonnes": [
        _col("numero"), _col("date"), _col("matricule_ecole"), _col("nom"), _col("classe"), _col("sexe"),
        _col("nature"), _col("jours"), _col("retard_min"), _col("motif"), _col("justifie"), _col("observations")],
        "filtres": [], "tri": [{"champ": "date", "ordre": "asc"}], "regroupement": "",
        "agregats": {"jours": "somme", "retard_min": "somme"}, "renumeroter": True}])

ABS_PERSONNEL = _modele(
    "CONTRÔLE DES RETARDS ET ABSENCES – PERSONNEL", sous_titre="Année scolaire {annee} {mois_annee}{periode}",
    orientation="paysage", parametres=["mois", "date_debut", "date_fin"],
    sections=[{"type": "tableau", "titre": "", "source": "absences_personnel", "colonnes": [
        _col("numero"), _col("date"), _col("matricule"), _col("nom"), _col("cours_tenu"), _col("sexe"),
        _col("nature"), _col("jours"), _col("retard_min"), _col("motif"), _col("justifie"), _col("observations")],
        "filtres": [], "tri": [{"champ": "date", "ordre": "asc"}], "regroupement": "",
        "agregats": {"jours": "somme", "retard_min": "somme"}, "renumeroter": True}])

FEUILLE_NOTES = _modele(
    "FEUILLE DE NOTES – {classe}", sous_titre="{compo_libelle} – année scolaire {annee}", orientation="paysage",
    parametres=["classe", "compo"],
    sections=[{"type": "tableau", "titre": "", "source": "notes", "colonnes": [
        _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("present"), _col("*notes*"),
        _col("total"), _col("moyenne")],
        "filtres": [], "tri": [], "regroupement": "", "agregats": {"moyenne": "moyenne"}, "renumeroter": True},
        SIGNATURE])

TABLEAU_DE_BORD = _modele(
    "TABLEAU DE BORD", sections=[
        {"type": "cles_valeurs", "titre": "INDICATEURS CLÉS", "source": "tableau_de_bord", "elements": [
            {"champ": "effectif", "titre": "Effectif inscrit", "format": "entier"},
            {"champ": "filles_pct", "titre": "Filles (%)", "format": "pourcent"},
            {"champ": "presents", "titre": "Présents fin d'année", "format": "entier"},
            {"champ": "taux_abandon", "titre": "Taux d'abandon", "format": "pourcent"},
            {"champ": "taux_admission", "titre": "Taux d'admission", "format": "pourcent"},
            {"champ": "sans_extrait", "titre": "Sans extrait de naissance", "format": "entier"},
            {"champ": "enseignants", "titre": "Enseignants", "format": "entier"},
            {"champ": "ratio", "titre": "Ratio élèves / enseignant", "format": "decimal"}]},
        {"type": "tableau_croise", "titre": "EFFECTIFS ET RÉSULTATS PAR CLASSE", "lignes": "classes",
         "classes": "toutes", "metriques": [
             {"metrique": "inscrits", "titre": "GARÇONS", "sexes": ["M"]},
             {"metrique": "inscrits", "titre": "FILLES", "sexes": ["F"]},
             {"metrique": "inscrits", "titre": "TOTAL", "sexes": ["T"]},
             {"metrique": "admis", "titre": "ADMIS", "sexes": ["T"]},
             {"metrique": "taux_admission", "titre": "TAUX D'ADMISSION", "sexes": ["T"]},
             {"metrique": "abandons", "titre": "ABANDONS", "sexes": ["T"]}], "total": True},
        {"type": "cles_valeurs", "titre": "ALERTES DE GESTION", "source": "tableau_de_bord", "elements": [
            {"champ": "alerte_sans_extrait", "titre": "Élèves sans extrait de naissance", "format": "entier"},
            {"champ": "alerte_homonymes", "titre": "Homonymes dans le registre", "format": "entier"},
            {"champ": "alerte_mga_manquantes", "titre": "Élèves présents sans MGA", "format": "entier"},
            {"champ": "alerte_classes_sans_enseignant", "titre": "Classes sans enseignant", "format": "entier"},
            {"champ": "alerte_sur_age", "titre": "Élèves en sur-âge", "format": "entier"}]},
        {"type": "graphique", "titre": "Effectifs par classe", "metrique": "inscrits", "sexes": ["M", "F"]},
        {"type": "graphique", "titre": "Taux d'admission par classe", "metrique": "taux_admission", "sexes": ["T"]}])

def _bulletin(periode):
    d = _modele("", sous_titre="", parametres=["classe", "eleve"] + (["compo"] if periode == "evaluation" else []),
                sections=[{"type": "bulletin", "titre": "", "periode": periode, "style": "colore", "palette": "douce",
                           "mention_officielle": True, "bilan_felicitations": 7, "bilan_suivi": 4,
                           "photo": True, "appreciations": True,
                           "statistiques_classe": True, "observations": True, "inclure_sortis": False,
                           "titre_bulletin": "", "signatures": ["L'enseignant(e)", "Le Directeur", "Les parents"]}],
                pied="{ecole} – {annee}")
    d["entete"] = {"officiel": False, "logo": True, "texte": ""}   # chaque bulletin porte son propre en-tête
    return d


BULLETIN_EVAL = _bulletin("evaluation")
BULLETIN_ANNUEL = _bulletin("annuel")
BULLETIN_COMPO = _bulletin("evaluation")
BULLETIN_COMPO["sections"][0]["colonnes"] = "composition"      # une seule composition, quel que soit le réglage

# ---------------------------------------------------------------- exemples demandés
EX_LISTE_CLASSE = _modele(
    "LISTE DES ÉLÈVES PAR CLASSE", parametres=["classe"],
    sections=[{"type": "tableau", "titre": "", "source": "eleves", "colonnes": [
        _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("date_naissance"), _col("age"),
        _col("statut")],
        "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"}],
        "tri": [{"champ": "nom", "ordre": "asc"}], "regroupement": "classe", "saut_page_groupe": True,
        "agregats": {"age": "moyenne"}, "sous_totaux": True, "total_general": True, "renumeroter": True}])

EX_EFFECTIFS_NIVEAU = _modele(
    "ÉTAT DES EFFECTIFS PAR NIVEAU", sections=[
        {"type": "tableau_croise", "titre": "", "lignes": "classes", "classes": "toutes", "titre_lignes": "NIVEAU",
         "metriques": ["inscrits", "presents", "sortis", "redoublants"], "sexes": ["M", "F", "T"], "total": True},
        {"type": "repartition", "titre": "Répartition par nationalité", "source": "eleves", "champ": "nationalite",
         "filtres": [], "pourcentage": True},
        {"type": "graphique", "titre": "Effectifs par niveau", "metrique": "inscrits", "sexes": ["M", "F"]},
        SIGNATURE])

EX_ENSEIGNANTS = _modele(
    "LISTE DES ENSEIGNANTS", sections=[
        {"type": "tableau", "titre": "", "source": "personnel", "colonnes": [
            _col("numero"), _col("matricule"), _col("nom"), _col("genre"), _col("fonction"), _col("classe_tenue"),
            _col("anciennete"), _col("telephone")],
         "filtres": [{"champ": "est_enseignant", "op": "=", "valeur": "OUI"}],
         "tri": [{"champ": "classe_tenue", "ordre": "asc"}], "regroupement": "", "agregats": {"anciennete": "moyenne"},
         "renumeroter": True},
        SIGNATURE])

AGES = _modele(
    "RÉPARTITION DES ÉLÈVES PAR ÂGE, NIVEAU ET SEXE", sous_titre="Âge au {date_ref_age} – année scolaire {annee}",
    orientation="paysage", sections=[
        {"type": "repartition_ages", "titre": "ENSEMBLE DES ÉLÈVES", "extrait": "tous"},
        {"type": "saut_page"},
        {"type": "repartition_ages", "titre": "ÉLÈVES AVEC EXTRAIT DE NAISSANCE", "extrait": "avec"},
        {"type": "saut_page"},
        {"type": "repartition_ages", "titre": "ÉLÈVES SANS EXTRAIT DE NAISSANCE", "extrait": "sans"},
        SIGNATURE])

EX_STAT_ANNUEL = _modele(
    "RAPPORT STATISTIQUE ANNUEL", sections=[
        {"type": "cles_valeurs", "titre": "Indicateurs de l'année", "source": "tableau_de_bord", "elements": [
            {"champ": "effectif", "titre": "Effectif inscrit", "format": "entier"},
            {"champ": "filles_pct", "titre": "Part des filles", "format": "pourcent"},
            {"champ": "taux_abandon", "titre": "Taux d'abandon", "format": "pourcent"},
            {"champ": "taux_admission", "titre": "Taux d'admission", "format": "pourcent"},
            {"champ": "ratio", "titre": "Élèves par enseignant", "format": "decimal"}]},
        {"type": "tableau_croise", "titre": "Effectifs détaillés", "lignes": "classes", "classes": "toutes",
         "metriques": ["inscrits", "ivoiriens", "etrangers", "orphelins", "sans_extrait", "sur_age"],
         "sexes": ["M", "F", "T"], "total": True},
        {"type": "saut_page"},
        {"type": "tableau_croise", "titre": "Résultats", "lignes": "classes", "classes": "toutes",
         "metriques": ["presents", "admis", "redoublent", "taux_admission"], "sexes": ["M", "F", "T"], "total": True},
        {"type": "graphique", "titre": "Taux d'admission par classe", "metrique": "taux_admission",
         "sexes": ["M", "F", "T"]},
        SIGNATURE])

EX_BILAN_RESULTATS = _modele(
    "BILAN DES RÉSULTATS", orientation="paysage", parametres=["classe"], sections=[
        {"type": "repartition", "titre": "Décisions", "source": "resultats", "champ": "decision",
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"}], "pourcentage": True},
        {"type": "repartition", "titre": "Observations", "source": "resultats", "champ": "observation",
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"},
                     {"champ": "observation", "op": "non_vide"}], "pourcentage": True},
        {"type": "tableau", "titre": "Résultats par élève", "source": "resultats", "colonnes": [
            _col("rang"), _col("nom"), _col("sexe"), _col("classe"), _col("mga"), _col("decision"),
            _col("observation")],
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"},
                     {"champ": "statut", "op": "=", "valeur": "PRESENT"}],
         "tri": [{"champ": "rang", "ordre": "asc"}], "regroupement": "classe", "saut_page_groupe": False,
         "agregats": {"mga": "moyenne"}, "sous_totaux": True, "total_general": True, "renumeroter": False},
        SIGNATURE])

EX_ABSENCES = _modele(
    "RAPPORT DES ABSENCES", sous_titre="{mois_annee}{periode}", parametres=["mois", "date_debut", "date_fin"],
    sections=[
        {"type": "repartition", "titre": "Élèves – répartition par motif", "source": "absences_eleves",
         "champ": "motif", "filtres": [], "pourcentage": True},
        {"type": "tableau", "titre": "Élèves – absences par classe", "source": "absences_eleves", "colonnes": [
            _col("date"), _col("nom"), _col("nature"), _col("jours"), _col("retard_min"), _col("motif"),
            _col("justifie")],
         "filtres": [], "tri": [{"champ": "date", "ordre": "asc"}], "regroupement": "classe",
         "agregats": {"jours": "somme", "retard_min": "somme"}, "sous_totaux": True, "total_general": True,
         "renumeroter": True},
        {"type": "tableau", "titre": "Personnel", "source": "absences_personnel", "colonnes": [
            _col("date"), _col("nom"), _col("nature"), _col("jours"), _col("retard_min"), _col("motif"),
            _col("justifie")],
         "filtres": [], "tri": [{"champ": "date", "ordre": "asc"}], "regroupement": "",
         "agregats": {"jours": "somme", "retard_min": "somme"}, "renumeroter": True},
        SIGNATURE])

AUTORISATIONS = _modele(
    "REGISTRE DES AUTORISATIONS D'ABSENCE", sous_titre="Année scolaire {annee} {mois_annee}{periode}",
    orientation="paysage", parametres=["mois", "date_debut", "date_fin"],
    sections=[{"type": "tableau", "titre": "", "source": "autorisations", "colonnes": [
        _col("numero"), _col("numero_autorisation"), _col("categorie", "Catégorie"), _col("matricule"), _col("nom"),
        _col("classe"), _col("periode"), _col("jours"), _col("motif"), _col("statut_libelle"),
        _col("avis")],
        "filtres": [], "tri": [{"champ": "date_debut", "ordre": "asc"}], "regroupement": "categorie",
        "agregats": {"jours": "somme"}, "sous_totaux": True, "total_general": True, "renumeroter": True},
        SIGNATURE])

DECISIONS_FIN_ANNEE = _modele(
    "DÉCISIONS DE FIN D'ANNÉE", parametres=["classe"], sections=[
        {"type": "repartition", "titre": "Récapitulatif des décisions", "source": "resultats", "champ": "decision",
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"}], "pourcentage": True},
        {"type": "tableau", "titre": "", "source": "resultats", "colonnes": [
            _col("numero"), _col("matricule_ecole"), _col("nom"), _col("sexe"), _col("mga"), _col("rang"),
            _col("decision_calculee", "Proposition"), _col("decision", "Décision retenue"),
            _col("decision_validee", "Validée"), _col("motif_decision", "Motif")],
         "filtres": [{"champ": "classe", "op": "=", "parametre": "classe"}], "tri": [], "regroupement": "classe",
         "saut_page_groupe": True, "agregats": {}, "sous_totaux": False, "total_general": False,
         "renumeroter": True},
        {"type": "texte", "style": "note", "texte":
            "Proposition : décision calculée (ADMIS si MGA ≥ seuil de la classe, sinon REDOUBLE). Décision "
            "retenue : décision validée par le directeur ; « NON » dans la colonne Validée signale une "
            "proposition pas encore validée."},
        SIGNATURE])

# (code, nom, catégorie, description, définition)
TEMPLATES = [
    ("REGISTRE", "Registre général des élèves", OFFICIEL, "Toutes classes (feuille REGISTRE ELEVES).", REGISTRE),
    ("ETAT_CLASSE", "État par classe", OFFICIEL,
     "Liste et statistiques d'une classe ; sans classe choisie, une page par classe (ETAT PAR CLASSE).", ETAT_CLASSE),
    ("EFFECTIFS", "Tableau des effectifs", OFFICIEL, "Effectifs par classe et par sexe (EFFECTIFS).", EFFECTIFS),
    ("SYNTHESE", "Synthèse de fin d'année", OFFICIEL, "Admis, taux, effectif probable (SYNTHESE FIN D'ANNEE).",
     SYNTHESE),
    ("RESULTATS", "Résultats CP1 à CM1", OFFICIEL, "Moyennes, MGA, décision et rang (RESULTATS).", RESULTATS),
    ("RESULTATS_CM2", "Résultats CM2", OFFICIEL, "Moyennes, MGA sur 4 évaluations (RESULTATS CM2).", RESULTATS_CM2),
    ("COMPOSITION", "Rapport de composition", OFFICIEL, "Statistiques et 3 meilleurs d'une évaluation.", COMPOSITION),
    ("RENTREE", "Rapport de rentrée", OFFICIEL, "Enseignants et effectifs redoublants / non redoublants.", RENTREE),
    ("MENSUEL", "Rapport mensuel du directeur", OFFICIEL, "Fréquentation, assiduité, évaluations et zones à rédiger.",
     MENSUEL),
    ("PERSONNEL", "Liste du personnel", OFFICIEL, "Personnel et récapitulatif par fonction (PERSONNEL).", PERSONNEL),
    ("ABS_ELEVES", "Journal des absences des élèves", OFFICIEL, "Retards et absences des élèves.", ABS_ELEVES),
    ("ABS_PERSONNEL", "Journal des absences du personnel", OFFICIEL, "Retards et absences du personnel.",
     ABS_PERSONNEL),
    ("AUTORISATIONS", "Registre des autorisations d'absence", OFFICIEL,
     "Demandes d'autorisation d'absence des élèves et du personnel, avec la décision du directeur.", AUTORISATIONS),
    ("FEUILLE_NOTES", "Feuille de notes", OFFICIEL, "Notes d'une classe pour une évaluation (NOTES).", FEUILLE_NOTES),
    ("AGES", "Élèves par âge, niveau et sexe", OFFICIEL,
     "Âges par niveau et par sexe : ensemble des élèves, avec extrait et sans extrait de naissance.", AGES),
    ("TABLEAU_DE_BORD", "Tableau de bord", OFFICIEL, "Indicateurs, tableau par classe, alertes et graphiques.",
     TABLEAU_DE_BORD),
    ("BULLETIN_EVAL", "Bulletins d'évaluation", "Bulletins",
     "Notes par matière, moyenne, rang et appréciation ; un élève, une classe ou toute l'école.", BULLETIN_EVAL),
    ("BULLETIN_COMPO", "Bulletins de composition", "Bulletins",
     "Une composition : note et appréciation par discipline, total, moyenne et rang.", BULLETIN_COMPO),
    ("BULLETIN_ANNUEL", "Bulletins annuels", "Bulletins",
     "Moyennes des évaluations, MGA, rang, décision et observation de fin d'année.", BULLETIN_ANNUEL),
    ("DECISIONS_FIN_ANNEE", "Décisions de fin d'année", "Fin d'année",
     "Admis, redoublants, abandons, exclus et transférés validés, par classe.", DECISIONS_FIN_ANNEE),
    ("EX_LISTE_CLASSE", "Liste des élèves par classe", EXEMPLE, "Liste alphabétique, une page par classe.",
     EX_LISTE_CLASSE),
    ("EX_EFFECTIFS_NIVEAU", "État des effectifs par niveau", EXEMPLE, "Effectifs, sorties, nationalités.",
     EX_EFFECTIFS_NIVEAU),
    ("EX_ENSEIGNANTS", "Liste des enseignants", EXEMPLE, "Enseignants triés par classe tenue.", EX_ENSEIGNANTS),
    ("EX_STAT_ANNUEL", "Rapport statistique annuel", EXEMPLE, "Indicateurs, effectifs détaillés et résultats.",
     EX_STAT_ANNUEL),
    ("EX_BILAN_RESULTATS", "Bilan des résultats", EXEMPLE, "Décisions, observations et classement.",
     EX_BILAN_RESULTATS),
    ("EX_ABSENCES", "Rapport des absences", EXEMPLE, "Absences des élèves et du personnel sur une période.",
     EX_ABSENCES),
]

# Lots de génération (plusieurs modèles en un seul PDF)
LOTS = {
    # macro ImprimerDossierFinAnnee du classeur
    "DOSSIER_FIN_ANNEE": ("Dossier de fin d'année", ["TABLEAU_DE_BORD", "EFFECTIFS", "SYNTHESE", "RENTREE",
                                                     "PERSONNEL"]),
    "RESULTATS_ANNUELS": ("Résultats de l'année", ["RESULTATS", "RESULTATS_CM2", "SYNTHESE"]),
}
