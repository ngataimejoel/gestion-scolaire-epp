"""Point d'entrée de GESTION SCOLAIRE EPP EXPERT.

    GestionScolaireEPP.exe              lance l'interface
    GestionScolaireEPP.exe --selftest   vérifie l'installation sans interface (code de sortie 0 = OK)
    GestionScolaireEPP.exe --version    affiche la version
"""
from __future__ import annotations

import argparse
import logging
import sys
import tempfile
import traceback
from pathlib import Path

from epp import APP_NAME, __version__


def _logging() -> None:
    from epp.core import paths
    logging.basicConfig(filename=str(paths.logs_dir() / "application.log"), level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s : %(message)s", encoding="utf-8")


def selftest(out=sys.stdout) -> int:
    """Contrôle de bon fonctionnement après installation : base, calculs, modèles, PDF, Excel, Qt.
    N'écrit que dans un dossier temporaire (les données de l'utilisateur ne sont pas touchées)."""
    import os
    etapes = []

    def ok(msg):
        etapes.append(msg)
        print(f"[OK] {msg}", file=out)

    try:
        with tempfile.TemporaryDirectory(prefix="epp_selftest_") as tmp:
            os.environ["EPP_DATA_DIR"] = tmp
            os.environ["EPP_ESSAI_SECONDAIRE"] = str(Path(tmp) / "essai_secondaire.json")  # essai réel intact
            from epp.core.db import open_database
            from epp.core import security
            db = open_database(Path(tmp) / "selftest.sqlite")
            assert db.integrity_ok()
            ok("base de données créée et intègre")
            security.create_user(db, "admin", "Administrateur", "MotDePasse!2026", "ADMIN")
            stored = db.scalar("SELECT hash FROM utilisateur WHERE login='admin'")
            assert stored.startswith("pbkdf2_sha256$") and "MotDePasse" not in stored
            assert security.authenticate(db, "admin", "MotDePasse!2026") is not None
            assert security.authenticate(db, "admin", "mauvais") is None
            ok("mot de passe haché (PBKDF2-SHA256) et vérifié")
            from epp.domain import calculs
            assert calculs.xround(2.675, 2) == 2.68 and calculs.xround(0.125, 2) == 0.13
            ok("arrondi identique à Excel")
            from epp.core import seed
            from epp.reports import service, store
            seed.create_year(db, "2026-2027")
            annee = service.annee_courante(db)
            s = security.system_session()
            n = 0
            for m in store.lister(db):
                p = {"mois": 10, "compo": 1, "classe": annee.codes[0]} if m["code"] in (
                    "MENSUEL", "COMPOSITION", "FEUILLE_NOTES") else {}
                service.generer(db, s, annee, m["code"], p, Path(tmp) / f"{m['code']}.pdf")
                n += 1
            service.generer(db, s, annee, "SYNTHESE", {}, Path(tmp) / "synthese.xlsx")
            service.generer(db, s, annee, "SYNTHESE", {}, Path(tmp) / "synthese.docx")
            ok(f"{n} modèles de rapports générés en PDF, exports Excel et Word OK")
            db.close()
            import base64
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from epp.core import licence
            k = Ed25519PrivateKey.generate()
            pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                              serialization.PublicFormat.Raw)).decode()
            m = licence.empreinte_machine()
            lic = base64.urlsafe_b64encode(f'{{"machine": "{m}"}}'.encode()).decode().rstrip("=")
            sig = base64.urlsafe_b64encode(k.sign(base64.urlsafe_b64decode(lic + "=="))).decode().rstrip("=")
            assert licence.verifier(lic, sig, pub, m) and not licence.verifier(lic, sig[:-4] + "AAAA", pub, m)
            assert licence.etat().statut in ("essai", "active", "essai_termine", "expiree")
            ok("contrôle de licence (signature Ed25519) opérationnel")
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from PySide6.QtWidgets import QApplication
        app = QApplication.instance() or QApplication([])
        from PySide6.QtPdf import QPdfDocument   # noqa: F401  (aperçu des rapports)
        ok(f"Qt {__import__('PySide6').__version__} disponible")
        app.quit()
    except Exception:
        traceback.print_exc(file=out)
        print(f"[ÉCHEC] après : {', '.join(etapes) or 'aucune étape'}", file=out)
        return 1
    print(f"{APP_NAME} {__version__} : auto-test réussi ({len(etapes)} étapes).", file=out)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="GestionScolaireEPP", description=APP_NAME)
    ap.add_argument("--selftest", action="store_true", help="vérifie l'installation et quitte")
    ap.add_argument("--version", action="store_true", help="affiche la version et quitte")
    ap.add_argument("--rapport", metavar="FICHIER", help="écrit le résultat de --selftest dans ce fichier")
    args, qt_args = ap.parse_known_args(argv)
    if args.version:
        print(f"{APP_NAME} {__version__}")
        return 0
    if args.selftest:
        if args.rapport:   # l'exécutable fenêtré n'a pas de console : résultat dans un fichier
            with open(args.rapport, "w", encoding="utf-8") as f:
                return selftest(f)
        return selftest(sys.stdout or open(Path(tempfile.gettempdir()) / "epp_selftest.txt", "w", encoding="utf-8"))
    _logging()
    try:
        from epp.ui.main import run
    except ImportError:
        from PySide6.QtWidgets import QApplication, QMessageBox
        app = QApplication(sys.argv[:1] + qt_args)
        QMessageBox.information(None, APP_NAME, "L'interface graphique est en cours de développement.")
        return 0
    return run(sys.argv[:1] + qt_args)


if __name__ == "__main__":
    sys.exit(main())
