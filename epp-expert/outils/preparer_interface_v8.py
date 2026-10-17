"""Prépare l'interface de l'application AKWA SCHOOL v8 à partir du prototype HTML v8.

    python outils/preparer_interface_v8.py chemin/AKWA_SCHOOL_Prototype_v8.html

Écrit epp/resources/web/akwa_v8.html : le prototype à l'identique (écrans, menus, couleurs), avec
seulement ce qui fait de la démonstration une vraie application :
- les données viennent de l'application (window.APP) au lieu du navigateur ;
- le mot de passe administrateur est vérifié par l'application (haché, jamais dans la page) ;
- le profil de démonstration est remplacé par l'utilisateur connecté ;
- les mentions et boutons de démonstration sont masqués.
Le pont avec l'application (enregistrement, impression, fichiers, licence…) est ajouté au chargement
par epp/v8/fenetre.py (epp/resources/web/pont_v8.js).

Depuis la version 1.3.2, akwa_v8.html est modifié directement (inscription, statut, matières du CP,
aperçu A4…) : ne plus le régénérer depuis le prototype, ces changements seraient perdus.
"""
from __future__ import annotations

import sys
from pathlib import Path

DEST = Path(__file__).resolve().parent.parent / "epp" / "resources" / "web" / "akwa_v8.html"

REMPLACEMENTS = [
    # données : fournies par l'application
    ("function load(){try{", "function load(){if(window.APP)return APP.charger();try{"),
    # mot de passe administrateur vérifié par l'application
    ("onok:f=>{if(f.get('pwd')===S.school.adminPwd){res(true);return}",
     "onok:f=>{if(window.APP){APP.verifierAdmin(f.get('pwd')).then(ok=>{if(ok){res(true);closeDlg()}"
     "else{$('#pwdErr').hidden=false;$('#pwdIn').select()}});return false}"
     "if(f.get('pwd')===S.school.adminPwd){res(true);return}"),
    (" Démonstration : le mot de passe est « admin » (modifiable dans Paramètres).</p>",
     "${window.APP?'':' Démonstration : le mot de passe est « admin » (modifiable dans Paramètres).'}</p>"),
    (" (démo : « admin »).</span>", "${window.APP?'':' (démo : « admin »)'}.</span>"),
    # mentions de démonstration
    ("\n <div class=\"sub\" style=\"margin-top:10px\">Pour essayer la fin d’année avec la démonstration",
     "\n ${window.APP?'':`<div class=\"sub\" style=\"margin-top:10px\">Pour essayer la fin d’année avec la démonstration"),
    ("« Remplir toutes les évaluations ».</div>`;", "« Remplir toutes les évaluations ».</div>`}`;"),
    ("'Vos données restent sur cet ordinateur, dans ce navigateur. Sauvegardez",
     "window.APP?'Vos données restent sur cet ordinateur, enregistrées automatiquement par l’application. "
     "Sauvegardez-les régulièrement sur une clé USB.':'Vos données restent sur cet ordinateur, dans ce navigateur. Sauvegardez"),
    ("\n <div class=\"card\"><h3>Démonstration</h3>", "\n ${window.APP?'':`<div class=\"card\"><h3>Démonstration</h3>"),
    ("Réinitialiser la démonstration</button></div></div>`;", "Réinitialiser la démonstration</button></div></div>`}`;"),
    # profil de démonstration remplacé par l'utilisateur connecté
    ("  $('#crumb').insertAdjacentHTML('beforeend',`<span class=\"sp\"></span><label",
     "  if(window.APP)APP.bandeau();else $('#crumb').insertAdjacentHTML('beforeend',`<span class=\"sp\"></span><label"),
]


def preparer(source: str) -> str:
    for avant, apres in REMPLACEMENTS:
        n = source.count(avant)
        if n != 1:
            raise SystemExit(f"Motif trouvé {n} fois (1 attendu) : {avant[:70]!r}")
        source = source.replace(avant, apres)
    return source


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    DEST.write_text(preparer(Path(sys.argv[1]).read_text(encoding="utf-8")), encoding="utf-8")
    print(f"Écrit : {DEST}")
