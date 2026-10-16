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

SCHEMA_VERSION = 10


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
        try:
            cur = self.conn.execute(sql, params)
        except sqlite3.Error as e:
            if self._tx_depth == 0 and self.conn.in_transaction:
                self.conn.rollback()            # pas de transaction implicite laissée ouverte
            if _MSG_CLOTUREE in str(e):
                raise AnneeCloturee() from None
            raise
        if self._tx_depth == 0:
            self.conn.commit()
        return cur

    def executemany(self, sql: str, seq) -> sqlite3.Cursor:
        try:
            cur = self.conn.executemany(sql, seq)
        except sqlite3.Error as e:
            if self._tx_depth == 0 and self.conn.in_transaction:
                self.conn.rollback()            # pas de transaction implicite laissée ouverte
            if _MSG_CLOTUREE in str(e):
                raise AnneeCloturee() from None
            raise
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

# Année clôturée (archivée) : toute écriture dans ses données est refusée par la base elle-même,
# quel que soit le chemin (interface, import, script).
_PAR_ANNEE = ["grille_notes", "classe", "evaluation", "jours_classe", "inscription", "affectation",
              "absence_eleve", "absence_personnel", "texte_rapport", "autorisation_absence", "conge"]
_PAR_INSCRIPTION = ["presence_eval", "note", "decision_fin_annee"]
_MSG_CLOTUREE = "ANNEE_CLOTUREE"


def _archive_triggers() -> list[str]:
    def cond(x: str, table: str) -> str:
        if table in _PAR_ANNEE:
            return f"(SELECT cloturee FROM annee_scolaire WHERE id = {x}.annee_id) = 1"
        if table in _PAR_INSCRIPTION:
            return (f"(SELECT a.cloturee FROM inscription i JOIN annee_scolaire a ON a.id = i.annee_id "
                    f"WHERE i.id = {x}.inscription_id) = 1")
        return (f"(SELECT a.cloturee FROM grille_notes g JOIN annee_scolaire a ON a.id = g.annee_id "
                f"WHERE g.id = {x}.grille_id) = 1")       # matiere
    out = []
    for table in _PAR_ANNEE + _PAR_INSCRIPTION + ["matiere"]:
        for op, quand in (("INSERT", cond("NEW", table)), ("DELETE", cond("OLD", table)),
                          ("UPDATE", f"{cond('OLD', table)} OR {cond('NEW', table)}")):
            out.append(f"CREATE TRIGGER IF NOT EXISTS archive_{table}_{op.lower()} BEFORE {op} ON {table} "
                       f"WHEN {quand} BEGIN SELECT RAISE(ABORT, '{_MSG_CLOTUREE}'); END")
    out.append("CREATE TRIGGER IF NOT EXISTS archive_annee_delete BEFORE DELETE ON annee_scolaire "
               f"WHEN OLD.cloturee = 1 BEGIN SELECT RAISE(ABORT, '{_MSG_CLOTUREE}'); END")
    out.append("CREATE TRIGGER IF NOT EXISTS archive_annee_update BEFORE UPDATE ON annee_scolaire "
               "WHEN OLD.cloturee = 1 AND NEW.cloturee = 1 AND (NEW.libelle IS NOT OLD.libelle OR "
               "NEW.date_debut IS NOT OLD.date_debut OR NEW.date_fin IS NOT OLD.date_fin OR "
               "NEW.date_edition IS NOT OLD.date_edition OR NEW.date_ref_age IS NOT OLD.date_ref_age OR "
               "NEW.nouveaux_cp1 IS NOT OLD.nouveaux_cp1) "
               f"BEGIN SELECT RAISE(ABORT, '{_MSG_CLOTUREE}'); END")
    return out


class AnneeCloturee(ValueError):
    """Écriture refusée : l'année scolaire concernée est clôturée (archivée en lecture seule)."""

    def __init__(self):
        super().__init__("Cette année scolaire est clôturée : ses données sont archivées en lecture seule. "
                         "Un administrateur peut la rouvrir depuis Paramètres › Années scolaires.")


_DECISION_SQL = [
    """CREATE TABLE IF NOT EXISTS decision_fin_annee (
        inscription_id INTEGER PRIMARY KEY REFERENCES inscription(id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('ADMIS', 'REDOUBLE', 'ABANDON', 'EXCLU', 'TRANSFERE')),
        decision_calculee TEXT,
        motif TEXT,
        valide_par TEXT NOT NULL,
        valide_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')))""",
]

_AUTORISATION_TABLE = """CREATE TABLE IF NOT EXISTS autorisation_absence (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('eleve', 'personnel')),
    personnel_id INTEGER REFERENCES personnel(id) ON DELETE CASCADE,
    inscription_id INTEGER REFERENCES inscription(id) ON DELETE CASCADE,
    date_demande TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    demi_journee TEXT,
    jours REAL NOT NULL,
    motif TEXT NOT NULL,
    precisions TEXT,
    lieu TEXT,
    contact TEXT,
    interim TEXT,
    demandeur TEXT,
    statut TEXT NOT NULL DEFAULT 'EN_ATTENTE' CHECK (statut IN ('EN_ATTENTE', 'ACCORDEE', 'REFUSEE')),
    avis TEXT,
    decide_par TEXT,
    decide_le TEXT,
    cree_par TEXT,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (annee_id, numero),
    CHECK ((kind = 'eleve' AND inscription_id IS NOT NULL) OR (kind = 'personnel' AND personnel_id IS NOT NULL))
)"""

def _ajouter_colonne(table: str, colonne: str, definition: str):
    """Étape de migration : ajoute une colonne si elle n'existe pas encore."""
    def etape(conn: sqlite3.Connection) -> None:
        if colonne not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {colonne} {definition}")
    return etape


_AUTORISATION_SQL = [
    _AUTORISATION_TABLE,
    _ajouter_colonne("absence_eleve", "autorisation_id",
                     "INTEGER REFERENCES autorisation_absence(id) ON DELETE CASCADE"),
    _ajouter_colonne("absence_personnel", "autorisation_id",
                     "INTEGER REFERENCES autorisation_absence(id) ON DELETE CASCADE"),
]

_CONGE_SQL = [
    """CREATE TABLE IF NOT EXISTS conge (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'FERIE' CHECK (type IN ('FERIE', 'VACANCES', 'AUTRE')),
    libelle TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    CHECK (date_fin >= date_debut)
)""",
    "CREATE INDEX IF NOT EXISTS idx_conge_annee ON conge(annee_id, date_debut)",
]

def _motifs_absence_v6(conn: sqlite3.Connection) -> None:
    """Motifs d'absence : « Travaux champêtres » retiré, « Opération bancaire » et « Congé de maternité »
    ajoutés avant « Autre » (les absences déjà saisies gardent leur motif)."""
    if not conn.execute("SELECT 1 FROM liste_valeur WHERE liste='MOTIF_ABSENCE'").fetchone():
        return
    conn.execute("DELETE FROM liste_valeur WHERE liste='MOTIF_ABSENCE' AND valeur='Travaux champêtres'")
    for v in ("Opération bancaire", "Congé de maternité"):
        conn.execute("INSERT OR IGNORE INTO liste_valeur(liste, valeur, ordre) VALUES('MOTIF_ABSENCE', ?, "
                     "(SELECT COALESCE(MAX(ordre), 0) + 1 FROM liste_valeur WHERE liste='MOTIF_ABSENCE'))", (v,))
    conn.execute("UPDATE liste_valeur SET ordre=(SELECT MAX(ordre) + 1 FROM liste_valeur WHERE liste='MOTIF_ABSENCE') "
                 "WHERE liste='MOTIF_ABSENCE' AND valeur='Autre'")


def _ministere_v7(conn: sqlite3.Connection) -> None:
    """Nom actuel du ministère (fiche scolaire de l'école), sauf s'il a été personnalisé."""
    from epp.core import seed
    conn.execute("UPDATE parametre SET valeur=? WHERE cle='ministere' AND valeur=?",
                 (seed.MINISTERE_DEFAUT, seed.ANCIEN_MINISTERE))


_APPAREIL_SQL = [
    """CREATE TABLE IF NOT EXISTS appareil (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    cle TEXT NOT NULL,
    dernier_seq INTEGER NOT NULL DEFAULT 0,
    actif INTEGER NOT NULL DEFAULT 1,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    cree_par TEXT,
    dernier_contact TEXT
)""",
    """CREATE TABLE IF NOT EXISTS synchro_op (
    uid TEXT PRIMARY KEY,
    appareil_id INTEGER NOT NULL REFERENCES appareil(id) ON DELETE CASCADE,
    recu_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    resultat TEXT NOT NULL
)""",
]


_ENSEIGNANT_SQL = [
    """CREATE TABLE IF NOT EXISTS appel (
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    classe_code TEXT NOT NULL,
    date TEXT NOT NULL,
    absents INTEGER NOT NULL DEFAULT 0,
    presents INTEGER NOT NULL DEFAULT 0,
    fait_par TEXT,
    fait_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (annee_id, classe_code, date)
)""",
    """CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    auteur TEXT NOT NULL,
    destinataire_id INTEGER REFERENCES utilisateur(id) ON DELETE CASCADE,
    titre TEXT NOT NULL,
    texte TEXT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS message_lu (
    message_id INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    lu_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (message_id, utilisateur_id)
)""",
    """CREATE TRIGGER IF NOT EXISTS personnel_inactif_comptes AFTER UPDATE OF actif ON personnel WHEN NEW.actif=0
BEGIN
    UPDATE appareil SET actif=0 WHERE utilisateur_id IN (SELECT id FROM utilisateur WHERE personnel_id=NEW.id);
    UPDATE utilisateur SET actif=0 WHERE personnel_id=NEW.id;
END""",
    """CREATE TRIGGER IF NOT EXISTS personnel_suppr_comptes BEFORE DELETE ON personnel
BEGIN
    UPDATE appareil SET actif=0 WHERE utilisateur_id IN (SELECT id FROM utilisateur WHERE personnel_id=OLD.id);
    UPDATE utilisateur SET actif=0 WHERE personnel_id=OLD.id;
END""",
]


MIGRATIONS: dict[int, list] = {           # instruction SQL ou fonction(connexion)
    2: _PHOTO_SQL,          # photos des élèves et du personnel
    3: _DECISION_SQL + _archive_triggers(),   # décisions de fin d'année, années clôturées en lecture seule
    4: _AUTORISATION_SQL + _archive_triggers(),   # demandes d'autorisation d'absence liées aux absences
    5: _CONGE_SQL + _archive_triggers(),          # jours fériés et vacances (non comptés comme jours de classe)
    6: [_motifs_absence_v6],                      # nouveaux motifs d'autorisation d'absence
    7: [_ajouter_colonne("eleve", "groupe_sanguin", "TEXT"),   # fiche scolaire : santé de l'élève
        _ajouter_colonne("eleve", "allergies", "TEXT"), _ministere_v7],
    8: _APPAREIL_SQL,                             # téléphones associés (application Android)
    9: [_ajouter_colonne("utilisateur", "personnel_id", "INTEGER REFERENCES personnel(id) ON DELETE SET NULL"),
        _ajouter_colonne("note", "en_attente", "INTEGER NOT NULL DEFAULT 0"),
        _ajouter_colonne("note", "saisi_par", "TEXT"),
        _ajouter_colonne("evaluation", "saisie_fermee", "INTEGER NOT NULL DEFAULT 0"),
        _ajouter_colonne("evaluation", "fin_saisie", "TEXT")] + _ENSEIGNANT_SQL,   # accès des enseignants
    10: [_ajouter_colonne("utilisateur", "secours_hash", "TEXT")],   # code de secours (mot de passe oublié)
}


def open_database(path: str | Path | None = None, seed: bool = True) -> Database:
    """Ouvre (et crée ou met à niveau si besoin) la base de données."""
    path = Path(path) if path else paths.db_path()
    existed = path.exists() and path.stat().st_size > 0
    db = Database(path)
    if not existed:
        db.conn.executescript(_schema_sql())
        for stmt in _archive_triggers():
            db.conn.execute(stmt)
        db.set_meta("schema_version", SCHEMA_VERSION)
        db.set_meta("cree_le", datetime.now().isoformat(timespec="seconds"))
        db.set_meta("app_version", __version__)
        if seed:
            from epp.core import seed as seed_mod
            seed_mod.seed_database(db)
    else:
        migrate(db)
        if seed:
            from epp.core import seed as seed_mod
            from epp.reports import store
            from epp.core import security
            seed_mod.ensure_params(db)              # nouveaux paramètres livrés avec une mise à jour
            security.ensure_roles(db)               # nouvelles permissions livrées avec une mise à jour
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
        for stmt in _archive_triggers():
            db.conn.execute(stmt)
        db.conn.commit()
        return
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    shutil.copy2(db.path, paths.backups_dir() / f"avant_migration_v{current}_{stamp}.db")
    with db.transaction():
        for version in range(current + 1, SCHEMA_VERSION + 1):
            for stmt in MIGRATIONS.get(version, []):
                stmt(db.conn) if callable(stmt) else db.conn.execute(stmt)
        db.conn.execute(
            "INSERT INTO meta(cle, valeur) VALUES('schema_version', ?) "
            "ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur",
            (str(SCHEMA_VERSION),),
        )
    db.set_meta("app_version", __version__)
