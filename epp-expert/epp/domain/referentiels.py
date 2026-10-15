"""Référentiels officiels livrés avec l'application : sous-préfectures et nationalités.

Les deux fichiers (epp/resources/referentiels) reprennent les fichiers SOUSPREFECTURES et
CODENATIONALITES du ministère (colonnes « code;libellé », UTF-8). Les recherches ignorent la casse,
les accents et la ponctuation, comme le prototype (fonctions natOff et spCode).
"""
from __future__ import annotations

import csv
import re
import unicodedata
from functools import lru_cache

from epp.core.paths import resource_path

NATIONALITE_DEFAUT = "IVOIRIENNE"


def norm(v) -> str:
    """« Burkinabè » -> « burkinabe » : minuscules, sans accents ni caractères autres que lettres et chiffres."""
    s = unicodedata.normalize("NFD", str(v or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


@lru_cache(maxsize=None)
def _lire(nom: str) -> tuple[tuple[str, str], ...]:
    chemin = resource_path("resources", "referentiels", nom)
    with open(chemin, encoding="utf-8-sig", newline="") as f:
        lignes = list(csv.reader(f, delimiter=";"))
    return tuple((c.strip(), l.strip()) for c, l, *_ in lignes[1:] if c.strip() and l.strip())


def sous_prefectures() -> list[tuple[str, str]]:
    """Sous-préfectures de Côte d'Ivoire : [(code, libellé)], ex. (« SP000725 », « OUANINOU »), par ordre alphabétique."""
    return list(_lire("sous_prefectures_ci.csv"))


def nationalites() -> list[tuple[str, str]]:
    """Nationalités officielles : [(code, libellé)], IVOIRIENNE en premier."""
    return list(_lire("nationalites.csv"))


@lru_cache(maxsize=None)
def _index_sp() -> dict[str, tuple[str, str]]:
    return {norm(l): (c, l) for c, l in reversed(_lire("sous_prefectures_ci.csv"))}


@lru_cache(maxsize=None)
def _index_nat() -> dict[str, tuple[str, str]]:
    return {norm(l): (c, l) for c, l in reversed(_lire("nationalites.csv"))}


def nom_sous_prefecture(v) -> str:
    """« Sous-préfecture de Touba » -> « Touba » (préfixe retiré)."""
    return re.sub(r"^\s*sous[-\s]?pr[ée]fecture\s+(de\s+|d['’]\s*)?", "", str(v or ""), flags=re.I).strip()


def code_sp(libelle) -> str:
    """Code officiel d'une sous-préfecture d'après son nom (« Sous-préfecture de Touba » -> « SP000726 ») ;
    chaîne vide si le nom est inconnu. Un code déjà au format SPxxxxxx est rendu tel quel s'il existe."""
    v = str(libelle or "").strip()
    if re.fullmatch(r"(?i)SP\d{6}", v):
        v = v.upper()
        return v if any(c == v for c, _ in _lire("sous_prefectures_ci.csv")) else ""
    n = norm(nom_sous_prefecture(v))
    return _index_sp()[n][0] if n and n in _index_sp() else ""


def libelle_sp(code) -> str:
    """Libellé officiel d'une sous-préfecture d'après son code (« SP000725 » -> « OUANINOU »)."""
    c = str(code or "").strip().upper()
    return next((l for k, l in _lire("sous_prefectures_ci.csv") if k == c), "")


def sous_prefecture_officielle(v) -> str:
    """Nom saisi librement ramené au libellé officiel (« ouaninou » -> « OUANINOU ») ; sinon le texte en majuscules."""
    n = norm(nom_sous_prefecture(v))
    if not n:
        return ""
    f = _index_sp().get(n)
    return f[1] if f else nom_sous_prefecture(v).upper()


def nationalite_officielle(v) -> str:
    """Nationalité saisie librement ramenée à la valeur officielle (« Burkinabè » -> « BURKINABE ») ;
    un code (« 75 ») est aussi accepté. Valeur inconnue : le texte en majuscules ; vide : « »."""
    s = str(v or "").strip()
    n = norm(s)
    if not n:
        return ""
    f = _index_nat().get(n)
    if f:
        return f[1]
    if s.isdigit():
        f = next((l for c, l in _lire("nationalites.csv") if c == s), None)
        if f:
            return f
    return s.upper()


def code_nationalite(v) -> str:
    """Code officiel d'une nationalité (« IVOIRIENNE » -> « 70 ») ; chaîne vide si inconnue."""
    f = _index_nat().get(norm(v))
    return f[0] if f else ""
