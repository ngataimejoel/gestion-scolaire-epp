"""Serveur de synchronisation des téléphones, sur le réseau local (Wi-Fi de l'école), sans Internet ni abonnement.

Il tourne dans l'application Windows, seulement quand elle est ouverte et que la synchronisation est activée
(Rapports & administration › Téléphones). Il écoute :
- en HTTP sur le port 8765 : association d'un téléphone, puis synchronisations (messages chiffrés, voir
  protocole.py) ;
- en UDP sur le port 8766 : le téléphone qui cherche « l'ordinateur de l'école » reçoit son adresse.

Les requêtes sont traitées l'une après l'autre, avec une connexion à la base propre au serveur (SQLite en mode
WAL : l'interface continue de fonctionner pendant une synchronisation).
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import socket
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Callable

from epp import APP_MARQUE, __version__
from epp.core import licence, security
from epp.core.db import Database
from epp.synchro import donnees
from epp.synchro import protocole as P

log = logging.getLogger(__name__)

DUREE_CODE = 10 * 60           # secondes de validité d'un code d'association
ESSAIS_CODE = 5                # preuves fausses tolérées avant annulation du code
TAILLE_MAX = 8 * 1024 * 1024   # octets d'une requête


def adresses_locales() -> list[str]:
    """Adresses IPv4 de l'ordinateur sur le réseau local (celle de la sortie par défaut en premier)."""
    out: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))           # aucun paquet envoyé : choix de l'interface seulement
            out.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in out:
                out.append(ip)
    except OSError:
        pass
    return [ip for ip in out if not ip.startswith("127.")] or ["127.0.0.1"]


def serveur_id(db: Database) -> str:
    sid = db.meta("serveur_id")
    if not sid:
        sid = secrets.token_hex(8)
        db.set_meta("serveur_id", sid)
    return sid


@dataclass
class CodeEnCours:
    code: str
    utilisateur_id: int
    cree_par: str
    expire: float
    echecs: int = 0

    @property
    def secondes_restantes(self) -> int:
        return max(0, int(self.expire - time.monotonic()))


class ServeurSynchro:
    def __init__(self, db_path: str | Path, port: int = P.PORT_HTTP, port_decouverte: int | None = P.PORT_DECOUVERTE,
                 etat_licence: Callable[[], licence.Etat] = licence.etat,
                 quand_modifie: Callable[[set, str, int], None] | None = None, hote: str = "0.0.0.0"):
        self.db_path = Path(db_path)
        self.port = port
        self.port_decouverte = port_decouverte
        self.hote = hote
        self.etat_licence = etat_licence
        self.quand_modifie = quand_modifie
        self._verrou = threading.Lock()
        self._code: CodeEnCours | None = None
        self._http: HTTPServer | None = None
        self._udp: socket.socket | None = None
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()
        self.db: Database | None = None
        self.serveur_id = ""
        self.ecole = ""                  # nom affiché aux téléphones qui cherchent l'ordinateur

    # ------------------------------------------------------------------ marche / arrêt
    @property
    def en_marche(self) -> bool:
        return self._http is not None

    def demarrer(self) -> None:
        if self.en_marche:
            return
        self.db = Database(self.db_path)
        self.serveur_id = serveur_id(self.db)
        self.ecole = self.db.get_param("ecole_nom", "") or ""
        serveur = self

        class Gestionnaire(_Gestionnaire):
            srv = serveur
        try:
            self._http = HTTPServer((self.hote, self.port), Gestionnaire)
        except OSError as e:
            self.db.close()
            self.db = None
            raise OSError(f"Le port {self.port} est déjà utilisé sur cet ordinateur ({e.strerror or e}). "
                          "Fermez l'autre programme qui l'utilise, puis réessayez.") from None
        self.port = self._http.server_address[1]
        self._http.timeout = 1
        self._stop.clear()
        self._threads = [threading.Thread(target=self._http.serve_forever, kwargs={"poll_interval": 0.5},
                                          name="synchro-http", daemon=True)]
        if self.port_decouverte is not None:
            try:
                self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                self._udp.bind((self.hote, self.port_decouverte))
                self.port_decouverte = self._udp.getsockname()[1]
                self._udp.settimeout(0.5)
                self._threads.append(threading.Thread(target=self._decouverte, name="synchro-udp", daemon=True))
            except OSError:
                log.warning("Découverte UDP indisponible (port %s) : saisie manuelle de l'adresse", self.port_decouverte)
                self._udp = None
        for t in self._threads:
            t.start()
        log.info("Synchronisation des téléphones : en écoute sur le port %s", self.port)

    def arreter(self) -> None:
        if not self.en_marche:
            return
        self._stop.set()
        self._http.shutdown()
        self._http.server_close()
        if self._udp is not None:
            self._udp.close()
        for t in self._threads:
            t.join(timeout=3)
        self._http = self._udp = None
        self._threads = []
        if self.db is not None:
            self.db.close()
            self.db = None
        with self._verrou:
            self._code = None
        log.info("Synchronisation des téléphones : arrêtée")

    def _decouverte(self) -> None:
        while not self._stop.is_set():
            try:
                data, adr = self._udp.recvfrom(256)
            except socket.timeout:
                continue
            except OSError:
                break
            if data.strip() == P.QUESTION_DECOUVERTE:
                rep = {"service": APP_MARQUE, "protocole": P.VERSION_PROTOCOLE, "serveur_id": self.serveur_id,
                       "ecole": self.ecole, "port": self.port}
                try:
                    self._udp.sendto(P.json_octets(rep), adr)
                except OSError:
                    pass

    # ------------------------------------------------------------------ code d'association
    def nouveau_code(self, utilisateur_id: int, cree_par: str) -> CodeEnCours:
        with self._verrou:
            self._code = CodeEnCours(P.nouveau_code(), utilisateur_id, cree_par, time.monotonic() + DUREE_CODE)
            return self._code

    def annuler_code(self) -> None:
        with self._verrou:
            self._code = None

    @property
    def code(self) -> CodeEnCours | None:
        with self._verrou:
            if self._code and self._code.secondes_restantes <= 0:
                self._code = None
            return self._code

    # ------------------------------------------------------------------ traitements
    def appairer(self, corps: dict) -> tuple[int, dict]:
        db = self.db
        sel, recue = P.unb64(corps.get("sel", "")), P.unb64(corps.get("preuve", ""))
        nom = " ".join(str(corps.get("nom") or "Téléphone").split())[:60] or "Téléphone"
        if not 16 <= len(sel) <= 64:
            return 400, {"erreur": "Requête d'association invalide."}
        with self._verrou:
            c = self._code
            if c is None or c.secondes_restantes <= 0:
                self._code = None
                return 410, {"erreur": "Aucun code d'association en cours sur l'ordinateur. Affichez un nouveau "
                                       "code (Rapports & administration › Téléphones)."}
            cle = P.cle_appairage(c.code, sel)
            if not P.preuve_valide(cle, recue):
                c.echecs += 1
                if c.echecs >= ESSAIS_CODE:
                    self._code = None
                    return 403, {"erreur": "Code incorrect. Trop d'essais : affichez un nouveau code sur l'ordinateur."}
                return 403, {"erreur": "Code incorrect."}
            self._code = None                  # un code ne sert qu'une fois
        if not self.etat_licence().utilisable:
            return 403, {"erreur": "La licence de l'application Windows n'est pas valable : activez-la d'abord."}
        u = db.one("SELECT id, login, nom, actif FROM utilisateur WHERE id=?", (c.utilisateur_id,))
        if u is None or not u["actif"]:
            return 403, {"erreur": "Le compte choisi sur l'ordinateur n'existe plus ou est désactivé."}
        secret = os.urandom(32)
        aid = db.execute("INSERT INTO appareil(nom, utilisateur_id, cle, cree_par) VALUES(?,?,?,?)",
                         (nom, u["id"], P.b64(secret), c.cree_par)).lastrowid
        security.log(db, c.cree_par, "ASSOCIATION_TELEPHONE", "appareil", f"{aid} « {nom} » pour {u['login']}")
        contenu = {"appareil_id": aid, "cle": P.b64(secret), "serveur_id": self.serveur_id,
                   "ecole": db.get_param("ecole_nom", "") or "", "utilisateur": {"login": u["login"], "nom": u["nom"]}}
        return 200, {"appareil_id": aid, "donnees": P.b64(P.sceller(cle, P.json_octets(contenu), P.AAD_APPAIRAGE))}

    def synchroniser(self, appareil_id: int, message: bytes) -> tuple[int, dict | bytes]:
        db = self.db
        a = db.one("SELECT * FROM appareil WHERE id=?", (appareil_id,))
        if a is None or not a["actif"]:
            return 401, {"erreur": "Ce téléphone n'est plus associé à l'ordinateur de l'école : associez-le à "
                                   "nouveau.", "code": "REVOQUE"}
        cle = P.unb64(a["cle"])
        try:
            req = json.loads(P.ouvrir(cle, message, P.aad_requete(appareil_id)).decode("utf-8"))
        except (P.ErreurProtocole, ValueError):
            return 400, {"erreur": "Message illisible : associez ce téléphone à nouveau.", "code": "CLE"}
        seq = int(req.get("seq") or 0)
        if seq <= a["dernier_seq"]:
            return 409, {"erreur": "Requête déjà reçue (rejeu refusé).", "code": "REJEU"}
        db.execute("UPDATE appareil SET dernier_seq=?, dernier_contact=datetime('now','localtime') WHERE id=?",
                   (seq, appareil_id))
        rep = self._traiter(dict(a), req)
        return 200, P.sceller(cle, P.json_octets(rep), P.aad_reponse(appareil_id, seq))

    def _traiter(self, a: dict, req: dict) -> dict:
        db = self.db
        self.ecole = db.get_param("ecole_nom", "") or ""
        u = db.one("SELECT actif FROM utilisateur WHERE id=?", (a["utilisateur_id"],))
        if u is None or not u["actif"]:
            return {"erreur": "Le compte de ce téléphone a été désactivé sur l'ordinateur.", "code": "COMPTE"}
        etat = self.etat_licence()
        s = licence.restreindre(security.load_session(db, a["utilisateur_id"]), etat)
        if not etat.utilisable:
            return {"erreur": etat.message, "code": "LICENCE", "instantane": donnees.instantane(db, s, etat)}
        ops = req.get("ops") or []
        if not isinstance(ops, list):
            ops = []
        app = donnees.Applicateur(db, s, a, req.get("admin"))
        res = app.appliquer(ops[:5000])
        ok = sum(1 for r in res if r.get("ok"))
        if ops:
            security.log(db, s.login, "SYNCHRO_TELEPHONE", "appareil",
                         f"« {a['nom']} » : {ok} saisie(s) appliquée(s) sur {len(ops)}")
        if app.modifie and self.quand_modifie:
            try:
                self.quand_modifie(set(app.modifie), a["nom"], ok)
            except Exception:      # noqa: BLE001 - l'affichage de l'ordinateur ne bloque pas la synchronisation
                log.exception("Notification de l'interface impossible")
        return {"resultats": res, "instantane": donnees.instantane(db, s, etat)}

    def presentation(self) -> dict:
        return {"service": APP_MARQUE, "version": __version__, "protocole": P.VERSION_PROTOCOLE,
                "serveur_id": self.serveur_id, "ecole": self.ecole}


class _Gestionnaire(BaseHTTPRequestHandler):
    srv: ServeurSynchro
    server_version = "AkwaSchool"
    sys_version = ""
    timeout = 30

    def log_message(self, fmt, *args):            # pas d'écriture sur la console
        log.debug("synchro %s - %s", self.client_address[0], fmt % args)

    def _repondre(self, code: int, corps: dict | bytes) -> None:
        if isinstance(corps, bytes):
            data, typ = corps, "application/octet-stream"
        else:
            data, typ = P.json_octets(corps), "application/json; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _corps(self) -> bytes | None:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > TAILLE_MAX:
            return None
        return self.rfile.read(n)

    def do_GET(self):
        if self.path.rstrip("/") == "/akwa":
            self._repondre(200, self.srv.presentation())
        else:
            self._repondre(404, {"erreur": "Adresse inconnue."})

    def do_POST(self):
        try:
            corps = self._corps()
            if corps is None:
                self._repondre(400, {"erreur": "Requête vide ou trop grande."})
            elif self.path == "/api/appairer":
                self._repondre(*self.srv.appairer(json.loads(corps.decode("utf-8"))))
            elif self.path == "/api/synchro":
                self._repondre(*self.srv.synchroniser(int(self.headers.get("X-Akwa-Appareil") or 0), corps))
            else:
                self._repondre(404, {"erreur": "Adresse inconnue."})
        except (P.ErreurProtocole, ValueError, KeyError, TypeError):
            self._repondre(400, {"erreur": "Requête invalide."})
        except Exception:      # noqa: BLE001
            log.exception("Erreur du serveur de synchronisation")
            self._repondre(500, {"erreur": "Erreur interne de l'ordinateur : voir le journal de l'application."})


# ---------------------------------------------------------------------- gestion des appareils (interface)
def lister_appareils(db: Database, utilisateur_id: int | None = None) -> list[dict]:
    sql = ("SELECT a.id, a.nom, a.actif, a.cree_le, a.cree_par, a.dernier_contact, u.login, u.nom AS utilisateur "
           "FROM appareil a JOIN utilisateur u ON u.id=a.utilisateur_id")
    params: tuple = ()
    if utilisateur_id is not None:
        sql += " WHERE a.utilisateur_id=?"
        params = (utilisateur_id,)
    return [dict(r) for r in db.query(sql + " ORDER BY a.actif DESC, a.cree_le DESC", params)]


def revoquer(db: Database, s: security.Session, appareil_id: int) -> None:
    """Un téléphone perdu ou remplacé ne peut plus se synchroniser (ses données sur le téléphone se verrouillent
    à la synchronisation suivante)."""
    a = db.one("SELECT nom, utilisateur_id FROM appareil WHERE id=?", (appareil_id,))
    if a is None:
        return
    if a["utilisateur_id"] != s.user_id:
        s.require("utilisateurs.gerer")
    db.execute("UPDATE appareil SET actif=0 WHERE id=?", (appareil_id,))
    security.log(db, s.login, "REVOCATION_TELEPHONE", "appareil", f"{appareil_id} « {a['nom']} »")
