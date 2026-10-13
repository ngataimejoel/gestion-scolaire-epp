"""Utilisateurs, rôles, autorisations et hachage des mots de passe."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from dataclasses import dataclass, field

from epp.core.db import Database

ITERATIONS = 240_000
MIN_PASSWORD = 6

# Autorisations disponibles (code -> libellé affiché)
PERMISSIONS: dict[str, str] = {
    "eleves.lire": "Consulter les élèves",
    "eleves.modifier": "Ajouter / modifier les élèves et inscriptions",
    "eleves.supprimer": "Supprimer des élèves",
    "notes.lire": "Consulter les notes et résultats",
    "notes.modifier": "Saisir les notes",
    "personnel.lire": "Consulter le personnel",
    "personnel.modifier": "Ajouter / modifier le personnel",
    "personnel.supprimer": "Supprimer du personnel",
    "absences.lire": "Consulter les absences",
    "absences.modifier": "Saisir les absences",
    "rapports.generer": "Générer, imprimer et exporter les rapports",
    "modeles.gerer": "Créer et modifier ses modèles de rapports",
    "modeles.partages": "Modifier ou supprimer les modèles partagés et intégrés",
    "parametres.modifier": "Modifier les paramètres de l'établissement et des années",
    "utilisateurs.gerer": "Gérer les utilisateurs et les rôles",
    "sauvegarde.creer": "Créer des sauvegardes",
    "sauvegarde.restaurer": "Restaurer une sauvegarde",
    "import.excel": "Importer des fichiers Excel",
    "export.excel": "Exporter vers Excel",
}

DEFAULT_ROLES: dict[str, tuple[str, list[str]]] = {
    "ADMIN": ("Administrateur", list(PERMISSIONS)),
    "DIRECTEUR": ("Directeur / responsable d'établissement",
                  [p for p in PERMISSIONS if p != "utilisateurs.gerer"]),
    "SECRETARIAT": ("Secrétariat", [
        "eleves.lire", "eleves.modifier", "personnel.lire", "absences.lire", "absences.modifier",
        "notes.lire", "rapports.generer", "export.excel", "sauvegarde.creer"]),
    "ENSEIGNANT": ("Enseignant", [
        "eleves.lire", "notes.lire", "notes.modifier", "absences.lire", "absences.modifier",
        "rapports.generer"]),
}


class AccessDenied(PermissionError):
    pass


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        ITERATIONS, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, dk_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except (ValueError, TypeError):
        return False


def check_password_policy(password: str) -> str | None:
    """Renvoie un message d'erreur, ou None si le mot de passe est acceptable."""
    if len(password) < MIN_PASSWORD:
        return f"Le mot de passe doit comporter au moins {MIN_PASSWORD} caractères."
    if password.isdigit() and len(set(password)) == 1:
        return "Le mot de passe est trop simple."
    return None


@dataclass
class Session:
    user_id: int
    login: str
    nom: str
    role_code: str
    role_libelle: str
    permissions: set[str] = field(default_factory=set)

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def require(self, perm: str) -> None:
        if not self.can(perm):
            raise AccessDenied(
                f"Votre profil ({self.role_libelle}) ne permet pas cette opération : "
                f"« {PERMISSIONS.get(perm, perm)} ».")


def system_session() -> Session:
    """Session technique (import initial, tests, ligne de commande)."""
    return Session(0, "systeme", "Système", "ADMIN", "Administrateur", set(PERMISSIONS))


def ensure_roles(db: Database) -> None:
    for code, (libelle, perms) in DEFAULT_ROLES.items():
        rid = db.scalar("SELECT id FROM role WHERE code=?", (code,))
        if rid is None:
            rid = db.execute("INSERT INTO role(code, libelle, systeme) VALUES(?,?,1)",
                             (code, libelle)).lastrowid
            db.executemany("INSERT OR IGNORE INTO role_permission(role_id, permission) VALUES(?,?)",
                           [(rid, p) for p in perms])
    admin_id = db.scalar("SELECT id FROM role WHERE code='ADMIN'")
    db.executemany("INSERT OR IGNORE INTO role_permission(role_id, permission) VALUES(?,?)",
                   [(admin_id, p) for p in PERMISSIONS])


def has_users(db: Database) -> bool:
    return bool(db.scalar("SELECT COUNT(*) FROM utilisateur"))


def create_user(db: Database, login: str, nom: str, password: str, role_code: str,
                doit_changer: bool = False) -> int:
    login = login.strip()
    if not login:
        raise ValueError("L'identifiant est obligatoire.")
    err = check_password_policy(password)
    if err:
        raise ValueError(err)
    if db.scalar("SELECT id FROM utilisateur WHERE login=?", (login,)):
        raise ValueError(f"L'identifiant « {login} » existe déjà.")
    role_id = db.scalar("SELECT id FROM role WHERE code=?", (role_code,))
    if role_id is None:
        raise ValueError(f"Rôle inconnu : {role_code}")
    return db.execute(
        "INSERT INTO utilisateur(login, nom, role_id, hash, doit_changer) VALUES(?,?,?,?,?)",
        (login, nom.strip() or login, role_id, hash_password(password), int(doit_changer))).lastrowid


def set_password(db: Database, user_id: int, password: str) -> None:
    err = check_password_policy(password)
    if err:
        raise ValueError(err)
    db.execute("UPDATE utilisateur SET hash=?, doit_changer=0 WHERE id=?",
               (hash_password(password), user_id))


def load_session(db: Database, user_id: int) -> Session:
    row = db.one(
        "SELECT u.id, u.login, u.nom, r.id AS rid, r.code, r.libelle FROM utilisateur u "
        "JOIN role r ON r.id=u.role_id WHERE u.id=?", (user_id,))
    perms = {r[0] for r in db.query("SELECT permission FROM role_permission WHERE role_id=?", (row["rid"],))}
    return Session(row["id"], row["login"], row["nom"], row["code"], row["libelle"], perms)


def authenticate(db: Database, login: str, password: str) -> Session | None:
    row = db.one("SELECT id, hash, actif FROM utilisateur WHERE login=?", (login.strip(),))
    if row is None or not row["actif"] or not verify_password(password, row["hash"]):
        log(db, login or "?", "CONNEXION_ECHEC", "utilisateur", login)
        return None
    db.execute("UPDATE utilisateur SET derniere_connexion=datetime('now','localtime') WHERE id=?", (row["id"],))
    s = load_session(db, row["id"])
    log(db, s.login, "CONNEXION", "utilisateur", s.login)
    return s


def admin_count(db: Database) -> int:
    return db.scalar(
        "SELECT COUNT(*) FROM utilisateur u JOIN role r ON r.id=u.role_id "
        "WHERE r.code='ADMIN' AND u.actif=1", default=0)


def log(db: Database, utilisateur: str, action: str, objet: str = "", details: str = "") -> None:
    db.execute("INSERT INTO journal(utilisateur, action, objet, details) VALUES(?,?,?,?)",
               (utilisateur, action, objet, details))
