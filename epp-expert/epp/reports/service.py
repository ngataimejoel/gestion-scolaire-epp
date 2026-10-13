"""Génération des rapports : un modèle (ou un lot de modèles) + paramètres -> PDF / Excel.

Séparation des responsabilités :
  données (datasets) -> définition (store / model) -> filtres et calculs (engine)
  -> document abstrait -> rendu (render_pdf / render_xlsx).
"""
from __future__ import annotations

import re
from pathlib import Path

from epp.core import security
from epp.core.db import Database
from epp.core.security import Session
from epp.domain import repo
from epp.domain.repo import Annee
from epp.reports import engine, render_pdf, render_xlsx, store
from epp.reports.builtin import LOTS


def nom_fichier(texte: str) -> str:
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", texte).strip(" .-")
    return re.sub(r"\s+", " ", t)[:120] or "rapport"


def document(db: Database, annee: Annee, ref: int | str, params: dict | None = None, version: int | None = None):
    m = store.get(db, ref)
    defn = store.definition(db, m["id"], version)
    return engine.build_document(db, annee, defn, params or {}, m["nom"])


def generer(db: Database, s: Session, annee: Annee, ref: int | str, params: dict | None, chemin: str | Path,
            format_: str | None = None) -> Path:
    """Génère un rapport au format PDF ou Excel (déduit de l'extension si non précisé)."""
    s.require("rapports.generer")
    chemin = Path(chemin)
    format_ = (format_ or chemin.suffix.lstrip(".") or "pdf").lower()
    if format_ in ("xlsx", "excel"):
        s.require("export.excel")
    doc = document(db, annee, ref, params)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    if format_ in ("xlsx", "excel"):
        chemin = chemin.with_suffix(".xlsx")
        render_xlsx.render(doc, chemin, store.get(db, ref)["nom"])
    else:
        chemin = chemin.with_suffix(".pdf")
        render_pdf.render(doc, chemin)
    security.log(db, s.login, "RAPPORT", store.get(db, ref)["nom"], str(chemin))
    return chemin


def generer_lot(db: Database, s: Session, annee: Annee, codes: list[str], params: dict | None,
                chemin: str | Path) -> Path:
    """Plusieurs modèles dans un seul PDF (ex. dossier de fin d'année)."""
    s.require("rapports.generer")
    docs = [document(db, annee, c, params) for c in codes]
    base = docs[0]
    for d in docs[1:]:
        base.blocks.append(engine.PageBreak())
        base.blocks.extend(d.blocks)
    chemin = Path(chemin).with_suffix(".pdf")
    chemin.parent.mkdir(parents=True, exist_ok=True)
    render_pdf.render(base, chemin)
    security.log(db, s.login, "RAPPORT_LOT", ", ".join(codes), str(chemin))
    return chemin


def generer_lot_nomme(db: Database, s: Session, annee: Annee, lot: str, params: dict | None,
                      dossier: str | Path) -> Path:
    titre, codes = LOTS[lot]
    return generer_lot(db, s, annee, codes, params, Path(dossier) / nom_fichier(f"{titre} {annee.libelle}"))


def un_fichier_par_classe(db: Database, s: Session, annee: Annee, ref: int | str, params: dict | None,
                          dossier: str | Path, format_: str = "pdf") -> list[Path]:
    """Un fichier par classe (équivalent des macros « un PDF par classe »)."""
    out = []
    nom = store.get(db, ref)["nom"]
    for code in annee.codes:
        p = dict(params or {})
        p["classe"] = code
        out.append(generer(db, s, annee, ref, p, Path(dossier) / nom_fichier(f"{nom} - {code} - {annee.libelle}"),
                           format_))
    return out


def annee_courante(db: Database) -> Annee:
    return repo.load_annee(db, repo.active_annee_id(db))
