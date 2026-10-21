"""Point d'entrée d'AKWA SCHOOL v8 : l'application à l'interface du prototype HTML v8.

    AkwaSchoolV8.exe              lance l'application
    AkwaSchoolV8.exe --selftest   vérifie l'installation sans interface (code de sortie 0 = OK)
    AkwaSchoolV8.exe --version    affiche la version
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
import traceback
from pathlib import Path

from epp import __version__

NOM = "AKWA SCHOOL v8"
log = logging.getLogger(__name__)


def selftest(out=sys.stdout) -> int:
    etapes = []

    def ok(msg):
        etapes.append(msg)
        print(f"[OK] {msg}", file=out)

    try:
        with tempfile.TemporaryDirectory(prefix="akwa_v8_selftest_") as tmp:
            os.environ["EPP_DATA_DIR"] = tmp
            os.environ["EPP_ESSAI_SECONDAIRE"] = str(Path(tmp) / "essai_secondaire.json")
            from epp.v8.stockage import ADMIN, Stockage
            st = Stockage(Path(tmp) / "akwa.sqlite")
            code = st.creer_admin("MotDePasse!2026")
            assert st.authentifier(ADMIN, "MotDePasse!2026")["role"] == "dir"
            assert st.recuperer(ADMIN, code, "Nouveau!2026") != code
            st.ecrire('{"school":{"name":"EPP","adminPwd":"x"},"students":[],"teachers":[]}')
            assert st.lire()["school"] == {"name": "EPP"}
            st.close()
            ok("données et comptes (mots de passe hachés, code de secours) opérationnels")
            from epp.core import licence
            from epp.v8.page import page_html
            from epp.v8.stockage import licence_pour_page
            html = page_html(None, {"role": "dir"}, licence_pour_page(licence.etat()))
            assert "window.APP_DATA=" in html and "APP.charger()" in html and "QWebChannel" in html
            ok("interface v8 et pont embarqués")
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication([])
        from PySide6.QtWebChannel import QWebChannel  # noqa: F401
        from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: F401
        from epp.v8 import connexion  # noqa: F401
        ok(f"Qt {__import__('PySide6').__version__} et moteur web disponibles")
        app.quit()
    except Exception:
        traceback.print_exc(file=out)
        print(f"[ÉCHEC] après : {', '.join(etapes) or 'aucune étape'}", file=out)
        return 1
    print(f"{NOM} {__version__} : auto-test réussi ({len(etapes)} étapes).", file=out)
    return 0


def run(argv: list[str]) -> int:
    from PySide6.QtCore import Qt
    from PySide6.QtWebEngineCore import QWebEngineUrlScheme  # noqa: F401 — moteur web initialisé avant l'application
    from PySide6.QtWidgets import QApplication, QMessageBox
    QApplication.setAttribute(Qt.AA_ShareOpenGLContexts)
    app = QApplication.instance() or QApplication(argv)
    app.setApplicationName(NOM)
    app.setApplicationVersion(__version__)
    app.setOrganizationName("GestionScolaireEPP")
    app.setQuitOnLastWindowClosed(False)
    from epp.core import licence
    from epp.ui import logo as logo_app
    from epp.ui.dialogs.acces import DialogueActivation
    from epp.ui.main import appliquer_theme
    from epp.v8.connexion import ouvrir_session
    from epp.v8.fenetre import Fenetre
    licence.controler_en_arriere_plan()          # code hors ligne : contrôle a posteriori dès qu'Internet est là
    from epp.v8.stockage import Stockage
    app.setWindowIcon(logo_app.icone())
    appliquer_theme(app)
    try:
        st = Stockage()
    except Exception as e:      # noqa: BLE001
        log.exception("Ouverture des données impossible")
        QMessageBox.critical(None, NOM, f"Les données ne peuvent pas être ouvertes :\n{e}")
        return 1
    try:
        while True:
            etat = licence.etat()
            espace = "enseignant" if st.solo() else "ecole"
            while licence.verrouillee(etat):
                if not DialogueActivation(None, bloquant=True, espace=espace).exec():
                    return 0
                etat = licence.etat()
            session = ouvrir_session(st)
            if session is None:
                return 0
            # une licence enseignant n'ouvre que l'espace enseignant seul, jamais celui du directeur
            while session["role"] == "dir" and (etat.type or "").startswith("ens"):
                QMessageBox.information(None, NOM, "Cet ordinateur a une licence enseignant : l'espace du directeur "
                                                   "demande un code école.")
                if not DialogueActivation(None, bloquant=True).exec():
                    return 0
                etat = licence.etat()
            win = Fenetre(st, session, etat)
            win.show()
            app.exec()
            if win.action_fin != "deconnexion":
                return 0
    finally:
        st.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="AkwaSchoolV8", description=NOM)
    ap.add_argument("--selftest", action="store_true", help="vérifie l'installation et quitte")
    ap.add_argument("--version", action="store_true", help="affiche la version et quitte")
    ap.add_argument("--rapport", metavar="FICHIER", help="écrit le résultat de --selftest dans ce fichier")
    args, qt_args = ap.parse_known_args(argv)
    if args.version:
        print(f"{NOM} {__version__}")
        return 0
    if args.selftest:
        if args.rapport:
            with open(args.rapport, "w", encoding="utf-8") as f:
                return selftest(f)
        return selftest(sys.stdout or open(Path(tempfile.gettempdir()) / "akwa_v8_selftest.txt", "w", encoding="utf-8"))
    from epp.core import paths
    logging.basicConfig(filename=str(paths.logs_dir() / "application_v8.log"), level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s : %(message)s", encoding="utf-8")
    return run(sys.argv[:1] + qt_args)


if __name__ == "__main__":
    sys.exit(main())
