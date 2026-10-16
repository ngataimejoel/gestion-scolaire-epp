"""Emplacements des fichiers de l'application.

Les données ne sont jamais stockées dans le dossier d'installation :
- Windows : %LOCALAPPDATA%\\GestionScolaireEPP
- autres systèmes : ~/.local/share/GestionScolaireEPP
La variable d'environnement EPP_DATA_DIR permet de choisir un autre dossier
(tests, installation portable).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from epp import APP_ID


def data_dir() -> Path:
    override = os.environ.get("EPP_DATA_DIR")
    if override:
        base = Path(override)
    elif sys.platform.startswith("win"):
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / APP_ID
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / APP_ID
    base.mkdir(parents=True, exist_ok=True)
    return base


def db_path() -> Path:
    return data_dir() / "epp.db"


def backups_dir() -> Path:
    p = data_dir() / "sauvegardes"
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs_dir() -> Path:
    p = data_dir() / "journaux"
    p.mkdir(parents=True, exist_ok=True)
    return p


def exports_dir() -> Path:
    p = Path.home() / "Documents" / "GESTION SCOLAIRE EPP"
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError:
        p = data_dir() / "exports"
        p.mkdir(parents=True, exist_ok=True)
    return p


def resource_path(*parts: str) -> Path:
    """Chemin d'une ressource embarquée (fonctionne aussi dans l'exécutable PyInstaller)."""
    frozen = getattr(sys, "_MEIPASS", None)
    base = Path(frozen) / "epp" if frozen else Path(__file__).resolve().parent.parent
    return base.joinpath(*parts)
