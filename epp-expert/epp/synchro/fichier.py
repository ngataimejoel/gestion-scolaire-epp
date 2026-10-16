"""Synchronisation par fichier, quand le téléphone n'est pas sur le Wi-Fi de l'école.

Le téléphone (déjà associé) crée un fichier de demande (.akwasync) qu'on envoie par WhatsApp, e-mail ou clé
USB. L'ordinateur l'importe (page Téléphones), applique les saisies exactement comme par le Wi-Fi et produit un
fichier de réponse, que le téléphone ouvre à son tour pour recevoir les données à jour.

Les deux fichiers sont du JSON dont seule l'enveloppe est lisible (format, identifiants, numéro) : le contenu
est chiffré et authentifié (AES-256-GCM) avec la clé de l'appareil, comme une synchronisation par le Wi-Fi, avec
le même compteur anti-rejeu. Un fichier intercepté est illisible, un fichier modifié est refusé, un fichier
déjà importé ne l'est pas une seconde fois. Le mot de passe administrateur (corrections, suppressions, premier
envoi d'un téléphone utilisé seul) n'est pas dans le fichier : il est saisi sur l'ordinateur à l'import.
Même format côté Java : android/.../synchro/FichierSynchro.java.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Callable

from epp.core import licence
from epp.core.db import Database
from epp.synchro import protocole as P

FORMAT = "AKWA-SCHOOL/synchro"
EXTENSION = ".akwasync"
TAILLE_MAX = 64 * 1024 * 1024


class FichierInvalide(ValueError):
    pass


def lire_enveloppe(contenu: bytes, sens: str) -> dict:
    if len(contenu) > TAILLE_MAX:
        raise FichierInvalide("Fichier trop volumineux.")
    try:
        e = json.loads(contenu.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        e = None
    if not isinstance(e, dict) or e.get("format") != FORMAT:
        raise FichierInvalide("Ce fichier n'est pas un fichier de synchronisation AKWA SCHOOL (.akwasync).")
    if e.get("sens") != sens:
        raise FichierInvalide("Ce fichier est une réponse de l'ordinateur, destinée au téléphone : importez le fichier "
                              "créé par le téléphone." if sens == "demande" else
                              "Ce fichier est une demande du téléphone, destinée à l'ordinateur.")
    if not isinstance(e.get("appareil_id"), int) or not isinstance(e.get("seq"), int):
        raise FichierInvalide("Fichier de synchronisation incomplet.")
    return e


def nom_fichier(appareil: str, sens: str, seq: int) -> str:
    ascii_ = unicodedata.normalize("NFKD", appareil or "").encode("ascii", "ignore").decode()
    nom = re.sub(r"[^A-Za-z0-9]+", "-", ascii_).strip("-")[:30] or "telephone"
    return f"AKWA-{nom}-{sens.upper()}-{seq}{EXTENSION}"


def _enveloppe(sens: str, serveur_id: str, appareil_id: int, seq: int, **champs) -> bytes:
    e = {"format": FORMAT, "v": 1, "sens": sens, "serveur_id": serveur_id, "appareil_id": appareil_id, "seq": seq,
         "cree_le": datetime.now().isoformat(timespec="seconds"), **champs}
    return json.dumps(e, ensure_ascii=False, indent=0).encode("utf-8")


def demande(cle: bytes, serveur_id: str, appareil_id: int, seq: int, requete: dict, appareil: str = "") -> bytes:
    """Fichier de demande, tel que le crée le téléphone (sert aux tests et à la vérification croisée Java)."""
    msg = P.sceller(cle, P.json_octets({**requete, "seq": seq}), P.aad_requete(appareil_id))
    return _enveloppe("demande", serveur_id, appareil_id, seq, appareil=appareil, message=P.b64(msg))


def ouvrir_reponse(cle: bytes, appareil_id: int, contenu: bytes) -> dict:
    """Lecture d'une réponse, comme le téléphone (tests)."""
    e = lire_enveloppe(contenu, "reponse")
    if e.get("erreur"):
        return {"erreur": e["erreur"], "code": e.get("code")}
    return json.loads(P.ouvrir(cle, P.unb64(e["message"]), P.aad_reponse(appareil_id, e["seq"])))


class ImportFichier:
    """Import, sur l'ordinateur, d'un fichier créé par un téléphone associé ; utilise sa propre connexion à la
    base (le serveur Wi-Fi peut tourner en même temps)."""

    def __init__(self, db_path: str | Path, etat_licence: Callable[[], licence.Etat] = licence.etat,
                 quand_modifie: Callable[[set, str, int], None] | None = None):
        self.db_path, self.etat_licence, self.quand_modifie = Path(db_path), etat_licence, quand_modifie

    def _serveur(self):
        from epp.synchro.serveur import ServeurSynchro, serveur_id
        srv = ServeurSynchro(self.db_path, etat_licence=self.etat_licence, quand_modifie=self.quand_modifie)
        srv.db = Database(self.db_path)
        srv.serveur_id = serveur_id(srv.db)
        return srv

    def _ouvrir(self, contenu: bytes, admin: str | None, lire_seulement: bool):
        e = lire_enveloppe(contenu, "demande")
        srv = self._serveur()
        try:
            if e.get("serveur_id") and e["serveur_id"] != srv.serveur_id:
                raise FichierInvalide("Ce fichier vient d'un téléphone associé à un autre ordinateur.")
            try:
                message = P.unb64(str(e.get("message") or ""))
            except P.ErreurProtocole:
                raise FichierInvalide("Fichier de synchronisation abîmé.") from None
            statut, rep, cle, seq = srv.recevoir(e["appareil_id"], message, admin, lire_seulement)
            if statut != 200 and rep.get("code") == "CLE":
                rep = {**rep, "erreur": "Fichier illisible : il a été modifié, ou le téléphone a été associé de "
                                        "nouveau depuis."}
            return e, srv, statut, rep, cle, seq
        except BaseException:
            srv.db.close()
            raise

    def examiner(self, contenu: bytes) -> dict:
        """Aperçu avant import : téléphone, compte, contenu de la demande (rien n'est appliqué)."""
        e, srv, statut, rep, _, seq = self._ouvrir(contenu, None, True)
        try:
            if statut != 200:
                return {"erreur": rep["erreur"], "code": rep.get("code"), "seq": seq}
            a, req = rep["appareil"], rep["requete"]
            u = srv.db.one("SELECT login, nom FROM utilisateur WHERE id=?", (a["utilisateur_id"],))
            par_type: dict[str, int] = {}
            for o in req.get("ops") or []:
                par_type[o.get("op", "?")] = par_type.get(o.get("op", "?"), 0) + 1
            f = req.get("fusion") if isinstance(req.get("fusion"), dict) else None
            return {"appareil": a["nom"], "compte": f"{u['nom']} ({u['login']})" if u else "?", "seq": seq,
                    "cree_le": e.get("cree_le"), "ops": len(req.get("ops") or []), "par_type": par_type,
                    "fusion": {"eleves": len(f.get("eleves") or []), "classes": len(f.get("classes") or []),
                               "notes": sum(len(v) for v in (f.get("notes") or {}).values())} if f else None}
        finally:
            srv.db.close()

    def importer(self, contenu: bytes, admin: str | None = None) -> tuple[str, bytes, dict]:
        """Applique la demande et renvoie (nom du fichier de réponse, contenu, réponse en clair)."""
        e, srv, statut, rep, cle, seq = self._ouvrir(contenu, admin or None, False)
        try:
            aid = e["appareil_id"]
            nom = srv.db.scalar("SELECT nom FROM appareil WHERE id=?", (aid,)) or str(e.get("appareil") or "")
            if statut != 200:
                data = _enveloppe("reponse", srv.serveur_id, aid, seq, erreur=rep["erreur"], code=rep.get("code"))
            else:
                msg = P.sceller(cle, P.json_octets(rep), P.aad_reponse(aid, seq))
                data = _enveloppe("reponse", srv.serveur_id, aid, seq, ecole=srv.ecole, message=P.b64(msg))
            return nom_fichier(nom, "reponse", seq), data, rep
        finally:
            srv.db.close()


def resume_reponse(rep: dict) -> str:
    """Compte rendu affiché sur l'ordinateur après l'import."""
    if rep.get("erreur") and not rep.get("resultats"):
        return rep["erreur"]
    res = rep.get("resultats") or []
    ok = sum(1 for r in res if r.get("ok"))
    admin = sum(1 for r in res if not r.get("ok") and r.get("code") == "ADMIN_REQUIS")
    refus = [r.get("message") or "?" for r in res if not r.get("ok") and r.get("code") != "ADMIN_REQUIS"]
    lignes = [f"{ok} saisie(s) appliquée(s)."]
    f = rep.get("fusion")
    if f:
        lignes.insert(0, f"Données du téléphone ajoutées : {f['eleves_ajoutes']} élève(s), {f['notes_ajoutees']} "
                         f"note(s), {f['absences_ajoutees']} absence(s) ; {len(f['differences'])} différence(s) "
                         f"signalée(s) au téléphone.")
    if admin:
        lignes.append(f"{admin} correction(s) en attente : mot de passe administrateur absent ou incorrect.")
    if refus:
        lignes.append(f"{len(refus)} refusée(s) : " + " ; ".join(refus[:5]) + (" …" if len(refus) > 5 else ""))
    if rep.get("erreur"):
        lignes.append(rep["erreur"])
    return "\n".join(lignes)
