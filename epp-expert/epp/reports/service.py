"""Génération des rapports : un modèle (ou un lot de modèles) + paramètres -> PDF / Excel / Word.

Séparation des responsabilités :
  données (datasets) -> définition (store / model) -> filtres et calculs (engine)
  -> document abstrait -> rendu (render_pdf / render_xlsx / render_docx).
"""
from __future__ import annotations

import re
from pathlib import Path

from epp.core import security
from epp.core.db import Database
from epp.core.security import Session
from epp.domain import repo
from epp.domain.repo import Annee
from epp.reports import engine, render_docx, render_pdf, render_xlsx, store
from epp.reports.builtin import LOTS


def nom_fichier(texte: str) -> str:
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", texte).strip(" .-")
    return re.sub(r"\s+", " ", t)[:120] or "rapport"


def document(db: Database, annee: Annee, ref: int | str, params: dict | None = None, version: int | None = None):
    m = store.get(db, ref)
    defn = store.definition(db, m["id"], version)
    return engine.build_document(db, annee, defn, params or {}, m["nom"])


FORMATS = {"pdf": ".pdf", "xlsx": ".xlsx", "excel": ".xlsx", "docx": ".docx", "word": ".docx"}


def _format(format_: str | None, chemin: Path) -> str:
    f = (format_ or chemin.suffix.lstrip(".") or "pdf").lower()
    f = {"excel": "xlsx", "word": "docx", "doc": "docx"}.get(f, f)
    return f if f in ("pdf", "xlsx", "docx") else "pdf"


def _droits_format(s: Session, f: str) -> None:
    s.require("rapports.generer")
    if f == "xlsx":
        s.require("export.excel")
    elif f == "docx":
        s.require("export.word")


def _ecrire(doc, f: str, chemin: Path, nom_feuille: str) -> Path:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin = chemin.with_suffix(FORMATS[f])
    if f == "xlsx":
        render_xlsx.render(doc, chemin, nom_feuille)
    elif f == "docx":
        render_docx.render(doc, chemin)
    else:
        render_pdf.render(doc, chemin)
    return chemin


def generer(db: Database, s: Session, annee: Annee, ref: int | str, params: dict | None, chemin: str | Path,
            format_: str | None = None) -> Path:
    """Génère un rapport en PDF, Excel ou Word (format déduit de l'extension si non précisé)."""
    chemin = Path(chemin)
    f = _format(format_, chemin)
    _droits_format(s, f)
    doc = document(db, annee, ref, params)
    nom = store.get(db, ref)["nom"]
    chemin = _ecrire(doc, f, chemin, nom)
    security.log(db, s.login, "RAPPORT", nom, str(chemin))
    return chemin


def assembler(docs: list) -> "engine.Document":
    """Plusieurs documents à la suite (un saut de page entre chacun)."""
    base = docs[0]
    for d in docs[1:]:
        base.blocks.append(engine.PageBreak())
        base.blocks.extend(d.blocks)
    return base


def generer_lot(db: Database, s: Session, annee: Annee, codes: list[str], params: dict | None,
                chemin: str | Path, format_: str = "pdf") -> Path:
    """Plusieurs modèles dans un seul fichier PDF ou Word (ex. dossier de fin d'année)."""
    f = _format(format_, Path(chemin)) if format_ else "pdf"
    f = "pdf" if f == "xlsx" else f
    _droits_format(s, f)
    base = assembler([document(db, annee, c, params) for c in codes])
    chemin = _ecrire(base, f, Path(chemin), "Rapport")
    security.log(db, s.login, "RAPPORT_LOT", ", ".join(codes), str(chemin))
    return chemin


def generer_lot_nomme(db: Database, s: Session, annee: Annee, lot: str, params: dict | None,
                      dossier: str | Path, format_: str = "pdf") -> Path:
    titre, codes = LOTS[lot]
    return generer_lot(db, s, annee, codes, params, Path(dossier) / nom_fichier(f"{titre} {annee.libelle}"),
                       format_)


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


# Listes de données : même choix que les modèles Excel d'import / export, en PDF ou en Word.
RAPPORT_DE_LISTE = {"eleves": "REGISTRE", "personnel": "PERSONNEL", "classes": "EFFECTIFS", "notes": "FEUILLE_NOTES",
                    "absences_eleves": "ABS_ELEVES", "absences_personnel": "ABS_PERSONNEL"}


def exporter_liste(db: Database, s: Session, annee: Annee, kind: str, chemin: str | Path, format_: str = "xlsx",
                   num: int | None = None) -> Path:
    """Exporte une liste de données (élèves, personnel, classes, notes, absences) en Excel (modèle
    réimportable), en PDF ou en Word (mise en page des états officiels, en-tête et logos compris)."""
    from epp.io import modeles_excel
    chemin = Path(chemin)
    f = _format(format_, chemin)
    if f == "xlsx":
        return modeles_excel.exporter(db, s, annee, kind, chemin.with_suffix(".xlsx"), num=num)
    if kind not in RAPPORT_DE_LISTE:
        raise ValueError(kind)
    code = RAPPORT_DE_LISTE[kind]
    if kind != "notes":
        return generer(db, s, annee, code, {}, chemin, f)
    if num is None:
        raise repo.ValidationError("Choisissez l'évaluation.", "evaluation")
    _droits_format(s, f)
    docs = []
    for c in annee.classes:
        g = annee.grilles.get(c.grille_id)
        if g is not None and num in g.matieres and repo.inscriptions(db, annee, c.code):
            docs.append(document(db, annee, code, {"classe": c.code, "compo": num}))
    if not docs:
        raise repo.ValidationError("Aucune classe n'a de notes pour cette évaluation.")
    chemin = _ecrire(assembler(docs), f, chemin, "Notes")
    security.log(db, s.login, "EXPORT_LISTE", kind, str(chemin))
    return chemin
