"""Synchronisation avec l'application Android : association par code, messages chiffrés, droits, mot de passe
administrateur, licence. Un client Python suit le même protocole que le client Java du téléphone."""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request

import pytest

from epp.core import licence, security
from epp.domain import repo
from epp.synchro import protocole as P
from epp.synchro.serveur import ServeurSynchro, lister_appareils, revoquer

ESSAI = licence.Etat("essai", jours_restants=5)
MDP_ADMIN = "Admin!2026"


class Client:
    """Client de référence (même algorithme que android/.../synchro/Protocole.java)."""

    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"
        self.appareil_id = None
        self.cle = None
        self.seq = 0

    def _post(self, chemin, data: bytes, entetes=None):
        req = urllib.request.Request(self.base + chemin, data=data, method="POST", headers=entetes or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def appairer(self, code: str, nom="Téléphone de test"):
        sel = os.urandom(16)
        k = P.cle_appairage(code, sel)
        st, data = self._post("/api/appairer", P.json_octets({"sel": P.b64(sel), "preuve": P.b64(P.preuve(k)),
                                                               "nom": nom}), {"Content-Type": "application/json"})
        rep = json.loads(data)
        if st == 200:
            contenu = json.loads(P.ouvrir(k, P.unb64(rep["donnees"]), P.AAD_APPAIRAGE))
            self.appareil_id, self.cle = contenu["appareil_id"], P.unb64(contenu["cle"])
            return st, contenu
        return st, rep

    def synchro(self, ops=(), admin=None, seq=None):
        corps = {"ops": list(ops), "client": {"version": "test"}}
        if admin:
            corps["admin"] = admin
        return self.synchro_brut(corps, seq)

    def synchro_brut(self, corps: dict, seq=None):
        self.seq = seq if seq is not None else self.seq + 1
        corps = {**corps, "seq": self.seq}
        msg = P.sceller(self.cle, P.json_octets(corps), P.aad_requete(self.appareil_id))
        st, data = self._post("/api/synchro", msg, {"X-Akwa-Appareil": str(self.appareil_id),
                                                    "Content-Type": "application/octet-stream"})
        if st != 200:
            return st, json.loads(data)
        return st, json.loads(P.ouvrir(self.cle, data, P.aad_reponse(self.appareil_id, self.seq)))


@pytest.fixture
def ecole(demo):
    db, annee = demo
    security.create_user(db, "admin", "Administrateur", MDP_ADMIN, "ADMIN")
    uid = security.create_user(db, "ens", "Enseignant CP1", "Ensei!2026", "ENSEIGNANT")
    # compte enseignant lié à l'agent qui tient la classe du premier élève (accès limité à cette classe)
    classe = repo.inscriptions(db, annee)[0]["classe"]
    pid = db.scalar("SELECT personnel_id FROM affectation WHERE annee_id=? AND classe_code=?", (annee.id, classe))
    db.execute("UPDATE utilisateur SET personnel_id=? WHERE id=?", (pid, uid))
    etat = {"e": ESSAI}
    modifs = []
    srv = ServeurSynchro(db.path, port=0, port_decouverte=0, etat_licence=lambda: etat["e"],
                         quand_modifie=lambda q, nom, n: modifs.append((q, nom, n)), hote="127.0.0.1")
    srv.demarrer()
    yield db, annee, srv, etat, modifs
    srv.arreter()


def _uid(n=[0]):
    n[0] += 1
    return f"op-{n[0]}-{os.urandom(4).hex()}"


def _client(db, srv, login="ens"):
    uid = db.scalar("SELECT id FROM utilisateur WHERE login=?", (login,))
    c = Client(srv.port)
    st, _ = c.appairer(srv.nouveau_code(uid, "admin").code)
    assert st == 200
    return c


def test_association_par_code(ecole):
    db, annee, srv, *_ = ecole
    uid = db.scalar("SELECT id FROM utilisateur WHERE login='ens'")
    c = Client(srv.port)
    assert c.appairer("ABCD-EFGH")[0] == 410                       # aucun code affiché
    code = srv.nouveau_code(uid, "admin").code
    st, rep = c.appairer("XXXX-XXXX")
    assert st == 403 and "incorrect" in rep["erreur"]
    st, contenu = c.appairer(P.afficher_code(code).lower(), nom="Tecno de Mme KONE")   # tiret et minuscules admis
    assert st == 200 and contenu["utilisateur"]["login"] == "ens" and len(c.cle) == 32
    assert contenu["serveur_id"] == srv.serveur_id
    assert c.appairer(code)[0] == 410                              # un code ne sert qu'une fois
    a = lister_appareils(db)
    assert [x["nom"] for x in a] == ["Tecno de Mme KONE"] and a[0]["login"] == "ens"
    # la clé n'est jamais transmise en clair : seule la preuve circule
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='ASSOCIATION_TELEPHONE'") == 1


def test_trop_d_essais_annulent_le_code(ecole):
    db, annee, srv, *_ = ecole
    srv.nouveau_code(1, "admin")
    c = Client(srv.port)
    for _ in range(5):
        c.appairer("AAAA-AAAA")
    assert srv.code is None


def test_copie_selon_les_droits(ecole):
    db, annee, srv, *_ = ecole
    st, rep = _client(db, srv).synchro()
    i = rep["instantane"]
    assert st == 200 and i["annee"]["libelle"] == annee.libelle and i["licence"]["utilisable"]
    assert "notes.modifier" in i["utilisateur"]["permissions"] and "eleves.modifier" not in i["utilisateur"]["permissions"]
    classe = i["utilisateur"]["classes"][0]                    # compte enseignant : sa classe seulement
    assert i["utilisateur"]["classes"] == [classe] and [c["code"] for c in i["classes"]] == [classe]
    assert len(i["eleves"]) == len(repo.inscriptions(db, annee, classe)) and {e["classe"] for e in i["eleves"]} == {classe}
    assert i["notes"] and i["resultats"] and i["grilles"] and i["absences_eleves"]
    assert "hash" not in json.dumps(i) and "logo_ecole" not in i["ecole"]


def test_saisie_de_note_idempotente_et_correction_protegee(ecole):
    db, annee, srv, etat, modifs = ecole
    c = _client(db, srv)
    i = c.synchro()[1]["instantane"]
    el = i["eleves"][0]
    g = next(g for g in i["grilles"] if g["id"] == next(x for x in i["classes"] if x["code"] == el["classe"])["grille_id"])
    m = g["matieres"]["1"][0]
    iid, mid = el["inscription_id"], m["id"]
    actuelle = i["notes"][str(iid)][str(mid)]
    db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid))
    # note dans une case vide : appliquée sans mot de passe, une seule fois même si elle est renvoyée
    op = {"uid": _uid(), "op": "note", "inscription_id": iid, "matiere_id": mid, "valeur": 4, "avant": None}
    r1 = c.synchro([op])[1]["resultats"][0]
    r2 = c.synchro([op])[1]["resultats"][0]
    assert r1["ok"] and r2 == r1
    assert db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid)) == 4
    assert modifs and "notes" in modifs[0][0]
    # correction d'une note déjà saisie : mot de passe administrateur obligatoire
    corr = {"uid": _uid(), "op": "note", "inscription_id": iid, "matiere_id": mid, "valeur": 5, "avant": 4}
    r = c.synchro([corr])[1]["resultats"][0]
    assert not r["ok"] and r["code"] == "ADMIN_REQUIS"
    r = c.synchro([corr], admin="faux")[1]["resultats"][0]
    assert r["code"] == "ADMIN_REQUIS" and "incorrect" in r["message"]
    r = c.synchro([corr], admin=MDP_ADMIN)[1]
    assert r["resultats"][0]["ok"] and r["instantane"]["notes"][str(iid)][str(mid)] == 5
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='NOTE_CORRIGEE' AND details LIKE '%téléphone%'") == 1
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='AUTORISATION_ADMIN_ECHEC'") >= 1
    # la note a changé sur l'ordinateur depuis la dernière synchronisation : conflit, rien n'est écrasé
    db.execute("UPDATE note SET valeur=6 WHERE inscription_id=? AND matiere_id=?", (iid, mid))
    r = c.synchro([{**corr, "uid": _uid(), "valeur": 7, "avant": 5}], admin=MDP_ADMIN)[1]["resultats"][0]
    assert r["code"] == "CONFLIT" and "(6)" in r["message"]
    assert actuelle is not None
    # note hors barème : refusée par les mêmes contrôles que sur l'ordinateur
    db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid))
    r = c.synchro([{**op, "uid": _uid(), "valeur": 99}])[1]["resultats"][0]
    assert r["code"] == "INVALIDE" and "comprise entre" in r["message"]


def test_absent_a_l_evaluation_efface_les_notes_avec_accord_admin(ecole):
    db, annee, srv, *_ = ecole
    c = _client(db, srv)
    i = c.synchro()[1]["instantane"]
    iid = next(int(k) for k, v in i["notes"].items() if v)
    op = {"uid": _uid(), "op": "presence", "inscription_id": iid, "eval_num": 1, "present": False}
    assert c.synchro([op])[1]["resultats"][0]["code"] == "ADMIN_REQUIS"
    r = c.synchro([op], admin=MDP_ADMIN)[1]
    assert r["resultats"][0]["ok"] and 1 in r["instantane"]["absents_evaluation"][str(iid)]


def test_absences_et_suppression_protegee(ecole):
    db, annee, srv, *_ = ecole
    c = _client(db, srv)
    i = c.synchro()[1]["instantane"]
    iid = i["eleves"][1]["inscription_id"]
    an0 = annee.an_debut()
    op = {"uid": _uid(), "op": "absence", "kind": "eleve", "cible": iid, "date": f"{an0}-11-03",
          "nature": "ABSENCE", "jours": 1, "motif": "Maladie", "justifie": "OUI"}
    r = c.synchro([op, op])[1]
    assert all(x["ok"] for x in r["resultats"])
    nouvelles = [a for a in r["instantane"]["absences_eleves"] if a["inscription_id"] == iid and a["date"] == f"{an0}-11-03"]
    assert len(nouvelles) == 1                                     # renvoyée deux fois, enregistrée une fois
    pers = i["personnel"][0]["id"]
    op_pers = {"uid": _uid(), "op": "absence", "kind": "personnel", "cible": pers, "date": f"{an0}-11-04",
               "nature": "RETARD", "retard_min": 20, "motif": "Pluie / route coupée"}
    assert c.synchro([op_pers])[1]["resultats"][0]["code"] == "DROITS"     # l'enseignant : élèves de sa classe
    r = _client(db, srv, "admin").synchro([op_pers])[1]
    assert r["resultats"][0]["ok"] and any(a["personnel_id"] == pers for a in r["instantane"]["absences_personnel"])
    bad = c.synchro([{"uid": _uid(), "op": "absence", "kind": "eleve", "cible": iid, "date": "1999-01-01",
                      "nature": "ABSENCE", "jours": 1}])[1]["resultats"][0]
    assert bad["code"] == "INVALIDE" and "année scolaire" in bad["message"]
    suppr = {"uid": _uid(), "op": "suppr_absence", "kind": "eleve", "id": nouvelles[0]["id"]}
    assert c.synchro([suppr])[1]["resultats"][0]["code"] == "ADMIN_REQUIS"
    assert c.synchro([suppr], admin=MDP_ADMIN)[1]["resultats"][0]["ok"]
    assert db.scalar("SELECT COUNT(*) FROM absence_eleve WHERE id=?", (nouvelles[0]["id"],)) == 0


def test_droits_du_role(ecole):
    db, annee, srv, *_ = ecole
    security.create_user(db, "secr", "Secrétariat", "Secret!2026", "SECRETARIAT")
    c = _client(db, srv, "secr")
    i = c.synchro()[1]["instantane"]
    iid = i["eleves"][0]["inscription_id"]
    r = c.synchro([{"uid": _uid(), "op": "presence", "inscription_id": iid, "eval_num": 2, "present": True}])[1]
    assert r["resultats"][0]["code"] == "DROITS"                   # le secrétariat ne saisit pas les notes


def test_rejeu_message_altere_revocation(ecole):
    db, annee, srv, *_ = ecole
    c = _client(db, srv)
    assert c.synchro()[0] == 200
    st, rep = c.synchro(seq=c.seq)                                 # même compteur : rejeu
    assert st == 409 and rep["code"] == "REJEU"
    msg = bytearray(P.sceller(c.cle, P.json_octets({"seq": 99}), P.aad_requete(c.appareil_id)))
    msg[20] ^= 1
    st, data = c._post("/api/synchro", bytes(msg), {"X-Akwa-Appareil": str(c.appareil_id)})
    assert st == 400
    revoquer(db, security.load_session(db, db.scalar("SELECT id FROM utilisateur WHERE login='admin'")),
             c.appareil_id)
    st, rep = c.synchro()
    assert st == 401 and rep["code"] == "REVOQUE"


def test_licence_echue_aucune_donnee(ecole):
    db, annee, srv, etat, _ = ecole
    c = _client(db, srv)
    etat["e"] = licence.Etat("essai_termine", jours_restants=0)
    st, rep = c.synchro([{"uid": _uid(), "op": "presence", "inscription_id": 1, "eval_num": 1, "present": True}])
    assert st == 200 and rep["code"] == "LICENCE" and "resultats" not in rep
    assert not rep["instantane"]["licence"]["utilisable"] and "eleves" not in rep["instantane"]
    c2 = Client(srv.port)
    assert c2.appairer(srv.nouveau_code(1, "admin").code)[0] == 403


def test_decouverte_sur_le_reseau(ecole):
    db, annee, srv, *_ = ecole
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(3)
        s.sendto(P.QUESTION_DECOUVERTE, ("127.0.0.1", srv.port_decouverte))
        rep = json.loads(s.recvfrom(1024)[0])
    assert rep["port"] == srv.port and rep["serveur_id"] == srv.serveur_id and rep["service"] == "AKWA SCHOOL"
    with urllib.request.urlopen(f"http://127.0.0.1:{srv.port}/akwa", timeout=5) as r:
        assert json.loads(r.read())["protocole"] == P.VERSION_PROTOCOLE


# =================================================================== version 1.1.1 : téléphone utilisable seul
def test_inscription_et_fiche_depuis_le_telephone(ecole):
    db, annee, srv, etat, modifs = ecole
    from epp.domain import repo
    assert _client(db, srv).synchro([{"uid": _uid(), "op": "eleve", "donnees": {"nom": "X", "sexe": "M",
                                                                               "classe": "CP1"}}])[1]["resultats"][0]["code"] == "DROITS"
    c = _client(db, srv, "admin")
    i = c.synchro()[1]["instantane"]
    assert i["classes"][0]["regle_mga"] in ("STANDARD", "MOYENNE4")
    u = _uid()
    cree = {"uid": u, "op": "eleve", "donnees": {"nom": "TANOH Ange Désiré", "sexe": "M", "date_naissance": "2019-03-04",
                                                  "classe": "CP1", "pere_tel": "0707070707"}}
    g = next(g for g in i["grilles"] if g["id"] == next(x for x in i["classes"] if x["code"] == "CP1")["grille_id"])
    note = {"uid": _uid(), "op": "note", "inscription_id": "u:" + u, "matiere_id": g["matieres"]["1"][0]["id"],
            "valeur": 7, "avant": None}
    absence = {"uid": _uid(), "op": "absence", "kind": "eleve", "cible": "u:" + u, "date": annee.date_debut[:4] + "-10-02",
               "nature": "ABSENCE", "jours": 1}
    st, rep = c.synchro([cree, note, absence])
    assert [r["ok"] for r in rep["resultats"]] == [True, True, True], rep["resultats"]
    iid = rep["resultats"][0]["inscription_id"]
    assert any(e["inscription_id"] == iid and e["nom"] == "TANOH Ange Désiré" for e in rep["instantane"]["eleves"])
    assert db.scalar("SELECT valeur FROM note WHERE inscription_id=?", (iid,)) == 7
    # renvoi (réponse perdue) : rien n'est créé deux fois ; même élève inscrit une seconde fois : reconnu
    assert c.synchro([cree])[1]["resultats"][0]["inscription_id"] == iid
    st, rep = c.synchro([{**cree, "uid": _uid()}])
    assert rep["resultats"][0]["inscription_id"] == iid and "déjà inscrit" in rep["resultats"][0]["message"]
    assert [e["nom"] for e in repo.inscriptions(db, annee)].count("TANOH Ange Désiré") == 1
    # correction de la fiche : mot de passe administrateur, et pas d'écrasement d'une correction de l'ordinateur
    modif = {"uid": _uid(), "op": "eleve", "inscription_id": iid, "donnees": {"mere_tel": "0505050505", "classe": "CP2"},
             "avant": {"mere_tel": None}}
    assert c.synchro([modif])[1]["resultats"][0]["code"] == "ADMIN_REQUIS"
    assert c.synchro([{**modif, "avant": {"mere_tel": "01"}}], admin=MDP_ADMIN)[1]["resultats"][0]["code"] == "CONFLIT"
    r = c.synchro([modif], admin=MDP_ADMIN)[1]["resultats"][0]
    assert r["ok"], r
    row = db.one("SELECT e.mere_tel, e.pere_tel, c.code FROM inscription i JOIN eleve e ON e.id=i.eleve_id "
                 "JOIN classe c ON c.id=i.classe_id WHERE i.id=?", (iid,))
    assert (row["mere_tel"], row["pere_tel"], row["code"]) == ("0505050505", "0707070707", "CP2")
    assert any("eleves" in q for q, *_ in modifs)


def _base_telephone(db, annee):
    """Base d'un téléphone utilisé seul : même forme que l'instantané, identifiants propres au téléphone."""
    from epp.domain import repo
    i = donnees_instantane(db, annee)
    gid = {g["id"]: 900 + n for n, g in enumerate(i["grilles"])}
    mid = {}
    grilles = []
    for g in i["grilles"]:
        ms = {}
        for num, l in g["matieres"].items():
            ms[num] = []
            for m in l:
                mid[m["id"]] = 5000 + len(mid)
                ms[num].append({**m, "id": mid[m["id"]]})
        grilles.append({**g, "id": gid[g["id"]], "matieres": ms})
    cp1 = next(c for c in i["classes"] if c["code"] == "CP1")
    classes = [{**c, "id": 70 + n, "grille_id": gid[c["grille_id"]]} for n, c in enumerate(i["classes"])]
    classes.append({**cp1, "id": 99, "code": "CP1B", "libelle": "CP1 B", "grille_id": gid[cp1["grille_id"]]})
    connu = repo.inscriptions(db, annee, "CP1")[0]
    m1 = next(g for g in grilles if g["id"] == gid[cp1["grille_id"]])["matieres"]
    note_connue = db.one("SELECT matiere_id, valeur FROM note WHERE inscription_id=? LIMIT 1", (connu["inscription_id"],))
    return {
        "version": 1, "mode": "autonome", "ecole": i["ecole"], "annee": {**i["annee"], "id": 1},
        "classes": classes, "grilles": grilles, "evaluations": i["evaluations"],
        "eleves": [
            {"inscription_id": 1, "nom": connu["nom"].lower(), "sexe": connu["sexe"], "date_naissance": connu["date_naissance"],
             "classe": "CP1", "statut": "PRESENT"},
            {"inscription_id": 2, "nom": "BROU Akissi", "sexe": "F", "date_naissance": "2019-05-06", "classe": "CP1B",
             "statut": "PRESENT", "matricule_ecole": "CP1B-001-26"},
            {"inscription_id": 3, "nom": "SORO Issa", "sexe": "M", "date_naissance": "2019-07-08", "classe": "CP1",
             "statut": "PRESENT"},
        ],
        "notes": {"1": {str(mid[note_connue["matiere_id"]]): note_connue["valeur"] + 1,
                        str(m1["1"][-1]["id"]): 4},
                  "2": {str(m1["1"][0]["id"]): 8, str(m1["2"][0]["id"]): 6.5},
                  "3": {str(m1["2"][1]["id"]): 99}},
        "absents_evaluation": {"3": [1]},
        "personnel": [{"id": 1, "matricule": "TEL-001", "nom": "KONAN Paul", "sexe": "M", "fonction": "INSTITUTEUR ADJOINT",
                       "classe_tenue": "CP1B"}],
        "absences_eleves": [{"id": 1, "inscription_id": 2, "date": annee.date_debut[:4] + "-10-05", "nature": "ABSENCE",
                             "jours": 1, "motif": "Maladie"}],
        "absences_personnel": [{"id": 1, "personnel_id": 1, "date": annee.date_debut[:4] + "-10-05", "nature": "RETARD",
                                "retard_min": 20}],
    }, connu, note_connue


def donnees_instantane(db, annee):
    from epp.synchro import donnees
    return donnees.instantane(db, security.system_session(), ESSAI)


def test_envoi_des_donnees_d_un_telephone_utilise_seul(ecole):
    db, annee, srv, etat, modifs = ecole
    from epp.domain import repo
    base, connu, note_connue = _base_telephone(db, annee)
    c = _client(db, srv, "admin")
    corps = {"fusion": base}
    st, rep = c.synchro_brut(corps)
    assert rep.get("code") == "ADMIN_REQUIS"
    st, rep = c.synchro_brut({"fusion": {**base, "annee": {"libelle": "2001-2002"}}, "admin": MDP_ADMIN})
    assert rep["code"] == "FUSION" and "2001-2002" in rep["erreur"]
    avant = len(repo.inscriptions(db, annee))
    st, rep = c.synchro_brut({**corps, "admin": MDP_ADMIN})
    r = rep["fusion"]
    assert r["classes_creees"] == 1 and r["eleves_ajoutes"] == 2 and r["eleves_reconnus"] == 1, r
    assert len(repo.inscriptions(db, annee)) == avant + 2
    # note différente sur l'ordinateur : signalée, jamais remplacée ; note hors barème refusée
    assert db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?",
                     (connu["inscription_id"], note_connue["matiere_id"])) == note_connue["valeur"]
    assert r["differences"] and r["differences"][0]["eleve"] == connu["nom"].lower()
    assert r["notes_ajoutees"] >= 2 and any("99" in e or "comprise" in e for e in r["erreurs"]), r
    brou = next(e for e in repo.inscriptions(db, annee) if e["nom"] == "BROU Akissi")
    assert brou["classe"] == "CP1B" and brou["matricule_ecole"] == "CP1B-001-26"
    soro = next(e for e in repo.inscriptions(db, annee) if e["nom"] == "SORO Issa")
    assert db.scalar("SELECT present FROM presence_eval WHERE inscription_id=? AND eval_num=1", (soro["inscription_id"],)) == 0
    assert r["absences_ajoutees"] == 2 and r["personnel_ajoute"] == 1
    assert rep["instantane"]["eleves"] and any(e["nom"] == "BROU Akissi" for e in rep["instantane"]["eleves"])
    # nouvel envoi : rien n'est ajouté deux fois
    r2 = c.synchro_brut({**corps, "admin": MDP_ADMIN})[1]["fusion"]
    assert (r2["eleves_ajoutes"], r2["absences_ajoutees"], r2["personnel_ajoute"], r2["classes_creees"]) == (0, 0, 0, 0)
    assert r2["eleves_reconnus"] == 3 and r2["absences_existantes"] == 2
    assert db.scalar("SELECT COUNT(*) FROM journal WHERE action='FUSION_TELEPHONE'") == 2


def test_cle_publique_du_telephone_identique_a_l_ordinateur():
    from pathlib import Path
    racine = Path(__file__).resolve().parents[1]
    cle = json.loads((racine / "epp" / "resources" / "activation.json").read_text(encoding="utf-8"))["cle_publique"]
    java = (racine / "android" / "app" / "src" / "main" / "java" / "com" / "akwaschool" / "mobile" / "noyau" /
            "Licence.java").read_text(encoding="utf-8")
    assert f'CLE_PUBLIQUE = "{cle}"' in java


def test_interface_du_telephone_identique_a_akwa_school_v8():
    import importlib.util
    from pathlib import Path
    racine = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("interface_android_v8", racine / "outils" / "interface_android_v8.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.FICHIER.read_text(encoding="utf-8") == m.contenu(), "relancez python outils/interface_android_v8.py"


def test_synchronisation_par_fichier(ecole):
    """Téléphone hors du Wi-Fi de l'école : fichier de demande envoyé par WhatsApp, réponse en fichier."""
    from epp.synchro import fichier as F
    db, annee, srv, etat, modifs = ecole
    c = _client(db, srv)
    i = c.synchro()[1]["instantane"]
    el = i["eleves"][0]
    g = next(g for g in i["grilles"] if g["id"] == next(x for x in i["classes"] if x["code"] == el["classe"])["grille_id"])
    iid, mid = el["inscription_id"], g["matieres"]["1"][0]["id"]
    db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid))
    op = {"uid": _uid(), "op": "note", "inscription_id": iid, "matiere_id": mid, "valeur": 4, "avant": None}
    corr = {"uid": _uid(), "op": "note", "inscription_id": iid, "matiere_id": mid, "valeur": 6, "avant": 4}
    c.seq += 1
    dem = F.demande(c.cle, srv.serveur_id, c.appareil_id, c.seq, {"ops": [op, corr]}, "Tecno de Mme KONE")
    assert b"inscription_id" not in dem and json.loads(dem)["sens"] == "demande"          # contenu chiffré
    imp = F.ImportFichier(db.path, etat_licence=lambda: etat["e"], quand_modifie=lambda q, n, k: modifs.append(q))
    ap = imp.examiner(dem)
    assert ap["ops"] == 2 and ap["par_type"] == {"note": 2} and ap["fusion"] is None and "ens" in ap["compte"]
    assert db.scalar("SELECT COUNT(*) FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid)) == 0
    # import avec le mot de passe administrateur saisi sur l'ordinateur : la correction passe aussi
    nom, rep_fichier, rep = imp.importer(dem, MDP_ADMIN)
    assert nom.endswith(f"-REPONSE-{c.seq}.akwasync") and "-Telephone-de-test-" in nom
    assert [r["ok"] for r in rep["resultats"]] == [True, True]
    assert db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid)) == 6
    lu = F.ouvrir_reponse(c.cle, c.appareil_id, rep_fichier)
    assert lu["instantane"]["notes"][str(iid)][str(mid)] == 6 and "2 saisie(s)" in F.resume_reponse(rep)
    # même fichier importé deux fois : refusé, la réponse le dit au téléphone
    _, rep2, r = imp.importer(dem)
    assert r["code"] == "REJEU" and F.ouvrir_reponse(c.cle, c.appareil_id, rep2)["code"] == "REJEU"
    # fichier modifié, mauvais sens, autre ordinateur
    falsifie = json.loads(dem)
    falsifie["seq"] += 1
    falsifie["message"] = falsifie["message"][:-8] + "AAAAAAA="
    assert "modifié" in imp.examiner(json.dumps(falsifie).encode())["erreur"]
    with pytest.raises(F.FichierInvalide, match="réponse"):
        imp.examiner(rep_fichier)
    with pytest.raises(F.FichierInvalide, match="autre ordinateur"):
        imp.examiner(F.demande(c.cle, "ailleurs", c.appareil_id, c.seq + 1, {"ops": []}))
    with pytest.raises(F.FichierInvalide):
        imp.examiner(b"PK\x03\x04 pas un fichier AKWA")
    # le Wi-Fi reprend après un fichier : le compteur est commun
    assert c.synchro()[0] == 200


def test_premier_envoi_par_fichier_d_un_telephone_utilise_seul(ecole):
    from epp.synchro import fichier as F
    db, annee, srv, etat, modifs = ecole
    base, *_ = _base_telephone(db, annee)
    c = _client(db, srv, "admin")
    imp = F.ImportFichier(db.path, etat_licence=lambda: etat["e"])
    dem = F.demande(c.cle, srv.serveur_id, c.appareil_id, 5, {"fusion": base, "ops": []})
    ap = imp.examiner(dem)
    assert ap["fusion"]["eleves"] == len(base["eleves"])
    _, data, rep = imp.importer(dem, MDP_ADMIN)
    assert rep["fusion"]["eleves_ajoutes"] == 2
    assert F.ouvrir_reponse(c.cle, c.appareil_id, data)["fusion"]["eleves_ajoutes"] == 2
    # sans mot de passe : rien n'est ajouté, le téléphone l'apprend par la réponse
    _, data, rep = imp.importer(F.demande(c.cle, srv.serveur_id, c.appareil_id, 6, {"fusion": base, "ops": []}))
    assert rep["code"] == "ADMIN_REQUIS" and "mot de passe" in F.resume_reponse(rep)


def test_fichiers_du_telephone_acceptes_par_le_pont_java():
    """Les noms écrits par pont_android.js doivent passer le filtre de Pont.java (sinon rien n'est enregistré)."""
    import re
    from pathlib import Path

    racine = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main"
    java = (racine / "java" / "com" / "akwaschool" / "mobile" / "Pont.java").read_text(encoding="utf-8")
    motif = re.search(r'NOM_FICHIER = Pattern\.compile\("(.+?)"\)', java).group(1).replace("\\\\", "\\")
    js = (racine / "assets" / "www" / "pont_android.js").read_text(encoding="utf-8")
    noms = [re.search(r"const FICHIER='([^']+)'", js).group(1)]
    noms += [f"copie_v8_{j}.json" for j in ("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")]
    assert "'copie_v8_'+JOURS" in js
    for nom in noms:
        assert re.fullmatch(motif, nom), nom
