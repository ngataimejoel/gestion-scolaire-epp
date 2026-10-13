"""Stockage des modèles de rapports dans la base : création, versions, duplication,
activation, suppression, import / export (fichiers .epptpl) et installation des
modèles intégrés.

Chaque enregistrement crée une nouvelle version : l'historique complet est conservé
et une version antérieure peut être restaurée. Les modèles intégrés (livrés avec
l'application) sont partagés : les modifier demande la permission « modeles.partages »,
et ils ne peuvent pas être supprimés (seulement désactivés ou rétablis).
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from epp import __version__
from epp.core import security
from epp.core.db import Database
from epp.core.security import Session
from epp.reports import model
from epp.reports.model import ModeleInvalide

EXTENSION = ".epptpl"


def _hash(defn: dict) -> str:
    return hashlib.sha256(json.dumps(defn, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _code_libre(db: Database, base: str) -> str:
    base = re.sub(r"[^A-Z0-9_]+", "_", base.upper()).strip("_")[:40] or "MODELE"
    code, i = base, 2
    while db.scalar("SELECT 1 FROM modele_rapport WHERE code=?", (code,)):
        code = f"{base}_{i}"
        i += 1
    return code


def _row(db: Database, ref: int | str):
    if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
        r = db.one("SELECT * FROM modele_rapport WHERE id=?", (int(ref),))
    else:
        r = db.one("SELECT * FROM modele_rapport WHERE code=?", (ref,))
    if r is None:
        raise KeyError(f"Modèle de rapport introuvable : {ref}")
    return r


def _require_edit(s: Session, row) -> None:
    s.require("modeles.gerer")
    if row["integre"]:
        s.require("modeles.partages")


# ------------------------------------------------------------------ lecture
def lister(db: Database, actifs_seulement: bool = False, categorie: str | None = None) -> list[dict]:
    sql = "SELECT * FROM modele_rapport"
    cond, args = [], []
    if actifs_seulement:
        cond.append("actif=1")
    if categorie:
        cond.append("categorie=?")
        args.append(categorie)
    if cond:
        sql += " WHERE " + " AND ".join(cond)
    sql += " ORDER BY integre DESC, categorie, nom"
    return [dict(r) for r in db.query(sql, args)]


def get(db: Database, ref: int | str) -> dict:
    return dict(_row(db, ref))


def definition(db: Database, ref: int | str, version: int | None = None) -> dict:
    r = _row(db, ref)
    v = version or r["version_courante"]
    d = db.scalar("SELECT definition FROM modele_version WHERE modele_id=? AND version=?", (r["id"], v))
    if d is None:
        raise KeyError(f"Version {v} introuvable pour le modèle « {r['nom']} ».")
    return json.loads(d)


def versions(db: Database, ref: int | str) -> list[dict]:
    r = _row(db, ref)
    return [dict(x) for x in db.query(
        "SELECT version, commentaire, cree_le, cree_par FROM modele_version WHERE modele_id=? ORDER BY version DESC",
        (r["id"],))]


# ------------------------------------------------------------------ écriture
def creer(db: Database, s: Session, nom: str, defn: dict | None = None, categorie: str = "Mes modèles",
          description: str = "", code: str | None = None) -> int:
    s.require("modeles.gerer")
    nom = (nom or "").strip()
    if not nom:
        raise ModeleInvalide("Donnez un nom au modèle.")
    if db.scalar("SELECT 1 FROM modele_rapport WHERE nom=?", (nom,)):
        raise ModeleInvalide(f"Un modèle nommé « {nom} » existe déjà.")
    d = model.valider(defn or model.nouveau_modele())
    with db.transaction():
        cur = db.execute(
            "INSERT INTO modele_rapport(code, nom, description, categorie, actif, integre, version_courante, "
            "cree_par) VALUES(?,?,?,?,1,0,1,?)", (code or _code_libre(db, nom), nom, description, categorie, s.login))
        mid = cur.lastrowid
        db.execute("INSERT INTO modele_version(modele_id, version, definition, commentaire, cree_par) "
                   "VALUES(?,1,?,?,?)", (mid, model.to_json(d), "Création", s.login))
        security.log(db, s.login, "MODELE_CREATION", nom)
    return mid


def enregistrer(db: Database, s: Session, ref: int | str, defn: dict, commentaire: str = "") -> int:
    """Enregistre une nouvelle version ; renvoie son numéro. Sans changement, rien n'est créé."""
    r = _row(db, ref)
    _require_edit(s, r)
    d = model.valider(defn)
    if _hash(d) == _hash(definition(db, r["id"])):
        return r["version_courante"]
    v = db.scalar("SELECT MAX(version) FROM modele_version WHERE modele_id=?", (r["id"],), 0) + 1
    with db.transaction():
        db.execute("INSERT INTO modele_version(modele_id, version, definition, commentaire, cree_par) "
                   "VALUES(?,?,?,?,?)", (r["id"], v, model.to_json(d), commentaire or "Modification", s.login))
        db.execute("UPDATE modele_rapport SET version_courante=?, modifie_le=datetime('now','localtime') WHERE id=?",
                   (v, r["id"]))
        security.log(db, s.login, "MODELE_MODIFICATION", r["nom"], f"version {v}")
    return v


def restaurer_version(db: Database, s: Session, ref: int | str, version: int) -> int:
    """Restaure une version antérieure en la recopiant comme nouvelle version (l'historique est conservé)."""
    r = _row(db, ref)
    return enregistrer(db, s, r["id"], definition(db, r["id"], version), f"Restauration de la version {version}")


def dupliquer(db: Database, s: Session, ref: int | str, nouveau_nom: str | None = None) -> int:
    r = _row(db, ref)
    nom = nouveau_nom or f"{r['nom']} (copie)"
    base, i = nom, 2
    while db.scalar("SELECT 1 FROM modele_rapport WHERE nom=?", (nom,)):
        nom = f"{base} {i}"
        i += 1
    return creer(db, s, nom, definition(db, r["id"]), "Mes modèles", r["description"] or "")


def renommer(db: Database, s: Session, ref: int | str, nom: str, description: str | None = None,
             categorie: str | None = None) -> None:
    r = _row(db, ref)
    _require_edit(s, r)
    nom = (nom or "").strip()
    if not nom:
        raise ModeleInvalide("Le nom ne peut pas être vide.")
    if db.scalar("SELECT 1 FROM modele_rapport WHERE nom=? AND id<>?", (nom, r["id"])):
        raise ModeleInvalide(f"Un modèle nommé « {nom} » existe déjà.")
    with db.transaction():
        db.execute("UPDATE modele_rapport SET nom=?, description=COALESCE(?, description), "
                   "categorie=COALESCE(?, categorie), modifie_le=datetime('now','localtime') WHERE id=?",
                   (nom, description, categorie, r["id"]))
        security.log(db, s.login, "MODELE_RENOMMAGE", r["nom"], nom)


def set_actif(db: Database, s: Session, ref: int | str, actif: bool) -> None:
    r = _row(db, ref)
    _require_edit(s, r)
    with db.transaction():
        db.execute("UPDATE modele_rapport SET actif=? WHERE id=?", (1 if actif else 0, r["id"]))
        security.log(db, s.login, "MODELE_ACTIVATION" if actif else "MODELE_DESACTIVATION", r["nom"])


def supprimer(db: Database, s: Session, ref: int | str) -> None:
    """Supprime un modèle personnel et tout son historique (l'interface demande confirmation avant)."""
    r = _row(db, ref)
    s.require("modeles.gerer")
    if r["integre"]:
        raise ModeleInvalide("Un modèle intégré ne peut pas être supprimé ; vous pouvez le désactiver "
                             "ou le dupliquer pour créer votre propre version.")
    with db.transaction():
        db.execute("DELETE FROM modele_rapport WHERE id=?", (r["id"],))
        security.log(db, s.login, "MODELE_SUPPRESSION", r["nom"])


def retablir_original(db: Database, s: Session, ref: int | str) -> int:
    """Remet un modèle intégré dans son état d'origine (nouvelle version)."""
    from epp.reports.builtin import TEMPLATES
    r = _row(db, ref)
    orig = next((t for t in TEMPLATES if t[0] == r["code"]), None)
    if not r["integre"] or orig is None:
        raise ModeleInvalide("Seuls les modèles intégrés peuvent être rétablis.")
    return enregistrer(db, s, r["id"], orig[4], "Rétablissement du modèle d'origine")


# ------------------------------------------------------------------ import / export
def exporter(db: Database, ref: int | str, chemin: str | Path) -> Path:
    r = _row(db, ref)
    chemin = Path(chemin)
    if chemin.suffix.lower() != EXTENSION:
        chemin = chemin.with_suffix(EXTENSION)
    data = {"type": "epp-modele-rapport", "application": __version__, "format": model.FORMAT_VERSION,
            "nom": r["nom"], "code": r["code"], "categorie": r["categorie"], "description": r["description"],
            "version": r["version_courante"], "definition": definition(db, r["id"])}
    chemin.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return chemin


def lire_fichier(chemin: str | Path) -> dict:
    try:
        data = json.loads(Path(chemin).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ModeleInvalide(f"Fichier de modèle illisible : {e}")
    if not isinstance(data, dict) or data.get("type") != "epp-modele-rapport" or "definition" not in data:
        raise ModeleInvalide("Ce fichier n'est pas un modèle de rapport de l'application.")
    data["definition"] = model.valider(data["definition"])
    return data


def importer(db: Database, s: Session, chemin: str | Path, remplacer: int | None = None) -> int:
    """Importe un fichier .epptpl : nouveau modèle, ou nouvelle version du modèle `remplacer`."""
    data = lire_fichier(chemin)
    if remplacer:
        enregistrer(db, s, remplacer, data["definition"], f"Import de {Path(chemin).name}")
        return int(remplacer)
    nom, base, i = data.get("nom") or Path(chemin).stem, None, 2
    base = nom
    while db.scalar("SELECT 1 FROM modele_rapport WHERE nom=?", (nom,)):
        nom = f"{base} (importé{'' if i == 2 else ' ' + str(i - 1)})"
        i += 1
    mid = creer(db, s, nom, data["definition"], data.get("categorie") or "Mes modèles",
                data.get("description") or "")
    security.log(db, s.login, "MODELE_IMPORT", nom, str(chemin))
    return mid


# ------------------------------------------------------------------ modèles intégrés
def install_builtin_templates(db: Database) -> None:
    """Installe les modèles intégrés manquants et met à jour ceux que l'utilisateur n'a pas modifiés."""
    from epp.reports.builtin import TEMPLATES
    with db.transaction():
        for code, nom, cat, desc, defn in TEMPLATES:
            d = model.valider(defn)
            h = _hash(d)
            r = db.one("SELECT * FROM modele_rapport WHERE code=?", (code,))
            if r is None:
                n, i = nom, 2
                while db.scalar("SELECT 1 FROM modele_rapport WHERE nom=?", (n,)):
                    n = f"{nom} ({i})"
                    i += 1
                cur = db.execute(
                    "INSERT INTO modele_rapport(code, nom, description, categorie, actif, integre, version_courante, "
                    "cree_par) VALUES(?,?,?,?,1,1,1,'systeme')", (code, n, desc, cat))
                db.execute("INSERT INTO modele_version(modele_id, version, definition, commentaire, cree_par) "
                           "VALUES(?,1,?,?, 'systeme')", (cur.lastrowid, model.to_json(d),
                                                          f"Modèle intégré (application {__version__})"))
                db.set_meta(f"builtin:{code}", h)
                continue
            if not r["integre"]:
                continue
            installed = db.meta(f"builtin:{code}")
            if installed == h:
                continue
            courant = _hash(definition(db, r["id"]))
            if installed is None or courant == installed:
                # non modifié par l'utilisateur : mise à jour vers la nouvelle version livrée
                v = db.scalar("SELECT MAX(version) FROM modele_version WHERE modele_id=?", (r["id"],), 0) + 1
                db.execute("INSERT INTO modele_version(modele_id, version, definition, commentaire, cree_par) "
                           "VALUES(?,?,?,?, 'systeme')", (r["id"], v, model.to_json(d),
                                                          f"Mise à jour du modèle intégré (application {__version__})"))
                db.execute("UPDATE modele_rapport SET version_courante=? WHERE id=?", (v, r["id"]))
            db.set_meta(f"builtin:{code}", h)
