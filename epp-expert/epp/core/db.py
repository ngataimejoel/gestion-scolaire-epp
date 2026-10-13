"""Accès à la base SQLite : connexion, création, migrations."""
from __future__ import annotations

import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from epp import __version__
from epp.core import paths

SCHEMA_VERSION = 2


class Database:
    """Fine enveloppe autour de sqlite3 (une connexion par application)."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), detect_types=0, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self._tx_depth = 0

    # ------------------------------------------------------------------ requêtes
    def execute(self, sql: str, params: Iterable[Any] | dict = ()) -> sqlite3.Cursor:
        cur = self.conn.execute(sql, params)
        if self._tx_depth == 0:
            self.conn.commit()
        return cur

    def executemany(self, sql: str, seq) -> sqlite3.Cursor:
        cur = self.conn.executemany(sql, seq)
        if self._tx_depth == 0:
            self.conn.commit()
        return cur

    def query(self, sql: str, params: Iterable[Any] | dict = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, params).fetchall()

    def one(self, sql: str, params: Iterable[Any] | dict = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, params).fetchone()

    def scalar(self, sql: str, params: Iterable[Any] | dict = (), default=None):
        row = self.conn.execute(sql, params).fetchone()
        return default if row is None or row[0] is None else row[0]

    @contextmanager
    def transaction(self):
        """Transaction imbriquable : tout ou rien."""
        if self._tx_depth == 0:
            self.conn.execute("BEGIN")
        self._tx_depth += 1
        try:
            yield self
        except Exception:
            self._tx_depth -= 1
            if self._tx_depth == 0:
                self.conn.rollback()
            raise
        else:
            self._tx_depth -= 1
            if self._tx_depth == 0:
                self.conn.commit()

    def close(self):
        try:
            self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        self.conn.close()

    # ------------------------------------------------------------------ paramètres
    def get_param(self, cle: str, default: str | None = None) -> str | None:
        v = self.scalar("SELECT valeur FROM parametre WHERE cle=?", (cle,))
        return default if v is None else v

    def set_param(self, cle: str, valeur) -> None:
        self.execute(
            "INSERT INTO parametre(cle, valeur) VALUES(?, ?) "
            "ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur",
            (cle, None if valeur is None else str(valeur)),
        )

    def meta(self, cle: str) -> str | None:
        return self.scalar("SELECT valeur FROM meta WHERE cle=?", (cle,))

    def set_meta(self, cle: str, valeur) -> None:
        self.execute(
            "INSERT INTO meta(cle, valeur) VALUES(?, ?) ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur",
            (cle, str(valeur)),
        )

    def integrity_ok(self) -> bool:
        return self.scalar("PRAGMA integrity_check") == "ok"


def _schema_sql() -> str:
    return (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8")


# Migrations successives : {version_cible: [instructions SQL]}.
# Pour faire évoluer le schéma, ajouter une entrée SCHEMA_VERSION + 1 ici.
_PHOTO_SQL = [
    """CREATE TABLE IF NOT EXISTS photo (
        kind TEXT NOT NULL CHECK (kind IN ('eleve', 'personnel')),
        ref_id INTEGER NOT NULL,
        data BLOB NOT NULL,
        mime TEXT NOT NULL DEFAULT 'image/jpeg',
        modifie_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        PRIMARY KEY (kind, ref_id))""",
    """CREATE TRIGGER IF NOT EXISTS photo_eleve_suppr AFTER DELETE ON eleve
        BEGIN DELETE FROM photo WHERE kind='eleve' AND ref_id=OLD.id; END""",
    """CREATE TRIGGER IF NOT EXISTS photo_personnel_suppr AFTER DELETE ON personnel
        BEGIN DELETE FROM photo WHERE kind='personnel' AND ref_id=OLD.id; END""",
]

MIGRATIONS: dict[int, list[str]] = {
    2: _PHOTO_SQL,          # photos des élèves et du personnel
}


def open_database(path: str | Path | None = None, seed: bool = True) -> Database:
    """Ouvre (et crée ou met à niveau si besoin) la base de données."""
    path = Path(path) if path else paths.db_path()
    existed = path.exists() and path.stat().st_size > 0
    db = Database(path)
    if not existed:
        db.conn.executescript(_schema_sql())
        db.set_meta("schema_version", SCHEMA_VERSION)
        db.set_meta("cree_le", datetime.now().isoformat(timespec="seconds"))
        db.set_meta("app_version", __version__)
        if seed:
            from epp.core import seed as seed_mod
            seed_mod.seed_database(db)
    else:
        migrate(db)
        if seed:
            from epp.reports import store
            store.install_builtin_templates(db)   # nouveaux modèles livrés avec une mise à jour
    return db


def migrate(db: Database) -> None:
    """Met la base à niveau ; une copie de sécurité est faite avant toute migration."""
    current = int(db.meta("schema_version") or 0)
    if current > SCHEMA_VERSION:
        raise RuntimeError(
            f"La base de données (version {current}) est plus récente que l'application "
            f"(version {SCHEMA_VERSION}). Installez la dernière version du programme."
        )
    if current == SCHEMA_VERSION:
        db.conn.executescript(_schema_sql())  # crée d'éventuelles tables manquantes
        return
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    shutil.copy2(db.path, paths.backups_dir() / f"avant_migration_v{current}_{stamp}.db")
    with db.transaction():
        for version in range(current + 1, SCHEMA_VERSION + 1):
            for stmt in MIGRATIONS.get(version, []):
                db.conn.execute(stmt)
        db.conn.execute(
            "INSERT INTO meta(cle, valeur) VALUES('schema_version', ?) "
            "ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur",
            (str(SCHEMA_VERSION),),
        )
    db.set_meta("app_version", __version__)
