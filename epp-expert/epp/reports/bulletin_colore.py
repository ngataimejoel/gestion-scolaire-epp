"""Bulletin « coloré » : une page A4 par élève, sur le modèle fourni par l'école.

En-tête (logo, nom de l'école, slogan, bandeau BULLETIN DE NOTES, devise), cadre d'identité,
tableau des disciplines du niveau avec une colonne colorée par évaluation du calendrier de la classe
et la moyenne annuelle, appréciation générale, bilan (félicitations, encouragements, doit
progresser, doit être suivi), décision du conseil des maîtres, observations des parents,
signatures et bandeau de pied de page.

Les textes viennent des paramètres (bulletin_titre, bulletin_slogan, bulletin_devise,
bulletin_pied) ; les disciplines et les évaluations viennent du niveau de chaque élève.
"""
from __future__ import annotations

import io

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable

from epp.core import seed
from epp.reports import engine as E

C = {k: colors.HexColor(v) for k, v in {
    "marine": "#0B3D91", "bleu": "#0B4A8B", "bleu_moyen": "#1565C0", "ciel": "#38A3E0", "vert": "#43A047",
    "vert_fonce": "#2E7D32", "orange": "#F59E0B", "violet": "#7E57C2", "jaune": "#F4B400", "jaune_clair": "#FFF4C7",
    "rouge": "#E53935", "fond": "#F3F8FE", "ligne_a": "#EAF3FC", "ligne_b": "#F8FBFF", "bord": "#9CC3EE",
    "pied_tab": "#D3E6F8", "texte": "#17324D", "gris": "#B0BEC5", "gris_txt": "#90A4AE", "blanc": "#FFFFFF",
}.items()}
COULEURS_PERIODES = ["ciel", "vert", "orange", "violet", "bleu_moyen", "rouge"]


def _clair(hexa: str, k: float) -> str:
    """Teinte éclaircie : k = part de blanc (0 = couleur d'origine, 1 = blanc)."""
    h = hexa.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "#" + "".join(f"{round(x + (255 - x) * k):02X}" for x in (r, g, b))


def teintes(palette: str = "douce") -> dict:
    """Couleurs de mise en page du bulletin (PDF et Word).

    « douce » (par défaut) : aucun aplat, fonds blancs, textes foncés et dessins au trait : lisible et économe
    en encre, y compris imprimé en noir et blanc ; chaque colonne garde sa couleur sur un filet fin.
    « vive » : aplats de couleur et textes blancs (impression couleur)."""
    hexa = {k: "#" + v.hexval()[2:].upper() for k, v in C.items()}
    if palette == "vive":
        return {"tete": {k: (v, "#FFFFFF", None) for k, v in hexa.items()},
                "ligne_a": hexa["ligne_a"], "ligne_b": hexa["ligne_b"], "pied_tab": hexa["pied_tab"],
                "identite": hexa["fond"], "bande_fond": hexa["bleu"], "bande_bord": None, "bande_texte": "#FFFFFF",
                "app_fond": hexa["vert"], "app_texte": "#FFFFFF", "separateur": "#FFFFFF", "pied": "plein",
                "obs_fond": hexa["ligne_a"], "bilan_fond": hexa["jaune_clair"], "decision_fond": hexa["ligne_a"],
                "aplats": True}
    blanc = "#FFFFFF"
    return {"tete": {k: (blanc, hexa["marine"], v) for k, v in hexa.items()},
            "ligne_a": blanc, "ligne_b": blanc, "pied_tab": blanc,
            "identite": blanc, "bande_fond": blanc, "bande_bord": hexa["bleu"], "bande_texte": hexa["bleu"],
            "app_fond": blanc, "app_texte": hexa["vert_fonce"], "separateur": hexa["bord"],
            "pied": "leger", "obs_fond": blanc, "bilan_fond": blanc, "decision_fond": blanc, "aplats": False}


def _fmt(v, dec=2) -> str:
    if v is None or v == "":
        return ""
    s = f"{float(v):.{dec}f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def _rang(r) -> str:
    return "" if not r else ("1er" if r == 1 else f"{r}e")


def _casse(t: str) -> str:
    """« EXPLOITATION DE TEXTE » -> « Exploitation de texte » (texte saisi en capitales seulement)."""
    return t[:1] + t[1:].lower() if t and t.isupper() else t


def _court(libelle: str) -> str:
    lib = libelle.lower()
    if "passage" in lib:
        return "Passage"
    if "examen blanc" in lib:
        return "Ex. blanc " + ("1" if lib.startswith("1") else "2")
    return libelle.split()[0] if libelle else libelle


def contenu(doc: E.Document, b: E.Bulletin) -> dict:
    """Textes et valeurs du bulletin, communs au PDF et au document Word."""
    d, o, v, params = b.data, b.options, doc.variables, doc.officiel
    annuel = d["type"] == "annuel"
    rel = d.get("releve") or {"periodes": [], "disciplines": [], "notes": {}, "moyennes": {}, "rangs": {},
                              "presents": {}, "moyennes_disciplines": {}, "echelle": d.get("bareme") or 10}
    periodes = rel["periodes"]
    courant = None if annuel else d.get("eval_num")

    def visible(num):
        return annuel or (courant is not None and num <= courant)

    notes, moyd = rel.get("notes", {}), rel.get("moyennes_disciplines", {})
    moys, rangs, presents = rel.get("moyennes", {}), rel.get("rangs", {}), rel.get("presents", {})
    trim = colonnes(params, o) == "trimestres" and bool(rel.get("trimestres"))
    if trim:
        # colonnes 1er, 2e, 3e trimestre (modèle de l'école) : moyennes des évaluations de chaque trimestre
        t_courant = next((p.get("trimestre") for p in periodes if p["num"] == courant), None)
        cols = [{"num": x["num"], "libelle": x["libelle"].replace("trimestre", "Trimestre")}
                for x in rel["trimestres"]]
        c_notes, c_moys = rel.get("notes_trim", {}), rel.get("moyennes_trim", {})
        c_rangs, c_presents = rel.get("rangs_trim", {}), rel.get("presents_trim", {})

        def c_visible(num):
            return annuel or (t_courant is not None and num <= t_courant)
    else:
        t_courant = None
        cols, c_notes, c_moys, c_rangs, c_presents, c_visible = periodes, notes, moys, rangs, presents, visible

    dernier = periodes[-1]["num"] if periodes else None
    titre_moy = "Moyenne annuelle" if annuel or courant == dernier else "Moyenne à ce jour"
    entetes = [(p["libelle"], COULEURS_PERIODES[i % len(COULEURS_PERIODES)]) for i, p in enumerate(cols)]
    lignes = []
    compo = not annuel and colonnes(params, o) == "composition"
    if compo:
        # bulletin d'une composition : la note de chaque discipline et son appréciation, total, moyenne, rang
        present = d.get("present", True)
        titre_moy = "Appréciation"
        cols = [{"num": courant, "libelle": d.get("evaluation") or "Composition"}]
        entetes = [("Note obtenue", "ciel")]
        c_visible = lambda num: True                                    # noqa: E731
        for n in d.get("notes") or []:
            lignes.append({"libelle": _casse(n["matiere"]), "max": _fmt(n["max"]),
                           "valeurs": [_fmt(n["note"]) if present else "Abs."],
                           "moyenne": n.get("appreciation") or "" if present else ""})
    for m in ([] if compo else rel["disciplines"]):
        vals = []
        for p in cols:
            val = c_notes.get(m["libelle"], {}).get(p["num"])
            vals.append(None if not c_visible(p["num"]) else "Abs." if c_presents.get(p["num"]) is False
                        else _fmt(val))
        moy = ""
        if annuel or courant:
            vs = {p["num"]: notes.get(m["libelle"], {}).get(p["num"]) for p in periodes if visible(p["num"])}
            moy = _fmt(moyd.get(m["libelle"]) if annuel else _moy_partielle(vs, d.get("regle_mga")))
        lignes.append({"libelle": _casse(m["libelle"]), "max": _fmt(m["max"]), "valeurs": vals, "moyenne": moy})
    ech = rel.get("echelle") or d.get("echelle") or 10
    totaux = []
    if compo:
        abs_ = None if present else "Abs."
        totaux = [{"libelle": "Total des points",
                   "valeurs": [abs_ or f"{_fmt(d.get('total'))} / {_fmt(d.get('total_max'))}"], "fin": ""},
                  {"libelle": f"Moyenne (/{_fmt(ech)})", "valeurs": [abs_ or _fmt(d.get("moyenne"))], "fin": ""},
                  {"libelle": "Rang", "valeurs": [_rang(d.get("rang")) if d.get("rang") else "–"],
                   "fin": f"sur {d.get('effectif')}" if d.get("rang") else ""}]
    for k, (lab, vals, fin) in enumerate(() if compo else (
            (f"Moyenne générale (/{_fmt(ech)})", {p["num"]: _fmt(c_moys.get(p["num"])) for p in cols},
             _fmt(d.get("mga") if annuel else _moy_partielle(
                 {p["num"]: moys.get(p["num"]) for p in periodes if visible(p["num"])}, d.get("regle_mga")))),
            ("Rang", {p["num"]: _rang(c_rangs.get(p["num"])) for p in cols},
             f"{_rang(d.get('rang'))} / {d.get('effectif')}" if annuel and d.get("rang") else ""))):
        cells = []
        for p in cols:
            absent = c_presents.get(p["num"]) is False
            cells.append(None if not c_visible(p["num"]) else "Abs." if absent and k == 0 else vals[p["num"]])
        totaux.append({"libelle": lab, "valeurs": cells, "fin": fin})
    stats = None
    st = d
    if trim and not annuel:
        st = (rel.get("stats_trim") or {}).get(t_courant) or {}
        st = {"moy_classe": st.get("moy_classe"), "moy_max": st.get("moy_max"), "moy_min": st.get("moy_min"),
              "effectif": st.get("classes")}
    if o.get("statistiques_classe", True) and st.get("moy_classe") is not None:
        stats = (f"Moyenne de la classe : {_fmt(st.get('moy_classe'))}   •   Plus forte : {_fmt(st.get('moy_max'))}"
                 f"   •   Plus faible : {_fmt(st.get('moy_min'))}   •   Élèves classés : {st.get('effectif')}")
    moy = d.get("mga") if annuel else d.get("moyenne")
    app = d.get("observation") if annuel else d.get("appreciation")
    if annuel and not app:
        from epp.domain.bulletins import appreciation
        app = appreciation(moy, d.get("bareme") or ech)
    seuil = d.get("seuil") or 5
    resultat = None if annuel else d.get("resultat")
    if trim and not annuel:
        # bulletin d'un trimestre : moyenne, appréciation et rang du trimestre (toutes ses évaluations)
        from epp.domain.bulletins import appreciation
        moy = c_moys.get(t_courant)
        app = appreciation(moy, ech) if moy is not None else "Absent(e) au trimestre"
        resultat = None if moy is None else "Moyenne atteinte" if moy >= seuil else "Moyenne non atteinte"
    app_txt = " – ".join(x for x in [app, resultat] if x) + "." if app else ""
    bareme = d.get("bareme") or ech
    choix = None
    if moy is not None:
        s_ = moy / ech * 10
        s_seuil = seuil / bareme * 10
        fel, suivi = float(o.get("bilan_felicitations", 7)), float(o.get("bilan_suivi", 4))
        choix = "fel" if s_ >= fel else "enc" if s_ >= s_seuil else "prog" if s_ >= suivi else "suivi"
    if annuel:
        dec = d.get("decision") or ""
        suite = d.get("classe_suivante")
        dec = {"ADMIS": f"ADMIS(E) en {suite}" if suite else "ADMIS(E) en 6ème",
               "REDOUBLE": "REDOUBLE", "EXCLU": "EXCLU(E)", "TRANSFERE": "TRANSFÉRÉ(E)"}.get(dec, dec)
    elif trim:
        r_ = c_rangs.get(t_courant)
        dec = f"{_rang(r_)} sur {(rel.get('effectifs_trim') or {}).get(t_courant)}" if r_ else "Absent(e)"
    else:
        dec = f"{_rang(d.get('rang'))} sur {d.get('effectif')}" if d.get("rang") else (
            "Absent(e)" if not d.get("present", True) else "")
    sigs = list(o.get("signatures") or ["L'enseignant(e)", "Le Directeur", "Les parents"])[:3]
    noms = [d.get("enseignant", ""), v.get("directeur", ""), ""]
    age = d.get("age")
    mention, officiel = "", None
    if o.get("mention_officielle", True):
        gauche, droite, _ = E.entete_officiel(doc)
        mention = "  •  ".join([*gauche[:3], *(droite[:1])])
        officiel = (gauche, droite[:2])          # en-tête « fiche scolaire » compact (sans logos)
    return {
        "annuel": annuel, "periodes": cols, "courant": t_courant if trim else courant, "visible": c_visible,
        "mention": mention, "officiel": officiel, "parents": d.get("ligne_parents") or "",
        "titre": E.subst(params.get("bulletin_titre") or "{ecole}", v).upper(),
        "slogan": E.subst(params.get("bulletin_slogan", seed.DEFAULT_PARAMS["bulletin_slogan"]) or "", v),
        "devise": E.subst(params.get("bulletin_devise", seed.DEFAULT_PARAMS["bulletin_devise"]) or "", v),
        "pied": E.subst(params.get("bulletin_pied", seed.DEFAULT_PARAMS["bulletin_pied"]) or "", v),
        "logos": [x for x in (E.repo.decode_logo(params.get("logo_ecole")),
                              E.repo.decode_logo(params.get("logo_iepp"))) if x],
        "nom_bulletin": o.get("titre_bulletin") or ("BULLETIN ANNUEL" if annuel else
                                                    "BULLETIN DE COMPOSITION" if compo else "BULLETIN DE NOTES"),
        "annee": v.get("annee", ""),
        "eleve": f"{d.get('nom', '')}  ({d.get('matricule_ecole', '')})",
        "naissance": E.fmt(d.get("date_naissance"), "date") or "",
        "age": f"{age} ans" if age not in (None, "") else "",
        "classe": d.get("classe", ""), "enseignant": d.get("enseignant", ""), "ecole": v.get("ecole", ""),
        "label_periode": "Trimestre :" if trim else "Composition :" if compo else "Période :",
        "choix_periode": ([(x, False) for x in ("1er", "2e", "3e")] + [("Année", True)] if trim and annuel
                          else [(x, i + 1 == t_courant) for i, x in enumerate(("1er", "2e", "3e"))] if trim
                          else [("Année complète", True)] if annuel
                          else [(_court(p["libelle"]), p["num"] == courant) for p in periodes]),
        "titre_moyenne": titre_moy, "entetes": entetes, "lignes": lignes, "totaux": totaux, "stats": stats,
        "appreciation": app_txt, "bilan_choix": choix,
        "bilan": [("fel", "Félicitations"), ("enc", "Encouragements"), ("prog", "Doit progresser"),
                  ("suivi", "Doit être suivi")],
        "titre_bilan": "Bilan de l'année" if annuel else "Bilan du trimestre" if trim else
        "Bilan de la composition" if compo else "Bilan de la période",
        "titre_decision": "Décision du conseil des maîtres" if annuel else "Résultat", "decision": dec,
        "signatures": [(lab, noms[i] if i < len(noms) else "") for i, lab in enumerate(sigs)],
        "photo": o.get("photo", True),
        "couleurs": teintes("vive" if ((params or {}).get("bulletin_palette") or o.get("palette")) == "vive"
                           else "douce"),
    }


class BulletinColore(Flowable):
    def __init__(self, doc: E.Document, b: E.Bulletin, fonts: tuple[str, str, str, str]):
        super().__init__()
        self.doc, self.b, self.d, self.photo, self.o = doc, b, b.data, b.photo, b.options
        self.F, self.FB, self.FI, self.FBI = fonts
        self.params = doc.officiel
        self.v = doc.variables

    def wrap(self, aw, ah):
        self.width, self.height = aw, ah - 1
        return self.width, self.height

    # ------------------------------------------------------------------ outils de dessin
    def _txt(self, x, y, s, font=None, size=9, color="texte", align="left", maxw=None):
        c = self.canv
        font = font or self.F
        s = str(s or "")
        if maxw:
            while size > 5.5 and stringWidth(s, font, size) > maxw:
                size -= 0.25
        c.setFont(font, size)
        c.setFillColor(C[color] if isinstance(color, str) else color)
        {"left": c.drawString, "center": c.drawCentredString, "right": c.drawRightString}[align](x, y, s)
        return size

    def _pointilles(self, x1, x2, y):
        c = self.canv
        c.saveState()
        c.setStrokeColor(C["gris"])
        c.setDash(0.8, 2)
        c.setLineWidth(0.6)
        c.line(x1, y, x2, y)
        c.restoreState()

    def _image(self, data, x, y, w, h):
        try:
            ir = ImageReader(io.BytesIO(data))
            iw, ih = ir.getSize()
        except Exception:
            return False
        k = min(w / iw, h / ih)
        self.canv.drawImage(ir, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k, mask="auto")
        return True

    def _embleme(self, x, y, s, plein=True):
        """Emblème par défaut (livre ouvert et élève) quand aucun logo n'est enregistré ; au trait sans aplat
        quand plein est faux (impression économe en encre)."""
        c = self.canv
        c.saveState()
        if not plein:
            c.setLineWidth(max(1.0, s * 0.03))
            c.setLineJoin(1)
        for sens, coul in ((-1, "bleu_moyen"), (1, "bleu_moyen")):
            p = c.beginPath()
            cx = x + s / 2
            p.moveTo(cx, y + s * 0.18)
            p.curveTo(cx + sens * s * 0.2, y + s * 0.3, cx + sens * s * 0.38, y + s * 0.3, cx + sens * s * 0.5, y + s * 0.22)
            p.lineTo(cx + sens * s * 0.5, y + s * 0.55)
            p.curveTo(cx + sens * s * 0.38, y + s * 0.62, cx + sens * s * 0.2, y + s * 0.62, cx, y + s * 0.5)
            p.close()
            c.setFillColor(C[coul])
            c.setStrokeColor(C[coul])
            c.drawPath(p, fill=1 if plein else 0, stroke=0 if plein else 1)
            c.setFillColor(C["jaune"])
            q = c.beginPath()
            q.moveTo(cx, y + s * 0.5)
            q.curveTo(cx + sens * s * 0.18, y + s * 0.6, cx + sens * s * 0.32, y + s * 0.6, cx + sens * s * 0.44, y + s * 0.54)
            q.lineTo(cx + sens * s * 0.44, y + s * 0.28)
            q.curveTo(cx + sens * s * 0.3, y + s * 0.34, cx + sens * s * 0.16, y + s * 0.34, cx, y + s * 0.24)
            q.close()
            if plein:
                c.drawPath(q, fill=1, stroke=0)
        c.setFillColor(C["marine"])
        c.setStrokeColor(C["marine"])
        c.circle(x + s * 0.5, y + s * 0.78, s * 0.08, fill=1 if plein else 0, stroke=0 if plein else 1)
        c.setLineWidth(s * 0.07 if plein else max(1.0, s * 0.035))
        c.setLineCap(1)
        c.line(x + s * 0.3, y + s * 0.62, x + s * 0.5, y + s * 0.66)
        c.line(x + s * 0.5, y + s * 0.66, x + s * 0.72, y + s * 0.86)
        c.setFillColor(C["jaune"])
        self._etoile(x + s * 0.8, y + s * 0.93, s * 0.07)
        c.restoreState()

    def _etoile(self, cx, cy, r):
        import math
        p = self.canv.beginPath()
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.45
            (p.moveTo if i == 0 else p.lineTo)(cx + rr * math.cos(a), cy + rr * math.sin(a))
        p.close()
        self.canv.drawPath(p, fill=1, stroke=0)

    def _icone(self, kind, cx, cy, r, actif, plein=True):
        c = self.canv
        coul = {"fel": "vert", "enc": "orange", "prog": "bleu_moyen", "suivi": "rouge"}[kind]
        col = C[coul] if actif else C["gris"]
        c.saveState()
        if not (actif or plein):          # choix non retenu : simple contour, sans encre en aplat
            c.setStrokeColor(col)
            c.setLineWidth(0.8)
            if kind == "suivi":
                p = c.beginPath()
                p.moveTo(cx, cy + r)
                p.lineTo(cx + r, cy - r * 0.8)
                p.lineTo(cx - r, cy - r * 0.8)
                p.close()
                c.drawPath(p, fill=0, stroke=1)
            else:
                c.circle(cx, cy, r * 0.9, fill=0, stroke=1)
            c.restoreState()
            return
        c.setFillColor(col)
        c.setStrokeColor(colors.white)
        if kind == "suivi":
            p = c.beginPath()
            p.moveTo(cx, cy + r)
            p.lineTo(cx + r, cy - r * 0.8)
            p.lineTo(cx - r, cy - r * 0.8)
            p.close()
            c.drawPath(p, fill=1, stroke=0)
            c.setFillColor(colors.white)
            c.setFont(self.FB, r * 1.25)
            c.drawCentredString(cx, cy - r * 0.6, "!")
        elif kind == "prog":
            c.setStrokeColor(col)
            c.setLineWidth(r * 0.35)
            c.circle(cx, cy, r * 0.8, fill=0, stroke=1)
            c.circle(cx, cy, r * 0.25, fill=1, stroke=0)
        else:
            c.circle(cx, cy, r, fill=1, stroke=0)
            c.setStrokeColor(colors.white)
            c.setLineWidth(r * 0.28)
            c.setLineCap(1)
            if kind == "fel":
                c.line(cx - r * 0.45, cy, cx - r * 0.1, cy - r * 0.38)
                c.line(cx - r * 0.1, cy - r * 0.38, cx + r * 0.48, cy + r * 0.35)
            else:
                c.setFillColor(colors.white)
                self._etoile(cx, cy, r * 0.6)
        c.restoreState()

    def _cadre(self, x, y, w, h, titre, coul_titre, fond_titre, bord, h_titre=7 * mm, taille=11):
        c = self.canv
        c.saveState()
        c.setFillColor(colors.white)
        c.setStrokeColor(bord)
        c.setLineWidth(1.1)
        c.roundRect(x, y, w, h, 3 * mm, fill=1, stroke=1)
        p = c.beginPath()
        r = 3 * mm
        top = y + h
        p.moveTo(x, top - h_titre)
        p.lineTo(x, top - r)
        p.arcTo(x, top - 2 * r, x + 2 * r, top, 180, -90)
        p.lineTo(x + w - r, top)
        p.arcTo(x + w - 2 * r, top - 2 * r, x + w, top, 90, -90)
        p.lineTo(x + w, top - h_titre)
        p.close()
        if fond_titre.hexval().upper() == "0XFFFFFF":       # sans aplat : un filet sépare le titre
            c.setStrokeColor(bord)
            c.setLineWidth(0.6)
            c.line(x, top - h_titre, x + w, top - h_titre)
        else:
            c.setFillColor(fond_titre)
            c.drawPath(p, fill=1, stroke=0)
        c.restoreState()
        self._txt(x + 4 * mm, top - h_titre + 2.1 * mm, titre, self.FB, taille, coul_titre, maxw=w - 8 * mm)

    # ------------------------------------------------------------------ page
    def draw(self):
        c, o = self.canv, self.o
        W, H = self.width, self.height
        K = contenu(self.doc, self.b)
        periodes = K["periodes"]
        y = H

        # en-tête officiel (ministère, DRENA, IEPP | République, devise), modèle de la fiche scolaire
        if K["officiel"]:
            from epp.reports.fiche_pdf import dessiner_entete
            c.saveState()
            y -= dessiner_entete(c, 0, y, W, K["officiel"][0], K["officiel"][1], [], (self.F, self.FB),
                                 taille=6.4, tirets=False) + 1.5 * mm
            c.restoreState()

        # en-tête
        hh = 33 * mm
        logos = K["logos"]
        if not (logos and self._image(logos[0], 0, y - hh + 2 * mm, 30 * mm, 29 * mm)):
            self._embleme(0, y - hh + 2 * mm, 30 * mm, K["couleurs"]["aplats"])
        xc0, xc1 = 34 * mm, W - 44 * mm
        cx = (xc0 + xc1) / 2
        self._txt(cx, y - 9 * mm, K["titre"], self.FB, 24, "marine", "center", maxw=xc1 - xc0)
        if K["slogan"]:
            self._txt(cx, y - 14 * mm, K["slogan"], self.FBI, 10, "bleu_moyen", "center", maxw=xc1 - xc0)
        lw = min(110 * mm, xc1 - xc0)
        c.setLineWidth(1.6 * mm if K["couleurs"]["pied"] == "plein" else 0.9 * mm)
        for i, coul in enumerate(("bleu_moyen", "jaune", "vert")):
            c.setStrokeColor(C[coul])
            c.line(cx - lw / 2 + i * lw / 3, y - 16.6 * mm, cx - lw / 2 + (i + 1) * lw / 3, y - 16.6 * mm)
        bw = min(108 * mm, xc1 - xc0)
        T = K["couleurs"]
        c.setFillColor(colors.HexColor(T["bande_fond"]))
        if T["bande_bord"]:
            c.setStrokeColor(colors.HexColor(T["bande_bord"]))
            c.setLineWidth(1.4)
        c.roundRect(cx - bw / 2, y - hh, bw, 15 * mm, 4 * mm, fill=1, stroke=1 if T["bande_bord"] else 0)
        bt = colors.HexColor(T["bande_texte"])
        self._txt(cx, y - hh + 6.4 * mm, K["nom_bulletin"], self.FB, 19, bt, "center", maxw=bw - 6 * mm)
        self._txt(cx, y - hh + 2 * mm, f"Année scolaire : {self.v.get('annee', '').replace('-', ' - ')}",
                  self.FB, 10, bt, "center")
        devise = K["devise"]
        y_dev, t_dev = y - 13 * mm, 11
        if len(logos) > 1:          # logo de l'IEPP en haut à droite, la devise passe dessous
            self._image(logos[1], W - 40 * mm, y - 16 * mm, 40 * mm, 15 * mm)
            y_dev, t_dev = y - 25 * mm, 9
        if devise:
            c.saveState()
            c.translate(W - 22 * mm, y_dev)
            c.rotate(7)
            lignes = simpleSplit(devise, self.FBI, t_dev, 40 * mm)[:3]
            for i, l in enumerate(lignes):
                self._txt(0, (len(lignes) / 2 - i) * 4.6 * mm * t_dev / 11 - 2 * mm, l, self.FBI, t_dev, "marine",
                          "center")
            c.setStrokeColor(C["jaune"])
            c.setLineWidth(1.4)
            p = c.beginPath()
            yb = -len(lignes) / 2 * 4.6 * mm * t_dev / 11 - 2.5 * mm
            p.moveTo(-17 * mm, yb)
            p.curveTo(-6 * mm, yb + 1.2 * mm, 8 * mm, yb + 1.6 * mm, 18 * mm, yb + 2.4 * mm)
            c.drawPath(p, stroke=1, fill=0)
            c.restoreState()
        y -= hh + 3 * mm

        # identité
        hi = 31 * mm if K["parents"] else 25 * mm
        c.setFillColor(colors.HexColor(T["identite"]))
        c.setStrokeColor(C["bord"])
        c.setLineWidth(1)
        c.roundRect(0, y - hi, W, hi, 3 * mm, fill=1, stroke=1)
        xp = W
        if K["photo"]:
            pw, ph = 20 * mm, 22 * mm
            xp = W - pw - 2 * mm
            if not (self.photo and self._image(self.photo, xp, y - 25 * mm + 1.5 * mm, pw, ph)):
                c.setStrokeColor(C["bord"])
                c.setFillColor(colors.white)
                c.rect(xp, y - 25 * mm + 1.5 * mm, pw, ph, fill=1, stroke=1)
                self._txt(xp + pw / 2, y - 25 * mm + 11 * mm, "PHOTO", self.F, 7, "gris_txt", "center")
            xp -= 2 * mm
        split = xp * 0.56
        c.setStrokeColor(C["bord"])
        c.line(split, y - (25 * mm) + 3 * mm, split, y - 3 * mm)

        def champ(x, yy, lab, val, maxw):
            self._txt(x, yy, lab, self.FB, 8.5, "texte")
            lw_ = stringWidth(lab, self.FB, 8.5) + 1.5 * mm
            self._txt(x + lw_, yy, val, self.F, 9.5, "marine", maxw=maxw - lw_)

        rows = [
            [("Élève :", K["eleve"], split - 7 * mm)],
            [("Né(e) le :", K["naissance"], split * 0.5), ("Âge :", K["age"], split * 0.4)],
            [("Classe :", K["classe"], split * 0.4), ("Enseignant(e) :", K["enseignant"], split * 0.56)],
        ]
        for i, r in enumerate(rows):
            yy = y - 6.5 * mm - i * 7 * mm
            xx = 3.5 * mm
            for lab, val, mw in r:
                champ(xx, yy, lab, val, mw)
                xx += mw + 2 * mm if len(r) > 1 else 0
        if K["parents"]:
            c.setStrokeColor(C["bord"])
            c.line(3 * mm, y - 24.2 * mm, W - 3 * mm, y - 24.2 * mm)
            champ(3.5 * mm, y - 28.3 * mm, "Parents :", K["parents"], W - 7 * mm)
        x2 = split + 3.5 * mm
        wr = xp - x2 - 2 * mm
        champ(x2, y - 6.5 * mm, "Établissement :", K["ecole"], wr)
        champ(x2, y - 13.5 * mm, "Année scolaire :", K["annee"], wr)
        self._txt(x2, y - 20.5 * mm, K["label_periode"], self.FB, 8.5)
        xx = x2 + stringWidth(K["label_periode"], self.FB, 8.5) + 2.5 * mm
        tc, ec = 8.0, 3.0 * mm             # police et écart réduits si les cases dépassent vers la photo
        while tc > 6 and xx + sum(3.6 * mm + stringWidth(l, self.FB, tc) + ec
                                  for l, _ in K["choix_periode"]) > xp - 1 * mm:
            tc, ec = tc - 0.25, max(1.2 * mm, ec - 0.3 * mm)
        for lib, coche in K["choix_periode"]:
            c.setStrokeColor(C["marine"])
            c.setFillColor(C["marine"] if coche and T["aplats"] else colors.white)
            c.rect(xx, y - 21.1 * mm, 2.8 * mm, 2.8 * mm, fill=1, stroke=1)
            if coche:
                c.setStrokeColor(colors.white if T["aplats"] else C["marine"])
                c.setLineWidth(1)
                c.line(xx + 0.5 * mm, y - 19.8 * mm, xx + 1.2 * mm, y - 20.6 * mm)
                c.line(xx + 1.2 * mm, y - 20.6 * mm, xx + 2.4 * mm, y - 18.8 * mm)
                c.setLineWidth(1)
            self._txt(xx + 3.6 * mm, y - 20.6 * mm, lib, self.FB if coche else self.F, tc, "texte")
            xx += 3.6 * mm + stringWidth(lib, self.FB, tc) + ec
        y -= hi + 3.5 * mm

        # tableau des disciplines
        h_bas, h_pied = 62 * mm, 19 * mm
        stats = K["stats"]
        dispo = y - h_bas - h_pied - 4 * mm - (4.5 * mm if o.get("statistiques_classe", True) else 0)
        disc = K["lignes"]
        n = len(disc) + 2
        hh_t = 11 * mm
        rh = max(4.2 * mm, min(10.5 * mm, (dispo - hh_t) / max(n, 1)))
        np_ = max(len(periodes), 1)
        w_no, w_moy = 10 * mm, 25 * mm
        w_p = min(27 * mm, (W - w_no - w_moy - 55 * mm) / np_)
        w_disc = W - w_no - w_moy - w_p * np_
        xs = [0, w_no, w_no + w_disc] + [w_no + w_disc + w_p * (i + 1) for i in range(np_)] + [W]
        top = y
        heads = [("N°", "bleu"), ("DISCIPLINES", "bleu")] + K["entetes"] + [(K["titre_moyenne"], "marine")]
        if not periodes:
            heads.insert(2, ("–", "ciel"))
        for i, (lab, coul) in enumerate(heads):
            x0, x1 = xs[i], xs[i + 1]
            fond, texte, trait = T["tete"][coul]
            c.setFillColor(colors.HexColor(fond))
            c.rect(x0, top - hh_t, x1 - x0, hh_t, fill=1, stroke=0)
            if trait:                      # filet de la couleur de l'évaluation
                c.setFillColor(colors.HexColor(trait))
                c.rect(x0, top - 0.8 * mm, x1 - x0, 0.8 * mm, fill=1, stroke=0)
            lignes = simpleSplit(lab, self.FB, 9.5, x1 - x0 - 2 * mm)[:2]
            for k, l in enumerate(lignes):
                yy = top - hh_t / 2 - 1.2 * mm + (len(lignes) - 1) * 1.9 * mm - k * 3.8 * mm
                self._txt((x0 + x1) / 2, yy, l, self.FB, 9.5, colors.HexColor(texte), "center",
                          maxw=x1 - x0 - 1.5 * mm)
        yy = top - hh_t
        for i, m in enumerate(disc):
            c.setFillColor(colors.HexColor(T["ligne_a"] if i % 2 == 0 else T["ligne_b"]))
            c.rect(0, yy - rh, W, rh, fill=1, stroke=0)
            base = yy - rh / 2 - 1.2 * mm
            self._txt(w_no / 2, base, str(i + 1), self.FB, 9.5, "marine", "center")
            lab = m["libelle"]
            sz = self._txt(xs[1] + 2.5 * mm, base, lab, self.F, 9.5, "texte",
                           maxw=w_disc - 15 * mm)
            self._txt(xs[1] + 3.5 * mm + stringWidth(lab, self.F, sz), base, f"(/{m['max']})",
                      self.F, 7, "gris_txt")
            for j, txt in enumerate(m["valeurs"]):
                if txt is not None:
                    self._txt((xs[2 + j] + xs[3 + j]) / 2, base, txt, self.F, 10, "texte", "center")
            self._txt((xs[-2] + xs[-1]) / 2, base, m["moyenne"], self.FB, 10, "marine", "center",
                      maxw=xs[-1] - xs[-2] - 2 * mm)
            yy -= rh
        # moyenne générale et rang
        if not T["aplats"] and K["totaux"]:     # sans aplat : un trait plus marqué les sépare des disciplines
            c.setStrokeColor(C["bleu_moyen"])
            c.setLineWidth(1)
            c.line(0, yy, W, yy)
        for t in K["totaux"]:
            c.setFillColor(colors.HexColor(T["pied_tab"]))
            c.rect(0, yy - rh, W, rh, fill=1, stroke=0)
            base = yy - rh / 2 - 1.3 * mm
            self._txt(xs[1] + 2.5 * mm, base, t["libelle"], self.FB, 10.5, "marine", maxw=w_disc - 3 * mm)
            for j, txt in enumerate(t["valeurs"]):
                if txt is not None:
                    self._txt((xs[2 + j] + xs[3 + j]) / 2, base, txt, self.FB, 10.5, "marine", "center",
                              maxw=xs[3 + j] - xs[2 + j] - 2 * mm)
            self._txt((xs[-2] + xs[-1]) / 2, base, t["fin"], self.FB, 10.5, "marine", "center")
            yy -= rh
        bas_tab = yy
        c.setStrokeColor(colors.HexColor(T["separateur"]))
        c.setLineWidth(1.2 if T["separateur"] == "#FFFFFF" else 0.5)
        for x in xs[1:-1]:
            c.line(x, top, x, bas_tab)
        c.setStrokeColor(C["bord"])
        c.setLineWidth(0.5)
        for i in range(n):
            c.line(0, top - hh_t - i * rh, W, top - hh_t - i * rh)
        c.setStrokeColor(C["bleu_moyen"])
        c.setLineWidth(1.2)
        c.roundRect(0, bas_tab, W, top - bas_tab, 2.5 * mm, fill=0, stroke=1)
        y = bas_tab - 1.5 * mm
        if stats:
            self._txt(W / 2, y - 3 * mm, stats, self.FI, 8, "texte", "center", maxw=W)
            y -= 4.5 * mm
        y -= 2.5 * mm

        # bas de page : appréciation, observations | bilan, décision, signatures
        gw = W * 0.485
        xr = gw + W * 0.03
        rw = W - xr
        # le bas de page occupe la place libre au-dessus du bandeau (au plus 100 mm)
        h_bas = max(h_bas, min(100 * mm, y - h_pied - 3 * mm))
        ha = h_bas * 0.5
        self._cadre(0, y - ha, gw, ha, "Appréciation générale", colors.HexColor(T["app_texte"]),
                    colors.HexColor(T["app_fond"]), C["vert"])
        lignes = simpleSplit(K["appreciation"], self.FB, 10, gw - 8 * mm) if K["appreciation"] else []
        ly = y - 7 * mm - 6 * mm
        for l in lignes[:2]:
            self._txt(4 * mm, ly, l, self.FB, 10, "vert_fonce")
            ly -= 5.5 * mm
        while ly > y - ha + 3 * mm:
            self._pointilles(4 * mm, gw - 4 * mm, ly)
            ly -= 5.5 * mm
        y2 = y - ha - 3 * mm
        ho = max(20 * mm, h_bas - ha - 3 * mm)
        self._cadre(0, y2 - ho, gw, ho, "Observations des parents", "marine", colors.HexColor(T["obs_fond"]), C["bord"],
                    h_titre=6.5 * mm, taille=10)
        ly = y2 - 6.5 * mm - 5.5 * mm
        while ly > y2 - ho + 2.5 * mm:
            self._pointilles(4 * mm, gw - 4 * mm, ly)
            ly -= 5.2 * mm

        hb = max(36 * mm, h_bas * 0.6)
        pas = (hb - 9 * mm) / 4.2
        self._cadre(xr, y - hb, rw, hb, K["titre_bilan"], "marine",
                    colors.HexColor(T["bilan_fond"]), C["jaune"], taille=11)
        choix, items = K["bilan_choix"], K["bilan"]
        lw_b = rw * 0.52
        for i, (k, lab) in enumerate(items):
            iy = y - 7 * mm - pas * 0.75 - i * pas
            self._icone(k, xr + 6 * mm, iy + 1.2 * mm, 2.3 * mm, choix == k, T["aplats"])
            self._txt(xr + 10.5 * mm, iy, lab, self.FB if choix == k else self.F, 10,
                      "marine" if choix == k else "gris_txt")
        c.setStrokeColor(C["bord"])
        c.line(xr + lw_b, y - hb + 3 * mm, xr + lw_b, y - 9 * mm)
        dx0, dw = xr + lw_b + 2.5 * mm, rw - lw_b - 5 * mm
        titre_dec = K["titre_decision"]
        for k, l in enumerate(simpleSplit(titre_dec, self.FB, 9, dw)[:2]):
            self._txt(dx0 + dw / 2, y - 12.5 * mm - k * 3.8 * mm, l, self.FB, 9, "marine", "center")
        c.setFillColor(colors.HexColor(T["decision_fond"]))
        c.setStrokeColor(C["bord"])
        c.setLineWidth(0.8)
        hd = hb - 22 * mm
        c.roundRect(dx0, y - hb + 3 * mm, dw, hd, 2.5 * mm, fill=1, stroke=0 if T["aplats"] else 1)
        dec = K["decision"]
        for k, l in enumerate(simpleSplit(dec, self.FB, 11, dw - 3 * mm)[:2]):
            self._txt(dx0 + dw / 2, y - hb + 3 * mm + hd / 2 + 0.8 * mm - k * 4.5 * mm, l, self.FB, 11, "bleu_moyen",
                      "center")

        sy = y - hb - 3 * mm
        hs = h_bas - hb - 3 * mm         # hauteur de la zone des signatures
        sigs = K["signatures"]
        cw = rw / max(len(sigs), 1)
        for i, (lab, nom) in enumerate(sigs):
            x0 = xr + i * cw
            self._txt(x0 + cw / 2, sy - 3 * mm, "Signature", self.FB, 8, "texte", "center")
            self._txt(x0 + cw / 2, sy - 6.6 * mm, lab, self.F, 8, "texte", "center", maxw=cw - 2 * mm)
            self._pointilles(x0 + 3 * mm, x0 + cw - 3 * mm, sy - hs + 5 * mm)
            if nom:
                self._txt(x0 + cw / 2, sy - hs + 1.5 * mm, nom, self.F, 7, "gris_txt", "center", maxw=cw - 2 * mm)
            if i:
                c.setStrokeColor(C["bord"])
                c.line(x0, sy - 1 * mm, x0, sy - hs + 1 * mm)

        # bandeau de pied
        self._bandeau(W, h_pied - 2 * mm, T["pied"] == "leger")

    def _bandeau(self, W, h, leger=False):
        c = self.canv
        c.saveState()
        for dy, coul in ((2.2 * mm, "jaune"), (0, "marine")):
            if leger:                      # deux vagues tracées en traits, sans aplat
                p = c.beginPath()
                p.moveTo(0, h * 0.55 + dy)
                p.curveTo(W * 0.3, h * 0.95 + dy, W * 0.6, h * 0.25 + dy, W, h * 0.8 + dy)
                c.setStrokeColor(C[coul])
                c.setLineWidth(1.4 if coul == "jaune" else 1)
                c.drawPath(p, fill=0, stroke=1)
                continue
            p = c.beginPath()
            p.moveTo(0, 0)
            p.lineTo(0, h * 0.55 + dy)
            p.curveTo(W * 0.3, h * 0.95 + dy, W * 0.6, h * 0.25 + dy, W, h * 0.8 + dy)
            p.lineTo(W, 0)
            p.close()
            c.setFillColor(C[coul])
            c.drawPath(p, fill=1, stroke=0)
        t = contenu(self.doc, self.b)["pied"]
        if t:
            self._txt(W / 2, h * 0.28, t, self.FBI, 12, "marine" if leger else "blanc", "center", maxw=W * 0.62)
            tw = min(stringWidth(t, self.FBI, 12), W * 0.62)
            c.setStrokeColor(C["jaune"])
            c.setLineWidth(1.2)
            for s in (-1, 1):
                x = W / 2 + s * (tw / 2 + 3 * mm)
                c.line(x, h * 0.33, x + s * 6 * mm, h * 0.33)
        # pile de livres et toque
        c.setLineWidth(0.8)
        for i, coul in enumerate(("vert", "rouge", "orange", "bleu_moyen")):
            c.setFillColor(C[coul])
            c.setStrokeColor(C[coul])
            c.roundRect(3 * mm + (i % 2) * 1.2 * mm, 1.5 * mm + i * 2.6 * mm, 20 * mm, 2.4 * mm, 0.6 * mm,
                        fill=0 if leger else 1, stroke=1 if leger else 0)
        c.setFillColor(C["jaune"])
        c.setStrokeColor(C["jaune"])
        x, y0 = W - 16 * mm, h * 0.45
        p = c.beginPath()
        p.moveTo(x - 8 * mm, y0)
        p.lineTo(x, y0 + 3.5 * mm)
        p.lineTo(x + 8 * mm, y0)
        p.lineTo(x, y0 - 3.5 * mm)
        p.close()
        c.drawPath(p, fill=0 if leger else 1, stroke=1 if leger else 0)
        c.rect(x - 4.5 * mm, y0 - 5.5 * mm, 9 * mm, 3.5 * mm, fill=0 if leger else 1, stroke=1 if leger else 0)
        c.setStrokeColor(C["jaune"])
        c.setLineWidth(0.8)
        c.line(x + 6 * mm, y0 + 0.5 * mm, x + 6 * mm, y0 - 5 * mm)
        c.restoreState()


def colonnes(params: dict | None, options: dict | None = None) -> str:
    """« trimestres » (par défaut, comme le modèle de l'école) ou « evaluations » (une colonne par évaluation) ;
    « composition » : bulletin d'une seule composition, choisi par le modèle (Bulletins de composition)."""
    if ((options or {}).get("colonnes") or "").lower() == "composition":
        return "composition"
    v = ((params or {}).get("bulletin_colonnes") or (options or {}).get("colonnes") or "trimestres").lower()
    return "evaluations" if v.startswith("eval") else "trimestres"


def _moy_partielle(vals: dict, regle: str | None):
    from epp.domain.bulletins import _moyenne_annuelle
    return _moyenne_annuelle(vals, regle or "")
