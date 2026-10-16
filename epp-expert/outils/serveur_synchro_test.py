"""Serveur de synchronisation de démonstration, pour tester le client Java du téléphone (CI Android).

    python outils/serveur_synchro_test.py <fichier_info.json>

Crée une école de démonstration dans un dossier temporaire, démarre le serveur sur 127.0.0.1 (ports libres),
affiche un code d'association et écrit dans le fichier : ports, code, et une case de notes vide à remplir.
S'arrête quand on ferme son entrée standard (ou Ctrl+C)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(sortie: str) -> None:
    tmp = tempfile.mkdtemp(prefix="akwa_synchro_")
    os.environ["EPP_DATA_DIR"] = tmp
    from epp.core import licence, security
    from epp.core.db import open_database
    from epp.demo import creer_ecole_demo
    from epp.synchro.serveur import ServeurSynchro
    db = open_database(Path(tmp) / "demo.sqlite")
    annee = creer_ecole_demo(db, security.system_session())
    security.create_user(db, "admin", "Administrateur", "Admin!2026", "ADMIN")
    uid = security.create_user(db, "ens", "Enseignant", "Ensei!2026", "ENSEIGNANT")
    n = db.one("SELECT n.inscription_id, n.matiere_id FROM note n JOIN inscription i ON i.id=n.inscription_id "
               "WHERE i.annee_id=? LIMIT 1", (annee.id,))
    db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id=?", (n["inscription_id"], n["matiere_id"]))
    # compte enseignant relié au maître de la classe de cet élève (sinon il ne voit aucune classe)
    from epp.domain import repo
    classe = repo.classe_inscription(db, n["inscription_id"])
    db.execute("UPDATE utilisateur SET personnel_id=(SELECT personnel_id FROM affectation WHERE annee_id=? "
               "AND classe_code=?) WHERE id=?", (annee.id, classe["code"], uid))
    srv = ServeurSynchro(db.path, port=0, port_decouverte=0, hote="127.0.0.1",
                         etat_licence=lambda: licence.Etat("essai", jours_restants=7))
    srv.demarrer()
    code = srv.nouveau_code(uid, "admin").code
    Path(sortie).write_text(json.dumps({"port": srv.port, "port_decouverte": srv.port_decouverte, "code": code,
                                        "serveur_id": srv.serveur_id, "inscription_id": n["inscription_id"],
                                        "matiere_id": n["matiere_id"]}), encoding="utf-8")
    print(f"prêt : port {srv.port}, code {code}", flush=True)
    try:
        sys.stdin.read()
    except KeyboardInterrupt:
        pass
    srv.arreter()
    n_notes = db.scalar("SELECT COUNT(*) FROM note WHERE inscription_id=? AND matiere_id=?",
                        (n["inscription_id"], n["matiere_id"]))
    print(f"note reçue du client Java : {'oui' if n_notes else 'non'}", flush=True)
    db.close()
    sys.exit(0 if n_notes else 3)


if __name__ == "__main__":
    main(sys.argv[1])
