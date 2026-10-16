"""AKWA SCHOOL v8 : données, comptes et page de l'interface (sans Qt)."""
from datetime import date, datetime, timezone

import pytest

from epp.core import licence
from epp.v8.page import page_html
from epp.v8.stockage import ADMIN, Erreur, Stockage, licence_pour_page


@pytest.fixture
def st(tmp_path, monkeypatch):
    monkeypatch.setenv("EPP_DATA_DIR", str(tmp_path))
    s = Stockage(tmp_path / "akwa.sqlite")
    yield s
    s.close()


ETAT = '{"school":{"name":"EPP OUANINOU 2","adminPwd":"admin","secours":"K7QM"},"students":[],"session":{"role":"dir"},' \
       '"teachers":[{"id":"t1","nom":"Mme Aka Rose","classe":"CP1","actif":true,"compte":{"login":"raka","actif":true}}]}'


def test_donnees_sans_secret_et_copie_du_jour(st):
    assert st.lire() is None
    st.ecrire(ETAT)
    o = st.lire()
    assert o["school"] == {"name": "EPP OUANINOU 2"} and "session" not in o
    assert st.copies() == [date.today().isoformat()]
    with pytest.raises(Erreur):
        st.ecrire('{"school":{}}')
    with pytest.raises(Erreur):
        st.ecrire("pas du json")
    assert st.lire()["school"]["name"] == "EPP OUANINOU 2"


def test_admin_connexion_et_code_de_secours(st):
    with pytest.raises(Erreur):
        st.creer_admin("123")
    code = st.creer_admin("Directeur26")
    with pytest.raises(Erreur):
        st.creer_admin("Directeur26")
    assert st.authentifier(ADMIN, "Directeur26")["role"] == "dir"
    with pytest.raises(Erreur):
        st.authentifier(ADMIN, "faux")
    assert st.verifier_admin("Directeur26") and not st.verifier_admin("x")
    hachages = st.conn.execute("SELECT hash || secours_hash FROM compte").fetchone()[0]
    assert "Directeur26" not in hachages and code.replace("-", "") not in hachages
    with pytest.raises(Erreur):
        st.recuperer(ADMIN, "AAAA-BBBB-CCCC", "Nouveau26")
    nouveau_code = st.recuperer(ADMIN, code.lower(), "Nouveau26")
    assert st.authentifier(ADMIN, "Nouveau26") and nouveau_code != code
    with pytest.raises(Erreur):                  # le code ne sert qu'une fois
        st.recuperer(ADMIN, code, "Encore26")
    st.changer(ADMIN, "Nouveau26", "Troisieme26")
    with pytest.raises(Erreur):
        st.changer(ADMIN, "Nouveau26", "x" * 8)


def test_compte_enseignant(st):
    st.ecrire(ETAT)
    st.creer_admin("Directeur26")
    with pytest.raises(Erreur):
        st.creer_compte_enseignant("t1", "a b")
    with pytest.raises(Erreur):
        st.creer_compte_enseignant("t1", "admin")
    mdp = st.creer_compte_enseignant("t1", "raka")
    s = st.authentifier("raka", mdp)
    assert s["role"] == "ens" and s["tid"] == "t1" and s["provisoire"] and "CP1" in s["nom"]
    st.definir("raka", "MaClasse26")
    assert not st.authentifier("raka", "MaClasse26")["provisoire"]
    mdp2 = st.reinitialiser_enseignant("t1")
    assert st.authentifier("raka", mdp2)["provisoire"]
    st.ecrire(ETAT.replace('"compte":{"login":"raka","actif":true}', '"compte":{"login":"raka","actif":false}'))
    with pytest.raises(Erreur, match="désactivé"):
        st.authentifier("raka", mdp2)


def test_licence_pour_la_page():
    j = date(2026, 10, 16)
    assert licence_pour_page(licence.Etat("active", "vie"), j) == {"type": "vie"}
    fin = datetime(2027, 10, 1, tzinfo=timezone.utc)
    assert licence_pour_page(licence.Etat("active", "1an", fin, 350), j) == {"type": "an", "fin": "2027-10-01"}
    assert licence_pour_page(licence.Etat("essai", jours_restants=5), j) == {"type": "essai", "debut": "2026-10-14"}


def test_page_avec_donnees_et_pont():
    html = page_html({"school": {"name": "</script><b>"}}, {"role": "dir"}, {"type": "vie"})
    assert html.count("window.APP_DATA=") == 1 and "<\\/script><b>" in html
    assert "APP.charger()" in html and "APP.verifierAdmin" in html and "qwebchannel.js" in html
    assert html.index("window.APP_DATA=") < html.index("let S=load()")
