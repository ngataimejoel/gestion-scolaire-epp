"""Fixtures communes : base temporaire, base importée depuis le classeur source."""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SOURCE = Path(os.environ.get("EPP_SOURCE_XLSM", ROOT / "tests" / "data" / "classeur_source.xlsm"))


@pytest.fixture(autouse=True)
def _data_dir(tmp_path, monkeypatch):
    """Chaque test travaille dans un dossier de données isolé."""
    monkeypatch.setenv("EPP_DATA_DIR", str(tmp_path / "data"))
    yield


@pytest.fixture
def db(tmp_path):
    from epp.core.db import open_database
    d = open_database(tmp_path / "vide.sqlite")
    yield d
    d.close()


@pytest.fixture(scope="session")
def _imported_file(tmp_path_factory):
    if not SOURCE.exists():
        pytest.skip(f"Classeur source absent : {SOURCE}")
    base = tmp_path_factory.mktemp("import")
    os.environ["EPP_DATA_DIR"] = str(base / "data")
    from epp.core.db import open_database
    from epp.core.security import system_session
    from epp.io.import_excel import import_workbook
    path = base / "importee.sqlite"
    d = open_database(path)
    rep = import_workbook(d, system_session(), SOURCE)
    d.close()
    return path, rep


@pytest.fixture
def idb(_imported_file, tmp_path):
    """Copie modifiable de la base importée depuis le classeur."""
    from epp.core.db import open_database
    src, _ = _imported_file
    dst = tmp_path / "base.sqlite"
    shutil.copy(src, dst)
    d = open_database(dst)
    yield d
    d.close()


@pytest.fixture
def annee(idb):
    from epp.domain import repo
    return repo.load_annee(idb, repo.active_annee_id(idb))


@pytest.fixture(scope="session")
def excel():
    """Valeurs calculées par Excel (cache du classeur, lecture seule)."""
    if not SOURCE.exists():
        pytest.skip(f"Classeur source absent : {SOURCE}")
    from openpyxl import load_workbook
    return load_workbook(SOURCE, data_only=True, read_only=False, keep_vba=False)


@pytest.fixture
def demo(tmp_path):
    """Base remplie avec l'école de démonstration fictive (disponible partout, y compris en CI)."""
    from epp.core.db import open_database
    from epp.core.security import system_session
    from epp.demo import creer_ecole_demo
    d = open_database(tmp_path / "demo.sqlite")
    annee = creer_ecole_demo(d, system_session())
    yield d, annee
    d.close()
