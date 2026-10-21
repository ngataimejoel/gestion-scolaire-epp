"""Activation sans Internet : code de demande de l'appareil, code de licence du générateur hors ligne."""
from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path

import pytest

from epp.core import hors_ligne, licence

RACINE = Path(__file__).resolve().parent.parent


def _module(nom):
    spec = importlib.util.spec_from_file_location(nom, RACINE / "outils" / f"{nom}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


gen = _module("generateur_hors_ligne")
gen_service = _module("generateur_codes")


@pytest.fixture
def cles(tmp_path, monkeypatch):
    """Clé du service (format de la variable Netlify) importée dans le générateur, reconnue par l'application."""
    c = gen_service.initialiser()
    monkeypatch.setenv("EPP_LICENCE_CLE_PUBLIQUE", c["cle_publique"])
    monkeypatch.setenv("EPP_ESSAI_SECONDAIRE", str(tmp_path / "registre" / "essai.json"))
    monkeypatch.setenv("AKWA_CODES_DOSSIER", str(tmp_path / "generateur"))
    graine = gen.graine_depuis_texte(c["EPP_LICENCE_CLE_PRIVEE"])
    assert gen.publique(graine) == c["cle_publique"]
    monkeypatch.setenv("EPP_CLES_COURTES", gen.cle_github(graine, 1))       # secret GitHub injecté par la CI
    return graine


def test_demande_courte_et_controlee():
    d = licence.demande_hors_ligne()
    assert len(d) == 19 and d.count("-") == 3 and d == licence.demande_hors_ligne()
    assert hors_ligne.demande_valide(d.lower().replace("-", " "))
    faute = d[:5] + ("A" if d[5] != "A" else "B") + d[6:]
    with pytest.raises(hors_ligne.CodeInvalide):
        hors_ligne.demande_valide(faute)


def test_code_hors_ligne_active_cet_appareil_seulement(cles):
    g = gen.generer(cles, licence.demande_hors_ligne(), "1an", date(2026, 10, 19))
    assert len(g["code"]) == 29 and [len(x) for x in g["code"].split("-")] == [5] * 5 and g["expire"] == "2027-10-19"
    e = licence.activer(g["code"].lower().replace("-", " "))   # saisi dans le champ habituel, sans Internet
    assert e.statut == "active" and e.type == "1an" and e.code == g["serie"]
    assert e.expire_le.date() == date(2027, 10, 19)
    assert licence.etat().statut == "active"
    autre = gen.generer(cles, hors_ligne.demande("autre-appareil"), "vie")
    with pytest.raises(licence.LicenceErreur, match="autre appareil"):
        licence.activer(autre["code"])
    abime = g["code"][:-1] + ("2" if g["code"][-1] != "2" else "3")
    with pytest.raises(licence.LicenceErreur):
        licence.activer(abime)


def test_code_signe_par_une_cle_inconnue_refuse(cles):
    g = gen.generer(bytes(32), licence.demande_hors_ligne(), "vie")
    with pytest.raises(licence.LicenceErreur):
        licence.activer(g["code"])
    assert licence.etat().statut == "essai"


def test_code_enseignant_reserve_a_l_espace_enseignant(cles):
    g = gen.generer(cles, licence.demande_hors_ligne(), "ensvie")
    with pytest.raises(licence.LicenceErreur, match="enseignant"):
        licence.activer(g["code"])
    assert licence.activer(g["code"], espace="enseignant").type == "ensvie"


def test_cle_du_generateur_chiffree_par_mot_de_passe(cles):
    pub = gen.enregistrer_cle(cles, "MotDePasse-2026")
    assert "MotDePasse" not in (gen.dossier() / "cle.json").read_text()
    assert gen.ouvrir_cle("MotDePasse-2026") == cles and gen.publique(cles) == pub
    with pytest.raises(gen.Erreur):
        gen.ouvrir_cle("mauvais")
    g = gen.generer(cles, licence.demande_hors_ligne(), "vie")
    gen.noter(g, "EPP TEST")
    assert "EPP TEST" in (gen.dossier() / "registre.csv").read_text(encoding="utf-8-sig")


def test_code_court_cle_retiree_ou_absente(cles, monkeypatch):
    d = licence.demande_hors_ligne()
    g2 = gen.generer(cles, d, "vie", numero=2)               # numéro de clé que l'application ne connaît pas
    with pytest.raises(licence.LicenceErreur):
        licence.activer(g2["code"])
    monkeypatch.setenv("EPP_CLES_COURTES", gen.cle_github(cles, 2))
    assert licence.activer(g2["code"]).type == "vie"
    g1 = gen.generer(cles, d, "vie", numero=1)                # ancienne clé retirée de la nouvelle version
    with pytest.raises(licence.LicenceErreur):
        licence.activer(g1["code"])


def test_secret_injecte_masque_et_a_sens_unique(cles):
    secret = hors_ligne.secret_court(cles, 1)
    injecte = hors_ligne.ecrire_cles_courtes({1: secret}, masquees=True)
    assert secret.hex() not in injecte and hors_ligne.lire_cles_courtes(injecte, masquees=True) == {1: secret}
    assert secret != cles and hors_ligne.secret_court(cles, 2) != secret


def test_ancien_code_long_toujours_accepte(cles):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    d15 = hors_ligne.nettoyer(licence.demande_hors_ligne())[:15]
    charge = hors_ligne.charge_utile("vie", None, 5)
    sig = Ed25519PrivateKey.from_private_bytes(cles).sign(hors_ligne.message(d15, charge))
    assert licence.activer(hors_ligne.grouper(hors_ligne.coder(charge + sig))).code == "HL-000005"
