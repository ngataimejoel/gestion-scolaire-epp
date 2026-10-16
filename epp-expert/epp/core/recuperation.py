"""Mot de passe oublié : code de secours, hors ligne.

Le code est remis à la création du compte (ou à la demande) : à imprimer ou à noter. Il ne sert qu'une fois ;
un nouveau code est donné après chaque utilisation. Seule son empreinte est conservée.
"""
from __future__ import annotations

import re
import secrets

from epp.core.db import Database
from epp.core.security import hash_password, log, set_password, verify_password

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"     # sans 0/O ni 1/I


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


def reinitialiser(db: Database, login: str, code: str, nouveau: str) -> str:
    """Nouveau mot de passe avec le code de secours ; renvoie le nouveau code de secours (à remettre)."""
    r = db.one("SELECT u.id, u.login, u.actif, u.secours_hash, p.actif AS p_actif FROM utilisateur u "
               "LEFT JOIN personnel p ON p.id=u.personnel_id WHERE u.login=?", ((login or "").strip(),))
    if r is None or not r["actif"] or r["p_actif"] == 0:
        raise RecuperationErreur("Compte inconnu ou désactivé. Adressez-vous à l'administrateur.")
    c = _normaliser(code)
    if not (r["secours_hash"] and len(c) == 12 and verify_password(c, r["secours_hash"])):
        log(db, r["login"], "RECUPERATION_ECHEC", "utilisateur", r["login"])
        raise RecuperationErreur("Code de secours incorrect.")
    set_password(db, r["id"], nouveau)          # règles du mot de passe vérifiées ici (ValueError)
    log(db, r["login"], "RECUPERATION", "utilisateur", "code de secours")
    return nouveau_code_secours(db, r["id"])
