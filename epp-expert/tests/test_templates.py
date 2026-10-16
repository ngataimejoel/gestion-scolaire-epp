"""Gestion des modèles : création, versions, duplication, renommage, activation,
suppression, import / export, droits d'accès, mise à jour des modèles intégrés."""
from __future__ import annotations

import json

import pytest

from epp.core import security
from epp.core.security import AccessDenied, Session, system_session
from epp.reports import model, store
from epp.reports.model import ModeleInvalide


def _defn(titre="Test"):
    d = model.nouveau_modele()
    d["titre"] = titre
    d["sections"] = [{"type": "tableau", "source": "eleves", "colonnes": [{"champ": "nom"}]}]
    return d


def _session(role: str) -> Session:
    perms = set(security.DEFAULT_ROLES[role][1])
    return Session(99, role.lower(), role, role, role, perms)


def test_modeles_integres_installes(db):
    m = store.lister(db)
    codes = {x["code"] for x in m}
    for c in ("REGISTRE", "ETAT_CLASSE", "EFFECTIFS", "SYNTHESE", "RESULTATS", "RESULTATS_CM2", "COMPOSITION",
              "RENTREE", "MENSUEL", "PERSONNEL", "ABS_ELEVES", "ABS_PERSONNEL", "FEUILLE_NOTES", "TABLEAU_DE_BORD",
              "EX_LISTE_CLASSE", "EX_EFFECTIFS_NIVEAU", "EX_ENSEIGNANTS", "EX_STAT_ANNUEL", "EX_BILAN_RESULTATS",
              "EX_ABSENCES"):
        assert c in codes
    assert all(x["integre"] for x in m)


def test_creer_modifier_versionner_restaurer(db):
    s = system_session()
    mid = store.creer(db, s, "Mon rapport", _defn("V1"))
    assert store.get(db, mid)["version_courante"] == 1
    d = store.definition(db, mid)
    d["titre"] = "V2"
    assert store.enregistrer(db, s, mid, d, "titre") == 2
    assert store.enregistrer(db, s, mid, d) == 2          # aucun changement : pas de nouvelle version
    assert [v["version"] for v in store.versions(db, mid)] == [2, 1]
    assert store.restaurer_version(db, s, mid, 1) == 3
    assert store.definition(db, mid)["titre"] == "V1"
    assert store.definition(db, mid, 2)["titre"] == "V2"   # l'historique est conservé


def test_validation_refuse_un_modele_invalide(db):
    s = system_session()
    with pytest.raises(ModeleInvalide):
        store.creer(db, s, "X", {"sections": [{"type": "inconnu"}]})
    with pytest.raises(ModeleInvalide):
        store.creer(db, s, "Y", {"sections": [{"type": "tableau", "source": "eleves", "colonnes": []}]})
    with pytest.raises(ModeleInvalide):
        store.creer(db, s, "Z", {"sections": [{"type": "tableau", "source": "nulle_part",
                                               "colonnes": [{"champ": "a"}]}]})
    with pytest.raises(ModeleInvalide):
        store.creer(db, s, "", _defn())


def test_dupliquer_renommer_activer_supprimer(db):
    s = system_session()
    cid = store.dupliquer(db, s, "SYNTHESE")
    c = store.get(db, cid)
    assert c["nom"].endswith("(copie)") and not c["integre"]
    assert store.definition(db, cid) == store.definition(db, "SYNTHESE")
    store.renommer(db, s, cid, "Ma synthèse", "desc")
    assert store.get(db, cid)["nom"] == "Ma synthèse"
    with pytest.raises(ModeleInvalide):
        store.renommer(db, s, cid, store.get(db, "REGISTRE")["nom"])   # nom déjà pris
    store.set_actif(db, s, cid, False)
    assert cid not in [m["id"] for m in store.lister(db, actifs_seulement=True)]
    store.supprimer(db, s, cid)
    with pytest.raises(KeyError):
        store.get(db, cid)
    assert not db.query("SELECT 1 FROM modele_version WHERE modele_id=?", (cid,))


def test_modele_integre_non_supprimable_mais_retablissable(db):
    s = system_session()
    with pytest.raises(ModeleInvalide):
        store.supprimer(db, s, "REGISTRE")
    d = store.definition(db, "REGISTRE")
    d["titre"] = "MODIFIÉ"
    store.enregistrer(db, s, "REGISTRE", d)
    store.retablir_original(db, s, "REGISTRE")
    assert store.definition(db, "REGISTRE")["titre"] != "MODIFIÉ"


def test_export_import(db, tmp_path):
    s = system_session()
    f = store.exporter(db, "COMPOSITION", tmp_path / "compo")
    assert f.suffix == ".epptpl"
    data = json.loads(f.read_text(encoding="utf-8"))
    assert data["type"] == "epp-modele-rapport" and data["definition"]["titre"] == "RAPPORT DE COMPOSITION"
    mid = store.importer(db, s, f)
    m = store.get(db, mid)
    assert m["nom"] != store.get(db, "COMPOSITION")["nom"] and not m["integre"]
    assert store.definition(db, mid) == store.definition(db, "COMPOSITION")
    # import comme nouvelle version d'un modèle existant
    perso = store.creer(db, s, "Perso", _defn())
    store.importer(db, s, f, remplacer=perso)
    assert store.get(db, perso)["version_courante"] == 2
    bad = tmp_path / "bad.epptpl"
    bad.write_text("{pas du json", encoding="utf-8")
    with pytest.raises(ModeleInvalide):
        store.importer(db, s, bad)
    bad.write_text(json.dumps({"type": "autre"}), encoding="utf-8")
    with pytest.raises(ModeleInvalide):
        store.importer(db, s, bad)


def test_droits_sur_les_modeles(db):
    ens = _session("ENSEIGNANT")
    with pytest.raises(AccessDenied):
        store.creer(db, ens, "Interdit", _defn())
    # rôle personnalisé : peut gérer ses modèles, mais pas les modèles partagés
    perso = Session(98, "perso", "Perso", "PERSO", "Perso", {"modeles.gerer", "rapports.generer"})
    mid = store.creer(db, perso, "Perso secrétariat", _defn())
    store.renommer(db, perso, mid, "Perso 2")
    with pytest.raises(AccessDenied):             # modèle intégré = partagé
        store.enregistrer(db, perso, "REGISTRE", _defn("hack"))
    with pytest.raises(AccessDenied):
        store.set_actif(db, perso, "REGISTRE", False)
    with pytest.raises(AccessDenied):
        store.creer(db, _session("SECRETARIAT"), "Non", _defn())
    dirc = _session("DIRECTEUR")
    d = store.definition(db, "REGISTRE")
    d["titre"] = "Par le directeur"
    store.enregistrer(db, dirc, "REGISTRE", d)


def test_mise_a_jour_des_modeles_integres(db, monkeypatch):
    from epp.reports import builtin
    s = system_session()
    # 1) modèle non modifié : mis à jour automatiquement
    tpl = [list(t) for t in builtin.TEMPLATES]
    for t in tpl:
        if t[0] == "EFFECTIFS":
            t[4] = dict(t[4], titre="EFFECTIFS v2")
        if t[0] == "SYNTHESE":
            t[4] = dict(t[4], titre="SYNTHESE v2")
    # 2) modèle modifié par l'utilisateur : conservé
    d = store.definition(db, "SYNTHESE")
    d["titre"] = "Ma synthèse"
    store.enregistrer(db, s, "SYNTHESE", d)
    monkeypatch.setattr(builtin, "TEMPLATES", [tuple(t) for t in tpl])
    store.install_builtin_templates(db)
    assert store.definition(db, "EFFECTIFS")["titre"] == "EFFECTIFS v2"
    assert store.definition(db, "SYNTHESE")["titre"] == "Ma synthèse"
    # 3) idempotent
    v = store.get(db, "EFFECTIFS")["version_courante"]
    store.install_builtin_templates(db)
    assert store.get(db, "EFFECTIFS")["version_courante"] == v


def test_actions_journalisees(db):
    s = system_session()
    mid = store.creer(db, s, "Journal", _defn())
    store.supprimer(db, s, mid)
    actions = [r["action"] for r in db.query("SELECT action FROM journal")]
    assert "MODELE_CREATION" in actions and "MODELE_SUPPRESSION" in actions


def test_etablissement_par_defaut(db):
    from epp.domain import repo
    e = repo.etablissement(db)
    assert e["ecole_nom"] == "EPP OUANINOU 2"
    assert e["iepp"] == "IEPP OUANINOU"
    assert e["dren"] == "DRENAET DE TOUBA"
