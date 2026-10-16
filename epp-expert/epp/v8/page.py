"""La page de l'interface v8, avec les données de l'école et le pont vers l'application."""
from __future__ import annotations

import json

from epp import __version__
from epp.core import paths


def page_html(etat: dict | None, session: dict, lic: dict) -> str:
    """La page v8 avec les données de l'école et le pont, prête à être affichée."""
    web = paths.resource_path("resources", "web")
    html = (web / "akwa_v8.html").read_text(encoding="utf-8")
    donnees = json.dumps({"etat": etat, "session": session, "licence": lic, "version": __version__},
                         ensure_ascii=False).replace("</", "<\\/")
    tete = ('<script src="qrc:///qtwebchannel/qwebchannel.js"></script>'
            f"<script>window.APP_DATA={donnees};</script>"
            f"<script>{(web / 'pont_v8.js').read_text(encoding='utf-8')}</script>")
    return html.replace("<head>", "<head>" + tete, 1)
