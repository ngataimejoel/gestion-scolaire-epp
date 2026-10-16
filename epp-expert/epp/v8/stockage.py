"""Données de l'application AKWA SCHOOL v8 (interface HTML v8).

Une base SQLite propre à cette application, dans le dossier de données habituel (sous-dossier akwa_v8) :
- etat : les données de l'école, telles que l'interface les manipule (un seul document JSON) ;
- copie : une copie par jour des données (les 30 derniers jours), pour revenir en arrière ;
- compte : l'administrateur et les comptes des enseignants. Seules les empreintes des mots de passe et
  des codes de secours sont conservées ; elles ne sont jamais envoyées à l'interface.
- journal : connexions et opérations sur les comptes.
"""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from epp.core import licence, paths
from epp.core.security import check_password_policy, hash_password, verify_password

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"     # sans 0/O ni 1/I
ADMIN = "admin"
COPIES_GARDEES = 30
CHAMPS_SECRETS = ("adminPwd", "secours")           # présents dans le modèle de la page : jamais conservés

SCHEMA = """
CREATE TABLE IF NOT EXISTS etat (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, maj TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS copie (jour TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS compte (
    login TEXT PRIMARY KEY COLLATE NOCASE, role TEXT NOT NULL, tid TEXT, hash TEXT NOT NULL,
    provisoire INTEGER NOT NULL DEFAULT 0, secours_hash TEXT);
CREATE TABLE IF NOT EXISTS journal (t TEXT NOT NULL, qui TEXT NOT NULL, action TEXT NOT NULL);
"""


class Erreur(Exception):
    """Message destiné à l'utilisateur."""


def dossier() -> Path:
    p = paths.data_dir() / "akwa_v8"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _code() -> tuple[str, str]:
    brut = "".join(secrets.choice(ALPHABET) for _ in range(12))
    return "-".join(brut[i:i + 4] for i in range(0, 12, 4)), brut


def _normaliser(code: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", (code or "").upper())


def _provisoire() -> str:
    return "Prov-" + "".join(secrets.choice(ALPHABET) for _ in range(6))


def licence_pour_page(e: licence.Etat, aujourd_hui: date | None = None) -> dict:
    """État de la licence au format de l'interface v8 (bandeau, Paramètres)."""
    j = aujourd_hui or date.today()
    if e.statut == "active" and e.type == "vie":
        return {"type": "vie"}
    if e.statut == "active" and e.expire_le:
        return {"type": "an", "fin": e.expire_le.date().isoformat()}
    return {"type": "essai", "debut": (j - timedelta(days=max(0, licence.ESSAI_JOURS - (e.jours_restants or 0)))).isoformat()}


class Stockage:
    def __init__(self, fichier: Path | None = None):
        self.fichier = Path(fichier) if fichier else dossier() / "akwa.sqlite"
        self.conn = sqlite3.connect(self.fichier)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def _journal(self, qui: str, action: str) -> None:
        self.conn.execute("INSERT INTO journal VALUES (?,?,?)", (datetime.now().isoformat(timespec="seconds"), qui, action))

    # ---------- données de l'école ----------
    def lire(self) -> dict | None:
        r = self.conn.execute("SELECT json FROM etat WHERE id=1").fetchone()
        return json.loads(r["json"]) if r else None

    def ecrire(self, texte: str) -> None:
        """Enregistre les données envoyées par l'interface (refuse un document incomplet)."""
        try:
            o = json.loads(texte)
        except ValueError:
            raise Erreur("Données illisibles : rien n'a été enregistré.") from None
        if not (isinstance(o, dict) and isinstance(o.get("school"), dict)
                and isinstance(o.get("students"), list) and isinstance(o.get("teachers"), list)):
            raise Erreur("Données incomplètes : rien n'a été enregistré.")
        for k in CHAMPS_SECRETS:
            o["school"].pop(k, None)
        o.pop("session", None)
        texte = json.dumps(o, ensure_ascii=False, separators=(",", ":"))
        with self.conn:
            self.conn.execute("INSERT INTO etat VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, "
                              "maj=excluded.maj", (texte, datetime.now().isoformat(timespec="seconds")))
            self.conn.execute("INSERT INTO copie VALUES (?,?) ON CONFLICT(jour) DO UPDATE SET json=excluded.json",
                              (date.today().isoformat(), texte))
            self.conn.execute("DELETE FROM copie WHERE jour NOT IN (SELECT jour FROM copie ORDER BY jour DESC LIMIT ?)",
                              (COPIES_GARDEES,))

    def copies(self) -> list[str]:
        return [r["jour"] for r in self.conn.execute("SELECT jour FROM copie ORDER BY jour DESC")]

    def revenir_a(self, jour: str) -> None:
        r = self.conn.execute("SELECT json FROM copie WHERE jour=?", (jour,)).fetchone()
        if r is None:
            raise Erreur("Copie introuvable.")
        with self.conn:
            self.conn.execute("UPDATE etat SET json=?, maj=? WHERE id=1", (r["json"], datetime.now().isoformat(timespec="seconds")))

    def sauvegarder_fichier(self, destination: Path) -> Path:
        """Copie complète et cohérente de la base (pour une clé USB)."""
        dst = sqlite3.connect(destination)
        try:
            self.conn.backup(dst)
        finally:
            dst.close()
        return destination

    # ---------- comptes ----------
    def a_un_admin(self) -> bool:
        return self.conn.execute("SELECT 1 FROM compte WHERE role='dir'").fetchone() is not None

    def creer_admin(self, mot_de_passe: str) -> str:
        """Premier lancement : mot de passe de l'administrateur ; renvoie son code de secours."""
        if self.a_un_admin():
            raise Erreur("L'administrateur existe déjà.")
        if msg := check_password_policy(mot_de_passe):
            raise Erreur(msg)
        code, brut = _code()
        with self.conn:
            self.conn.execute("INSERT INTO compte VALUES (?, 'dir', NULL, ?, 0, ?)",
                              (ADMIN, hash_password(mot_de_passe), hash_password(brut)))
            self._journal(ADMIN, "Création du compte administrateur")
        return code

    def _compte(self, login: str):
        return self.conn.execute("SELECT * FROM compte WHERE login=?", ((login or "").strip(),)).fetchone()

    def _enseignant(self, tid: str) -> dict | None:
        o = self.lire() or {}
        return next((t for t in o.get("teachers", []) if t.get("id") == tid), None)

    def authentifier(self, login: str, mot_de_passe: str) -> dict:
        """Renvoie la session {role, tid, login, nom, provisoire} ou lève Erreur."""
        c = self._compte(login)
        if c is None or not verify_password(mot_de_passe, c["hash"]):
            time.sleep(0.4)
            raise Erreur("Identifiant ou mot de passe incorrect.")
        nom = "Directeur (administrateur)"
        if c["role"] == "ens":
            t = self._enseignant(c["tid"])
            if not t or not t.get("actif", True) or not (t.get("compte") or {}).get("actif"):
                raise Erreur("Compte désactivé. Adressez-vous au directeur.")
            nom = f"{t.get('nom', '')} – {t.get('classe') or 'sans classe'}"
        with self.conn:
            self._journal(c["login"], "Connexion")
        return {"role": c["role"], "tid": c["tid"], "login": c["login"], "nom": nom, "provisoire": bool(c["provisoire"])}

    def verifier(self, login: str, mot_de_passe: str) -> bool:
        c = self._compte(login)
        return c is not None and verify_password(mot_de_passe, c["hash"])

    def verifier_admin(self, mot_de_passe: str) -> bool:
        c = self.conn.execute("SELECT hash FROM compte WHERE role='dir'").fetchone()
        return c is not None and verify_password(mot_de_passe, c["hash"])

    def changer(self, login: str, ancien: str, nouveau: str) -> None:
        if not self.verifier(login, ancien):
            raise Erreur("Mot de passe actuel incorrect.")
        self.definir(login, nouveau)

    def definir(self, login: str, nouveau: str) -> None:
        if msg := check_password_policy(nouveau):
            raise Erreur(msg)
        with self.conn:
            self.conn.execute("UPDATE compte SET hash=?, provisoire=0 WHERE login=?", (hash_password(nouveau), login))
            self._journal(login, "Mot de passe changé")

    def nouveau_code_secours(self, login: str) -> str:
        code, brut = _code()
        with self.conn:
            self.conn.execute("UPDATE compte SET secours_hash=? WHERE login=?", (hash_password(brut), login))
            self._journal(login, "Nouveau code de secours")
        return code

    def recuperer(self, login: str, code: str, nouveau: str) -> str:
        """Nouveau mot de passe avec le code de secours ; renvoie le nouveau code (l'ancien ne sert plus)."""
        c = self._compte(login)
        if c is None or not c["secours_hash"] or not verify_password(_normaliser(code), c["secours_hash"]):
            time.sleep(0.4)
            raise Erreur("Code de secours incorrect.")
        if msg := check_password_policy(nouveau):
            raise Erreur(msg)
        with self.conn:
            self.conn.execute("UPDATE compte SET hash=?, provisoire=0 WHERE login=?", (hash_password(nouveau), c["login"]))
            self._journal(c["login"], "Mot de passe changé avec le code de secours")
        return self.nouveau_code_secours(c["login"])

    def creer_compte_enseignant(self, tid: str, login: str) -> str:
        """Compte d'un enseignant créé par le directeur ; renvoie le mot de passe provisoire."""
        login = (login or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", login):
            raise Erreur("Identifiant invalide : 3 à 40 lettres, chiffres, points ou tirets.")
        c = self._compte(login)
        if c is not None and c["tid"] != tid:
            raise Erreur("Identifiant déjà utilisé.")
        mdp = _provisoire()
        with self.conn:
            self.conn.execute("DELETE FROM compte WHERE role='ens' AND tid=?", (tid,))
            self.conn.execute("INSERT INTO compte VALUES (?, 'ens', ?, ?, 1, NULL)", (login, tid, hash_password(mdp)))
            self._journal(ADMIN, f"Compte enseignant créé : {login}")
        return mdp

    def reinitialiser_enseignant(self, tid: str) -> str:
        c = self.conn.execute("SELECT login FROM compte WHERE role='ens' AND tid=?", (tid,)).fetchone()
        if c is None:
            raise Erreur("Ce compte n'existe pas encore : créez-le d'abord.")
        mdp = _provisoire()
        with self.conn:
            self.conn.execute("UPDATE compte SET hash=?, provisoire=1 WHERE login=?", (hash_password(mdp), c["login"]))
            self._journal(ADMIN, f"Mot de passe provisoire : {c['login']}")
        return mdp
