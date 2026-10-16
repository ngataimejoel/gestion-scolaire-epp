"""Sauvegardes de la base de données.

Une sauvegarde est un fichier .zip contenant :
  - epp.db : copie cohérente de la base (API de sauvegarde SQLite, sans arrêter l'application) ;
  - manifeste.json : application, version du schéma, date, motif, taille et empreinte SHA-256.
Les photos et les logos sont dans la base : ils font partie de la sauvegarde.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from epp import APP_NAME, __version__
from epp.core import paths
from epp.core.db import SCHEMA_VERSION, Database, open_database
from epp.core.security import Session, log

EXTENSION = ".zip"
PREFIXE = "EPP_sauvegarde_"


class SauvegardeInvalide(ValueError):
    pass


def dossier(db: Database) -> Path:
    choisi = (db.get_param("sauvegarde_dossier") or "").strip()
    p = Path(choisi) if choisi else paths.backups_dir()
    p.mkdir(parents=True, exist_ok=True)
    return p


def creer_sauvegarde(db: Database, s: Session, motif: str = "manuelle", destination: Path | None = None) -> Path:
    """Sauvegarde demandée par un utilisateur (permission sauvegarde.creer)."""
    s.require("sauvegarde.creer")
    return sauvegarde_auto(db, motif, destination, s.login)


def sauvegarde_auto(db: Database, motif: str, destination: Path | None = None, login: str = "systeme") -> Path:
    """Sauvegarde faite par l'application avant une opération importante (passage d'année, restauration…)."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", motif).strip("_")[:40] or "sauvegarde"
    dest_dir = Path(destination) if destination else dossier(db)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{PREFIXE}{stamp}_{slug}{EXTENSION}"
    n = 1
    while out.exists():
        n += 1
        out = dest_dir / f"{PREFIXE}{stamp}_{slug}_{n}{EXTENSION}"
    with tempfile.TemporaryDirectory(prefix="epp_sauv_") as tmp:
        copie = Path(tmp) / "epp.db"
        dst = sqlite3.connect(copie)
        try:
            db.conn.backup(dst)
        finally:
            dst.close()
        data = copie.read_bytes()
        manifeste = {
            "application": APP_NAME, "version_application": __version__,
            "version_schema": db.meta("schema_version"), "cree_le": datetime.now().isoformat(timespec="seconds"),
            "motif": motif, "utilisateur": login, "taille": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "annees": [r["libelle"] for r in db.query("SELECT libelle FROM annee_scolaire ORDER BY libelle")],
        }
        partiel = out.with_suffix(".partiel")
        with zipfile.ZipFile(partiel, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("epp.db", data)
            z.writestr("manifeste.json", json.dumps(manifeste, ensure_ascii=False, indent=2))
        partiel.replace(out)               # le fichier n'apparaît qu'une fois complet
    verifier(out)
    log(db, login, "SAUVEGARDE", out.name, motif)
    return out


def verifier(fichier: Path) -> dict:
    """Contrôle une sauvegarde (empreinte, intégrité SQLite) et renvoie son manifeste."""
    try:
        with zipfile.ZipFile(fichier) as z:
            manifeste = json.loads(z.read("manifeste.json").decode("utf-8"))
            data = z.read("epp.db")
    except (OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        raise SauvegardeInvalide(f"Fichier de sauvegarde illisible : {e}") from None
    if hashlib.sha256(data).hexdigest() != manifeste.get("sha256") or len(data) != manifeste.get("taille"):
        raise SauvegardeInvalide("La sauvegarde est endommagée (empreinte différente).")
    with tempfile.TemporaryDirectory(prefix="epp_verif_") as tmp:
        p = Path(tmp) / "epp.db"
        p.write_bytes(data)
        con = sqlite3.connect(p)
        try:
            ok = con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            con.close()
    if not ok:
        raise SauvegardeInvalide("La base contenue dans la sauvegarde n'est pas intègre.")
    return manifeste


def lister(db: Database) -> list[dict]:
    out = []
    for f in sorted(dossier(db).glob(f"{PREFIXE}*{EXTENSION}"), reverse=True):
        out.append({"fichier": f, "nom": f.name, "taille": f.stat().st_size})
    return out


def restaurer(db: Database, s: Session, fichier: Path) -> tuple[Database, Path]:
    """Remplace la base par celle d'une sauvegarde vérifiée. Une sauvegarde de sécurité de l'état actuel
    est faite d'abord. La connexion `db` est fermée : la base rouverte (et mise à niveau) est renvoyée,
    avec le chemin de la sauvegarde de sécurité. Les utilisateurs doivent se reconnecter."""
    s.require("sauvegarde.restaurer")
    fichier = Path(fichier)
    manifeste = verifier(fichier)
    try:
        version = int(manifeste.get("version_schema") or 0)
    except ValueError:
        version = 0
    if version > SCHEMA_VERSION:
        raise SauvegardeInvalide("Cette sauvegarde a été faite avec une version plus récente de l'application : "
                                 "mettez d'abord l'application à jour.")
    avant = sauvegarde_auto(db, "avant restauration", login=s.login)
    with zipfile.ZipFile(fichier) as z:
        data = z.read("epp.db")
    chemin = db.path
    db.close()
    provisoire = chemin.with_name(chemin.name + ".restauration")
    provisoire.write_bytes(data)
    for ext in ("-wal", "-shm"):
        try:
            Path(str(chemin) + ext).unlink()
        except FileNotFoundError:
            pass
    os.replace(provisoire, chemin)
    nouvelle = open_database(chemin)
    log(nouvelle, s.login, "RESTAURATION", fichier.name,
        f"sauvegarde du {manifeste.get('cree_le')} ; état précédent conservé dans {avant.name}")
    return nouvelle, avant


def sauvegarde_periodique(db: Database, maintenant: datetime | None = None) -> Path | None:
    """Sauvegarde automatique (au démarrage et à la fermeture) si la dernière date de plus de
    « sauvegarde_frequence_heures ». Seules les sauvegardes automatiques au-delà de
    « sauvegarde_conserver » sont supprimées ; les sauvegardes manuelles ne le sont jamais."""
    if (db.get_param("sauvegarde_auto") or "1") != "1":
        return None
    now = maintenant or datetime.now()
    try:
        heures = float(db.get_param("sauvegarde_frequence_heures") or 24)
        garder = max(1, int(float(db.get_param("sauvegarde_conserver") or 20)))
    except ValueError:
        heures, garder = 24.0, 20
    derniere = db.meta("derniere_sauvegarde_auto")
    if derniere and (now - datetime.fromisoformat(derniere)).total_seconds() < heures * 3600:
        return None
    if not db.scalar("SELECT COUNT(*) FROM annee_scolaire"):
        return None                       # base vide : rien à protéger
    out = sauvegarde_auto(db, "automatique")
    db.set_meta("derniere_sauvegarde_auto", now.isoformat(timespec="seconds"))
    autos = sorted(dossier(db).glob(f"{PREFIXE}*_automatique*{EXTENSION}"), reverse=True)
    for f in autos[garder:]:
        try:
            f.unlink()
        except OSError:
            pass
    return out
