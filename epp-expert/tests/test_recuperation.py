"""Mot de passe oublié : code de secours (hors ligne) et code reçu par mail."""
from __future__ import annotations

import pytest

from epp.core import recuperation, security
from epp.core.recuperation import RecuperationErreur


def test_code_de_secours_puis_code_par_mail(demo):
    db, _ = demo
    uid = security.create_user(db, "dir", "Directeur", "Direct!2026", "DIRECTEUR")
    code = recuperation.nouveau_code_secours(db, uid)
    with pytest.raises(RecuperationErreur):
        recuperation.reinitialiser(db, "dir", "AAAA-BBBB-CCCC", "Nouveau!2026")
    nouveau = recuperation.reinitialiser(db, "dir", code.lower().replace("-", " "), "Nouveau!2026")
    assert nouveau and nouveau != code and security.authenticate(db, "dir", "Nouveau!2026")
    with pytest.raises(RecuperationErreur):                       # un code de secours ne sert qu'une fois
        recuperation.reinitialiser(db, "dir", code, "Autre!2026x")

    with pytest.raises(RecuperationErreur):                       # pas d'adresse enregistrée
        recuperation.envoyer_code_mail(db, "dir", envoyer=lambda *a: None)
    with pytest.raises(ValueError):
        recuperation.definir_email(db, uid, "pas-une-adresse")
    recuperation.definir_email(db, uid, "directeur@ecole.ci")
    recu = {}
    masque = recuperation.envoyer_code_mail(db, "dir", envoyer=lambda email, c, ecole, login: recu.update(c=c, e=email))
    assert recu["e"] == "directeur@ecole.ci" and masque.startswith("di") and "@ecole.ci" in masque
    assert recuperation.reinitialiser(db, "dir", recu["c"], "ParMail!2026") is None
    assert security.authenticate(db, "dir", "ParMail!2026")
    with pytest.raises(RecuperationErreur):                       # code mail consommé
        recuperation.reinitialiser(db, "dir", recu["c"], "Encore!2026")
