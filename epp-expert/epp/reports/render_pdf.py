"""Rendu PDF (ReportLab) d'un document produit par le moteur de rapports.

Mise en page reprise du classeur : A4, marges étroites (0,8 cm à gauche et à droite),
en-tête officiel, ligne d'en-tête des tableaux répétée sur chaque page, pied de page
« titre – école – Page p / n ». Les largeurs de colonnes sont calculées pour que le
tableau tienne dans la largeur de la page : le texte passe à la ligne au lieu
d'être coupé, et la police est réduite si nécessaire.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (Image, KeepTogether, PageBreak as RLPageBreak, Paragraph as RLParagraph,
                                SimpleDocTemplate, Spacer, Table as RLTable, TableStyle)
from reportlab.lib.utils import ImageReader
from xml.sax.saxutils import escape

from epp import APP_NAME
from epp.core.paths import resource_path
from epp.reports import engine as E

FONT = "EPPSans"
FONT_B = "EPPSans-Bold"
FONT_I = "EPPSans-Italic"
_fonts_ok = False

BLEU = colors.HexColor("#1F4E79")
BLEU_CLAIR = colors.HexColor("#DDEBF7")
GRIS = colors.HexColor("#F2F2F2")
GRIS_FONCE = colors.HexColor("#D9D9D9")
ROSE = colors.HexColor("#FCE4EC")
GRIS_TRANSF = colors.HexColor("#E7E6E6")

MARGE_G = MARGE_D = 8 * mm
MARGE_H = MARGE_B = 12 * mm


def _register_fonts() -> None:
    global _fonts_ok
    if _fonts_ok:
        return
    d = resource_path("resources", "fonts")
    pdfmetrics.registerFont(TTFont(FONT, str(d / "LiberationSans-Regular.ttf")))
    pdfmetrics.registerFont(TTFont(FONT_B, str(d / "LiberationSans-Bold.ttf")))
    pdfmetrics.registerFont(TTFont(FONT_I, str(d / "LiberationSans-Italic.ttf")))
    pdfmetrics.registerFont(TTFont("EPPSans-BoldItalic", str(d / "LiberationSans-BoldItalic.ttf")))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily(FONT, normal=FONT, bold=FONT_B, italic=FONT_I, boldItalic="EPPSans-BoldItalic")
    _fonts_ok = True


def _style(size=9, bold=False, align=TA_LEFT, italic=False, color=colors.black, leading=None):
    return ParagraphStyle("s", fontName=FONT_B if bold else (FONT_I if italic else FONT), fontSize=size,
                          leading=leading or size * 1.2, alignment=align, textColor=color)


ALIGN = {"gauche": TA_LEFT, "centre": TA_CENTER, "droite": TA_RIGHT}


def _p(text, style) -> RLParagraph:
    return RLParagraph(escape(str(text)).replace("\n", "<br/>"), style)


class _NumberedCanvas(rl_canvas.Canvas):
    """Canvas en deux passes pour écrire « Page p / n »."""

    def __init__(self, *args, footer=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []
        self._footer = footer

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            if self._footer:
                self._footer(self, self._pageNumber, n)
            super().showPage()
        super().save()


# ------------------------------------------------------------------------- tableaux
def _grid(header: list[list[E.HeaderCell]], ncols: int):
    """Place les cellules d'en-tête (colspan/rowspan) dans une grille ; renvoie (grille de textes, spans)."""
    nrows = len(header)
    grid = [[None] * ncols for _ in range(nrows)]
    spans = []
    for r, row in enumerate(header):
        c = 0
        for cell in row:
            while c < ncols and grid[r][c] is not None:
                c += 1
            if c >= ncols:
                break
            grid[r][c] = cell.text
            for rr in range(r, min(nrows, r + cell.rowspan)):
                for cc in range(c, min(ncols, c + cell.colspan)):
                    if (rr, cc) != (r, c):
                        grid[rr][cc] = ""
            if cell.colspan > 1 or cell.rowspan > 1:
                spans.append(((c, r), (min(ncols, c + cell.colspan) - 1, min(nrows, r + cell.rowspan) - 1)))
            c += cell.colspan
    return [[x if x is not None else "" for x in row] for row in grid], spans


def _cell_text(v, typ, monnaie) -> str:
    return E.fmt(v, typ, monnaie)


_NUM_RE = re.compile(r"^[+\d][\d\s.,/:%+-]*$")


def _words(text: str) -> list[str]:
    """Mots insécables : un numéro de téléphone ou un nombre n'est jamais coupé."""
    return [text] if _NUM_RE.match(text or "") else text.split()


def _widths(texts_by_col: list[list[str]], head_by_col: list[list[str]], fixed: list[float | None],
            avail: float, fs: float):
    """Largeurs naturelles (sans retour à la ligne) et minimales (plus long mot)."""
    pad = 6
    nat, minw, body = [], [], []
    _fit3.body = body
    for i, col in enumerate(texts_by_col):
        if fixed[i]:
            nat.append(fixed[i] * mm)
            minw.append(fixed[i] * mm)
            body.append(fixed[i] * mm)
            continue
        cells = col or [""]
        n = max((pdfmetrics.stringWidth(t, FONT, fs) for t in cells), default=0)
        w = max((pdfmetrics.stringWidth(word, FONT, fs) for t in cells for word in _words(t)), default=0)
        hw = max((pdfmetrics.stringWidth(word, FONT_B, fs) for t in head_by_col[i] for word in t.split()), default=0)
        hn = max((pdfmetrics.stringWidth(t, FONT_B, fs) for t in head_by_col[i]), default=0)
        body.append(max(n, hw) + pad)
        nat.append(max(n, min(hn, max(n, hw) * 2.2), hw) + pad)
        minw.append(max(w, hw) + pad)
    return nat, minw


def _fit3(nat, minw, avail):
    """1) tout tient sans retour à la ligne ; 2) sinon les en-têtes passent sur plusieurs lignes
    mais pas les données ; 3) sinon les données longues passent à la ligne (jamais au milieu d'un mot)."""
    if sum(nat) <= avail:
        return _fit(nat, minw, avail)
    body = [max(m, b) for m, b in zip(minw, _fit3.body)]
    if sum(body) <= avail:
        flex = [n - b for n, b in zip(nat, body)]
        sf = sum(flex) or 1
        extra = avail - sum(body)
        return [b + extra * f / sf for b, f in zip(body, flex)]
    return _fit(body, minw, avail)


def _span_needs(nat, minw, hgrid, spans, fs):
    """Un en-tête fusionné sur plusieurs colonnes ne doit pas couper ses mots :
    les colonnes couvertes sont élargies ensemble si nécessaire."""
    pad = 6
    for (c0, r0), (c1, _r1) in spans:
        if c1 <= c0:
            continue
        text = hgrid[r0][c0] or ""
        hw = max((pdfmetrics.stringWidth(w, FONT_B, fs) for w in text.split()), default=0) + pad
        hn = pdfmetrics.stringWidth(text, FONT_B, fs) + pad
        n = c1 - c0 + 1
        for arr, need in ((minw, hw), (nat, max(hw, min(hn, hw * 2.2)))):
            have = sum(arr[c0:c1 + 1])
            if have < need:
                for c in range(c0, c1 + 1):
                    arr[c] += (need - have) / n
    for i in range(len(nat)):
        nat[i] = max(nat[i], minw[i])


def _fit(nat, minw, avail):
    s_nat = sum(nat)
    if s_nat <= avail:
        extra = avail - s_nat
        return [w + extra * (w / s_nat) for w in nat] if s_nat else nat
    s_min = sum(minw)
    if s_min <= avail:
        flex = [n - m for n, m in zip(nat, minw)]
        sf = sum(flex) or 1
        extra = avail - s_min
        return [m + extra * f / sf for m, f in zip(minw, flex)]
    return None


def _table(t: E.Table, avail: float, monnaie: str) -> list:
    ncols = len(t.types)
    hgrid, spans = _grid(t.header, ncols)
    # textes formatés
    body_txt = []
    for row in t.rows:
        if row.kind == "group":
            body_txt.append([str(row.cells[0] or "")] + [""] * (ncols - 1))
            continue
        rtype = row.style.get("type")
        cells = []
        for i, v in enumerate(row.cells):
            typ = t.types[i]
            if rtype and i > 0 and not isinstance(v, str):
                typ = rtype
            cells.append(_cell_text(v, typ, monnaie))
        body_txt.append(cells)
    texts_by_col = [[r[i] for r, row in zip(body_txt, t.rows) if row.kind != "group"] for i in range(ncols)]
    head_by_col = [[hgrid[r][i] for r in range(len(hgrid)) if not any(
        sp[0][0] <= i <= sp[1][0] and sp[0][1] == r and sp[1][0] > sp[0][0] for sp in spans)] for i in range(ncols)]
    widths, fs = None, 9.0
    # passe 1 : réduire la police (jusqu'à 7 pt) pour éviter tout retour à la ligne dans les données ;
    # passe 2 : accepter les retours à la ligne entre les mots (jusqu'à 6 pt).
    for no_wrap, sizes in ((True, (9, 8.5, 8, 7.5, 7)), (False, (9, 8.5, 8, 7.5, 7, 6.5, 6))):
        for fs in sizes:
            nat, minw = _widths(texts_by_col, head_by_col, t.widths, avail, fs)
            _span_needs(nat, minw, hgrid, spans, fs)
            if no_wrap:
                body = [max(m, b) for m, b in zip(minw, _fit3.body)]
                widths = _fit3(nat, minw, avail) if sum(body) <= avail else None
            else:
                widths = _fit3(nat, minw, avail)
            if widths:
                break
        if widths:
            break
    word_wrap = None
    if not widths:  # dernier recours : coupure des mots
        nat, minw = _widths(texts_by_col, head_by_col, t.widths, avail, fs)
        widths = [w * avail / sum(minw) for w in minw]
        word_wrap = "CJK"
    hs = _style(fs, bold=True, align=TA_CENTER, color=colors.white)
    base = len(hgrid)

    def build(indices: list[int]) -> RLTable:
        data = [[_p(x, hs) for x in row] for row in hgrid]
        styles = [
            ("FONTNAME", (0, 0), (-1, -1), FONT), ("FONTSIZE", (0, 0), (-1, -1), fs),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#808080")),
            ("BACKGROUND", (0, 0), (-1, base - 1), BLEU),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ]
        for sp in spans:
            styles.append(("SPAN", sp[0], sp[1]))
        for n, k in enumerate(indices):
            row, txt = t.rows[k], body_txt[k]
            r = base + n
            bold = row.kind in ("subtotal", "total")
            cells = []
            for i, x in enumerate(txt):
                st = _style(fs, bold=bold or (t.first_col_header and i == 0), align=ALIGN.get(t.aligns[i], TA_LEFT))
                if word_wrap:
                    st.wordWrap = word_wrap
                cells.append(_p(x, st))
            if row.kind == "group":
                cells = [_p(txt[0], _style(fs, bold=True))] + [""] * (ncols - 1)
                styles += [("SPAN", (0, r), (-1, r)), ("BACKGROUND", (0, r), (-1, r), BLEU_CLAIR)]
            elif row.kind == "subtotal":
                styles.append(("BACKGROUND", (0, r), (-1, r), GRIS))
            elif row.kind == "total":
                styles.append(("BACKGROUND", (0, r), (-1, r), GRIS_FONCE))
            elif row.style.get("statut") == "ABANDON":
                styles.append(("BACKGROUND", (0, r), (-1, r), ROSE))
            elif row.style.get("statut") == "TRANSFERE":
                styles.append(("BACKGROUND", (0, r), (-1, r), GRIS_TRANSF))
            data.append(cells)
        if t.first_col_header and indices:
            styles.append(("BACKGROUND", (0, base), (0, -1), GRIS))
        tbl = RLTable(data, colWidths=widths, repeatRows=base, hAlign="CENTER")
        tbl.setStyle(TableStyle(styles))
        return tbl

    # découpage : un groupe par page si demandé (le total général reste avec le dernier groupe)
    chunks: list[list[int]] = [[]]
    for k, row in enumerate(t.rows):
        if t.page_break_groups and row.kind == "group" and chunks[-1]:
            chunks.append([])
        chunks[-1].append(k)
    tables = []
    for i, ch in enumerate(chunks):
        if i:
            tables.append(RLPageBreak())
        tables.append(build(ch))
    out = []
    title = [_p(t.title, _style(10, bold=True, color=BLEU)), Spacer(1, 2 * mm)] if t.title else []
    if len(tables) == 1 and len(t.rows) <= 25:
        out.append(KeepTogether(title + tables))   # petit tableau : jamais coupé entre deux pages
    else:
        out += title + tables
    out.append(Spacer(1, 4 * mm))
    return out


# ------------------------------------------------------------------------- autres blocs
def _logo(data: bytes, max_w: float, max_h: float):
    try:
        iw, ih = ImageReader(io.BytesIO(data)).getSize()
    except Exception:
        return None
    k = min(max_w / iw, max_h / ih)
    return Image(io.BytesIO(data), width=iw * k, height=ih * k)


def _officiel(doc: E.Document, avail: float, force: bool = False) -> list:
    """En-tête officiel sur le modèle de la fiche scolaire de l'école (ministère, DRENA, IEPP à gauche,
    République, devise et logos à droite, trait de séparation)."""
    if not force and not doc.entete.get("officiel", True):
        return []
    from epp.reports.fiche_pdf import EnteteOfficielPDF
    gauche, droite, logos = E.entete_officiel(doc)
    out = [EnteteOfficielPDF(gauche, droite, logos, (FONT, FONT_B)), Spacer(1, 2 * mm)]
    if doc.entete.get("texte"):
        out.append(_p(E.subst(doc.entete["texte"], doc.variables), _style(8, align=TA_CENTER)))
    out.append(Spacer(1, 3 * mm))
    return out


def _kv(b: E.KeyValues, avail: float) -> list:
    per_row = 4
    cells, rows = [], []
    for k, v in b.items:
        cells.append([_p(v, _style(14, bold=True, align=TA_CENTER, color=BLEU)),
                      _p(k, _style(7.5, align=TA_CENTER, color=colors.HexColor("#404040")))])
        if len(cells) == per_row:
            rows.append(cells)
            cells = []
    if cells:
        rows.append(cells + [""] * (per_row - len(cells)))
    out = []
    if b.title:
        out.append(_p(b.title, _style(10, bold=True, color=BLEU)))
        out.append(Spacer(1, 2 * mm))
    if rows:
        tbl = RLTable(rows, colWidths=[avail / per_row] * per_row)
        tbl.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, GRIS_FONCE),
                                 ("INNERGRID", (0, 0), (-1, -1), 0.4, GRIS_FONCE),
                                 ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFCFE")),
                                 ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                 ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        out.append(tbl)
    out.append(Spacer(1, 4 * mm))
    return out


def _chart(b: E.Chart, avail: float) -> list:
    w, h = min(avail, 170 * mm), 60 * mm
    d = Drawing(w, h + 12)
    ch = VerticalBarChart()
    ch.x, ch.y, ch.width, ch.height = 30, 20, w - 110, h - 25
    ch.data = [vals for _, vals in b.series]
    ch.categoryAxis.categoryNames = b.categories
    ch.categoryAxis.labels.fontName = FONT
    ch.valueAxis.labels.fontName = FONT
    ch.valueAxis.valueMin = 0
    if b.percent:
        ch.valueAxis.labelTextFormat = lambda v: f"{v * 100:.0f} %"
    palette = [BLEU, colors.HexColor("#C55A11"), colors.HexColor("#548235")]
    for i in range(len(b.series)):
        ch.bars[i].fillColor = palette[i % 3]
    d.add(ch)
    lg = Legend()
    lg.x, lg.y = w - 70, h - 20
    lg.fontName = FONT
    lg.colorNamePairs = [(palette[i % 3], n) for i, (n, _) in enumerate(b.series)]
    d.add(lg)
    d.add(String(0, h + 2, b.title, fontName=FONT_B, fontSize=10, fillColor=BLEU))
    return [d, Spacer(1, 4 * mm)]


def _zone(b: E.TextZone, avail: float) -> list:
    body = _p(b.text or " ", _style(9))
    tbl = RLTable([[body]], colWidths=[avail], rowHeights=[max(b.lines * 12, 14)] if not b.text else None)
    tbl.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [KeepTogether([_p(b.title, _style(9, bold=True)), Spacer(1, 1 * mm), tbl, Spacer(1, 3 * mm)])]


def _signature(b: E.Signature, avail: float) -> list:
    left = _p(b.lieu_date, _style(9))
    right = [_p(b.fonction, _style(9, bold=True, align=TA_CENTER)), Spacer(1, 16 * mm),
             _p(b.nom, _style(9, bold=True, align=TA_CENTER))]
    tbl = RLTable([[left, right]], colWidths=[avail * 0.55, avail * 0.45])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [Spacer(1, 4 * mm), KeepTogether([tbl])]


def _rang(r) -> str:
    if r is None:
        return "–"
    return "1er" if r == 1 else f"{r}e"


def _bulletin(doc: E.Document, b: E.Bulletin, avail: float) -> list:
    d, o = b.data, b.options
    if o.get("style", "colore") == "colore":
        from epp.reports.bulletin_colore import BulletinColore
        return [BulletinColore(doc, b, (FONT, FONT_B, FONT_I, "EPPSans-BoldItalic"))]
    out = _officiel(doc, avail, force=True)
    annuel = d["type"] == "annuel"
    titre = o.get("titre_bulletin") or ("BULLETIN ANNUEL DE NOTES" if annuel else "BULLETIN DE NOTES")
    sous = f"Année scolaire {doc.variables.get('annee', '')}" if annuel else \
        f"{d['evaluation']}" + (f" du {E.fmt(d.get('date_evaluation'), 'date')}" if d.get("date_evaluation") else "") + \
        f" – Année scolaire {doc.variables.get('annee', '')}"
    out += [_p(titre, _style(14, bold=True, align=TA_CENTER, color=BLEU, leading=17)),
            _p(sous, _style(9.5, align=TA_CENTER)), Spacer(1, 4 * mm)]
    # identité + photo
    lab, val = _style(8, color=colors.HexColor("#404040")), _style(10, bold=True)
    ident = [("Nom et prénoms", d.get("nom")), ("Matricule école", d.get("matricule_ecole")),
             ("Matricule DESPS", d.get("matricule_desps") or "–"), ("Classe", d.get("classe")),
             ("Sexe", {"M": "Masculin", "F": "Féminin"}.get(d.get("sexe"), "")),
             ("Né(e) le", E.fmt(d.get("date_naissance"), "date") or "–"),
             ("Redoublant", d.get("redoublant") or "NON"), ("Effectif classé", str(d.get("effectif") or 0)),
             ("Père", d.get("pere") or "–"), ("Mère", d.get("mere") or "–")]
    cells = [[_p(k, lab), _p(str(v or ""), val)] for k, v in ident]
    grid = [cells[i] + cells[i + 1] for i in range(0, len(cells), 2)]
    pw, ph = 30 * mm, 38 * mm
    left_w = avail - pw - 4 * mm
    t_ident = RLTable(grid, colWidths=[left_w * 0.18, left_w * 0.32, left_w * 0.18, left_w * 0.32])
    t_ident.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                                 ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#C0C0C0"))]))
    if o.get("photo", True) and b.photo:
        try:
            ph_img = Image(io.BytesIO(b.photo))
            iw, ih = ph_img.imageWidth, ph_img.imageHeight
            k = min(pw / iw, ph / ih)
            ph_img = Image(io.BytesIO(b.photo), width=iw * k, height=ih * k)
        except Exception:
            ph_img = _p("PHOTO", _style(8, align=TA_CENTER, color=colors.grey))
    else:
        ph_img = _p("PHOTO", _style(8, align=TA_CENTER, color=colors.grey))
    show_photo = o.get("photo", True)
    if show_photo:
        box = RLTable([[ph_img]], colWidths=[pw], rowHeights=[ph])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.grey), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                                 ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        top = RLTable([[t_ident, box]], colWidths=[left_w + 4 * mm, pw])
    else:
        t_ident = RLTable(grid, colWidths=[avail * 0.15, avail * 0.35, avail * 0.15, avail * 0.35])
        top = t_ident
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    out += [top, Spacer(1, 5 * mm)]
    hs = _style(9, bold=True, align=TA_CENTER, color=colors.white)
    cs = _style(9.5)
    cn = _style(9.5, align=TA_CENTER)
    base_style = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#808080")), ("BACKGROUND", (0, 0), (-1, 0), BLEU),
                  ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    app = o.get("appreciations", True)
    if not annuel:
        coef = d["mode"] == "COEF"
        head = ["MATIÈRE", "NOTE", "COEF." if coef else "SUR"] + (["APPRÉCIATION"] if app else [])
        rows = [[_p(h, hs) for h in head]]
        for n in d["notes"]:
            note = "Abs." if not d["present"] else (E.fmt(n["note"], "decimal") if n["note"] is not None else "–")
            r = [_p(n["matiere"], cs), _p(note + ("" if coef else ""), cn),
                 _p(E.fmt(n["coef"] if coef else n["max"], "decimal"), cn)]
            if app:
                r.append(_p(n["appreciation"] or "", cs))
            rows.append(r)
        tot = [_p("TOTAL", _style(9.5, bold=True)), _p(E.fmt(d["total"], "decimal") if d["total"] is not None else "–",
                                                     _style(9.5, bold=True, align=TA_CENTER)),
               _p("" if coef else E.fmt(d["total_max"], "decimal"), cn)] + ([_p("", cs)] if app else [])
        rows.append(tot)
        widths = [avail * 0.42, avail * 0.14, avail * 0.12] + ([avail * 0.32] if app else [])
        if not app:
            widths = [w * avail / sum(widths) for w in widths]
        t = RLTable(rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle(base_style + [("BACKGROUND", (0, -1), (-1, -1), GRIS_FONCE)]))
        out += [t, Spacer(1, 4 * mm)]
        res = [("MOYENNE", f"{E.fmt(d['moyenne'], 'decimal')} / {E.fmt(d['echelle'], 'entier')}"
                if d["moyenne"] is not None else "–"),
               ("RANG", f"{_rang(d['rang'])} sur {d['effectif']}" if d.get("rang") else "–"),
               ("APPRÉCIATION", d.get("appreciation") or "–"), ("RÉSULTAT", d.get("resultat") or "–")]
    else:
        echelle = d["bareme"]
        head = ["ÉVALUATION", "DATE", f"MOYENNE (/{E.fmt(echelle, 'entier')})"] + (["APPRÉCIATION"] if app else [])
        rows = [[_p(h, hs) for h in head]]
        for e in d["evaluations"]:
            m = "Abs. (0)" if not e["present"] else (E.fmt(e["moyenne"], "decimal") if e["moyenne"] is not None else "–")
            r = [_p(e["evaluation"], cs), _p(E.fmt(e["date"], "date"), cn), _p(m, cn)]
            if app:
                r.append(_p(e["appreciation"] or "", cs))
            rows.append(r)
        if d.get("regle_mga") == "STANDARD":
            rows.append([_p("Moyenne des 3 compositions", _style(9.5, italic=True)), _p("", cn),
                         _p(E.fmt(d.get("moy_compos"), "decimal") if d.get("moy_compos") is not None else "–", cn)] +
                        ([_p("", cs)] if app else []))
        widths = [avail * 0.40, avail * 0.16, avail * 0.16] + ([avail * 0.28] if app else [])
        if not app:
            widths = [w * avail / sum(widths) for w in widths]
        t = RLTable(rows, colWidths=widths)
        t.setStyle(TableStyle(base_style))
        out += [t, Spacer(1, 2 * mm)]
        regle = "MGA = (moyenne des 3 compositions + 2 × composition de passage) ÷ 3" \
            if d.get("regle_mga") == "STANDARD" else "MGA = moyenne des 4 évaluations"
        out += [_p(regle, _style(7.5, italic=True, color=colors.HexColor("#404040"))), Spacer(1, 3 * mm)]
        suite = d.get("classe_suivante")
        dec = d.get("decision") or "–"
        if dec == "ADMIS":
            dec = f"ADMIS(E) en {suite}" if suite else "ADMIS(E) – entrée en 6ème"
        else:
            dec = {"EXCLU": "EXCLU(E)", "TRANSFERE": "TRANSFÉRÉ(E)"}.get(dec, dec)
        res = [("MOYENNE GÉNÉRALE ANNUELLE", f"{E.fmt(d['mga'], 'decimal')} / {E.fmt(echelle, 'entier')}"
                if d.get("mga") is not None else "–"),
               ("RANG", f"{_rang(d.get('rang'))} sur {d['effectif']}" if d.get("rang") else "–"),
               ("DÉCISION", dec), ("OBSERVATION", d.get("observation") or "–")]
    kv = [[_p(k, _style(8, color=colors.HexColor("#404040"), align=TA_CENTER)) for k, _ in res],
          [_p(v, _style(12, bold=True, align=TA_CENTER, color=BLEU)) for _, v in res]]
    t = RLTable(kv, colWidths=[avail / 4] * 4)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, BLEU), ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                           ("BACKGROUND", (0, 0), (-1, 0), BLEU_CLAIR), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 1), (-1, 1), 6), ("BOTTOMPADDING", (0, 1), (-1, 1), 6)]))
    out += [t, Spacer(1, 3 * mm)]
    if o.get("statistiques_classe", True):
        ech = d.get("echelle") if not annuel else d.get("bareme")
        stat = (f"Classe : moyenne {E.fmt(d.get('moy_classe'), 'decimal') or '–'}  •  plus forte "
                f"{E.fmt(d.get('moy_max'), 'decimal') or '–'}  •  plus faible {E.fmt(d.get('moy_min'), 'decimal') or '–'}"
                f"  (sur {E.fmt(ech, 'entier')})  •  seuil d'admission {E.fmt(d.get('seuil'), 'decimal')}")
        out += [_p(stat, _style(8.5, align=TA_CENTER, color=colors.HexColor("#303030"))), Spacer(1, 4 * mm)]
    if o.get("observations", True):
        out += _zone(E.TextZone("Observations de l'enseignant(e) :", "", 3), avail)
    sig = o.get("signatures") or []
    if sig:
        n = len(sig)
        lieu = f"Fait à {doc.variables.get('localite', '')}, le {doc.variables.get('date_edition', '')}"
        st = RLTable([[_p(x, _style(9, bold=True, align=TA_CENTER)) for x in sig], [""] * n],
                     colWidths=[avail / n] * n, rowHeights=[None, 18 * mm])
        st.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        out += [_p(lieu, _style(9)), Spacer(1, 2 * mm), st]
    return [KeepTogether(out)]


def _segments(segs: list[tuple[str, bool]]) -> str:
    return "".join(f"<b>{escape(s)}</b>" if gras else escape(s) for s, gras in segs).replace("\n", "<br/>")


def _lettre(b: E.Lettre, avail: float) -> list:
    from reportlab.lib.enums import TA_JUSTIFY
    from reportlab.platypus import Indenter
    marge = 16 * mm
    w = avail - 2 * marge
    out: list = [Indenter(marge, marge)]
    for i, ligne in enumerate(b.entete):
        out.append(_p(ligne, _style(9 if i < 2 else 8.5, bold=i != 1, align=TA_CENTER, leading=12)))
        if i == 1:
            out.append(Spacer(1, 3 * mm))
    out.append(Spacer(1, 5 * mm))
    st_ref = _style(8.5, leading=13)
    refs = [[RLParagraph(_segments([(g.split(":")[0] + " :", True), (":".join(g.split(":")[1:]), False)])
                         if g else "", st_ref),
             RLParagraph(_segments([(d.split(":")[0] + " :", True), (":".join(d.split(":")[1:]), False)])
                         if d else "", st_ref)] for g, d in b.references]
    if refs:
        t = RLTable(refs, colWidths=[w * 0.62, w * 0.38])
        t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
        out += [t, Spacer(1, 7 * mm)]
    out += [_p(b.titre, _style(15, bold=True, align=TA_CENTER, color=BLEU, leading=18)), Spacer(1, 4 * mm)]
    if b.destinataire:
        dest = [_p(b.destinataire[0], _style(9.5, bold=True))] + [_p(x, _style(9.5)) for x in b.destinataire[1:]]
        t = RLTable([[dest]], colWidths=[w])
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#9FB6CD")),
                               ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2F6FA")),
                               ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        out += [t, Spacer(1, 5 * mm)]
    for style, segs in b.corps:
        if style == "intitule":
            out += [RLParagraph(_segments(segs), _style(9.5, bold=True, leading=13)), Spacer(1, 1.5 * mm)]
        elif style == "droite":
            out += [Spacer(1, 2 * mm), RLParagraph(_segments(segs), _style(9.5, align=TA_RIGHT, leading=13)),
                    Spacer(1, 3 * mm)]
        else:
            out += [RLParagraph(_segments(segs), _style(9.5, align=TA_JUSTIFY, leading=13.5)),
                    Spacer(1, 2.5 * mm)]
    if b.signatures:
        n = len(b.signatures)
        tete = [_p(x, _style(7.5, bold=True, align=TA_CENTER, color=BLEU)) for x, _ in b.signatures]
        cases = [[_p(l, _style(7.5, bold=k == 0, align=TA_CENTER, leading=10)) if l else Spacer(1, 6 * mm)
                  for k, l in enumerate(ls)] for _, ls in b.signatures]
        t = RLTable([tete, cases], colWidths=[w / n] * n, rowHeights=[9 * mm, 34 * mm])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9FB6CD")),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F6FA")),
                               ("VALIGN", (0, 0), (-1, 0), "MIDDLE"), ("VALIGN", (0, 1), (-1, 1), "MIDDLE")]))
        out += [Spacer(1, 2 * mm), _p(b.titre_signatures, _style(10, bold=True, align=TA_CENTER, color=BLEU)),
                Spacer(1, 2 * mm), KeepTogether([t])]
    out.append(Indenter(-marge, -marge))
    return out


PSTYLE = {"normal": dict(size=9), "titre2": dict(size=10, bold=True, color=BLEU), "note": dict(size=8, italic=True),
          "encadre": dict(size=9)}


def render(doc: E.Document, out: str | Path | io.BytesIO) -> None:
    _register_fonts()
    size = landscape(A4) if doc.orientation == "paysage" else A4
    avail = size[0] - MARGE_G - MARGE_D
    monnaie = doc.variables.get("monnaie", "FCFA")
    story = []
    story += _officiel(doc, avail)
    last_break = True
    carry: list = []          # intitulés en attente : toujours imprimés avec le bloc qui les suit

    def emit(fl: list) -> None:
        nonlocal carry
        if carry and fl:
            first = fl[0]
            content = list(first._content) if isinstance(first, KeepTogether) else [first]
            fl = [KeepTogether(carry + content)] + fl[1:]
            carry = []
        story.extend(fl)

    for b in doc.blocks:
        if isinstance(b, tuple) and b[0] == "TITRE":
            fl = []
            if b[1]:
                fl.append(_p(b[1], _style(13, bold=True, align=TA_CENTER, color=BLEU, leading=16)))
            if b[2]:
                fl.append(_p(b[2], _style(9.5, align=TA_CENTER)))
            fl.append(Spacer(1, 4 * mm))
            carry += fl
            last_break = False
            continue
        elif isinstance(b, E.Table):
            emit(_table(b, avail, monnaie))
        elif isinstance(b, E.Paragraph):
            if not b.text:
                continue
            st = _style(**PSTYLE.get(b.style, PSTYLE["normal"]))
            p = _p(b.text, st)
            if b.style == "encadre":
                t = RLTable([[p]], colWidths=[avail])
                t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, colors.grey),
                                       ("BACKGROUND", (0, 0), (-1, -1), GRIS)]))
                p = t
            if b.style == "titre2" or (b.style == "normal" and len(b.text) < 160):
                carry += [p, Spacer(1, 2 * mm)]      # un intitulé ne reste jamais seul en bas de page
                last_break = False
                continue
            emit([p, Spacer(1, 2 * mm)])
        elif isinstance(b, E.KeyValues):
            emit(_kv(b, avail))
        elif isinstance(b, E.Chart):
            emit(_chart(b, avail))
        elif isinstance(b, E.TextZone):
            emit(_zone(b, avail))
        elif isinstance(b, E.Signature):
            emit(_signature(b, avail))
        elif isinstance(b, E.Bulletin):
            emit(_bulletin(doc, b, avail))
        elif isinstance(b, E.Lettre):
            emit(_lettre(b, avail))
        elif isinstance(b, E.FicheScolaire):
            from epp.reports.fiche_pdf import FicheScolairePDF
            emit([FicheScolairePDF(doc, b, (FONT, FONT_B, FONT_I))])
        elif isinstance(b, E.EnteteOfficiel):
            emit(_officiel(doc, avail, force=True))
        elif isinstance(b, E.PageBreak):
            if carry:
                story.extend(carry)
                carry = []
            if not last_break:
                story.append(RLPageBreak())
                last_break = True
            continue
        last_break = False
    story.extend(carry)
    while story and isinstance(story[-1], (RLPageBreak, Spacer)):
        story.pop()

    pied = doc.pied or {}
    v = doc.variables
    ftxt = E.subst(pied.get("texte") or "", v)

    def footer(c, page, total):
        c.saveState()
        c.setFont(FONT, 7.5)
        c.setFillColor(colors.HexColor("#404040"))
        y = 6 * mm
        c.drawString(MARGE_G, y, ftxt[:120])
        if pied.get("numerotation", True):
            c.drawCentredString(size[0] / 2, y, f"Page {page} / {total}")
        if pied.get("date_edition", True):
            c.drawRightString(size[0] - MARGE_D, y, f"Édité le {v.get('date_jour', '')}")
        c.restoreState()

    if isinstance(out, Path):
        out = str(out)
    tpl = SimpleDocTemplate(out, pagesize=size, leftMargin=MARGE_G, rightMargin=MARGE_D, topMargin=MARGE_H,
                            bottomMargin=MARGE_B, title=doc.titre or doc.nom, author=v.get("ecole", ""),
                            subject=doc.sous_titre, creator=APP_NAME)
    tpl.build(story or [Spacer(1, 1)], canvasmaker=lambda *a, **k: _NumberedCanvas(*a, footer=footer, **k))


def render_bytes(doc: E.Document) -> bytes:
    buf = io.BytesIO()
    render(doc, buf)
    return buf.getvalue()
