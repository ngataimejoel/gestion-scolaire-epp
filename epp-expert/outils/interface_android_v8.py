"""Copie l'interface v8 (celle d'AKWA SCHOOL v8 sous Windows) dans l'application Android.

    python outils/interface_android_v8.py

Écrit android/app/src/main/assets/www/index.html : epp/resources/web/akwa_v8.html à l'identique (écrans, menus,
sous-menus, couleurs), précédé du pont avec le téléphone (assets/www/pont_android.js) et avec les seules mentions
« ordinateur » devenues « téléphone ». À relancer après toute modification de akwa_v8.html (un test le vérifie).
"""
from __future__ import annotations

from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "epp" / "resources" / "web" / "akwa_v8.html"
FICHIER = RACINE / "android" / "app" / "src" / "main" / "assets" / "www" / "index.html"

REMPLACEMENTS = [
    ("<head>", '<head>\n<script src="pont_android.js"></script>'),
    ("window.APP?'Vos données restent sur cet ordinateur, enregistrées automatiquement par l’application. "
     "Sauvegardez-les régulièrement sur une clé USB.'",
     "window.APP?'Vos données restent sur ce téléphone, enregistrées automatiquement par l’application. "
     "Sauvegardez-les régulièrement et envoyez la sauvegarde sur l’ordinateur (AKWA SCHOOL v8).'"),
]


def contenu() -> str:
    page = SOURCE.read_text(encoding="utf-8")
    for avant, apres in REMPLACEMENTS:
        n = page.count(avant)
        if n != 1:
            raise SystemExit(f"Motif trouvé {n} fois (1 attendu) : {avant[:70]!r}")
        page = page.replace(avant, apres)
    return page


if __name__ == "__main__":
    FICHIER.write_text(contenu(), encoding="utf-8")
    print(f"Écrit : {FICHIER}")
