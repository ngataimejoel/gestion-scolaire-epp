"""Mot de passe oublié : code de secours (hors ligne) ou code reçu par mail (Internet, version activée).

- Le code de secours est remis à la création du compte (ou à la demande) : à imprimer ou à noter. Il ne sert
  qu'une fois ; un nouveau code est donné après chaque utilisation. Seule son empreinte est conservée.
- Le code par mail (6 chiffres, valable 15 minutes, 5 essais) est envoyé par le service en ligne d'AKWA SCHOOL
  à l'adresse enregistrée sur le compte.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta

from epp.core.db import Database
from epp.core.security import hash_password, log, set_password, verify_password

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"     # sans 0/O ni 1/I
DUREE_CODE_MAIL = timedelta(minutes=15)
ESSAIS_MAX = 5
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RecuperationErreur(Exception):
    pass


def _normaliser(code: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", (code or "").upper())


def nouveau_code_secours(db: Database, user_id: int, par: str = "") -> str:
    """Crée (ou remplace) le code de secours du compte et le renvoie, en clair, pour être imprimé ou noté."""
    brut = "".join(secrets.choice(ALPHABET) for _ in range(12))
    db.execute("UPDATE utilisateur SET secours_hash=? WHERE id=?", (hash_password(brut), user_id))
    login = db.scalar("SELECT login FROM utilisateur WHERE id=?", (user_id,))
    log(db, par or login or "?", "CODE_SECOURS", "utilisateur", login or "")
    return "-".join(brut[i:i + 4] for i in range(0, 12, 4))


def definir_email(db: Database, user_id: int, email: str | None) -> None:
    email = (email or "").strip() or None
    if email and not _EMAIL.match(email):
        raise ValueError("Adresse mail invalide.")
    db.execute("UPDATE utilisateur SET email=? WHERE id=?", (email, user_id))


def masquer(email: str) -> str:
    nom, _, dom = email.partition("@")
    return (nom[:2] + "•" * max(1, len(nom) - 2)) + "@" + dom


def _compte(db: Database, login: str):
    r = db.one("SELECT u.*, p.actif AS p_actif FROM utilisateur u LEFT JOIN personnel p ON p.id=u.personnel_id "
               "WHERE u.login=?", ((login or "").strip(),))
    if r is None or not r["actif"] or r["p_actif"] == 0:
        raise RecuperationErreur("Compte inconnu ou désactivé. Adressez-vous à l'administrateur.")
    return r


def envoyer_code_mail(db: Database, login: str, envoyer=None) -> str:
    """Envoie un code à l'adresse mail du compte ; renvoie l'adresse masquée (ex. « ko•••@gmail.com »)."""
    r = _compte(db, login)
    if not r["email"]:
        raise RecuperationErreur("Aucune adresse mail n'est enregistrée pour ce compte : utilisez le code de secours.")
    code = f"{secrets.randbelow(10 ** 6):06d}"
    if envoyer is None:
        from epp.core import licence
        envoyer = licence.envoyer_code_recuperation
    envoyer(r["email"], code, db.get_param("ecole_nom") or "", r["login"])
    expire = (datetime.now() + DUREE_CODE_MAIL).isoformat(timespec="seconds")
    db.execute("UPDATE utilisateur SET recup_hash=?, recup_expire=?, recup_essais=0 WHERE id=?",
               (hash_password(code), expire, r["id"]))
    log(db, r["login"], "RECUPERATION_MAIL", "utilisateur", masquer(r["email"]))
    return masquer(r["email"])


def reinitialiser(db: Database, login: str, code: str, nouveau: str) -> str | None:
    """Nouveau mot de passe avec le code de secours ou le code reçu par mail.

    Renvoie le nouveau code de secours quand l'ancien vient d'être utilisé (à remettre à l'utilisateur), sinon None.
    """
    r = _compte(db, login)
    c = _normaliser(code)
    secours = bool(r["secours_hash"]) and len(c) == 12 and verify_password(c, r["secours_hash"])
    mail = (not secours and bool(r["recup_hash"]) and len(c) == 6 and r["recup_essais"] < ESSAIS_MAX
            and datetime.now() <= datetime.fromisoformat(r["recup_expire"]) and verify_password(c, r["recup_hash"]))
    if not (secours or mail):
        db.execute("UPDATE utilisateur SET recup_essais=recup_essais+1 WHERE id=?", (r["id"],))
        log(db, r["login"], "RECUPERATION_ECHEC", "utilisateur", r["login"])
        raise RecuperationErreur("Code incorrect ou expiré.")
    set_password(db, r["id"], nouveau)          # règles du mot de passe vérifiées ici (ValueError)
    db.execute("UPDATE utilisateur SET recup_hash=NULL, recup_expire=NULL, recup_essais=0 WHERE id=?", (r["id"],))
    log(db, r["login"], "RECUPERATION", "utilisateur", "code de secours" if secours else "code reçu par mail")
    return nouveau_code_secours(db, r["id"]) if secours else None
