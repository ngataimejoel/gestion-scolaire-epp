"""Fiche scolaire de l'élève (modèle de l'école) et code QR qui l'accompagne.

La fiche reprend l'identité de l'élève, son état civil, ses parents (nom, prénoms, domicile, contact,
profession), sa scolarité année par année (niveau, moyenne annuelle, effectif de la classe) et l'école
fréquentée. Le code QR contient les informations de l'école et de l'élève, lisibles par n'importe quel
lecteur de QR code (texte simple, sans connexion).
"""
from __future__ import annotations

import struct
import zlib

from epp.core.db import Database
from epp.domain import calculs, repo, resultats
from epp.domain.repo import Annee

PARENTS = (("pere", "PÈRE"), ("mere", "MÈRE"), ("tuteur", "TUTEUR / TUTRICE"))
NIVEAUX = ("CP1", "CP2", "CE1", "CE2", "CM1", "CM2")


def separer_nom(nom_complet: str | None) -> tuple[str, str]:
    """« KOUAME Kouadio Jean » -> (« KOUAME », « Kouadio Jean ») : le premier mot est le nom de famille."""
    mots = (nom_complet or "").split()
    return (mots[0], " ".join(mots[1:])) if mots else ("", "")


def niveau(classe_code: str | None) -> str:
    """Niveau d'une classe (CP1 … CM2) d'après son code (« CE1 A » -> « CE1 »)."""
    c = (classe_code or "").upper().replace(" ", "")
    return next((n for n in NIVEAUX if c.startswith(n)), classe_code or "")


def parents(r: dict) -> list[dict]:
    """Parents connus de l'élève : qualité, nom complet, nom, prénoms, profession, domicile, contact."""
    out = []
    for qui, titre in PARENTS:
        nom, prenoms = separer_nom(r.get(f"{qui}_nom"))
        out.append({"qui": qui, "titre": titre, "nom_complet": (r.get(f"{qui}_nom") or "").strip(), "nom": nom,
                    "prenoms": prenoms, "profession": r.get(f"{qui}_profession") or "",
                    "domicile": r.get(f"{qui}_residence") or "", "contact": r.get(f"{qui}_tel") or ""})
    return out


def ligne_parents(r: dict) -> str:
    """Une ligne pour l'en-tête des documents de l'élève : « Père : X (profession) • Mère : Y (profession) »."""
    morceaux = []
    for p in parents(r)[:2]:
        if p["nom_complet"]:
            morceaux.append(f"{'Père' if p['qui'] == 'pere' else 'Mère'} : {p['nom_complet']}"
                            + (f" ({p['profession']})" if p["profession"] else ""))
    if not morceaux:
        t = parents(r)[2]
        if t["nom_complet"]:
            morceaux.append(f"Tuteur : {t['nom_complet']}" + (f" ({t['profession']})" if t["profession"] else ""))
    return "  •  ".join(morceaux)


def info_parents(db: Database, eleve_id: int | None) -> dict:
    """Champs « parents » d'un élève (pour les en-têtes des bulletins et des demandes)."""
    r = repo.get_eleve(db, eleve_id) if eleve_id else {}
    return {k: r.get(k) for qui, _ in PARENTS for k in (f"{qui}_nom", f"{qui}_profession", f"{qui}_residence",
                                                        f"{qui}_tel")}


# ---------------------------------------------------------------------------- scolarité
def _resultats_annee(db: Database, annee_id: int, cache: dict) -> tuple[Annee, dict[int, dict]]:
    if annee_id not in cache:
        a = repo.load_annee(db, annee_id)
        rows = resultats.compute(db, a)
        effectifs: dict[str, int] = {}
        for r in rows:
            effectifs[r["classe"]] = effectifs.get(r["classe"], 0) + 1
        cache[annee_id] = (a, {r["inscription_id"]: dict(r, effectif=effectifs[r["classe"]]) for r in rows})
    return cache[annee_id]


def scolarite(db: Database, eleve_id: int, cache: dict | None = None) -> list[dict]:
    """Une ligne par année d'inscription (plus ancienne d'abord) : année, niveau, MGA, effectif, décision."""
    cache = {} if cache is None else cache
    out = []
    for i in db.query("SELECT i.id, i.annee_id, i.date_inscription, i.statut, a.libelle FROM inscription i "
                      "JOIN annee_scolaire a ON a.id=i.annee_id WHERE i.eleve_id=? ORDER BY a.libelle, i.id",
                      (eleve_id,)):
        a, res = _resultats_annee(db, i["annee_id"], cache)
        r = res.get(i["id"], {})
        mga = r.get("mga")
        out.append({"annee": i["libelle"], "classe": r.get("classe", ""), "niveau": niveau(r.get("classe")),
                    "moyenne": mga, "bareme": r.get("bareme"), "effectif": r.get("effectif"),
                    "decision": r.get("decision") or "", "date_inscription": i["date_inscription"],
                    "statut": i["statut"], "date_fin": a.date_fin})
    return out


# ---------------------------------------------------------------------------- fiches
def fiches(db: Database, annee: Annee, classe_code: str | None = None, inscription_id: int | None = None,
           inclure_sortis: bool = True) -> list[dict]:
    """Données des fiches scolaires : un élève, une classe ou toute l'école (année affichée)."""
    e = repo.etablissement(db)
    rows = repo.inscriptions(db, annee, classe_code)
    if inscription_id:
        rows = [r for r in rows if r["inscription_id"] == int(inscription_id)]
    if not inclure_sortis:
        rows = [r for r in rows if r["statut"] == "PRESENT"]
    rang = {c: i for i, c in enumerate(annee.codes)}
    rows.sort(key=lambda r: (rang.get(r["classe"], 999), r["nom"] or ""))
    cache: dict = {}
    from epp.domain.bulletins import _enseignants
    profs = _enseignants(db, annee)
    out = []
    for r in rows:
        nom, prenoms = separer_nom(r["nom"])
        sco = scolarite(db, r["eleve_id"], cache)
        premiere = sco[0] if sco else {}
        derniere = sco[-1] if sco else {}
        motif = {"ABANDON": "Abandon", "TRANSFERE": "Transfert"}.get(r["statut"], "")
        d = dict(r)
        d.update({
            "nom_famille": nom, "prenoms": prenoms, "niveau": niveau(r["classe"]),
            "fiche_no": f"{r.get('ordre') or r['numero']:04d}",
            "parents": parents(r), "ligne_parents": ligne_parents(r), "scolarite": sco,
            "ecole": e.get("ecole_nom", ""), "code_ecole": e.get("ecole_code", ""), "iepp": e.get("iepp", ""),
            "dren": e.get("dren", ""), "ville": e.get("localite", ""), "lieu_naissance": r.get("localite") or "",
            "directeur": e.get("directeur", ""), "enseignant": profs.get(r["classe"], ""),
            "sous_prefecture_ecole": e.get("sous_prefecture", "") or e.get("localite", ""),
            "annee": annee.libelle, "frequente_du": premiere.get("date_inscription") or "",
            "frequente_au": derniere.get("date_fin") if r["statut"] != "PRESENT" else "",
            "motif_depart": motif,
        })
        d["qr"] = qr_texte(d)
        out.append(d)
    return out


def qr_texte(d: dict) -> str:
    """Texte du code QR : école puis élève (une information par ligne)."""
    dn = calculs.to_date(d.get("date_naissance"))
    lignes = [
        f"ECOLE: {d.get('ecole', '')}" + (f" (code {d['code_ecole']})" if d.get("code_ecole") else ""),
        f"IEPP: {d.get('iepp', '')}", f"DREN: {d.get('dren', '')}", f"LOCALITE: {d.get('ville', '')}",
        f"ANNEE SCOLAIRE: {d.get('annee', '')}",
        f"ELEVE: {d.get('nom', '')}", f"SEXE: {d.get('sexe', '')}",
        f"NE(E) LE: {dn.strftime('%d/%m/%Y') if dn else ''}" + (f" A {d['lieu_naissance']}"
                                                                if d.get("lieu_naissance") else ""),
        f"CLASSE: {d.get('classe', '')}", f"MATRICULE ECOLE: {d.get('matricule_ecole', '')}",
        f"MATRICULE DESPS: {d.get('matricule_desps') or ''}", f"FICHE N: {d.get('fiche_no', '')}",
    ]
    for p in d.get("parents") or []:
        if p["nom_complet"]:
            lignes.append(f"{p['titre']}: {p['nom_complet']}" + (f" - {p['profession']}" if p["profession"] else "")
                          + (f" - {p['contact']}" if p["contact"] else ""))
    return "\n".join(lignes)


# ---------------------------------------------------------------------------- code QR
def qr_matrice(texte: str) -> list[list[bool]]:
    """Modules du code QR (True = noir), correction d'erreur M, version choisie selon la longueur."""
    from reportlab.graphics.barcode.qr import QrCodeWidget
    w = QrCodeWidget(texte, barLevel="M")
    w.qr.make()
    return [[bool(x) for x in row] for row in w.qr.modules]


def qr_png(texte: str, module: int = 6, marge: int = 4) -> bytes:
    """Image PNG (niveaux de gris) du code QR, pour Word et l'écran ; sans bibliothèque d'image."""
    m = qr_matrice(texte)
    n = len(m)
    taille = (n + 2 * marge) * module
    blanc = b"\xff" * taille
    brut = bytearray()
    for _ in range(marge * module):
        brut += b"\x00" + blanc
    for row in m:
        ligne = b"\xff" * (marge * module) + b"".join((b"\x00" if x else b"\xff") * module for x in row) + \
            b"\xff" * (marge * module)
        for _ in range(module):
            brut += b"\x00" + ligne
    for _ in range(marge * module):
        brut += b"\x00" + blanc

    def bloc(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", taille, taille, 8, 0, 0, 0, 0))
            + bloc(b"IDAT", zlib.compress(bytes(brut), 9)) + bloc(b"IEND", b""))
