"""Injecte, masqué, le secret des codes hors ligne courts dans l'application Windows (epp/resources/ac.dat).

La CI l'appelle avant PyInstaller avec le secret GitHub AKWA_CLES_CODES_COURTS (« 1:base64 », donné par le bouton
« Clé pour GitHub » du générateur hors ligne). Le fichier n'est jamais versionné.
    python outils/injecter_cles_courtes.py [--exiger]
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from epp.core import hors_ligne  # noqa: E402

CIBLE = Path(__file__).resolve().parents[1] / "epp" / "resources" / "ac.dat"


def main() -> int:
    cles = hors_ligne.lire_cles_courtes(os.environ.get("AKWA_CLES_CODES_COURTS", ""))
    if not cles:
        msg = "Secret AKWA_CLES_CODES_COURTS absent ou illisible : les codes hors ligne de 25 caractères seront refusés."
        print(("::error::" if "--exiger" in sys.argv else "::warning::") + msg)
        return 1 if "--exiger" in sys.argv else 0
    CIBLE.write_text(hors_ligne.ecrire_cles_courtes(cles, masquees=True), encoding="ascii")
    print(f"clé(s) n° {', '.join(map(str, cles))} injectée(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
