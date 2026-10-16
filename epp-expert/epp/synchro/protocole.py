"""Protocole de synchronisation avec l'application Android (même algorithme côté Java, voir
android/app/src/main/java/com/akwaschool/mobile/synchro/Protocole.java).

Appairage (une fois par téléphone) :
    L'ordinateur affiche un code de 8 caractères valable 10 minutes. Le téléphone tire un sel aléatoire et
    dérive K = PBKDF2-HMAC-SHA256(code, « AKWA-SCHOOL/appairage/ » + sel, 150 000 itérations, 32 octets).
    Il envoie le sel et la preuve HMAC-SHA256(K, « preuve ») : le code lui-même ne circule jamais sur le
    réseau. L'ordinateur, qui connaît le code, vérifie la preuve et renvoie la clé secrète de l'appareil
    chiffrée par K (AES-256-GCM). Cinq preuves fausses annulent le code.

Synchronisation (ensuite) :
    Chaque requête et chaque réponse est chiffrée et authentifiée par AES-256-GCM avec la clé de l'appareil
    (nonce aléatoire de 12 octets en tête du message). La requête porte un compteur strictement croissant :
    une requête rejouée est refusée. Rien de lisible ne circule sur le Wi-Fi.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION_PROTOCOLE = 1
PORT_HTTP = 8765               # requêtes du téléphone
PORT_DECOUVERTE = 8766         # diffusion UDP « où est l'ordinateur de l'école ? »
QUESTION_DECOUVERTE = b"AKWA-SCHOOL?"
ALPHABET_CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"     # sans O/0 ni I/1 : pas de confusion à la lecture
LONGUEUR_CODE = 8
ITERATIONS = 150_000
SEL_APPAIRAGE = b"AKWA-SCHOOL/appairage/"
AAD_APPAIRAGE = b"akwa/appairage"


class ErreurProtocole(ValueError):
    pass


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def unb64(texte: str) -> bytes:
    try:
        return base64.b64decode(texte, validate=True)
    except (ValueError, TypeError):
        raise ErreurProtocole("donnée base64 invalide") from None


def nouveau_code() -> str:
    return "".join(secrets.choice(ALPHABET_CODE) for _ in range(LONGUEUR_CODE))


def normaliser_code(code: str) -> str:
    """« abcd-efgh » ou « ABCD EFGH » → « ABCDEFGH »."""
    return "".join(c for c in (code or "").upper() if c.isalnum())


def afficher_code(code: str) -> str:
    c = normaliser_code(code)
    return f"{c[:4]}-{c[4:]}"


def cle_appairage(code: str, sel: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", normaliser_code(code).encode("ascii"), SEL_APPAIRAGE + sel, ITERATIONS, 32)


def preuve(cle: bytes) -> bytes:
    return hmac.new(cle, b"preuve", hashlib.sha256).digest()


def preuve_valide(cle: bytes, recue: bytes) -> bool:
    return hmac.compare_digest(preuve(cle), recue)


def sceller(cle: bytes, donnees: bytes, aad: bytes) -> bytes:
    """nonce (12 octets) + texte chiffré + étiquette d'authentification."""
    nonce = os.urandom(12)
    return nonce + AESGCM(cle).encrypt(nonce, donnees, aad)


def ouvrir(cle: bytes, message: bytes, aad: bytes) -> bytes:
    if len(message) < 12 + 16:
        raise ErreurProtocole("message trop court")
    try:
        return AESGCM(cle).decrypt(message[:12], message[12:], aad)
    except InvalidTag:
        raise ErreurProtocole("message altéré ou clé incorrecte") from None


def aad_requete(appareil_id: int) -> bytes:
    return f"akwa/requete/{appareil_id}".encode("ascii")


def aad_reponse(appareil_id: int, seq: int) -> bytes:
    return f"akwa/reponse/{appareil_id}/{seq}".encode("ascii")


def json_octets(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
