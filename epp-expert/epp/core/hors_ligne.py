"""Activation sans Internet (zones sans réseau).

L'appareil de l'école affiche un « code de demande » court, tiré de son empreinte. Le fournisseur le saisit dans
son générateur hors ligne, qui renvoie un « code de licence » signé (Ed25519) pour cet appareil seulement.
L'application vérifie la signature avec les clés publiques connues : aucune connexion n'est nécessaire.

Format (identique dans le téléphone, voir android/.../noyau/HorsLigne.java) :
  demande : SHA-256("AKWA-HL|" + empreinte) → 75 premiers bits (15 caractères) + 1 caractère de contrôle ;
  charge utile (6 octets) : version 1 et type sur 1 octet, jour d'expiration sur 2 (0 : à vie, compté depuis
  le 1er janvier 2026), numéro de série sur 3 ;
  message signé : "AKWA-HL1|" + 15 caractères de la demande + charge utile ;
  code : charge utile + signature (70 octets) écrits en 112 caractères de ALPHABET, par groupes de 4.

Code court (25 caractères, « XXXXX-XXXXX-XXXXX-XXXXX-XXXXX ») : 125 bits, soit 20 bits de charge utile (numéro de
clé sur 3, type sur 3, jour d'émission sur 14) et 105 bits de sceau HMAC-SHA256. Trop court pour une signature à clé
publique : le secret de vérification est donc dans l'application. Protections :
  - le secret n'est pas dans le dépôt public : la CI l'injecte à la compilation (secret GitHub), masqué ;
  - il est dérivé à sens unique de la clé maîtresse du fournisseur (sha256), qu'il ne permet pas de retrouver :
    la clé du service en ligne et les codes longs restent sûrs même s'il est extrait d'une application ;
  - numéro de clé : si un secret fuit, le générateur passe au numéro suivant et la version suivante de
    l'application refuse l'ancien numéro, sans changer de clé maîtresse ;
  - code lié à l'appareil (code de demande), type et date scellés, 2^105 essais pour deviner un code.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import date, datetime, timedelta, timezone

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"     # ni 0, 1, I ni O : pas de confusion à la saisie
TYPES = ("", "1an", "vie", "ens1an", "ensvie")
ORIGINE = date(2026, 1, 1)
LONGUEUR_CODE = 112


class CodeInvalide(ValueError):
    pass


def nettoyer(texte: str) -> str:
    return "".join(c for c in (texte or "").upper() if c in ALPHABET)


def _controle(c15: str) -> str:
    return ALPHABET[sum((i + 1) * ALPHABET.index(c) for i, c in enumerate(c15)) % 32]


def _bits(octets: bytes, n: int) -> str:
    v = int.from_bytes(octets, "big")
    total = len(octets) * 8
    return "".join(ALPHABET[(v >> (total - 5 * (i + 1))) & 31] for i in range(n))


def grouper(code: str, taille: int = 4) -> str:
    return "-".join(code[i:i + taille] for i in range(0, len(code), taille))


def demande(empreinte: str) -> str:
    """Code de demande de cet appareil (16 caractères, « XXXX-XXXX-XXXX-XXXX »)."""
    h = hashlib.sha256(f"AKWA-HL|{empreinte}".encode()).digest()
    c15 = _bits(h[:10], 15)
    return grouper(c15 + _controle(c15))


def demande_valide(texte: str) -> str:
    """Les 15 caractères utiles d'un code de demande saisi, ou CodeInvalide (faute de frappe)."""
    c = nettoyer(texte)
    if len(c) != 16 or _controle(c[:15]) != c[15]:
        raise CodeInvalide("Code de demande incorrect : vérifiez les 16 caractères.")
    return c[:15]


def charge_utile(type_: str, expire: date | None, serie: int) -> bytes:
    jours = 0 if expire is None else (expire - ORIGINE).days
    if type_ not in TYPES[1:] or not 0 <= jours < 65536 or not 0 <= serie < 1 << 24:
        raise ValueError("licence hors ligne impossible")
    return bytes([0x10 | TYPES.index(type_)]) + jours.to_bytes(2, "big") + serie.to_bytes(3, "big")


def message(demande15: str, charge: bytes) -> bytes:
    return b"AKWA-HL1|" + demande15.encode("ascii") + charge


def coder(octets: bytes) -> str:
    return _bits(octets, len(octets) * 8 // 5)


def decoder(code: str) -> bytes:
    c = nettoyer(code)
    if len(c) != LONGUEUR_CODE:
        raise CodeInvalide("Code de licence incomplet : il compte 112 caractères (28 groupes de 4).")
    v = 0
    for x in c:
        v = (v << 5) | ALPHABET.index(x)
    return v.to_bytes(70, "big")


def est_code_hors_ligne(texte: str) -> bool:
    return len(nettoyer(texte)) >= 100


def verifier(code: str, empreinte: str, cles: list[str]) -> dict | None:
    """Contenu {type, expire_le, code} si le code est signé par une des clés pour cet appareil, sinon None."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        brut = decoder(code)
    except CodeInvalide:
        return None
    charge, signature = brut[:6], brut[6:]
    if charge[0] >> 4 != 1 or not 1 <= (charge[0] & 15) < len(TYPES):
        return None
    m = message(nettoyer(demande(empreinte))[:15], charge)
    for cle in cles:
        try:
            Ed25519PublicKey.from_public_bytes(base64.b64decode(cle)).verify(signature, m)
        except (InvalidSignature, ValueError, TypeError):
            continue
        jours = int.from_bytes(charge[1:3], "big")
        expire = None if jours == 0 else datetime.combine(ORIGINE + timedelta(days=jours), datetime.max.time(),
                                                          timezone.utc).replace(microsecond=0)
        return {"type": TYPES[charge[0] & 15], "expire_le": expire.isoformat() if expire else None,
                "code": f"HL-{int.from_bytes(charge[3:], 'big'):06d}"}
    return None


# ---------------------------------------------------------------------- code court (25 caractères)
LONGUEUR_COURT = 25
JOURS_AN = 365


def secret_court(graine: bytes, numero: int) -> bytes:
    """Secret de vérification n° ``numero``, dérivé à sens unique de la clé maîtresse du fournisseur."""
    return hashlib.sha256(b"AKWA-CODE25|%d|" % numero + graine).digest()


def masque(numero: int) -> bytes:
    return hashlib.sha256(b"AKWA-AC|%d" % numero).digest()


def _xor(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def lire_cles_courtes(texte: str, masquees: bool = False) -> dict[int, bytes]:
    """« 1:base64,2:base64 » → {numéro: secret} ; ``masquees`` : valeurs injectées dans l'application."""
    cles = {}
    for partie in (texte or "").replace(";", ",").split(","):
        n, _, v = partie.strip().partition(":")
        try:
            numero, brut = int(n), base64.b64decode(v.strip(), validate=True)
        except ValueError:
            continue
        if 1 <= numero <= 7 and len(brut) == 32:
            cles[numero] = _xor(brut, masque(numero)) if masquees else brut
    return cles


def ecrire_cles_courtes(cles: dict[int, bytes], masquees: bool = False) -> str:
    return ",".join(f"{n}:{base64.b64encode(_xor(c, masque(n)) if masquees else c).decode()}"
                    for n, c in sorted(cles.items()))


def grouper_court(code: str) -> str:
    return grouper(code, 5)


def est_code_court(texte: str) -> bool:
    return len(nettoyer(texte)) == LONGUEUR_COURT


def _sceau(secret: bytes, demande15: str, charge: int) -> int:
    m = b"AKWA-HL25|" + demande15.encode("ascii") + charge.to_bytes(3, "big")
    return int.from_bytes(hmac.new(secret, m, hashlib.sha256).digest()[:14], "big") >> 7      # 105 bits


def coder_court(secret: bytes, numero: int, demande: str, type_: str, emis: date) -> str:
    """Code court (groupé 5-5-5-5-5) pour le code de demande saisi."""
    d15 = demande_valide(demande)
    jour = (emis - ORIGINE).days
    if not 1 <= numero <= 7 or type_ not in TYPES[1:] or not 0 <= jour < 1 << 14:
        raise ValueError("licence hors ligne impossible")
    charge = numero << 17 | TYPES.index(type_) << 14 | jour
    v = charge << 105 | _sceau(secret, d15, charge)
    return grouper_court("".join(ALPHABET[(v >> (5 * (24 - i))) & 31] for i in range(25)))


def verifier_court(code: str, empreinte: str, cles: dict[int, bytes]) -> dict | None:
    """Contenu {type, expire_le, code} si le code court est scellé pour cet appareil par une clé connue."""
    c = nettoyer(code)
    if len(c) != LONGUEUR_COURT:
        return None
    v = 0
    for x in c:
        v = (v << 5) | ALPHABET.index(x)
    charge, sceau = v >> 105, v & ((1 << 105) - 1)
    numero, t, jour = charge >> 17, (charge >> 14) & 7, charge & 0x3FFF
    secret = cles.get(numero)
    if secret is None or not 1 <= t < len(TYPES):
        return None
    attendu = _sceau(secret, nettoyer(demande(empreinte))[:15], charge)
    if not hmac.compare_digest(attendu.to_bytes(14, "big"), sceau.to_bytes(14, "big")):
        return None
    type_ = TYPES[t]
    expire = None
    if type_.endswith("1an"):
        expire = datetime.combine(ORIGINE + timedelta(days=jour + JOURS_AN), datetime.max.time(),
                                  timezone.utc).replace(microsecond=0)
    return {"type": type_, "expire_le": expire.isoformat() if expire else None, "code": f"HC-{sceau >> 85:07d}"}
