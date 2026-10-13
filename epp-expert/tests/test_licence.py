"""Licence : codes 1 an / à vie à usage unique, activation en ligne, contrôle hors ligne, générateur.

Le service d'activation réel (activation/lib/core.mjs) tourne en local sous Node avec un stockage
en mémoire ; ces tests sont ignorés si Node n'est pas installé.
"""
from __future__ import annotations

import importlib.util
import shutil
import socket
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from epp.core import licence
from epp.core.security import system_session

RACINE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("generateur_codes", RACINE / "outils" / "generateur_codes.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


@pytest.fixture
def service(tmp_path, monkeypatch):
    if not shutil.which("node") or not (RACINE / "activation" / "lib" / "core.mjs").exists():
        pytest.skip("Node.js absent : service d'activation non testable ici")
    cles = gen.initialiser()
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0))
        port = so.getsockname()[1]
    p = subprocess.Popen(["node", str(RACINE / "activation" / "dev" / "serveur-local.mjs"), str(port),
                          cles["EPP_LICENCE_CLE_PRIVEE"], cles["EPP_ADMIN_TOKEN"]], stdout=subprocess.PIPE)
    assert p.stdout.readline().strip() == b"pret"
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("EPP_DATA_DIR", str(tmp_path / "donnees"))
    monkeypatch.setenv("EPP_ACTIVATION_URL", url)
    monkeypatch.setenv("EPP_LICENCE_CLE_PUBLIQUE", cles["cle_publique"])
    monkeypatch.setenv("EPP_GENERATEUR_CONFIG", str(tmp_path / "generateur"))
    monkeypatch.setenv("EPP_ESSAI_SECONDAIRE", str(tmp_path / "registre" / "essai.json"))
    gen.ecrire_config(url=url, jeton=cles["EPP_ADMIN_TOKEN"])
    yield url
    p.terminate()
    p.wait(5)


def test_essai_puis_lecture_seule(service):
    t0 = datetime.now(timezone.utc)
    assert licence.ESSAI_JOURS == 7
    e = licence.etat(t0)
    assert e.statut == "essai" and e.jours_restants == 7 and e.utilisable
    assert "7 jour(s) restant(s)" in e.message
    assert licence.etat(t0 + timedelta(days=6, hours=23)).statut == "essai"
    e = licence.etat(t0 + timedelta(days=7, hours=1))
    assert e.statut == "essai_termine" and not e.utilisable
    assert licence.verrouillee(e)
    s = licence.restreindre(system_session(), e)
    assert not s.permissions                      # rien n'est consultable, imprimable ni exportable
    assert licence.restreindre(system_session(), licence.etat(t0)).permissions
    # l'ordinateur a déjà été vu à une date plus récente : horloge reculée, refusée
    licence._ecrire_json(licence.FICHIER_ESSAI, {"premier_lancement": t0.isoformat(),
                                                 "derniere_date_vue": (t0 + timedelta(days=10)).isoformat()})
    assert licence.etat().statut == "horloge" and not licence.etat().utilisable


def test_code_a_vie_usage_unique(service, monkeypatch):
    code = gen.generer("vie", 1, "EPP OUANINOU 2")[0]["code"]
    e = licence.activer(code, "EPP OUANINOU 2")
    assert e.statut == "active" and e.type == "vie" and e.utilisable and e.expire_le is None
    assert licence.etat(datetime.now(timezone.utc) + timedelta(days=4000)).statut == "active"
    # le même code sur un autre ordinateur est refusé
    monkeypatch.setattr(licence, "empreinte_machine", lambda: "f" * 64)
    with pytest.raises(licence.LicenceErreur, match="déjà été utilisé"):
        licence.activer(code)
    # la licence copiée sur un autre ordinateur n'y est pas valable
    assert licence.etat().statut == "essai"
    l = {x["code"]: x for x in gen.lister()}[code]
    assert l["utilise"] and l["ecole"] == "EPP OUANINOU 2"


def test_code_un_an_et_renouvellement(service):
    c1, c2 = (x["code"] for x in gen.generer("1an", 2))
    e = licence.activer(c1)
    assert e.type == "1an" and 364 <= e.jours_restants <= 365
    assert licence.etat(datetime.now(timezone.utc) + timedelta(days=366)).statut == "expiree"
    e2 = licence.activer(c2)          # renouvelé avant échéance : les jours restants s'ajoutent
    assert 729 <= e2.jours_restants <= 730


def test_codes_errones_et_hors_ligne(service, monkeypatch):
    with pytest.raises(licence.LicenceErreur, match="inconnu"):
        licence.activer("EPP-2222-3333-4444-5555")
    with pytest.raises(licence.LicenceErreur, match="mal saisi"):
        licence.activer("abc")
    c = gen.generer("vie", 1)[0]["code"]
    gen.revoquer(c)
    with pytest.raises(licence.LicenceErreur, match="annulé"):
        licence.activer(c)
    monkeypatch.setenv("EPP_ACTIVATION_URL", "http://127.0.0.1:9")
    with pytest.raises(licence.LicenceErreur, match="Internet"):
        licence.activer(gen.generer("vie", 1)[0]["code"])


def test_licence_falsifiee_refusee(service):
    import base64
    import json
    licence.activer(gen.generer("1an", 1)[0]["code"])
    f = Path(licence.paths.data_dir()) / licence.FICHIER
    d = json.loads(f.read_text())
    contenu = json.loads(base64.urlsafe_b64decode(d["licence"] + "=="))
    contenu["expire_le"] = "2099-01-01T00:00:00Z"
    d["licence"] = base64.urlsafe_b64encode(json.dumps(contenu).encode()).decode().rstrip("=")
    f.write_text(json.dumps(d))
    assert licence.etat().statut == "essai"


def test_reponse_d_un_faux_serveur_refusee(service, monkeypatch):
    autre = gen.initialiser()["cle_publique"]
    monkeypatch.setenv("EPP_LICENCE_CLE_PUBLIQUE", autre)
    with pytest.raises(licence.LicenceErreur, match="authentique"):
        licence.activer(gen.generer("vie", 1)[0]["code"])


def test_generateur_jeton_obligatoire(service):
    gen.ecrire_config(jeton="mauvais-jeton-" + "x" * 30)
    with pytest.raises(gen.ErreurGenerateur, match="refusé"):
        gen.generer("vie", 1)


def test_generateur_absent_de_l_application():
    """Le générateur et ses secrets ne sont jamais embarqués dans l'installateur des écoles."""
    spec_txt = (RACINE / "packaging" / "gestion_scolaire.spec").read_text(encoding="utf-8")
    assert "generateur" not in spec_txt.lower() and "outils" not in spec_txt
    assert not list((RACINE / "epp").rglob("*generateur*"))


def test_reinstallation_ne_relance_pas_l_essai(service):
    t0 = datetime.now(timezone.utc) - timedelta(days=8)
    licence._ecrire_json(licence.FICHIER_ESSAI, {"premier_lancement": t0.isoformat(),
                                                 "derniere_date_vue": t0.isoformat()})
    assert licence.etat().statut == "essai_termine"
    # dossier de données supprimé (désinstallation complète puis réinstallation)
    (licence.paths.data_dir() / licence.FICHIER_ESSAI).unlink()
    assert licence.etat().statut == "essai_termine"
    # l'autre copie effacée seule : la première suffit
    import os
    Path(os.environ["EPP_ESSAI_SECONDAIRE"]).unlink()
    assert licence.etat().statut == "essai_termine"
    # l'activation d'un code lève la restriction
    assert licence.activer(gen.generer("1an", 1)[0]["code"]).utilisable


def test_donnees_inaccessibles_mais_conservees_apres_l_essai(service, tmp_path):
    """Essai terminé : rapports et saisie refusés ; après activation, les données sont intactes."""
    from epp.core.db import open_database
    from epp.core.security import AccessDenied
    from epp.demo import creer_ecole_demo
    from epp.domain import repo
    from epp.reports import service as rapports
    db = open_database(tmp_path / "ecole.sqlite")
    annee = creer_ecole_demo(db, system_session())
    n = len(repo.inscriptions(db, annee))
    t0 = datetime.now(timezone.utc) - timedelta(days=8)
    licence._ecrire_json(licence.FICHIER_ESSAI, {"premier_lancement": t0.isoformat(),
                                                 "derniere_date_vue": t0.isoformat()})
    s = licence.restreindre(system_session(), licence.etat())
    with pytest.raises(AccessDenied):
        rapports.generer(db, s, annee, "REGISTRE", {}, tmp_path / "r.pdf")
    with pytest.raises(AccessDenied):
        repo.save_eleve(db, s, None, {"nom": "X Y", "sexe": "M", "date_naissance": "2018-01-01"}, annee)
    licence.activer(gen.generer("vie", 1)[0]["code"])
    s = licence.restreindre(system_session(), licence.etat())
    assert len(repo.inscriptions(db, annee)) == n
    assert rapports.generer(db, s, annee, "REGISTRE", {}, tmp_path / "r.pdf").exists()
    db.close()
