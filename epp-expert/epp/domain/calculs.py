"""Règles de calcul du classeur, reproduites à l'identique.

Chaque fonction cite la formule Excel d'origine. Les arrondis suivent la
fonction ARRONDI d'Excel (demi vers l'extérieur, précision de 15 chiffres).
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Sequence


def xround(x: float, n: int = 2) -> float:
    """ARRONDI(x; n) d'Excel."""
    d = Decimal(format(float(x), ".15g"))
    return float(d.quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP))


def to_date(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v if not hasattr(v, "date") else v.date()
    s = str(v)[:10]
    try:
        y, m, d = (int(p) for p in s.split("-"))
        return date(y, m, d)
    except ValueError:
        return None


def datedif_years(debut, fin) -> int | None:
    """DATEDIF(debut; fin; "y") : nombre d'années révolues."""
    d1, d2 = to_date(debut), to_date(fin)
    if d1 is None or d2 is None:
        return None
    if d2 < d1:
        return None  # Excel renvoie #NOMBRE!
    years = d2.year - d1.year
    if (d2.month, d2.day) < (d1.month, d1.day):
        years -= 1
    return years


def moyenne_evaluation(notes: Sequence[tuple[float | None, float]], mode: str, echelle: float,
                       present: bool = True) -> tuple[float | None, float | None]:
    """Total et moyenne d'une évaluation pour un élève.

    notes : liste (note ou None, coefficient ou barème) dans l'ordre des matières.
    mode COEF (NOTES CP) :
        =SI($G="NON";0;SI(NB(H:O)=0;"";ARRONDI(SOMMEPROD(H:O;coef)/SOMMEPROD(ESTNUM(H:O)*coef);2)))
    mode BAREME (NOTES CE1 à CM2) :
        total   =SI(absent;0;SI(NB=0;"";SOMME(notes)))
        moyenne =SI(absent;0;SI(NB=0;"";ARRONDI(SOMME(notes)/SOMMEPROD(ESTNUM(notes)*barème)*échelle;2)))
    Le classeur n'affiche pas de total en CP ; l'application donne la somme des notes pondérées
    par leur coefficient (demande de l'utilisateur, 14/10/2026), la moyenne reste celle du classeur.
    """
    if not present:
        return 0.0, 0.0
    saisies = [(n, w) for n, w in notes if n is not None]
    if not saisies:
        return None, None
    if mode == "COEF":
        den = sum(w for _, w in saisies)
        if den == 0:
            return None, None
        pondere = sum(n * w for n, w in saisies)
        return xround(pondere, 2), xround(pondere / den, 2)
    total = sum(n for n, _ in saisies)
    den = sum(w for _, w in saisies)
    if den == 0:
        return total, None
    return total, xround(total / den * echelle, 2)


def moyenne_compositions(moyennes: Iterable[float | None]) -> float | None:
    """RESULTATS!J : =SI(NB(G:I)=0;"";ARRONDI(MOYENNE(G:I);2))"""
    vals = [m for m in moyennes if m is not None]
    return xround(sum(vals) / len(vals), 2) if vals else None


def mga_standard(moy3: float | None, passage: float | None) -> float | None:
    """RESULTATS!L : =SI(OU(J="";K="");"";ARRONDI((J+2*K)/3;2))"""
    if moy3 is None or passage is None:
        return None
    return xround((moy3 + 2 * passage) / 3, 2)


def mga_moyenne4(moyennes: Sequence[float | None]) -> float | None:
    """RESULTATS CM2!J : =SI(NB(F:I)<4;"";ARRONDI(SOMME(F:I)/4;2))"""
    vals = [m for m in moyennes if m is not None]
    if len(vals) < 4:
        return None
    return xround(sum(vals) / 4, 2)


def decision(statut: str, mga: float | None, seuil: float) -> str | None:
    """RESULTATS!O : ABANDON / TRANSFERE selon le statut, sinon ADMIS si MGA >= seuil, sinon REDOUBLE."""
    if statut == "ABANDON":
        return "ABANDON"
    if statut == "TRANSFERE":
        return "TRANSFERE"
    if mga is None:
        return None
    return "ADMIS" if mga >= seuil else "REDOUBLE"


def observation(dec: str | None, mga: float | None, bareme: float) -> str | None:
    """RESULTATS!Q : mention selon la MGA ramenée sur 10."""
    if dec == "ADMIS" and mga is not None:
        s = mga / bareme * 10
        if s >= 8:
            return "Très bien"
        if s >= 7:
            return "Bien"
        if s >= 6:
            return "Assez bien"
        return "Passable"
    if dec == "REDOUBLE":
        return "Insuffisant"
    return None


def rangs(valeurs: dict, eligibles: set) -> dict:
    """RESULTATS!P : rang = 1 + nombre d'éligibles ayant une valeur strictement supérieure."""
    pool = [valeurs[k] for k in eligibles if valeurs.get(k) is not None]
    out = {}
    for k in eligibles:
        v = valeurs.get(k)
        if v is not None:
            out[k] = sum(1 for x in pool if x > v) + 1
    return out


def taux(num: float, den: float) -> float:
    """=SI(den=0;0;num/den)"""
    return 0.0 if not den else num / den


def taux_frequentation(jours_absence: float, effectif: int, jours_classe: int | None) -> float | None:
    """RAPPORT MENSUEL!H : =SI(OU(eff=0;jours="";jours=0);"";MAX(0;1-abs/(eff*jours)))"""
    if not effectif or not jours_classe:
        return None
    return max(0.0, 1 - jours_absence / (effectif * jours_classe))


AGE_NORMAL = {"CP1": 6, "CP2": 7, "CE1": 8, "CE2": 9, "CM1": 10, "CM2": 11}


def sur_age(classe: str, age: int | None, ecart: int = 3) -> bool:
    """TABLEAU DE BORD!J17 (corrigé, voir audit A1) : âge >= âge normal + 3."""
    if age is None or classe not in AGE_NORMAL:
        return False
    return age >= AGE_NORMAL[classe] + ecart


MATRICULE_DESPS_AIDE = "9 caractères, avec une lettre majuscule au début ou à la fin (ex. A12345678 ou 12345678B)."


def matricule_desps_valide(m: str | None) -> bool:
    """REGISTRE ELEVES!C : NBCAR=9 et une majuscule A-Z en première ou dernière position."""
    if not m:
        return True
    if len(m) != 9:
        return False
    return ("A" <= m[0] <= "Z") or ("A" <= m[-1] <= "Z")


def matricule_ecole(classe: str, numero: int, annee_libelle: str) -> str:
    """REGISTRE ELEVES!B : CLASSE-NNN-AA."""
    return f"{classe}-{numero:03d}-{annee_libelle[2:4]}"
