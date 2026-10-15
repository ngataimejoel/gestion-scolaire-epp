# -*- mode: python ; coding: utf-8 -*-
# PyInstaller : pyinstaller packaging/gestion_scolaire.spec  (depuis le dossier epp-expert)
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent
APP = "GestionScolaireEPP"
# tous les modules de l'application (les pages de l'interface sont chargées à la demande)
MODULES = [".".join(p.relative_to(ROOT).with_suffix("").parts).removesuffix(".__init__")
           for p in (ROOT / "epp").rglob("*.py")]

a = Analysis(
    [str(ROOT / "packaging" / "lanceur.py")],
    pathex=[str(ROOT)],
    datas=[
        (str(ROOT / "epp" / "core" / "schema.sql"), "epp/core"),
        (str(ROOT / "epp" / "resources"), "epp/resources"),
        *collect_data_files("docx"),                 # modèle Word de base de python-docx
    ],
    # reportlab.graphics.barcode charge ses modules dynamiquement (code QR de la fiche scolaire)
    hiddenimports=[*MODULES, *collect_submodules("reportlab.graphics.barcode"), "PySide6.QtSvg",
                   "PySide6.QtPdf", "PySide6.QtPdfWidgets", "PySide6.QtMultimedia",
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
