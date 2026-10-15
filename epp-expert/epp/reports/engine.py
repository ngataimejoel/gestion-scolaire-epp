"""Moteur de génération : transforme (modèle + données + filtres) en un document
abstrait, indépendant du format de sortie. Les moteurs de rendu (PDF, Excel,
impression) lisent ce document. Aucun code n'est spécifique à un rapport donné.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from epp.core.db import Database
from epp.domain import calculs, repo, stats
from epp.domain.repo import Annee
from epp.core.seed import MOIS_FR
from epp.reports import model
from epp.reports.datasets import SOURCES, Contexte, champs as source_champs


# ======================================================================= document
@dataclass
class HeaderCell:
    text: str
    colspan: int = 1
    rowspan: int = 1


@dataclass
class Row:
    cells: list[Any]
    kind: str = "data"          # data | group | subtotal | total
    style: dict = field(default_factory=dict)


@dataclass
class Table:
    title: str
    header: list[list[HeaderCell]]
    rows: list[Row]
    types: list[str]
    aligns: list[str]
    widths: list[float | None]           # mm, None = automatique
    first_col_header: bool = False       # 1re colonne en gras (tableaux croisés)
    page_break_groups: bool = False


@dataclass
class Paragraph:
    text: str
    style: str = "normal"               # normal | titre2 | note | encadre


@dataclass
class KeyValues:
    title: str
    items: list[tuple[str, str]]


@dataclass
class TextZone:
    title: str
    text: str
    lines: int = 4


@dataclass
class Signature:
    lieu_date: str
    fonction: str
    nom: str


@dataclass
class Chart:
    title: str
    categories: list[str]
    series: list[tuple[str, list[float]]]
    percent: bool = False


@dataclass
class Bulletin:
    """Un bulletin d'élève (une page) : données calculées + options d'affichage."""
    data: dict
    photo: bytes | None = None
    options: dict = field(default_factory=dict)


@dataclass
class FicheScolaire:
    """Fiche scolaire d'un élève (une page, modèle de l'école) avec son code QR."""
    data: dict
    photo: bytes | None = None
    options: dict = field(default_factory=dict)


@dataclass
class PageBreak:
    pass


@dataclass
class Lettre:
    """Lettre administrative sur le modèle de l'école (demande d'autorisation d'absence du personnel) :
    en-tête centré, références (gauche / droite), titre, destinataire encadré, paragraphes faits de
    segments (texte, gras), tableau des signatures et avis."""
    entete: list[str]
    references: list[tuple[str, str]]
    titre: str
    destinataire: list[str]
    corps: list[tuple[str, list[tuple[str, bool]]]]   # (style : normal | intitule | droite, segments)
    titre_signatures: str
    signatures: list[tuple[str, list[str]]]           # (titre de colonne, lignes de la case)


@dataclass
class EnteteOfficiel:
    """En-tête officiel (ministère, DRENA, IEPP, école, logos) répété en haut d'une nouvelle page."""
    pass


@dataclass
class Document:
    nom: str
    titre: str
    sous_titre: str
    orientation: str
    entete: dict
    officiel: dict
    pied: dict
    blocks: list = field(default_factory=list)
    variables: dict = field(default_factory=dict)


def entete_officiel(doc: Document) -> tuple[list[str], list[str], list[bytes]]:
    """Lignes de gauche et de droite de l'en-tête officiel (texte modifiable dans les paramètres,
    variables remplacées) et logos à placer au centre (IEPP puis école, s'ils existent)."""
    from epp.core import seed
    o = doc.officiel

    def lignes(cle: str, defaut: str) -> list[str]:
        out = []
        for brut in (o[cle] if cle in o else defaut).splitlines():
            x = subst(brut, doc.variables).strip()
            if brut.rstrip().endswith("}") and x.endswith(":"):
                x = re.sub(r"\s*(?:-\s*)?[^-:]*:$", "", x)    # « - Code : » sans code : libellé retiré
            if x:
                out.append(x)
        return out

    logos = []
    if doc.entete.get("logo", True):
        for cle in repo.LOGOS:
            data = repo.decode_logo(o.get(cle))
            if data:
                logos.append(data)
        ancien = o.get("logo") or ""          # ancien réglage : chemin d'un fichier image
        if not logos and ancien:
            try:
                from pathlib import Path
                logos.append(Path(ancien).read_bytes())
            except OSError:
                pass
    return lignes("entete_gauche", seed.ENTETE_GAUCHE_DEFAUT), lignes("entete_droite", seed.ENTETE_DROITE_DEFAUT), logos


# ======================================================================= formatage
def fmt(v, typ: str = "auto", monnaie: str = "FCFA") -> str:
    if v is None or v == "":
        return ""
    if typ == "auto":
        if isinstance(v, bool):
            return "OUI" if v else "NON"
        if isinstance(v, int):
            typ = "entier"
        elif isinstance(v, float):
            typ = "entier" if v.is_integer() else "decimal"
        else:
            typ = "texte"
    try:
        if typ == "entier":
            return f"{int(round(float(v))):,}".replace(",", " ")
        if typ == "decimal":
            f = float(v)
            return (f"{f:,.2f}".replace(",", " ").replace(".", ",")) if not f.is_integer() else f"{int(f)}"
        if typ == "pourcent":
            return f"{float(v) * 100:.1f}".replace(".", ",") + " %"
        if typ == "monnaie":
            return f"{float(v):,.0f}".replace(",", " ") + f" {monnaie}"
        if typ == "date":
            d = calculs.to_date(v)
            return d.strftime("%d/%m/%Y") if d else str(v)
    except (TypeError, ValueError):
        return str(v)
    return str(v)


def default_align(typ: str) -> str:
    return "droite" if typ in ("entier", "decimal", "pourcent", "monnaie") else (
        "centre" if typ == "date" else "gauche")


class _Safe(dict):
    def __missing__(self, k):
        return "{" + k + "}"


def subst(text: str, variables: dict) -> str:
    if not text:
        return ""
    try:
        return text.format_map(_Safe(variables))
    except (ValueError, IndexError):
        return text


# ======================================================================= contexte
def variables(db: Database, annee: Annee, params: dict) -> dict:
    e = repo.etablissement(db)
    ed = calculs.to_date(annee.date_edition)
    ra = calculs.to_date(annee.date_ref_age)
    v = {
        "ecole": e.get("ecole_nom", ""), "code_ecole": e.get("ecole_code", ""), "annee": annee.libelle,
        "directeur": e.get("directeur", ""), "localite": e.get("localite", ""), "iepp": e.get("iepp", ""),
        "dren": e.get("dren", ""), "ministere": e.get("ministere", ""), "secteur": e.get("secteur", ""),
        "pays": e.get("pays", ""), "devise_pays": e.get("devise_pays", ""),
        "date_edition": ed.strftime("%d/%m/%Y") if ed else "", "date_ref_age": ra.strftime("%d/%m/%Y") if ra else "",
        "date_jour": date.today().strftime("%d/%m/%Y"),
        "classe": params.get("classe") or "", "compo": params.get("compo") or "",
        "monnaie": e.get("monnaie", "FCFA"),
    }
    mois = params.get("mois")
    if mois:
        an = stats.annee_civile(annee, mois)
        v.update(mois=MOIS_FR[mois - 1], mois_annee=f"{MOIS_FR[mois - 1]} {an}",
                 jours_classe=(annee.jours.get(mois) or {}).get("jours", ""))
        parts = []
        for cal, lib in (("STD", "CP1 à CM1"), ("CM2", "CM2")):
            num = stats.evaluation_du_mois(annee, cal, mois, an)
            if cal in annee.evaluations:
                parts.append(f"{lib} : " + (annee.libelle_evaluation(cal, num) if num else "aucune"))
        v["evaluation_du_mois"] = "  •  ".join(parts)
    else:
        v.update(mois="", mois_annee="", jours_classe="", evaluation_du_mois="")
    compo = params.get("compo")
    if compo:
        ev = annee.evaluations.get("STD", {}).get(int(compo)) or {}
        evc = annee.evaluations.get("CM2", {}).get(int(compo)) or {}
        lib = ev.get("libelle", f"Évaluation {compo}")
        if evc and evc.get("libelle") != lib:
            lib += f" (CM2 : {evc['libelle']})"
        v["compo_libelle"] = lib
        d = calculs.to_date(ev.get("date"))
        v["compo_date"] = d.strftime("%d/%m/%Y") if d else ""
    else:
        v.update(compo_libelle="", compo_date="")
    d1, d2 = params.get("date_debut"), params.get("date_fin")
    v["periode"] = (f"du {fmt(d1, 'date')} " if d1 else "") + (f"au {fmt(d2, 'date')}" if d2 else "")
    pers = repo.personnel(db, annee)
    ens = [p for p in pers if (p.get("fonction") or "").upper().startswith(("INSTITUTEUR", "DIRECTEUR"))]
    v["nb_enseignants"] = len(ens)
    v["nb_enseignantes"] = sum(1 for p in ens if p["sexe"] == "F")
    v["nb_personnel"] = len(pers)
    tenues = {p.get("classe_code") for p in pers if p.get("classe_code")}
    v["classes_sans_enseignant"] = len([c for c in annee.codes if c not in tenues])
    n = db.scalar("SELECT COUNT(*) FROM inscription WHERE annee_id=?", (annee.id,), 0)
    v["effectif"] = n
    v["controle_effectifs"] = (f"OK – le total correspond au nombre d'élèves du registre ({n})")
    return v


# ======================================================================= filtres / tri
def _cmp_val(v):
    if v is None:
        return (1, "")
    if isinstance(v, (int, float)):
        return (0, v)
    return (0, str(v).lower())


def apply_filters(rows: list[dict], filtres: list[dict], params: dict) -> list[dict]:
    out = rows
    for f in filtres or []:
        champ, op = f.get("champ"), f.get("op", "=")
        if f.get("parametre"):
            val = params.get(f["parametre"])
            if val in (None, ""):
                continue  # paramètre non renseigné : filtre ignoré (toutes les valeurs)
        else:
            val = f.get("valeur")

        def ok(r, champ=champ, op=op, val=val):
            x = r.get(champ)
            if op == "vide":
                return x in (None, "")
            if op == "non_vide":
                return x not in (None, "")
            if op == "dans":
                return str(x) in [s.strip() for s in str(val).split(";")]
            if op in ("contient", "commence"):
                xs, vs = str(x or "").lower(), str(val or "").lower()
                return vs in xs if op == "contient" else xs.startswith(vs)
            try:
                xn, vn = float(x), float(str(val).replace(",", "."))
            except (TypeError, ValueError):
                xn, vn = str(x or ""), str(val or "")
                if op not in ("=", "!="):
                    xn, vn = str(x or "").lower(), str(val or "").lower()
            if op == "=":
                return xn == vn
            if op == "!=":
                return xn != vn
            if x in (None, ""):
                return False
            return {">": xn > vn, ">=": xn >= vn, "<": xn < vn, "<=": xn <= vn}[op]
        out = [r for r in out if ok(r)]
    return out


def apply_sort(rows: list[dict], tri: list[dict]) -> list[dict]:
    rows = list(rows)
    for t in reversed(tri or []):
        rows.sort(key=lambda r: _cmp_val(r.get(t["champ"])), reverse=t.get("ordre") == "desc")
    return rows


def aggregate(values: list, how: str):
    vals = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if how == "compte":
        return len([v for v in values if v not in (None, "")])
    if not vals:
        return None
    if how == "somme":
        return sum(vals)
    if how == "moyenne":
        return calculs.xround(sum(vals) / len(vals), 2)
    if how == "min":
        return min(vals)
    if how == "max":
        return max(vals)
    return None


AGG_LABEL = {"compte": "Nb", "somme": "Total", "moyenne": "Moy.", "min": "Min", "max": "Max"}


# ======================================================================= sections
class Builder:
    def __init__(self, db: Database, annee: Annee, defn: dict, params: dict):
        self.db = db
        self.annee = annee
        self.defn = model.valider(defn)
        self.params = dict(params)
        self.ctx = Contexte(db, annee, self.params)
        self.vars = variables(db, annee, self.params)

    def t(self, text: str) -> str:
        return subst(text, self.vars)

    # ------------------------------------------------------------------ tableau
    def tableau(self, s: dict) -> list:
        src = SOURCES[s["source"]]
        fields = {c.nom: c for c in source_champs(s["source"], self.ctx)}
        rows = src.charger(self.ctx)
        rows = apply_filters(rows, s.get("filtres"), self.params)
        tri = list(s.get("tri") or [])
        grp = s.get("regroupement") or ""
        if grp:
            # les groupes suivent l'ordre des classes de l'année, sinon l'ordre d'apparition
            rang: dict = {c: i for i, c in enumerate(self.annee.codes)} if grp == "classe" else {}
            for i, r in enumerate(rows):
                r["__ordre__"] = i
                rang.setdefault(r.get(grp), len(rang) + 100000)
            for r in rows:
                r["__groupe__"] = rang[r.get(grp)]
            tri = [{"champ": "__groupe__", "ordre": "asc"}] + [t for t in tri if t["champ"] != grp]
            if not s.get("tri"):
                tri.append({"champ": "__ordre__", "ordre": "asc"})
        rows = apply_sort(rows, tri)
        cols = []
        for c in s["colonnes"]:
            if c.get("champ") == "*notes*":       # matières de la feuille de notes, ajoutées dynamiquement
                for f in source_champs(s["source"], self.ctx):
                    if f.nom.startswith("note_"):
                        cols.append({"champ": f.nom, "titre": f.libelle, "format": "decimal"})
                continue
            cols.append(c)
        types, aligns, heads, widths = [], [], [], []
        for c in cols:
            f = fields.get(c["champ"])
            typ = c.get("format") or "auto"
            if typ == "auto":
                typ = f.type if f else "texte"
            types.append(typ)
            al = c.get("alignement") or "auto"
            aligns.append(default_align(typ) if al == "auto" else al)
            heads.append(HeaderCell(self.t(c.get("titre") or (f.libelle if f else c["champ"]))))
            widths.append(c.get("largeur") or None)
        aggs = {k: v for k, v in (s.get("agregats") or {}).items() if v}
        renum = s.get("renumeroter", True)
        out_rows: list[Row] = []

        def line(r, n):
            vals = []
            for c in cols:
                v = r.get(c["champ"])
                if renum and c["champ"] == "numero":
                    v = n
                vals.append(v)
            return Row(vals, "data", {"statut": r.get("statut")})

        def agg_row(subset, label, kind):
            if not aggs:
                return None
            vals = []
            for i, c in enumerate(cols):
                how = aggs.get(c["champ"])
                vals.append(aggregate([r.get(c["champ"]) for r in subset], how) if how else None)
            # étiquette dans la première colonne de texte sans agrégat (sinon la première libre)
            libres = [i for i, c in enumerate(cols) if not aggs.get(c["champ"])]
            textes = [i for i in libres if types[i] == "texte"]
            if libres:
                vals[(textes or libres)[0]] = label
            return Row(vals, kind)

        if grp:
            groups: dict[Any, list[dict]] = {}
            for r in rows:
                groups.setdefault(r.get(grp), []).append(r)
            glib = fields.get(grp).libelle if fields.get(grp) else grp
            for gval, subset in groups.items():
                out_rows.append(Row([f"{glib} : {fmt(gval, fields[grp].type if grp in fields else 'auto')} "
                                     f"({len(subset)})"] + [None] * (len(cols) - 1), "group"))
                for n, r in enumerate(subset, 1):
                    out_rows.append(line(r, n))
                if s.get("sous_totaux", True):
                    ar = agg_row(subset, f"Sous-total {fmt(gval)}", "subtotal")
                    if ar:
                        out_rows.append(ar)
        else:
            for n, r in enumerate(rows, 1):
                out_rows.append(line(r, n))
        if s.get("total_general", True):
            ar = agg_row(rows, f"TOTAL ({len(rows)})", "total")
            if ar:
                out_rows.append(ar)
        blocks = []
        if not rows and s.get("message_vide", True):
            blocks.append(Paragraph(self.t(s.get("titre") or ""), "titre2") if s.get("titre") else None)
            blocks.append(Paragraph("Aucune donnée ne correspond aux critères choisis.", "note"))
            return [b for b in blocks if b]
        return [Table(self.t(s.get("titre", "")), [heads], out_rows, types, aligns, widths,
                      page_break_groups=bool(s.get("saut_page_groupe")))]

    # ------------------------------------------------------------------ tableau croisé
    def _metric_specs(self, s):
        specs = []
        for m in s.get("metriques") or []:
            if isinstance(m, str):
                m = {"metrique": m}
            code = m["metrique"]
            brut = stats.METRIQUES.get(code, (code.upper(), "n"))[0]
            lib = (s.get("libelles") or {}).get(code) or m.get("titre") or \
                (brut.upper() if not brut.startswith(" ") else "\u00a0\u00a0\u00a0" + brut.strip())
            sexes = m.get("sexes") or (["T"] if code in ("seuil", "mois_observation") else s.get("sexes") or ["M", "F", "T"])
            specs.append((code, self.t(lib), sexes))
        return specs

    def _special(self, code: str, classe: str, st: stats.Stats):
        if code == "seuil":
            cl = self.annee.classe(classe)
            return f"{cl.seuil:g}/{cl.bareme:g}" if cl else ""
        if code == "mois_observation":
            mois = self.params.get("mois")
            if not mois:
                return ""
            if classe == "TOTAL":
                tot = st.val("TOTAL", "T", "mois_jours_absence") or 0
                return "Aucune absence enregistrée ce mois" if not tot else f"{stats._fmt_nombre(tot)} jour(s) d'absence au total"
            j = st.val(classe, "T", "mois_jours_absence") or 0
            r = st.val(classe, "T", "mois_retards") or 0
            return "" if not j and not r else f"{stats._fmt_nombre(j)} jour(s) d'absence, {r} retard(s)"
        return None

    def tableau_croise(self, s: dict) -> list:
        self.params["classes_extra"] = s.get("classes_extra") or []
        self.ctx.params = self.params
        st = self.ctx.stats()
        specs = self._metric_specs(s)
        sx_lib = {"M": "G", "F": "F", "T": "T"}
        if s.get("classes") == "parametre" and self.params.get("classe"):
            classes = [self.params["classe"]]
        else:
            classes = list(st.classes)
        total = s.get("total", True) and len(classes) > 1

        def value(code, cl, sx):
            sp = self._special(code, cl, st)
            if sp is not None:
                return sp, "texte"
            v = st.val(cl, sx, code)
            typ = {"n": "entier", "p": "pourcent", "d": "decimal"}[stats.METRIQUES.get(code, ("", "n"))[1]]
            return v, typ

        if s.get("lignes", "classes") == "classes":
            h1 = [HeaderCell(self.t(s.get("titre_lignes") or "CLASSE"), rowspan=2)]
            h2 = []
            for code, lib, sexes in specs:
                if len(sexes) == 1:
                    h1.append(HeaderCell(lib, rowspan=2))
                else:
                    h1.append(HeaderCell(lib, colspan=len(sexes)))
                    h2 += [HeaderCell(sx_lib[x]) for x in sexes]
            header = [h1, h2]
            types, rows = ["texte"], []
            for code, lib, sexes in specs:
                for x in sexes:
                    types.append(value(code, classes[0] if classes else "TOTAL", x)[1])
            for cl in classes + (["TOTAL"] if total else []):
                cells = [cl]
                for code, lib, sexes in specs:
                    for x in sexes:
                        cells.append(value(code, cl, x)[0])
                rows.append(Row(cells, "total" if cl == "TOTAL" else "data"))
            # colonne unique sans sous-titre G/F/T : fusion verticale
            if not h2:
                header = [[HeaderCell(h.text) for h in h1]]
        else:
            single = len(classes) == 1 and not total
            if single:
                header = [[HeaderCell("")] + [HeaderCell({"M": "GARÇONS", "F": "FILLES", "T": "TOTAL"}[x])
                                              for x in (s.get("sexes") or ["M", "F", "T"])]]
                sexes_all = s.get("sexes") or ["M", "F", "T"]
                cols = [(classes[0], x) for x in sexes_all]
            else:
                sexes_all = s.get("sexes") or ["M", "F", "T"]
                groups = classes + (["TOTAL"] if total else [])
                header = [[HeaderCell(self.t(s.get("titre_lignes") or ""), rowspan=2)] +
                          [HeaderCell(g, colspan=len(sexes_all)) for g in groups],
                          [HeaderCell(sx_lib[x]) for _ in groups for x in sexes_all]]
                cols = [(g, x) for g in groups for x in sexes_all]
            rows, types = [], ["texte"]
            for code, lib, _ in specs:
                cells = [lib]
                for cl, x in cols:
                    cells.append(value(code, cl, x)[0])
                rows.append(Row(cells, "data"))
            for cl, x in cols:
                types.append("entier")
            # type par ligne (pourcentages) : on garde le type dans le style de la ligne
            for r, (code, _, _) in zip(rows, specs):
                r.style["type"] = {"n": "entier", "p": "pourcent", "d": "decimal"}[stats.METRIQUES.get(code, ("", "n"))[1]]
        aligns = ["gauche"] + ["centre"] * (len(types) - 1)
        return [Table(self.t(s.get("titre", "")), header, rows, types, aligns, [None] * len(types),
                      first_col_header=True)]

    # ------------------------------------------------------------------ répartition
    def repartition(self, s: dict) -> list:
        src = SOURCES[s["source"]]
        rows = apply_filters(src.charger(self.ctx), s.get("filtres"), self.params)
        f = next((c for c in source_champs(s["source"], self.ctx) if c.nom == s["champ"]), None)
        counts: dict[Any, int] = {}
        for r in rows:
            counts[r.get(s["champ"])] = counts.get(r.get(s["champ"]), 0) + 1
        tot = sum(counts.values())
        out = []
        for k in sorted(counts, key=_cmp_val):
            cells = [fmt(k, f.type if f else "auto") or "(non renseigné)", counts[k]]
            if s.get("pourcentage", True):
                cells.append(calculs.taux(counts[k], tot))
            out.append(Row(cells))
        out.append(Row(["TOTAL", tot] + ([1.0 if tot else 0.0] if s.get("pourcentage", True) else []), "total"))
        head = [HeaderCell(f.libelle if f else s["champ"]), HeaderCell("Nombre")]
        types = ["texte", "entier"]
        if s.get("pourcentage", True):
            head.append(HeaderCell("%"))
            types.append("pourcent")
        return [Table(self.t(s.get("titre", "")), [head], out, types, ["gauche"] + ["droite"] * (len(types) - 1),
                      [None] * len(types))]

    # ------------------------------------------------------------------ âges
    def repartition_ages(self, s: dict) -> list:
        """Élèves par âge (lignes), par niveau et par sexe (colonnes), avec ou sans extrait de naissance."""
        r = stats.repartition_ages(self.db, self.annee, s.get("extrait") or "tous")
        sexes = s.get("sexes") or ["M", "F", "T"]
        sx_lib = {"M": "G", "F": "F", "T": "T"}
        groupes = r["classes"] + ["TOTAL"]
        header = [[HeaderCell("ÂGE", rowspan=2)] + [HeaderCell(g, colspan=len(sexes)) for g in groupes],
                  [HeaderCell(sx_lib[x]) for _ in groupes for x in sexes]]
        rows = []
        for ag in r["ages"] + ["TOTAL"]:
            lib = ag if isinstance(ag, str) else f"{ag} ans"
            rows.append(Row([lib] + [r["n"].get((ag, g, x), 0) for g in groupes for x in sexes],
                            "total" if ag == "TOTAL" else "data"))
        types = ["texte"] + ["entier"] * (len(groupes) * len(sexes))
        titre = self.t(s.get("titre") or "") or stats.EXTRAITS[r["extrait"]]
        return [Table(titre, header, rows, types, ["gauche"] + ["centre"] * (len(types) - 1),
                      [None] * len(types), first_col_header=True)]

    # ------------------------------------------------------------------ classement
    def classement(self, s: dict) -> list:
        compo = int(self.params.get("compo") or 1)
        top = int(s.get("top") or 3)
        cl = stats.classement(self.db, self.annee, compo, top)
        rangs = ["PREMIER", "DEUXIÈME", "TROISIÈME", "QUATRIÈME", "CINQUIÈME"] + [f"{i}e" for i in range(6, 21)]
        header = [[HeaderCell("NIVEAU", rowspan=2)] + [HeaderCell(rangs[i], colspan=2) for i in range(top)],
                  [h for _ in range(top) for h in (HeaderCell("NOM & PRÉNOMS"), HeaderCell("MOY"))]]
        rows = []
        for code in self.annee.codes:
            cells = [code]
            lst = cl.get(code, [])
            for i in range(top):
                cells += [lst[i]["nom"], lst[i]["moyenne"]] if i < len(lst) else ["", None]
            rows.append(Row(cells))
        types = ["texte"] + ["texte", "decimal"] * top
        aligns = ["centre"] + ["gauche", "centre"] * top
        return [Table(self.t(s.get("titre", "")), header, rows, types, aligns, [None] * len(types),
                      first_col_header=True)]

    # ------------------------------------------------------------------ indicateurs
    def cles_valeurs(self, s: dict) -> list:
        tdb = self.ctx.get("tdb", lambda: stats.tableau_de_bord(self.db, self.annee))
        data = dict(tdb)
        data.update({f"alerte_{k}": v for k, v in tdb["alertes"].items()})
        items = []
        for e in s.get("elements") or []:
            items.append((self.t(e.get("titre") or e["champ"]), fmt(data.get(e["champ"]), e.get("format", "auto"))))
        return [KeyValues(self.t(s.get("titre", "")), items)]

    def graphique(self, s: dict) -> list:
        st = self.ctx.stats()
        code = s.get("metrique", "inscrits")
        series = []
        for x in s.get("sexes") or ["T"]:
            series.append(({"M": "Garçons", "F": "Filles", "T": "Total"}[x], [float(st.val(c, x, code) or 0)
                                                                          for c in self.annee.codes]))
        pct = stats.METRIQUES.get(code, ("", "n"))[1] == "p"
        return [Chart(self.t(s.get("titre") or stats.METRIQUES.get(code, (code,))[0]), list(self.annee.codes),
                      series, pct)]

    def texte(self, s: dict) -> list:
        return [Paragraph(self.t(s.get("texte", "")), s.get("style", "normal"))]

    def zone_redaction(self, s: dict) -> list:
        cle = s.get("cle") or ""
        if cle.startswith("{") and cle.endswith("}"):
            cle = str(self.params.get(cle[1:-1]) or "")
        textes = repo.get_textes(self.db, self.annee.id, s.get("rapport", "LIBRE"), cle)
        out = []
        if s.get("titre"):
            out.append(Paragraph(self.t(s["titre"]), "titre2"))
        for c in s.get("champs") or []:
            out.append(TextZone(self.t(c.get("titre", "")), textes.get(c["champ"], ""),
                                int(c.get("lignes") or s.get("lignes") or 3)))
        return out

    def signature(self, s: dict) -> list:
        ld = f"Fait à {self.vars['localite']}, le {self.vars['date_edition']}" if s.get("lieu_date", True) else ""
        return [Signature(ld, self.t(s.get("fonction", "")), self.t(s.get("nom", "")))]

    def bulletin(self, s: dict) -> list:
        from epp.domain import bulletins, fiche_scolaire
        classe = self.params.get("classe") or None
        eleve = self.params.get("eleve")
        eleve = int(eleve) if eleve not in (None, "") else None
        if s.get("periode", "evaluation") == "annuel":
            data = bulletins.bulletins_annuels(self.db, self.annee, classe, eleve)
        else:
            data = bulletins.bulletins_evaluation(self.db, self.annee, int(self.params.get("compo") or 1),
                                                  classe, eleve)
        if not s.get("inclure_sortis", False):
            data = [d for d in data if d.get("statut") == "PRESENT"]
        out = []
        opts = {k: s.get(k) for k in ("photo", "appreciations", "signatures", "observations", "statistiques_classe",
                                      "titre_bulletin", "style", "mention_officielle", "bilan_felicitations",
                                      "bilan_suivi", "colonnes", "palette") if s.get(k) is not None}
        opts["titre_bulletin"] = self.t(opts.get("titre_bulletin") or "")
        for i, d in enumerate(data):
            if i:
                out.append(PageBreak())
            photo = repo.get_photo(self.db, "eleve", d["eleve_id"]) if s.get("photo", True) else None
            par = fiche_scolaire.info_parents(self.db, d["eleve_id"])
            d["ligne_parents"] = fiche_scolaire.ligne_parents(par)
            for p in fiche_scolaire.parents(par)[:2]:
                d[p["qui"]] = p["nom_complet"] + (f" ({p['profession']})" if p["profession"] else "")
            out.append(Bulletin(d, photo, opts))
        if not data:
            out.append(Paragraph("Aucun élève ne correspond aux critères choisis.", "note"))
        return out

    def fiche_scolaire(self, s: dict) -> list:
        from epp.domain import fiche_scolaire
        eleve = self.params.get("eleve")
        data = fiche_scolaire.fiches(self.db, self.annee, self.params.get("classe") or None,
                                     int(eleve) if eleve not in (None, "") else None,
                                     inclure_sortis=bool(s.get("inclure_sortis", True)))
        out = []
        opts = {k: s.get(k) for k in ("photo", "qr", "titre_fiche") if s.get(k) is not None}
        for i, d in enumerate(data):
            if i:
                out.append(PageBreak())
            photo = repo.get_photo(self.db, "eleve", d["eleve_id"]) if s.get("photo", True) else None
            out.append(FicheScolaire(d, photo, opts))
        if not data:
            out.append(Paragraph("Aucun élève ne correspond aux critères choisis.", "note"))
        return out

    def saut_page(self, s: dict) -> list:
        return [PageBreak()]

    # ------------------------------------------------------------------ document
    def build(self, nom: str = "") -> Document:
        d = self.defn
        e = repo.etablissement(self.db)
        doc = Document(nom or d.get("titre", ""), "", "", d["page"].get("orientation", "portrait"),
                       d.get("entete", {}), e, d.get("pied", {}), variables=self.vars)
        rep = d.get("repeter_par") or ""
        valeurs = [None]
        if rep == "classe":
            valeurs = [self.params["classe"]] if self.params.get("classe") else list(self.annee.codes)
        first = True
        for val in valeurs:
            if rep == "classe":
                self.params["classe"] = val
                self.ctx = Contexte(self.db, self.annee, self.params)
                self.vars = variables(self.db, self.annee, self.params)
            if not first:
                doc.blocks.append(PageBreak())
            first = False
            doc.blocks.append(("TITRE", self.t(d.get("titre", "")), self.t(d.get("sous_titre", ""))))
            for s in d["sections"]:
                doc.blocks += getattr(self, s["type"])(s)
        doc.titre = self.t(d.get("titre", ""))
        doc.sous_titre = self.t(d.get("sous_titre", ""))
        doc.variables = self.vars
        return doc


def build_document(db: Database, annee: Annee, defn: dict, params: dict | None = None, nom: str = "") -> Document:
    return Builder(db, annee, copy.deepcopy(defn), params or {}).build(nom)
