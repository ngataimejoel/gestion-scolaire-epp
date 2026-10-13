"""Licence d'utilisation : essai, activation en ligne par code (1 an ou à vie), contrôle hors ligne.

- Internet n'est nécessaire qu'au moment de l'activation. Le service renvoie une licence signée
  (Ed25519) liée à cet ordinateur ; l'application la vérifie ensuite hors ligne avec la clé publique
  livrée dans resources/activation.json.
- Sans licence : 7 jours d'essai complets (comptés depuis le premier lancement, mémorisés à deux
  endroits pour qu'une réinstallation ne les remette pas à zéro), puis lecture seule (consultation, impression, export et
  sauvegarde restent possibles : les données de l'école ne sont jamais bloquées).
- Licence 1 an échue : même lecture seule, jusqu'à l'activation d'un nouveau code.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from epp import __version__
from epp.core import paths
from epp.core.paths import resource_path
from epp.core.security import PERMISSIONS, Session

ESSAI_JOURS = 7
FICHIER = "licence.json"
FICHIER_ESSAI = "essai.json"
# Ce qui reste permis quand la licence n'est pas (ou plus) valable
PERMISSIONS_LECTURE = {p for p in PERMISSIONS if p.endswith(".lire")} | {
    "rapports.generer", "export.excel", "sauvegarde.creer"}


class LicenceErreur(Exception):
    pass


@dataclass
class Etat:
    statut: str                 # active | essai | essai_termine | expiree | horloge
    type: str | None = None     # 1an | vie
    expire_le: datetime | None = None
    jours_restants: int | None = None
    ecole: str = ""
    code: str = ""

    @property
    def utilisable(self) -> bool:
        return self.statut in ("active", "essai")

    @property
    def message(self) -> str:
        if self.statut == "active" and self.type == "vie":
            return "Licence à vie activée."
        if self.statut == "active":
            return f"Licence valable jusqu'au {self.expire_le:%d/%m/%Y} ({self.jours_restants} jour(s))."
        if self.statut == "essai":
            return f"Version d'essai : {self.jours_restants} jour(s) restant(s)."
        if self.statut == "expiree":
            return "Licence expirée : l'application est en lecture seule. Activez un nouveau code."
        if self.statut == "horloge":
            return "La date de l'ordinateur semble avoir été reculée : corrigez-la pour continuer."
        return "Période d'essai terminée : l'application est en lecture seule. Activez un code."


def _config() -> dict:
    cfg = {"url": "", "cle_publique": ""}
    try:
        cfg.update(json.loads(Path(resource_path("resources", "activation.json")).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    cfg["url"] = os.environ.get("EPP_ACTIVATION_URL", cfg["url"]).rstrip("/")
    cfg["cle_publique"] = os.environ.get("EPP_LICENCE_CLE_PUBLIQUE", cfg["cle_publique"])
    return cfg


def empreinte_machine() -> str:
    """Identifiant anonyme de l'ordinateur (empreinte SHA-256, aucune donnée personnelle envoyée)."""
    ident = ""
    if sys.platform.startswith("win"):
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0,
                                winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as k:
                ident = winreg.QueryValueEx(k, "MachineGuid")[0]
        except OSError:
            pass
    else:
        for f in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            try:
                ident = Path(f).read_text().strip()
                break
            except OSError:
                pass
    if not ident:
        import uuid
        ident = f"{uuid.getnode():012x}"
    return hashlib.sha256(f"EPP-EXPERT|{ident}".encode()).hexdigest()


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _lire_json(nom: str) -> dict:
    try:
        return json.loads((paths.data_dir() / nom).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _ecrire_json(nom: str, data: dict) -> None:
    p = paths.data_dir() / nom
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def _b64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verifier(licence: str, signature: str, cle_publique: str | None = None, machine: str | None = None) -> dict | None:
    """Contenu de la licence si la signature est valable et qu'elle concerne cet ordinateur, sinon None."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    cle = cle_publique if cle_publique is not None else _config()["cle_publique"]
    if not cle or not licence or not signature:
        return None
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(cle)).verify(_b64u(signature), _b64u(licence))
        contenu = json.loads(_b64u(licence).decode("utf-8"))
    except (InvalidSignature, ValueError, TypeError):
        return None
    if contenu.get("machine") != (machine or empreinte_machine()):
        return None
    return contenu


# Copie des dates d'essai hors du dossier de données (registre de l'utilisateur sous Windows) :
# supprimer les données ou réinstaller ne relance pas la période d'essai.
_CLE_REGISTRE = r"Software\GestionScolaireEPP"


def _lire_secondaire() -> dict:
    f = os.environ.get("EPP_ESSAI_SECONDAIRE")
    try:
        if f or not sys.platform.startswith("win"):
            p = Path(f) if f else Path.home() / ".config" / "GestionScolaireEPP-essai.json"
            return json.loads(p.read_text(encoding="utf-8"))
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _CLE_REGISTRE) as k:
            return json.loads(winreg.QueryValueEx(k, "Essai")[0])
    except (OSError, ValueError):
        return {}


def _ecrire_secondaire(data: dict) -> None:
    f = os.environ.get("EPP_ESSAI_SECONDAIRE")
    try:
        if f or not sys.platform.startswith("win"):
            p = Path(f) if f else Path.home() / ".config" / "GestionScolaireEPP-essai.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(data), encoding="utf-8")
            return
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _CLE_REGISTRE) as k:
            winreg.SetValueEx(k, "Essai", 0, winreg.REG_SZ, json.dumps(data))
    except OSError:
        pass


def _lire_essai() -> dict:
    """Dates d'essai les plus défavorables des deux copies : premier lancement le plus ancien,
    dernière date vue la plus récente."""
    a, b = _lire_json(FICHIER_ESSAI), _lire_secondaire()
    out = {}
    debuts = [x["premier_lancement"] for x in (a, b) if x.get("premier_lancement")]
    vues = [x["derniere_date_vue"] for x in (a, b) if x.get("derniere_date_vue")]
    if debuts:
        out["premier_lancement"] = min(debuts, key=datetime.fromisoformat)
    if vues:
        out["derniere_date_vue"] = max(vues, key=datetime.fromisoformat)
    return out


def etat(maintenant: datetime | None = None) -> Etat:
    now = maintenant or _maintenant()
    essai = _lire_essai()
    vue = essai.get("derniere_date_vue")
    if vue and datetime.fromisoformat(vue) > now + timedelta(days=1):
        return Etat("horloge")
    if maintenant is None or "premier_lancement" not in essai:   # seule l'horloge réelle est mémorisée
        essai["derniere_date_vue"] = max(filter(None, [vue, now.isoformat()]), key=datetime.fromisoformat)
        essai.setdefault("premier_lancement", now.isoformat())
        _ecrire_json(FICHIER_ESSAI, essai)
        _ecrire_secondaire(essai)

    lic = _lire_json(FICHIER)
    contenu = verifier(lic.get("licence", ""), lic.get("signature", ""))
    if contenu:
        exp = datetime.fromisoformat(contenu["expire_le"].replace("Z", "+00:00")) if contenu.get("expire_le") else None
        if exp is None:
            return Etat("active", contenu["type"], None, None, contenu.get("ecole", ""), contenu.get("code", ""))
        jours = (exp - now).days
        return Etat("active" if now <= exp else "expiree", contenu["type"], exp, max(jours, 0),
                    contenu.get("ecole", ""), contenu.get("code", ""))
    debut = datetime.fromisoformat(essai["premier_lancement"])
    reste = ESSAI_JOURS - (now - debut).days
    return Etat("essai" if reste > 0 else "essai_termine", jours_restants=max(reste, 0))


def activer(code: str, ecole: str = "", url: str | None = None, timeout: float = 20) -> Etat:
    """Active un code auprès du service en ligne et enregistre la licence reçue."""
    cfg = _config()
    url = (url or cfg["url"]).rstrip("/")
    if not url or not cfg["cle_publique"]:
        raise LicenceErreur("Le service d'activation n'est pas configuré dans cette version.")
    machine = empreinte_machine()
    actuelle = _lire_json(FICHIER)
    corps = {"code": code.strip(), "machine": machine, "ecole": ecole, "version": __version__,
             "licence_actuelle": actuelle.get("licence"), "signature_actuelle": actuelle.get("signature")}
    req = urllib.request.Request(f"{url}/api/activer", data=json.dumps(corps).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            rep = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("erreur")
        except ValueError:
            msg = None
        raise LicenceErreur(msg or f"Le service d'activation a répondu par une erreur ({e.code}).") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise LicenceErreur("Impossible de joindre le service d'activation. Vérifiez la connexion Internet "
                            "et réessayez.") from None
    if not verifier(rep.get("licence", ""), rep.get("signature", ""), cfg["cle_publique"], machine):
        raise LicenceErreur("La réponse du service d'activation n'est pas authentique.")
    _ecrire_json(FICHIER, {"licence": rep["licence"], "signature": rep["signature"],
                           "enregistre_le": _maintenant().isoformat()})
    return etat()


def restreindre(s: Session, e: Etat) -> Session:
    """Session limitée à la consultation quand la licence n'est pas (ou plus) valable."""
    if e.utilisable:
        return s
    return Session(s.user_id, s.login, s.nom, s.role_code, s.role_libelle, set(s.permissions) & PERMISSIONS_LECTURE)
