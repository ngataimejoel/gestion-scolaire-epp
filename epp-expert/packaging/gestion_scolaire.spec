# -*- mode: python ; coding: utf-8 -*-
# PyInstaller : pyinstaller packaging/gestion_scolaire.spec  (depuis le dossier epp-expert)
from pathlib import Path

ROOT = Path(SPECPATH).parent
APP = "GestionScolaireEPP"

a = Analysis(
    [str(ROOT / "packaging" / "lanceur.py")],
    pathex=[str(ROOT)],
    datas=[
        (str(ROOT / "epp" / "core" / "schema.sql"), "epp/core"),
        (str(ROOT / "epp" / "resources"), "epp/resources"),
    ],
    hiddenimports=["epp.ui.main", "PySide6.QtPdf", "PySide6.QtPdfWidgets", "PySide6.QtMultimedia",
                   "PySide6.QtMultimediaWidgets", "PySide6.QtCharts", "PySide6.QtPrintSupport"],
    excludes=["tkinter", "pandas", "numpy", "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
              "PySide6.Qt3DCore", "PySide6.QtQuick3D", "PySide6.QtDesigner"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name=APP,
    console=False, icon=str(ROOT / "epp" / "resources" / "app.ico") if (ROOT / "epp" / "resources" / "app.ico").exists() else None,
    version=str(ROOT / "packaging" / "version_info.txt"),
)
coll = COLLECT(exe, a.binaries, a.datas, name=APP)
