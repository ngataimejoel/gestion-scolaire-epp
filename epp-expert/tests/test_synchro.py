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
        self.seq = seq if seq is not None else self.seq + 1
        corps = {"seq": self.seq, "ops": list(ops), "client": {"version": "test"}}
        if admin:
            corps["admin"] = admin
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
    security.create_user(db, "ens", "Enseignant CP1", "Ensei!2026", "ENSEIGNANT")
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
    assert len(i["eleves"]) == len(__import__("epp.domain.repo", fromlist=["x"]).inscriptions(db, annee))
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
    r = c.synchro([{"uid": _uid(), "op": "absence", "kind": "personnel", "cible": pers, "date": f"{an0}-11-04",
                    "nature": "RETARD", "retard_min": 20, "motif": "Pluie / route coupée"}])[1]
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
