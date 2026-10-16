"""Calendrier scolaire : jours fériés et vacances, jours de classe.

Les jours de classe sont les jours du lundi au vendredi compris dans l'année scolaire, sauf les jours
fériés et les périodes de vacances saisis dans les paramètres. Ils servent au décompte des autorisations
d'absence et peuvent recalculer le nombre de jours de classe de chaque mois (taux de fréquentation).
"""
from __future__ import annotations

from datetime import date, timedelta

from epp.core.db import Database
from epp.core.security import Session, log
from epp.domain import calculs
from epp.domain.repo import Annee, ValidationError

TYPES = {"FERIE": "Jour férié", "VACANCES": "Vacances / congés scolaires", "AUTRE": "Autre (journée sans classe)"}


def _paques(an: int) -> date:
    """Dimanche de Pâques (calendrier grégorien, algorithme de Meeus)."""
    a, b, c = an % 19, an // 100, an % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mois = (h + l - 7 * m + 114) // 31
    jour = (h + l - 7 * m + 114) % 31 + 1
    return date(an, mois, jour)


def feries_de_date_connue(annee: Annee) -> list[dict]:
    """Jours fériés de Côte d'Ivoire dont la date se calcule (fixes et liés à Pâques) tombant dans l'année
    scolaire. Les fêtes musulmanes (Ramadan, Tabaski, Maouloud…) dépendent de la lune : à saisir."""
    a1, a2 = calculs.to_date(annee.date_debut), calculs.to_date(annee.date_fin)
    out = []
    for an in (a1.year, a2.year):
        p = _paques(an)
        for d, lib in [(date(an, 1, 1), "Jour de l'an"), (p + timedelta(days=1), "Lundi de Pâques"),
                       (date(an, 5, 1), "Fête du travail"), (p + timedelta(days=39), "Ascension"),
                       (p + timedelta(days=50), "Lundi de Pentecôte"), (date(an, 8, 7), "Fête de l'indépendance"),
                       (date(an, 8, 15), "Assomption"), (date(an, 11, 1), "Toussaint"),
                       (date(an, 11, 15), "Journée nationale de la paix"), (date(an, 12, 25), "Noël")]:
            if a1 <= d <= a2:
                out.append({"type": "FERIE", "libelle": lib, "date_debut": d.isoformat(), "date_fin": d.isoformat()})
    return sorted(out, key=lambda x: x["date_debut"])


def conges(db: Database, annee: Annee) -> list[dict]:
    rows = [dict(r) for r in db.query("SELECT * FROM conge WHERE annee_id=? ORDER BY date_debut, id", (annee.id,))]
    for r in rows:
        d1, d2 = calculs.to_date(r["date_debut"]), calculs.to_date(r["date_fin"])
        r["type_libelle"] = TYPES.get(r["type"], r["type"])
        r["jours_classe_perdus"] = sum(1 for i in range((d2 - d1).days + 1) if (d1 + timedelta(i)).weekday() < 5)
    return rows


def jours_sans_classe(db: Database, annee: Annee) -> set[date]:
    out: set[date] = set()
    for r in db.query("SELECT date_debut, date_fin FROM conge WHERE annee_id=?", (annee.id,)):
        d, fin = calculs.to_date(r["date_debut"]), calculs.to_date(r["date_fin"])
        while d <= fin:
            out.add(d)
            d += timedelta(days=1)
    return out


def jours_de_classe(debut: date, fin: date, exclus: set[date] | None = None) -> list[date]:
    """Jours du lundi au vendredi de la période, hors jours fériés et vacances."""
    exclus = exclus or set()
    out, d = [], debut
    while d <= fin:
        if d.weekday() < 5 and d not in exclus:
            out.append(d)
        d += timedelta(days=1)
    return out


def _valider(annee: Annee, data: dict) -> dict:
    typ = data.get("type") or "FERIE"
    if typ not in TYPES:
        raise ValidationError("Type : FERIE, VACANCES ou AUTRE.", "type")
    lib = (data.get("libelle") or "").strip()
    if not lib:
        raise ValidationError("Indiquez le libellé (ex. Tabaski, Congés de Noël).", "libelle")
    d1 = calculs.to_date(data.get("date_debut"))
    d2 = calculs.to_date(data.get("date_fin") or data.get("date_debut"))
    if d1 is None:
        raise ValidationError("Indiquez la date de début.", "date_debut")
    if d2 is None or d2 < d1:
        raise ValidationError("La date de fin doit être postérieure ou égale à la date de début.", "date_fin")
    a1, a2 = calculs.to_date(annee.date_debut), calculs.to_date(annee.date_fin)
    if a1 and a2 and not (a1 <= d1 and d2 <= a2):
        raise ValidationError(f"La période doit être comprise dans l'année scolaire {annee.libelle}.", "date_debut")
    return {"type": typ, "libelle": lib, "date_debut": d1.isoformat(), "date_fin": d2.isoformat()}


def enregistrer(db: Database, s: Session, annee: Annee, cid: int | None, data: dict) -> int:
    s.require("parametres.modifier")
    d = _valider(annee, data)
    with db.transaction():
        _enregistrer(db, annee, cid, d)
        cid = cid or db.scalar("SELECT MAX(id) FROM conge WHERE annee_id=?", (annee.id,))
        _apres_modification(db, annee)
    log(db, s.login, "CONGE", annee.libelle, f"{d['libelle']} {d['date_debut']} → {d['date_fin']}")
    return cid


def _enregistrer(db: Database, annee: Annee, cid: int | None, d: dict) -> None:
    if cid:
        db.execute("UPDATE conge SET type=?, libelle=?, date_debut=?, date_fin=? WHERE id=? AND annee_id=?",
                   (d["type"], d["libelle"], d["date_debut"], d["date_fin"], cid, annee.id))
    else:
        db.execute("INSERT INTO conge(annee_id, type, libelle, date_debut, date_fin) VALUES(?,?,?,?,?)",
                   (annee.id, d["type"], d["libelle"], d["date_debut"], d["date_fin"]))


def _apres_modification(db: Database, annee: Annee) -> None:
    """Les autorisations d'absence déjà saisies suivent le calendrier (durée et absences reportées)."""
    from epp.domain import autorisations
    autorisations.recalculer(db, annee)


def supprimer(db: Database, s: Session, annee: Annee, cid: int) -> None:
    s.require("parametres.modifier")
    with db.transaction():
        db.execute("DELETE FROM conge WHERE id=? AND annee_id=?", (cid, annee.id))
        _apres_modification(db, annee)
    log(db, s.login, "SUPPRESSION_CONGE", "conge", str(cid))


def ajouter_feries(db: Database, s: Session, annee: Annee) -> int:
    """Ajoute les jours fériés de date connue qui ne sont pas déjà dans la liste. Renvoie le nombre ajouté."""
    s.require("parametres.modifier")
    deja = {(r["date_debut"], r["date_fin"]) for r in conges(db, annee)}
    n = 0
    with db.transaction():
        for f in feries_de_date_connue(annee):
            if (f["date_debut"], f["date_fin"]) not in deja:
                enregistrer(db, s, annee, None, f)
                n += 1
    return n


def jours_de_classe_par_mois(db: Database, annee: Annee) -> dict[int, int]:
    """Nombre de jours de classe de chaque mois du tableau des jours de classe (septembre à juillet par
    défaut), d'après le calendrier : lundi à vendredi, hors jours fériés et vacances."""
    a1, a2 = calculs.to_date(annee.date_debut), calculs.to_date(annee.date_fin)
    mois = set(annee.jours) or {9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7}
    out: dict[int, int] = {m: 0 for m in mois}
    for d in jours_de_classe(a1, a2, jours_sans_classe(db, annee)):
        if d.month in mois:
            out[d.month] += 1
    return out


def set_jours_classe(db: Database, s: Session, annee: Annee, jours: dict[int, int]) -> None:
    """Enregistre le nombre de jours de classe par mois (tableau des paramètres)."""
    s.require("parametres.modifier")
    from epp.core import seed
    with db.transaction():
        for mois, n in jours.items():
            n = int(n)
            if not 0 <= n <= 31:
                raise ValidationError(f"Jours de classe de {seed.MOIS_FR[mois - 1].lower()} : entre 0 et 31.")
            db.execute("INSERT INTO jours_classe(annee_id, mois, libelle, jours) VALUES(?,?,?,?) "
                       "ON CONFLICT(annee_id, mois) DO UPDATE SET jours=excluded.jours",
                       (annee.id, mois, seed.MOIS_FR[mois - 1], n))
    log(db, s.login, "JOURS_CLASSE", annee.libelle, str(jours))
