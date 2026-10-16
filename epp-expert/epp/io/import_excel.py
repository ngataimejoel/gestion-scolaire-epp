"""Migration du classeur GESTION_SCOLAIRE_EPP_MODELE_EXPERT (.xlsm/.xlsx) vers SQLite.

Le classeur n'est jamais modifié : il est ouvert en lecture seule.
L'association notes ↔ élèves reproduit la logique des formules du classeur
(clé de position « CP-1 », « CE1-1 »… calculée sur l'ordre du registre),
puis est contrôlée avec le matricule école lu dans la feuille de notes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import openpyxl

from epp.core.db import Database
from epp.core.security import Session, log
from epp.core import seed
from epp.domain import calculs, repo

FIRST, LAST = 10, 250

PARAM_CELLS = {"ministere": "C4", "dren": "C5", "iepp": "C6", "ecole_nom": "C7", "ecole_code": "C8",
               "localite": "C10", "directeur": "C11", "secteur": "C15"}

NOTES_SHEETS = {
    # feuille : (code grille, classes, fonction de clé de groupe du registre)
    "NOTES CP": ("CP", ("CP1", "CP2")),
    "NOTES CE1": ("CE1", ("CE1",)),
    "NOTES CE2-CM1": ("CE2-CM1", ("CE2", "CM1")),
    "NOTES CM2": ("CM2", ("CM2",)),
}

ZONES_MENSUEL = {"A41": "animations", "A58": "cooperatives", "F58": "bibliotheque", "J58": "cantine",
                 "A64": "relations_enseignants", "A69": "relations_maitres_eleves",
                 "A74": "relations_autorites", "A79": "evenements", "F84": "grossesses", "M84": "deces",
                 "A86": "difficultes", "A91": "satisfactions", "A96": "conclusion"}

MOIS = {m.lower(): i + 1 for i, m in enumerate(seed.MOIS_FR)}


@dataclass
class ImportReport:
    annee: str = ""
    eleves: int = 0
    personnel: int = 0
    notes: int = 0
    presences_non: int = 0
    absences_eleves: int = 0
    absences_personnel: int = 0
    avertissements: list[str] = field(default_factory=list)

    def resume(self) -> str:
        lines = [f"Année scolaire : {self.annee}",
                 f"Élèves importés : {self.eleves}",
                 f"Agents importés : {self.personnel}",
                 f"Notes importées : {self.notes} (absences aux évaluations : {self.presences_non})",
                 f"Absences élèves : {self.absences_eleves}",
                 f"Absences personnel : {self.absences_personnel}"]
        if self.avertissements:
            lines.append("Avertissements :")
            lines += [f" - {a}" for a in self.avertissements]
        return "\n".join(lines)


def _s(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def _d(v) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 1 < v < 80000:  # numéro de série Excel
        return date.fromordinal(date(1899, 12, 30).toordinal() + int(v)).isoformat()
    s = _s(v)
    if not s:
        return None
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    return s[:10] if re.match(r"\d{4}-\d{2}-\d{2}", s) else None


def _num(v) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ".").strip())
    except ValueError:
        return None


def _matiere(header: str) -> str:
    return re.sub(r"\s*\(/\s*\d+\)\s*$", "", str(header).replace("\n", " ")).strip()


def check_workbook(path: str | Path) -> list[str]:
    """Contrôle la structure avant import ; renvoie la liste des problèmes bloquants."""
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as e:  # fichier illisible ou protégé
        return [f"Le fichier ne peut pas être ouvert : {e}"]
    required = ["PARAMETRES", "REGISTRE ELEVES", "PERSONNEL"]
    missing = [s for s in required if s not in wb.sheetnames]
    wb.close()
    return [f"Feuille manquante : {s}" for s in missing]


def import_workbook(db: Database, s: Session, path: str | Path, remplacer: bool = False) -> ImportReport:
    """Importe le classeur dans la base. Si l'année existe déjà et remplacer=False, l'import est refusé."""
    s.require("import.excel")
    problems = check_workbook(path)
    if problems:
        raise repo.ValidationError("\n".join(problems))
    wb = openpyxl.load_workbook(path, data_only=True)
    wbf = openpyxl.load_workbook(path, data_only=False)
    rep = ImportReport()
    P = wb["PARAMETRES"]
    libelle = _s(P["C9"].value) or ""
    libelle = libelle.replace("/", "-")
    if not re.fullmatch(r"\d{4}-\d{4}", libelle):
        raise repo.ValidationError(f"Année scolaire illisible dans PARAMETRES!C9 : {libelle!r}")
    rep.annee = libelle
    with db.transaction():
        existing = db.scalar("SELECT id FROM annee_scolaire WHERE libelle=?", (libelle,))
        if existing:
            if not remplacer:
                raise repo.ValidationError(
                    f"L'année {libelle} existe déjà dans la base. Cochez « remplacer » pour la réimporter.")
            db.execute("DELETE FROM annee_scolaire WHERE id=?", (existing,))
            db.execute("DELETE FROM eleve WHERE id NOT IN (SELECT eleve_id FROM inscription)")
        aid = seed.create_year(db, libelle, active=True)
        # ---------------------------------------------------------- paramètres
        for cle, cell in PARAM_CELLS.items():
            v = _s(P[cell].value)
            if v is not None:
                db.set_param(cle, v)
        db.execute("UPDATE annee_scolaire SET date_edition=COALESCE(?, date_edition), "
                   "date_ref_age=COALESCE(?, date_ref_age), nouveaux_cp1=? WHERE id=?",
                   (_d(P["C12"].value), _d(P["C13"].value), int(_num(P["C14"].value) or 0), aid))
        _import_lists(db, P)
        annee = repo.load_annee(db, aid)
        _import_classes(db, P, annee)
        annee = repo.load_annee(db, aid)
        _import_calendar(db, P, annee)
        _import_matieres(db, wb, annee)
        annee = repo.load_annee(db, aid)
        # ---------------------------------------------------------- registre
        reg_rows = _import_registre(db, s, wb["REGISTRE ELEVES"], annee, rep)
        _import_notes(db, wb, annee, reg_rows, rep)
        pers = _import_personnel(db, s, wb["PERSONNEL"], annee, rep)
        _import_absences(db, wb, wbf, annee, reg_rows, pers, rep)
        _import_textes(db, wb, annee)
    log(db, s.login, "IMPORT_EXCEL", "classeur", f"{Path(path).name} : {rep.eleves} élèves")
    return rep


def _import_lists(db: Database, P) -> None:
    def col(c, r1, r2):
        return [v for v in (_s(P[f"{c}{r}"].value) for r in range(r1, r2 + 1)) if v]
    mapping = {"NATIONALITE": col("G", 3, 12), "ORPHELIN_DE": col("I", 3, 8), "FONCTION": col("E", 14, 25)}
    for liste, vals in mapping.items():
        if vals:
            db.execute("DELETE FROM liste_valeur WHERE liste=?", (liste,))
            for i, v in enumerate(dict.fromkeys(vals)):
                db.execute("INSERT INTO liste_valeur(liste, valeur, ordre) VALUES(?,?,?)", (liste, v, i))


def _import_classes(db: Database, P, annee: repo.Annee) -> None:
    classes = [v for v in (_s(P[f"E{r}"].value) for r in range(3, 13)) if v]
    seuils = {}
    for r in range(18, 30):
        code = _s(P[f"B{r}"].value)
        if code and code.upper() == code and len(code) <= 6 and _num(P[f"C{r}"].value) is not None:
            seuils[code] = (_num(P[f"C{r}"].value), _num(P[f"D{r}"].value) or 10)
    for i, code in enumerate(classes):
        cl = annee.classe(code)
        seuil, bareme = seuils.get(code, (cl.seuil if cl else 5, cl.bareme if cl else 10))
        if cl:
            db.execute("UPDATE classe SET ordre=?, seuil=?, bareme=? WHERE id=?", (i, seuil, bareme, cl.id))
        else:
            db.execute("INSERT INTO classe(annee_id, code, libelle, ordre, seuil, bareme) VALUES(?,?,?,?,?,?)",
                       (annee.id, code, code, i, seuil, bareme))


def _import_calendar(db: Database, P, annee: repo.Annee) -> None:
    for i, r in enumerate(range(29, 33), start=1):
        for col, cal in (("C", "STD"), ("D", "CM2")):
            d = _d(P[f"{col}{r}"].value)
            if d:
                db.execute("UPDATE evaluation SET date=? WHERE annee_id=? AND calendrier=? AND num=?",
                           (d, annee.id, cal, i))
    for r in range(38, 50):
        nom = (_s(P[f"B{r}"].value) or "").lower()
        mois = int(_num(P[f"C{r}"].value) or MOIS.get(nom, 0))
        jours = _num(P[f"D{r}"].value)
        if 1 <= mois <= 12 and jours is not None:
            db.execute("INSERT INTO jours_classe(annee_id, mois, libelle, jours) VALUES(?,?,?,?) "
                       "ON CONFLICT(annee_id, mois) DO UPDATE SET jours=excluded.jours",
                       (annee.id, mois, seed.MOIS_FR[mois - 1], int(jours)))


def _eval_blocks(ws) -> list[dict]:
    """Repère les blocs d'évaluation d'une feuille de notes : colonnes Présent ?, matières, moyenne."""
    blocks, cur = [], None
    for c in range(1, ws.max_column + 1):
        h = ws.cell(9, c).value
        h = str(h).strip() if h is not None else ""
        if h.startswith("Présent"):
            cur = {"presence": c, "matieres": [], "moyenne": None}
            blocks.append(cur)
        elif cur is not None and cur["moyenne"] is None:
            if h.upper().startswith("MOYENNE"):
                cur["moyenne"] = c
            elif h and not h.upper().startswith("TOTAL") and not h.startswith("="):
                cur["matieres"].append((c, _matiere(h), _num(ws.cell(8, c).value)))
    return blocks


def _import_matieres(db: Database, wb, annee: repo.Annee) -> None:
    gcode = {g.code: g for g in annee.grilles.values()}
    for sheet, (code, _) in NOTES_SHEETS.items():
        if sheet not in wb.sheetnames or code not in gcode:
            continue
        g = gcode[code]
        for num, b in enumerate(_eval_blocks(wb[sheet]), start=1):
            db.execute("DELETE FROM matiere WHERE grille_id=? AND eval_num=?", (g.id, num))
            for i, (_, lib, val) in enumerate(b["matieres"]):
                db.execute("INSERT INTO matiere(grille_id, eval_num, ordre, libelle, valeur) VALUES(?,?,?,?,?)",
                           (g.id, num, i, lib, val if val is not None else 1))


REG_COLS = {"matricule_desps": "C", "nom": "D", "sexe": "E", "classe": "F", "date_naissance": "G",
            "nationalite": "I", "localite": "J", "sous_prefecture": "K", "extrait": "L", "acte_num": "M",
            "acte_date": "N", "centre_etat_civil": "O", "orphelin": "P", "orphelin_de": "Q",
            "pere_nom": "R", "pere_profession": "S", "pere_residence": "T", "pere_tel": "U",
            "mere_nom": "V", "mere_profession": "W", "mere_residence": "X", "mere_tel": "Y",
            "tuteur_nom": "Z", "tuteur_profession": "AA", "tuteur_residence": "AB", "tuteur_tel": "AC",
            "redoublant": "AD", "statut": "AE", "observations": "AF", "matricule_ecole": "B"}


def _import_registre(db: Database, s: Session, ws, annee: repo.Annee, rep: ImportReport) -> dict[int, dict]:
    rows: dict[int, dict] = {}
    compteur: dict[str, int] = {}
    for r in range(FIRST, LAST + 1):
        nom = _s(ws[f"D{r}"].value)
        if not nom:
            continue
        d = {k: ws[f"{c}{r}"].value for k, c in REG_COLS.items()}
        classe = (_s(d["classe"]) or "").upper()
        if annee.classe(classe) is None:
            rep.avertissements.append(f"REGISTRE ligne {r} : classe « {classe} » inconnue, élève ignoré ({nom}).")
            continue
        compteur[classe] = compteur.get(classe, 0) + 1
        mat = _s(d["matricule_ecole"]) or calculs.matricule_ecole(classe, compteur[classe], annee.libelle)
        data = {k: (_d(v) if k in ("date_naissance", "acte_date") else _s(v)) for k, v in d.items()}
        data["sexe"] = (data["sexe"] or "").upper()
        if data["matricule_desps"] and not calculs.matricule_desps_valide(data["matricule_desps"]):
            rep.avertissements.append(f"REGISTRE ligne {r} : matricule DESPS non conforme « {data['matricule_desps']} », "
                                      f"conservé dans les observations.")
            data["observations"] = ((data["observations"] or "") + f" [DESPS saisi : {data['matricule_desps']}]").strip()
            data["matricule_desps"] = None
        try:
            eid = repo.save_eleve(db, s, None, data, None)
        except repo.ValidationError as e:
            rep.avertissements.append(f"REGISTRE ligne {r} ({nom}) : {e}")
            continue
        iid = repo.inscrire(db, s, eid, annee, classe, data["redoublant"] or "NON", data["statut"] or "PRESENT",
                            "INSCRIPTION", matricule=mat, date_inscription=annee.date_debut,
                            observations=None)
        rows[r] = {"inscription_id": iid, "classe": classe, "matricule": mat, "nom": nom}
        rep.eleves += 1
    return rows


def _import_notes(db: Database, wb, annee: repo.Annee, reg_rows: dict[int, dict], rep: ImportReport) -> None:
    gcode = {g.code: g for g in annee.grilles.values()}
    for sheet, (code, classes) in NOTES_SHEETS.items():
        if sheet not in wb.sheetnames or code not in gcode:
            continue
        ws = wb[sheet]
        g = gcode[code]
        # Clé de position du classeur : k-ième élève du registre appartenant au groupe
        groupe = [reg_rows[r] for r in sorted(reg_rows) if reg_rows[r]["classe"] in classes]
        blocks = _eval_blocks(ws)
        k = 0
        for r in range(FIRST, LAST + 1):
            mat_feuille = _s(ws[f"B{r}"].value)
            has_data = any(ws.cell(r, c).value is not None for b in blocks for c in
                           [b["presence"]] + [m[0] for m in b["matieres"]])
            if not mat_feuille and not has_data:
                continue
            if k >= len(groupe):
                rep.avertissements.append(f"{sheet} ligne {r} : notes sans élève correspondant, ignorées.")
                continue
            ins = groupe[k]
            k += 1
            if mat_feuille and mat_feuille != ins["matricule"]:
                rep.avertissements.append(f"{sheet} ligne {r} : matricule {mat_feuille} attendu {ins['matricule']}.")
            for num, b in enumerate(blocks, start=1):
                pres = (_s(ws.cell(r, b["presence"]).value) or "").upper()
                if pres == "NON":
                    db.execute("INSERT OR REPLACE INTO presence_eval(inscription_id, eval_num, present) VALUES(?,?,0)",
                               (ins["inscription_id"], num))
                    rep.presences_non += 1
                    continue
                mats = g.matieres.get(num, [])
                for (c, lib, _), m in zip(b["matieres"], mats):
                    v = _num(ws.cell(r, c).value)
                    if v is not None:
                        db.execute("INSERT OR REPLACE INTO note(inscription_id, matiere_id, valeur) VALUES(?,?,?)",
                                   (ins["inscription_id"], m["id"], v))
                        rep.notes += 1


PERS_COLS = {"matricule": "B", "nom": "C", "sexe": "D", "date_naissance": "E", "fonction": "G", "grade": "H",
             "classe_tenue": "I", "diplome": "J", "date_prise_service": "K", "date_arrivee": "M",
             "telephone": "N", "situation_matrimoniale": "O", "observations": "P"}


def _import_personnel(db: Database, s: Session, ws, annee: repo.Annee, rep: ImportReport) -> dict[str, int]:
    out = {}
    for r in range(FIRST, 70):
        nom = _s(ws[f"C{r}"].value)
        if not nom:
            continue
        d = {k: ws[f"{c}{r}"].value for k, c in PERS_COLS.items()}
        data = {k: (_d(v) if k.startswith("date") else _s(v)) for k, v in d.items()}
        data["sexe"] = (data["sexe"] or "").upper()
        data["matricule"] = data["matricule"] or f"SANS-MATRICULE-{r}"
        existing = db.scalar("SELECT id FROM personnel WHERE matricule=?", (data["matricule"],))
        try:
            pid = repo.save_personnel(db, s, existing, data, annee)
        except repo.ValidationError as e:
            rep.avertissements.append(f"PERSONNEL ligne {r} ({nom}) : {e}")
            continue
        out[data["matricule"]] = pid
        rep.personnel += 1
    return out


_REF = re.compile(r"^='?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$")


def _import_absences(db: Database, wb, wbf, annee: repo.Annee, reg_rows, pers, rep: ImportReport) -> None:
    by_mat = {v["matricule"]: v["inscription_id"] for v in reg_rows.values()}
    for sheet, kind in (("ABSENCES ELEVES", "eleve"), ("ABSENCES PERSONNEL", "personnel")):
        if sheet not in wb.sheetnames:
            continue
        ws, wf = wb[sheet], wbf[sheet]
        for r in range(FIRST, LAST + 1):
            dt = _d(ws[f"B{r}"].value)
            if not dt:
                continue
            mat = _s(ws[f"C{r}"].value)
            formula = wf[f"C{r}"].value
            if kind == "eleve":
                cible = by_mat.get(mat) if mat else None
                if cible is None and isinstance(formula, str):
                    m = _REF.match(formula)
                    if m and m[1] == "REGISTRE ELEVES" and int(m[3]) in reg_rows:
                        cible = reg_rows[int(m[3])]["inscription_id"]
            else:
                cible = pers.get(mat) if mat else None
            if cible is None:
                rep.avertissements.append(f"{sheet} ligne {r} : matricule inconnu ({mat}), absence ignorée.")
                continue
            nature = (_s(ws[f"G{r}"].value) or "").upper()
            jours, retard = _num(ws[f"H{r}"].value), _num(ws[f"I{r}"].value)
            table, fk = ("absence_eleve", "inscription_id") if kind == "eleve" else ("absence_personnel", "personnel_id")
            db.execute(f"INSERT INTO {table}(annee_id, {fk}, date, nature, jours, retard_min, motif, justifie, observations) "
                       f"VALUES(?,?,?,?,?,?,?,?,?)",
                       (annee.id, cible, dt, nature if nature in ("RETARD", "ABSENCE") else "ABSENCE",
                        jours, int(retard) if retard is not None else None, _s(ws[f"J{r}"].value),
                        _s(ws[f"K{r}"].value), _s(ws[f"L{r}"].value)))
            if kind == "eleve":
                rep.absences_eleves += 1
            else:
                rep.absences_personnel += 1


def _import_textes(db: Database, wb, annee: repo.Annee) -> None:
    def put(rapport, cle, champ, v):
        v = _s(v)
        if v is not None:
            db.execute("INSERT OR REPLACE INTO texte_rapport(annee_id, rapport, cle, champ, texte) VALUES(?,?,?,?,?)",
                       (annee.id, rapport, cle, champ, v))
    if "RAPPORT MENSUEL" in wb.sheetnames:
        ws = wb["RAPPORT MENSUEL"]
        mois = MOIS.get((_s(ws["C8"].value) or "").lower())
        if mois:
            for cell, champ in ZONES_MENSUEL.items():
                put("MENSUEL", str(mois), champ, ws[cell].value)
    if "RAPPORT DE COMPOSITION" in wb.sheetnames:
        ws = wb["RAPPORT DE COMPOSITION"]
        put("COMPOSITION", str(int(_num(ws["C9"].value) or 1)), "observations", ws["A33"].value)
    if "RAPPORT DE RENTREE" in wb.sheetnames:
        put("RENTREE", "", "observations", wb["RAPPORT DE RENTREE"]["A38"].value)
