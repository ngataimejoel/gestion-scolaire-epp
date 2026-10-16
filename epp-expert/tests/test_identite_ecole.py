"""Identité de l'école figée après la première saisie, modifiable avec le mot de passe d'un administrateur."""
from __future__ import annotations

import pytest

from epp.core import security
from epp.core.security import AccessDenied, system_session
from epp.domain import repo


def test_identite_verrouillee_apres_premiere_saisie(demo):
    db, _ = demo
    s = system_session()
    repo.save_etablissement(db, s, {"ecole_nom": "EPP ESSAI", "ecole_code": "E000001", "directeur": "M. A"})
    assert repo.identite_verrouillee(db)
    repo.save_etablissement(db, s, {"ecole_nom": "EPP ESSAI", "directeur": "Mme B"})   # inchangé / non figé
    with pytest.raises(AccessDenied):
        repo.save_etablissement(db, s, {"ecole_nom": "AUTRE ÉCOLE"})
    security.create_user(db, "admin", "Administrateur", "Admin!2026", "ADMIN")
    assert security.verifier_admin(db, s, "faux", "identité") is None
    admin = security.verifier_admin(db, s, "Admin!2026", "identité")
    repo.save_etablissement(db, s, {"ecole_nom": "AUTRE ÉCOLE", "identite_verrouillee": "NON"}, autorise_par=admin)
    assert db.get_param("ecole_nom") == "AUTRE ÉCOLE" and repo.identite_verrouillee(db)
    assert db.get_param("directeur") == "Mme B"
