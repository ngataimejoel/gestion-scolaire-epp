"""Mot de passe oublié : code de secours (hors ligne, usage unique)."""
from __future__ import annotations

import pytest

from epp.core import recuperation, security
from epp.core.recuperation import RecuperationErreur


def test_code_de_secours(demo):
    db, _ = demo
    uid = security.create_user(db, "dir", "Directeur", "Direct!2026", "DIRECTEUR")
    code = recuperation.nouveau_code_secours(db, uid)
    with pytest.raises(RecuperationErreur):
        recuperation.reinitialiser(db, "dir", "AAAA-BBBB-CCCC", "Nouveau!2026")
    nouveau = recuperation.reinitialiser(db, "dir", code.lower().replace("-", " "), "Nouveau!2026")
    assert nouveau and nouveau != code and security.authenticate(db, "dir", "Nouveau!2026")
    with pytest.raises(RecuperationErreur):                       # un code de secours ne sert qu'une fois
        recuperation.reinitialiser(db, "dir", code, "Autre!2026x")
    assert recuperation.reinitialiser(db, "dir", nouveau, "Autre!2026x")
