"""Données du tableau de bord (accueil) et de la recherche globale (Ctrl + K).

Tout est calculé ici, sans interface : indicateurs cliquables, effectifs par classe (garçons / filles),
résultats de l'évaluation en cours, absences des derniers jours de classe, premiers de classe, liste
« À faire », agenda et activité récente.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from epp.core.db import Database
from epp.domain import calculs, calendrier, repo, resultats
from epp.domain.repo import Annee

JOURS_ABSENCES = 10
JOURS_SEMAINE = "LMMJVSD"


def _date(v) -> date | None:
    return calculs.to_date(v) if v else None


def evaluation_courante(annee: Annee, aujourd_hui: date | None = None) -> int:
    """Dernière évaluation dont la date est passée (calendrier CP1-CM1), sinon la première."""
    today = aujourd_hui or date.today()
    evs = annee.evaluations.get("STD") or next(iter(annee.evaluations.values()), {})
    passees = [n for n, e in evs.items() if _date(e.get("date")) and _date(e.get("date")) <= today]
    return max(passees) if passees else min(evs or {1: None})


def _derniers_jours(db: Database, annee: Annee, today: date, n: int) -> list[date]:
    exclus = calendrier.jours_sans_classe(db, annee)
    debut = _date(annee.date_debut) or today - timedelta(days=60)
    jours = calendrier.jours_de_classe(max(debut, today - timedelta(days=40)), today, exclus)
    return jours[-n:]


def _derniere_sauvegarde(db: Database) -> datetime | None:
    try:
        from epp.core import backup
        fichiers = backup.lister(db)
    except Exception:      # noqa: BLE001 - dossier de sauvegarde absent ou inaccessible
        return None
    dates = [datetime.fromtimestamp(f["fichier"].stat().st_mtime) for f in fichiers]
    return max(dates) if dates else None


def tableau(db: Database, annee: Annee, aujourd_hui: date | None = None) -> dict:
    """Toutes les données de l'accueil pour l'année affichée."""
    today = aujourd_hui or date.today()
    ins = repo.inscriptions(db, annee)
    actifs = [r for r in ins if r["statut"] == "PRESENT"]
    garcons = sum(1 for r in actifs if r["sexe"] == "M")
    ev = evaluation_courante(annee, today)
    cal_std = annee.evaluations.get("STD", {})
    ev_lib = (cal_std.get(ev) or {}).get("libelle") or f"Évaluation {ev}"

    # effectifs et résultats par classe
    moys = resultats.moyennes_par_evaluation(db, annee)
    par_classe, res_classe, premiers = [], [], []
    for cl in annee.classes:
        el = [r for r in actifs if r["classe"] == cl.code]
        g = sum(1 for r in el if r["sexe"] == "M")
        par_classe.append({"classe": cl.code, "garcons": g, "filles": len(el) - g, "total": len(el)})
        notes = [(moys.get(r["inscription_id"], {}).get(ev, {}).get("moyenne"), r) for r in el]
        notes = [(m, r) for m, r in notes if m is not None]
        ok = sum(1 for m, _ in notes if m >= cl.seuil)
        res_classe.append({"classe": cl.code, "moyenne": sum(m for m, _ in notes) / len(notes) if notes else None,
                           "bareme": cl.bareme, "seuil": cl.seuil, "evalues": len(notes), "admis": ok,
                           "taux": ok / len(notes) if notes else None})
        if notes:
            m, r = max(notes, key=lambda t: t[0])
            premiers.append({"classe": cl.code, "nom": r["nom"], "moyenne": m, "bareme": cl.bareme,
                             "inscription_id": r["inscription_id"], "eleve_id": r["eleve_id"]})
    evalues = sum(c["evalues"] for c in res_classe)
    admis = sum(c["admis"] for c in res_classe)

    # absences : aujourd'hui et derniers jours de classe
    abs_rows = db.query("SELECT a.date, a.nature, a.justifie, a.inscription_id FROM absence_eleve a "
                        "WHERE a.annee_id=? AND a.nature='ABSENCE'", (annee.id,))
    absents_auj = {r["inscription_id"] for r in abs_rows if r["date"] == today.isoformat()}
    jours = []
    for d in _derniers_jours(db, annee, today, JOURS_ABSENCES):
        du_jour = [r for r in abs_rows if r["date"] == d.isoformat()]
        j = sum(1 for r in du_jour if (r["justifie"] or "").upper() == "OUI")
        jours.append({"date": d.isoformat(), "jour": JOURS_SEMAINE[d.weekday()], "num": d.day,
                      "justifiees": j, "non_justifiees": len(du_jour) - j})
    presence = (len(actifs) - len(absents_auj)) / len(actifs) if actifs else None

    # à faire
    sans_extrait = sum(1 for r in actifs if r.get("extrait") == "NON")
    sur_age = sum(1 for r in actifs if calculs.sur_age(r["classe"], r.get("age")))
    en_attente = [dict(r) for r in db.query(
        "SELECT a.*, COALESCE(e.nom, p.nom) AS nom FROM autorisation_absence a "
        "LEFT JOIN inscription i ON i.id=a.inscription_id LEFT JOIN eleve e ON e.id=i.eleve_id "
        "LEFT JOIN personnel p ON p.id=a.personnel_id WHERE a.annee_id=? AND a.statut='EN_ATTENTE' "
        "ORDER BY a.date_debut", (annee.id,))]
    tenues = {p.get("classe_code") for p in repo.personnel(db, annee) if p.get("classe_code")}
    sans_ens = [c for c in annee.codes if c not in tenues]
    sans_moy = [c["classe"] for c in res_classe if c["evalues"] < next(p["total"] for p in par_classe
                                                                        if p["classe"] == c["classe"])]
    sauv = _derniere_sauvegarde(db)
    a_faire = []
    if en_attente:
        a_faire.append(("alerte", "Demandes d'autorisation", f"{len(en_attente)} demande(s) en attente de décision",
                        "absences"))
    if sans_moy and evalues:
        a_faire.append(("alerte", "Notes manquantes", f"{ev_lib} : notes à compléter en {', '.join(sans_moy)}",
                        "notes"))
    if sans_ens:
        a_faire.append(("danger", "Classes sans enseignant", f"{', '.join(sans_ens)} : affectez un enseignant",
                        "personnel"))
    if sans_extrait:
        a_faire.append(("alerte", "Extraits de naissance", f"{sans_extrait} élève(s) sans extrait", "eleves"))
    if sur_age:
        a_faire.append(("alerte", "Âges à vérifier", f"{sur_age} élève(s) avec 3 ans ou plus d'avance d'âge",
                        "eleves"))
    if sauv is None or (datetime.now() - sauv).days > 7:
        a_faire.append(("danger", "Sauvegarde", "Aucune sauvegarde pour l'instant" if sauv is None else
                        f"Dernière sauvegarde il y a {(datetime.now() - sauv).days} jours", "sauvegarde"))

    # agenda : demandes à décider, prochaine évaluation, congés à venir
    agenda = [{"date": a["date_debut"], "titre": a["nom"] or "", "detail": f"{a['motif']} · demande {a['numero']}",
               "etiquette": "À décider", "cle": "absences"} for a in en_attente[:3]]
    prochaine = sorted((_date(e.get("date")), n, e) for n, e in cal_std.items()
                       if _date(e.get("date")) and _date(e.get("date")) >= today)
    if prochaine:
        d, _, e = prochaine[0]
        agenda.append({"date": d.isoformat(), "titre": e["libelle"], "detail": "Date prévue au calendrier",
                       "etiquette": "Évaluation", "cle": "notes"})
    for c in calendrier.conges(db, annee):
        if (c.get("date_fin") or c["date_debut"]) >= today.isoformat() and len(agenda) < 6:
            agenda.append({"date": c["date_debut"], "titre": c["libelle"],
                           "detail": f"du {_fr(c['date_debut'])} au {_fr(c['date_fin'])}"
                           if c.get("date_fin") and c["date_fin"] != c["date_debut"] else _fr(c["date_debut"]),
                           "etiquette": "Congés" if c.get("type") == "VACANCES" else "Férié", "cle": "parametres"})
    agenda.sort(key=lambda a: a["date"])

    activite = [{"date": r["horodatage"], "texte": _activite(r)} for r in db.query(
        "SELECT * FROM journal WHERE action NOT LIKE '%CONNEXION%' AND action NOT LIKE 'AUTORISATION_ADMIN%' "
        "ORDER BY id DESC LIMIT 6")]

    return {
        "date": today.isoformat(), "evaluation": ev, "evaluation_libelle": ev_lib,
        "effectif": len(actifs), "garcons": garcons, "filles": len(actifs) - garcons,
        "presence": presence, "absents_aujourdhui": len(absents_auj),
        "reussite": admis / evalues if evalues else None, "admis": admis, "evalues": evalues,
        "sans_extrait": sans_extrait, "sur_age": sur_age,
        "par_classe": par_classe, "resultats": res_classe, "absences": jours, "premiers": premiers,
        "a_faire": a_faire, "agenda": agenda, "activite": activite,
        "derniere_sauvegarde": sauv.isoformat(timespec="minutes") if sauv else None,
    }


def _fr(v) -> str:
    d = _date(v)
    return d.strftime("%d/%m/%Y") if d else ""


ACTIONS = {
    "AJOUT_ELEVE": "Élève ajouté", "MODIF_ELEVE": "Élève modifié", "SUPPRESSION_ELEVE": "Élève supprimé",
    "INSCRIPTION": "Inscription", "MODIF_INSCRIPTION": "Inscription modifiée", "REINSCRIPTIONS": "Réinscriptions",
    "MODIF_PERSONNEL": "Personnel modifié", "SUPPRESSION_PERSONNEL": "Personnel supprimé",
    "ABSENCE_ELEVE": "Absence d'élève enregistrée", "ABSENCE_PERSONNEL": "Absence du personnel enregistrée",
    "NOTE_CORRIGEE": "Note corrigée", "MODIF_MATIERES": "Matières modifiées", "MODIF_CLASSE": "Classe modifiée",
    "MODIF_PARAMETRES": "Paramètres modifiés", "MODIF_ANNEE": "Année scolaire modifiée",
    "IMPORT_EXCEL": "Import Excel", "SAUVEGARDE": "Sauvegarde", "RESTAURATION": "Restauration",
    "ACTIVATION": "Activation de la licence", "SUPPRESSION_CONGE": "Jour de congé supprimé",
}


def _activite(r) -> str:
    """Libellé lisible d'une ligne du journal, avec son détail quand il dit quelque chose."""
    a = r["action"] or ""
    action = ACTIONS.get(a) or a.replace("_", " ").capitalize()
    detail = (r["details"] or "").strip()
    return f"{action} : {detail[:90]}" if detail and not detail.isdigit() else action


# =================================================================== recherche globale
def rechercher(db: Database, annee: Annee | None, texte: str, limite: int = 8) -> list[dict]:
    """Élèves (nom, matricule, parents) et personnel correspondant au texte, pour la recherche Ctrl + K."""
    t = (texte or "").strip()
    if len(t) < 2:
        return []
    out = []
    if annee:
        for r in repo.inscriptions(db, annee, recherche=t)[:limite]:
            out.append({"type": "eleve", "titre": r["nom"], "id": r["eleve_id"],
                        "inscription_id": r["inscription_id"], "classe": r["classe"],
                        "detail": f"Élève · {r['classe']} · {r['matricule_ecole'] or ''}".rstrip(" ·")})
    for p in repo.personnel(db, annee, recherche=t)[:limite]:
        out.append({"type": "personnel", "titre": p["nom"], "id": p["id"],
                    "detail": f"Personnel · {p.get('fonction') or ''}".rstrip(" ·")})
    return out
